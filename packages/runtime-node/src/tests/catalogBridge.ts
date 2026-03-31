/**
 * 本文件作用：
 * - 为统一图谱 + PromptUnit 主链路 + MCP/Skill shell bridge 提供较完整的集成测试。
 * - 覆盖范围：
 *   1) catalog PromptUnit 兼容读取；
 *   2) MCP stdio / streamable-http / SSE 三种 transport 的同步与调用；
 *   3) args-json / flags 两种参数输入；
 *   4) skill 脚本执行与失败路径；
 *   5) context PromptUnit 投影与关系表基础 CRUD。
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { CatalogNode, CatalogNodeFacet, CatalogRelation, JsonObject, JsonValue } from "../types/index.js";
import { InternalShellBridge } from "../bridges/index.js";
import { AppDatabase, seedDefaultConfigs } from "../storage/index.js";

function createMockMcpServer(transportLabel: string): McpServer {
  const server = new McpServer({
    name: `mock-${transportLabel}-server`,
    version: "1.0.0"
  });
  server.registerTool(
    "echo_payload",
    {
      description: `回显输入参数，并标记 transport=${transportLabel}`,
      inputSchema: {
        message: z.string().describe("要回显的文本"),
        count: z.number().int().describe("次数")
      }
    } as any,
    async ({ message, count }: any) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            transport: transportLabel,
            message,
            count,
            echoed: `${message}:${count}`
          })
        }
      ],
      structuredContent: {
        transport: transportLabel,
        message,
        count,
        echoed: `${message}:${count}`
      }
    })
  );
  return server;
}

async function startStreamableHttpServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createMcpExpressApp();
  app.all("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    const server = createMockMcpServer("streamable-http");
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

async function startSseServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createMcpExpressApp();
  const transports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();

  app.get("/mcp", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const server = createMockMcpServer("sse");
    const sessionId = transport.sessionId;
    transports.set(sessionId, { transport, server });
    transport.onclose = () => {
      transports.delete(sessionId);
    };
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const record = transports.get(sessionId);
    if (!record) {
      res.status(404).send("session not found");
      return;
    }
    await record.transport.handlePostMessage(req, res, req.body);
  });

  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      for (const record of transports.values()) {
        await record.transport.close();
        await record.server.close();
      }
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

function createBridgeContext(suffix: string) {
  return {
    runId: `run_${suffix}`,
    threadId: `thread_${suffix}`,
    nodeId: `node_${suffix}`,
    agentId: `agent_${suffix}`,
    toolCallId: `toolcall_${suffix}`,
    toolId: "builtin.shell_command",
    toolName: "shell_command",
    workspaceRoot: process.cwd()
  };
}

function saveCatalogNodeAndFacet(db: AppDatabase, node: CatalogNode, facets: CatalogNodeFacet[]): void {
  db.saveCatalogNode(node);
  for (const facet of facets) db.saveCatalogFacet(facet);
}

function saveMcpServerNode(db: AppDatabase, projectId: string, nodeId: string, transport: "stdio" | "streamable-http" | "sse", clientConfig: JsonObject): void {
  saveCatalogNodeAndFacet(
    db,
    {
      nodeId,
      projectId,
      nodeClass: "group",
      name: nodeId,
      title: nodeId,
      summaryText: `MCP server ${nodeId}`,
      contentText: `MCP server ${nodeId} transport=${transport}`,
      contentFormat: "markdown",
      primaryKind: "mcp",
      visibility: "visible",
      exposeMode: "summary_first",
      enabled: true,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    [
      {
        facetId: `facet.integration.${nodeId}`,
        nodeId,
        facetType: "integration",
        payload: {
          sourceType: "mcp_server",
          transport,
          serverName: nodeId,
          clientConfig
        },
        updatedAt: new Date().toISOString()
      }
    ]
  );
}

function saveSkillNode(db: AppDatabase, projectId: string, nodeId: string, executionConfig: JsonObject): void {
  saveCatalogNodeAndFacet(
    db,
    {
      nodeId,
      projectId,
      nodeClass: "item",
      name: nodeId,
      title: nodeId,
      summaryText: `Skill ${nodeId}`,
      contentText: `Skill ${nodeId} 的提示说明`,
      contentFormat: "markdown",
      primaryKind: "skill",
      visibility: "visible",
      exposeMode: "summary_first",
      enabled: true,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    [
      {
        facetId: `facet.prompt.${nodeId}`,
        nodeId,
        facetType: "prompt",
        payload: {
          promptKind: "tool_hint",
          role: "developer",
          insertionPoint: "tool_context",
          priority: 10
        },
        updatedAt: new Date().toISOString()
      },
      {
        facetId: `facet.tool.${nodeId}`,
        nodeId,
        facetType: "tool",
        payload: {
          toolKind: "skill_tool",
          route: {
            kind: "skill_tool",
            skillId: nodeId
          },
          executorType: "shell",
          inputSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
              count: { type: "integer" },
              fail: { type: "boolean" }
            },
            required: ["message", "count"]
          },
          exposurePolicy: {
            preferredAdapter: "chat_function",
            fallbackAdapters: ["structured_output_tool_call", "prompt_protocol_fallback"],
            exposureLevel: "description",
            exposeByDefault: true,
            catalogPath: ["catalog", "skill"]
          },
          permissionPolicy: {
            permissionProfileId: "perm.readonly",
            shellPermissionLevel: "readonly",
            timeoutMs: 15_000
          },
          executionConfig
        },
        updatedAt: new Date().toISOString()
      }
    ]
  );
}

function extractStructuredPayload(result: JsonValue | undefined): JsonObject {
  assert.ok(result && typeof result === "object" && !Array.isArray(result), "工具输出必须是对象");
  const response = result as Record<string, JsonValue>;
  if ("response" in response && response.response && typeof response.response === "object" && !Array.isArray(response.response)) {
    const content = (response.response as Record<string, JsonValue>).content as JsonValue[] | undefined;
    assert.ok(content && Array.isArray(content) && content.length > 0, "MCP 返回内容不能为空");
    const firstItem = content[0] as Record<string, JsonValue>;
    return JSON.parse(String(firstItem.text)) as JsonObject;
  }
  if ("parsedStdout" in response && response.parsedStdout && typeof response.parsedStdout === "object" && !Array.isArray(response.parsedStdout)) {
    return response.parsedStdout as JsonObject;
  }
  throw new Error("无法从工具输出中提取结构化内容");
}

async function main() {
  const projectId = "catalog-bridge";
  const __filename = fileURLToPath(import.meta.url);
  const runtimeRoot = path.resolve(path.dirname(__filename), "../..");
  const workspaceRoot = path.resolve(runtimeRoot, "..", "..");
  // 使用唯一测试目录，避免 catalog bridge 与其他测试并发时删除同一路径触发 EPERM。
  const dataDir = path.join(runtimeRoot, "data", `${projectId}-${process.pid}-${Date.now()}`);
  rmSync(dataDir, { recursive: true, force: true });

  const db = new AppDatabase(path.join(dataDir, "framework-catalog-bridge.sqlite"));
  seedDefaultConfigs(db, projectId);

  const promptUnit = db.getPromptUnit("block.system.safety", undefined, projectId);
  assert.ok(promptUnit, "默认 prompt unit 应可读取");
  assert.equal(promptUnit?.sourceRef?.kind, "catalog_node", "旧 PromptUnit API 应优先返回 catalog 来源");

  const relation: CatalogRelation = {
    relationId: "rel.catalog.test",
    projectId,
    fromNodeId: "block.system.safety",
    toNodeId: "block.task.input",
    relationType: "reference",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.saveCatalogRelation(relation);
  assert.equal(db.listCatalogRelations(projectId).length, 1, "catalog relation CRUD 应可用");

  const stdioFixturePath = path.join(runtimeRoot, "src", "tests", "fixtures", "mockMcpStdioServer.mjs");
  const skillFixturePath = path.join(runtimeRoot, "src", "tests", "fixtures", "mockSkillScript.mjs");

  const streamableServer = await startStreamableHttpServer();
  const sseServer = await startSseServer();

  try {
    saveMcpServerNode(db, projectId, "mcp.server.stdio", "stdio", {
      command: process.execPath,
      args: [stdioFixturePath]
    });
    saveMcpServerNode(db, projectId, "mcp.server.http", "streamable-http", {
      url: streamableServer.url
    });
    saveMcpServerNode(db, projectId, "mcp.server.sse", "sse", {
      url: sseServer.url
    });

    saveSkillNode(db, projectId, "skill.argsjson", {
      command: process.execPath,
      args: [skillFixturePath],
      argMode: "args_json"
    });
    saveSkillNode(db, projectId, "skill.flags", {
      command: process.execPath,
      args: [skillFixturePath],
      argMode: "flags"
    });

    const bridge = new InternalShellBridge({
      projectId,
      db,
      workspaceRoot
    });

    for (const serverId of ["mcp.server.stdio", "mcp.server.http", "mcp.server.sse"]) {
      const synced = await bridge.syncMcpServer(serverId);
      assert.equal(synced.createdToolNodeIds.length, 1, `${serverId} 应映射出一个 mcp tool 节点`);
      const projected = db.listCatalogContextPromptUnits(projectId).find((item) => item.id === `catalog.projected.tool.${synced.createdToolNodeIds[0]}`);
      assert.ok(projected, `${serverId} 的工具节点应能投影成 PromptUnit`);
      assert.match(projected!.template, /simpagent mcp call/, "投影内容里应包含标准 bridge 命令");
    }

    const stdioCall = await bridge.tryExecute(
      `simpagent mcp call --server mcp.server.stdio --tool echo_payload --args-json '{"message":"hello","count":2}'`,
      createBridgeContext("stdio")
    );
    assert.ok(stdioCall?.handled && stdioCall.toolResult?.ok, "stdio MCP 调用应成功");
    assert.equal(extractStructuredPayload(stdioCall!.toolResult!.output).transport, "stdio");

    const httpCall = await bridge.tryExecute(
      `simpagent mcp call --server mcp.server.http --tool echo_payload --message http --count 3`,
      createBridgeContext("http")
    );
    assert.ok(httpCall?.handled && httpCall.toolResult?.ok, "streamable-http MCP flags 调用应成功");
    assert.equal(extractStructuredPayload(httpCall!.toolResult!.output).transport, "streamable-http");

    const sseCall = await bridge.tryExecute(
      `simpagent mcp call --server mcp.server.sse --tool echo_payload --message sse --count 4`,
      createBridgeContext("sse")
    );
    assert.ok(sseCall?.handled && sseCall.toolResult?.ok, "SSE MCP flags 调用应成功");
    assert.equal(extractStructuredPayload(sseCall!.toolResult!.output).transport, "sse");

    const schemaError = await bridge.tryExecute(
      `simpagent mcp call --server mcp.server.stdio --tool echo_payload --message only-text`,
      createBridgeContext("mcp_schema")
    );
    assert.ok(schemaError?.handled && !schemaError.toolResult?.ok, "MCP 缺少必填字段时应失败");
    assert.equal(schemaError?.toolResult?.error?.code, "MCP_INPUT_SCHEMA_INVALID");

    const missingServer = await bridge.tryExecute(
      `simpagent mcp call --server missing-server --tool echo_payload --args-json '{"message":"x","count":1}'`,
      createBridgeContext("mcp_missing")
    );
    assert.ok(missingServer?.handled && !missingServer.toolResult?.ok, "MCP 缺失 server 时应返回结构化失败");

    const skillArgsJson = await bridge.tryExecute(
      `simpagent skill call --skill skill.argsjson --args-json '{"message":"alpha","count":5}'`,
      createBridgeContext("skill_argsjson")
    );
    assert.ok(skillArgsJson?.handled && skillArgsJson.toolResult?.ok, "skill args-json 调用应成功");
    assert.equal(extractStructuredPayload(skillArgsJson!.toolResult!.output).echoed, "alpha:5");

    const skillFlags = await bridge.tryExecute(
      `simpagent skill call --skill skill.flags --message beta --count 6`,
      createBridgeContext("skill_flags")
    );
    assert.ok(skillFlags?.handled && skillFlags.toolResult?.ok, "skill flags 调用应成功");
    assert.equal(extractStructuredPayload(skillFlags!.toolResult!.output).echoed, "beta:6");

    const skillSchemaError = await bridge.tryExecute(
      `simpagent skill call --skill skill.argsjson --args-json '{"message":"gamma"}'`,
      createBridgeContext("skill_schema")
    );
    assert.ok(skillSchemaError?.handled && !skillSchemaError.toolResult?.ok, "skill 缺参时应失败");
    assert.equal(skillSchemaError?.toolResult?.error?.code, "SKILL_INPUT_SCHEMA_INVALID");

    const skillFailure = await bridge.tryExecute(
      `simpagent skill call --skill skill.flags --message fail --count 1 --fail`,
      createBridgeContext("skill_fail")
    );
    assert.ok(skillFailure?.handled && !skillFailure.toolResult?.ok, "skill 脚本失败时应返回失败结果");
    assert.equal(skillFailure?.toolResult?.error?.code, "SKILL_COMMAND_FAILED");

    assert.ok((stdioCall?.sideEffects?.length ?? 0) >= 1, "bridge 调用必须产生 side effects");

    console.log("CATALOG_BRIDGE_TEST_OK", {
      promptUnitSource: promptUnit?.sourceRef?.kind,
      relations: db.listCatalogRelations(projectId).length,
      projectedPromptUnits: db.listCatalogContextPromptUnits(projectId).length
    });
  } finally {
    await streamableServer.close();
    await sseServer.close();
  }
}

main().catch((error) => {
  console.error("CATALOG_BRIDGE_TEST_FAILED", error);
  process.exitCode = 1;
});
