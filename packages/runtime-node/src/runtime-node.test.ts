/**
 * runtime-node 关键能力测试：
 * - 配置解析
 * - 文件读写/替换/删除
 * - shell 执行
 * - SQLite trace 落盘
 */
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createUuidV7Id } from "@simpagent/agent-core";
import { NodeFileRuntime, NodeShellRuntime, SqliteTraceStore, parseSimpleToml } from "./index.js";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("runtime-node", () => {
  it("解析简单 TOML 配置", () => {
    expect(parseSimpleToml('provider = "deepseek"\ntimeoutMs = 1000\n')).toEqual({
      provider: "deepseek",
      timeoutMs: 1000
    });
  });

  it("read_file 支持行范围并拒绝非法范围", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-"));
    const path = join(dir, "a.txt");
    const runtime = new NodeFileRuntime();

    await writeFile(path, "一\n二\n三", "utf8");
    await expect(runtime.readTextFile({ path, startLine: 2, endLine: 3 })).resolves.toMatchObject({
      text: "二\n三",
      metadata: { totalLines: 3, startLine: 2, endLine: 3 }
    });
    await expect(runtime.readTextFile({ path, startLine: 4, endLine: 3 })).rejects.toThrow("行号范围无效");
  });

  it("edit_file 支持新建、替换和删除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-"));
    const path = join(dir, "nested", "a.txt");
    const runtime = new NodeFileRuntime();

    await runtime.editTextFile({ path, edits: [{ oldText: "", newText: "hello" }] });
    await runtime.editTextFile({ path, edits: [{ oldText: "hello", newText: "world" }] });
    expect(await readFile(path, "utf8")).toBe("world");
    await runtime.editTextFile({ path, edits: [{ oldText: "", newText: "" }] });
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("shell_command 返回 stdout、stderr 和退出码", async () => {
    const runtime = new NodeShellRuntime();
    const result = await runtime.runCommand({ command: "node -e \"console.log('ok')\"", timeoutMs: 5000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.timedOut).toBe(false);
  });

  it("SQLite trace store 会把 conversation、message 与 event 落库", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-"));
    const store = new SqliteTraceStore(dir);
    const threadId = createUuidV7Id();
    const turnId = createUuidV7Id();

    await store.saveThread(threadId, {
      id: threadId,
      agentId: createUuidV7Id(),
      title: "测试",
      tags: ["coding", "review"],
      createdAt: 1,
      updatedAt: 2,
      metadata: {
        source: "unit-test"
      },
      messages: [
        {
          id: createUuidV7Id(),
          role: "user",
          content: "你好",
          tags: ["question"]
        }
      ]
    });
    await store.saveTrace({
      threadId,
      turnId,
      createdAt: 1,
      requests: [
        {
          url: "https://example.test/v1/chat/completions",
          method: "POST",
          headers: {
            authorization: "Bearer secret"
          },
          body: {
            model: "test-model",
            messages: []
          }
        }
      ],
      responseEvents: [],
      toolApprovals: [],
      toolResults: [],
      errors: [],
      metrics: {}
    });

    expect(threadId).toMatch(uuidV7Pattern);
    expect(turnId).toMatch(uuidV7Pattern);
    const databaseFile = await stat(join(dir, "simpagent.sqlite"));
    expect(databaseFile.isFile()).toBe(true);
    expect(await store.loadThread(threadId)).toMatchObject({
      id: threadId,
      title: "测试",
      tags: ["coding", "review"],
      metadata: { source: "unit-test" },
      messages: [
        {
          role: "user",
          content: "你好",
          tags: ["question"]
        }
      ]
    });
    expect(await store.listThreads()).toHaveLength(1);
    store.close();

    const db = new DatabaseSync(join(dir, "simpagent.sqlite"));
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{
      readonly name: string;
    }>;
    const tableNames = tableRows.map((row) => row.name);
    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("nodes");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("events");
    expect(tableNames).not.toContain("tags");
    expect(tableNames).not.toContain("conversation_tags");
    expect(tableNames).not.toContain("node_tags");
    expect(tableNames).not.toContain("message_tags");
    expect(tableNames).not.toContain("graphs");
    expect(tableNames).not.toContain("runs");
    expect(tableNames).not.toContain("turns");

    const nodeColumns = db.prepare("PRAGMA table_info(nodes)").all() as unknown as Array<{
      readonly name: string;
    }>;
    const edgeColumns = db.prepare("PRAGMA table_info(edges)").all() as unknown as Array<{
      readonly name: string;
    }>;
    expect(nodeColumns.map((row) => row.name)).toContain("name");
    expect(edgeColumns.map((row) => row.name)).not.toContain("priority");

    const conversationNode = db.prepare("SELECT node_type, metadata_json FROM nodes WHERE id = ?").get(threadId) as
      | {
          readonly node_type: string;
          readonly metadata_json: string | null;
        }
      | undefined;
    expect(conversationNode?.node_type).toBe("conversation");
    expect(conversationNode?.metadata_json).toContain("unit-test");
    expect(conversationNode?.metadata_json).not.toContain("threadSnapshot");

    const tagRows = db
      .prepare(
        `
        SELECT tag_nodes.name AS name
        FROM edges
        JOIN nodes AS tag_nodes ON tag_nodes.id = edges.target_node_id
        WHERE edges.source_node_id = ?
          AND edges.edge_type = 'hashtag'
          AND tag_nodes.node_type = 'tag'
        ORDER BY tag_nodes.name
      `
      )
      .all(threadId) as unknown as Array<{ readonly name: string }>;
    expect(tagRows.map((row) => row.name)).toEqual(["coding", "review"]);

    const reverseTagRows = db
      .prepare(
        `
        SELECT source_nodes.id AS id
        FROM edges
        JOIN nodes AS source_nodes ON source_nodes.id = edges.source_node_id
        JOIN nodes AS tag_nodes ON tag_nodes.id = edges.target_node_id
        WHERE tag_nodes.name = ?
          AND tag_nodes.node_type = 'tag'
          AND edges.edge_type = 'hashtag'
      `
      )
      .all("coding") as unknown as Array<{ readonly id: string }>;
    expect(reverseTagRows.map((row) => row.id)).toContain(threadId);

    const indexRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as unknown as Array<{
      readonly name: string;
    }>;
    const indexNames = indexRows.map((row) => row.name);
    expect(indexNames).toContain("idx_edges_source");
    expect(indexNames).toContain("idx_edges_target");

    const llmCall = db.prepare("SELECT request_json FROM llm_calls LIMIT 1").get() as
      | {
          readonly request_json: string;
        }
      | undefined;
    expect(llmCall?.request_json).toContain("[redacted]");
    expect(llmCall?.request_json).not.toContain("Bearer secret");
    db.close();
  });
});
