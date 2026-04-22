/**
 * runtime-node 关键能力测试：
 * - 配置解析
 * - 文件读写/替换/删除
 * - shell 执行
 * - trace 落盘
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createUuidV7Id } from "@simpagent/agent-core";
import { JsonFileTraceStore, NodeFileRuntime, NodeShellRuntime, parseSimpleToml } from "./index.js";

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

  it("trace store 会把 thread 与 trace 落盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "simpagent-"));
    const store = new JsonFileTraceStore(dir);
    const threadId = createUuidV7Id();
    const turnId = createUuidV7Id();

    await store.saveThread(threadId, { id: threadId, title: "测试" });
    await store.saveTrace({
      threadId,
      turnId,
      createdAt: 1,
      responseEvents: [],
      toolApprovals: [],
      toolResults: [],
      errors: [],
      metrics: {}
    });

    expect(threadId).toMatch(uuidV7Pattern);
    expect(turnId).toMatch(uuidV7Pattern);
    expect(await store.loadThread(threadId)).toEqual({ id: threadId, title: "测试" });
    expect(await store.listThreads()).toHaveLength(1);
  });
});
