/**
 * 本文件作用：
 * - 为权限内核与 catalog API 提供专项测试。
 * - 覆盖范围：
 *   1) shell 命令 `allow / ask / deny` 三种决策；
 *   2) approval request 的数据库写入；
 *   3) catalog node / facet / relation 的 HTTP CRUD。
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import type { JsonObject, ToolSpec } from "../types/index.js";
import { AppDatabase, seedDefaultConfigs } from "../storage/index.js";
import { AgentRegistry } from "../core/agents/index.js";
import { WorkflowRegistry } from "../core/workflows/index.js";
import { ToolRegistry, ToolRuntime } from "../core/tools/index.js";
import { PromptCompiler } from "../core/prompt/index.js";
import { UnifiedProviderClient } from "../providers/index.js";
import { TraceEventBus } from "../core/trace/index.js";
import { createNodeBoundRuntimeEngine } from "../engineNodeBindings.js";
import { registerHttpRoutes } from "../api/index.js";

function createShellSpec(id: string): ToolSpec {
  return {
    id,
    name: id,
    description: "测试 shell 工具",
    executorType: "shell",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" }
      },
      required: ["command"]
    },
    permissionProfileId: "perm.readonly",
    timeoutMs: 5000,
    workingDirPolicy: {
      mode: "workspace"
    },
    executorConfig: {
      permissionPolicy: {
        permissionProfileId: "perm.readonly",
        allowCommandPrefixes: ["echo ", "git ", "rm "]
      }
    } as unknown as JsonObject,
    enabled: true,
    version: 1
  };
}

async function createHarness(projectId: string) {
  const __filename = fileURLToPath(import.meta.url);
  const runtimeRoot = path.resolve(path.dirname(__filename), "../..");
  const workspaceRoot = path.resolve(runtimeRoot, "..", "..");
  const dataDir = path.join(runtimeRoot, "data", `${projectId}-${Date.now()}`);
  rmSync(dataDir, { recursive: true, force: true });

  const db = new AppDatabase(path.join(dataDir, "framework.sqlite"));
  seedDefaultConfigs(db, projectId);

  const agentRegistry = new AgentRegistry(db);
  const workflowRegistry = new WorkflowRegistry(db);
  const toolRegistry = new ToolRegistry(db, projectId);
  agentRegistry.refresh();
  workflowRegistry.refresh();
  toolRegistry.refresh();

  const promptCompiler = new PromptCompiler();
  const providerClient = new UnifiedProviderClient();
  const traceBus = new TraceEventBus(db);
  const toolRuntime = new ToolRuntime({
    workspaceRoot,
    shellAllowPrefixes: ["echo ", "git ", "rm "],
    getPermissionConfig: () => db.getSystemConfig(projectId).permissionPolicy
  });
  const { nodeEngine: engine } = createNodeBoundRuntimeEngine({
    projectId,
    db,
    agentRegistry,
    workflowRegistry,
    toolRegistry,
    promptCompiler,
    toolRuntime,
    providerClient,
    traceBus,
    workspaceRoot,
    dataDir
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  registerHttpRoutes(app, {
    projectId,
    db,
    agentRegistry,
    workflowRegistry,
    toolRegistry,
    promptCompiler,
    toolRuntime,
    providerClient,
    traceBus,
    workspaceRoot,
    dataDir,
    engine
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    db,
    toolRuntime,
    workspaceRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

async function testPermissionRuntime(harness: Awaited<ReturnType<typeof createHarness>>, projectId: string) {
  const allowResult = await harness.toolRuntime.execute(createShellSpec("tool.allow"), { command: "echo permission-ok" });
  assert.equal(allowResult.result.ok, true, "echo 命令应允许直接执行");

  const askResult = await harness.toolRuntime.execute(createShellSpec("tool.ask"), { command: "git add ." });
  assert.equal(askResult.result.ok, false, "git add 应要求审批");
  assert.equal(askResult.result.error?.code, "SHELL_APPROVAL_REQUIRED");

  const denyResult = await harness.toolRuntime.execute(createShellSpec("tool.deny"), { command: "rm -rf temp" });
  assert.equal(denyResult.result.ok, false, "破坏性命令应被拒绝");
  assert.equal(denyResult.result.error?.code, "SHELL_PERMISSION_DENIED");

  harness.db.upsertApprovalRequest({
    requestId: "approval.test",
    runId: "run.permission",
    threadId: "thread.permission",
    toolId: "builtin.shell_command",
    toolName: "shell_command",
    scope: "command",
    status: "pending",
    summary: "测试审批请求",
    payload: {
      command: "git add ."
    },
    requestedAt: new Date().toISOString()
  });
  assert.equal(harness.db.listApprovalRequestRows("run.permission").length, 1, "审批请求应成功落库");

  const nextConfig = harness.db.upsertSystemConfig(
    {
      permissionPolicy: {
        defaultMode: "deny",
        rules: [
          ...harness.db.getSystemConfig(projectId).permissionPolicy.rules,
          {
            ruleId: "perm.project.allow.workspace",
            layer: "project",
            scope: "path",
            action: "allow",
            matcher: {
              type: "prefix",
              value: harness.workspaceRoot
            },
            description: "允许测试工作区路径"
          }
        ]
      }
    },
    projectId
  );
  assert.ok(nextConfig.permissionPolicy.rules.length >= 1, "system config 应能持久化 permissionPolicy");
}

async function testCatalogHttpCrud(baseUrl: string) {
  const now = new Date().toISOString();
  const createResp = await fetch(`${baseUrl}/api/catalog/nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nodeId: "catalog.http.test",
      nodeClass: "item",
      name: "catalog.http.test",
      title: "HTTP Catalog Test",
      summaryText: "HTTP CRUD 测试节点",
      contentText: "正文",
      contentFormat: "markdown",
      primaryKind: "tool",
      visibility: "visible",
      exposeMode: "summary_first",
      enabled: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now
    })
  });
  assert.equal(createResp.status, 200, "创建 catalog node 应成功");

  const listNodesJson = (await (await fetch(`${baseUrl}/api/catalog/nodes`)).json()) as {
    ok: boolean;
    data: Array<{ nodeId: string }>;
  };
  assert.equal(listNodesJson.ok, true);
  assert.ok(listNodesJson.data.some((item) => item.nodeId === "catalog.http.test"), "节点应在列表中可见");

  const facetResp = await fetch(`${baseUrl}/api/catalog/nodes/catalog.http.test/facets/tool`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      payload: {
        toolKind: "http",
        executeMode: "direct_client",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" }
          }
        }
      }
    })
  });
  assert.equal(facetResp.status, 200, "保存 facet 应成功");

  const relationResp = await fetch(`${baseUrl}/api/catalog/relations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relationId: "rel.catalog.http",
      fromNodeId: "catalog.http.test",
      toNodeId: "block.system.safety",
      relationType: "reference",
      createdAt: now,
      updatedAt: now
    })
  });
  assert.equal(relationResp.status, 200, "保存 relation 应成功");

  const relationJson = (await (await fetch(`${baseUrl}/api/catalog/relations`)).json()) as {
    ok: boolean;
    data: Array<{ relationId: string }>;
  };
  assert.equal(relationJson.ok, true);
  assert.ok(relationJson.data.some((item) => item.relationId === "rel.catalog.http"), "relation 应出现在列表中");

  const promptUnitsJson = (await (await fetch(`${baseUrl}/api/catalog/prompt-units`)).json()) as {
    ok: boolean;
    data: unknown[];
  };
  assert.equal(promptUnitsJson.ok, true);
  assert.ok(Array.isArray(promptUnitsJson.data), "catalog prompt units 应返回数组");

  const deleteResp = await fetch(`${baseUrl}/api/catalog/nodes/catalog.http.test`, {
    method: "DELETE"
  });
  assert.equal(deleteResp.status, 200, "删除 node 应成功");
}

async function main() {
  const projectId = "permissions-catalog";
  const harness = await createHarness(projectId);
  try {
    await testPermissionRuntime(harness, projectId);
    await testCatalogHttpCrud(harness.baseUrl);
    console.log("PERMISSIONS_CATALOG_TEST_OK", {
      approvalRows: harness.db.listApprovalRequestRows("run.permission").length
    });
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error("PERMISSIONS_CATALOG_TEST_FAILED", error);
  process.exitCode = 1;
});
