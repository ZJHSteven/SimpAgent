/**
 * 本文件作用：
 * - 提供最小冒烟测试脚本（不启动 HTTP 服务）。
 * - 验证核心链路：SQLite 初始化 -> 种子配置 -> Runtime 创建 run（Mock provider）-> 状态查询。
 *
 * 使用方式：
 * - 在 `backend` 目录执行：`npm run test:smoke`
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase, seedDefaultConfigs } from "../storage/index.js";
import { AgentRegistry } from "../core/agents/index.js";
import { WorkflowRegistry } from "../core/workflows/index.js";
import { ToolRegistry, ToolRuntime } from "../core/tools/index.js";
import { PromptCompiler } from "../core/prompt/index.js";
import { UnifiedProviderClient } from "../providers/index.js";
import { TraceEventBus } from "../core/trace/index.js";
import { FrameworkRuntimeEngine } from "../runtime/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const projectId = "smoke";
  const __filename = fileURLToPath(import.meta.url);
  const backendRoot = path.resolve(path.dirname(__filename), "../..");
  // 使用唯一测试目录，避免并发执行时多个 smoke 互相抢占同一 SQLite 文件。
  const dataDir = path.join(backendRoot, "data", `${projectId}-${process.pid}-${Date.now()}`);
  const db = new AppDatabase(path.join(dataDir, "framework-smoke.sqlite"));
  seedDefaultConfigs(db, projectId);

  const agentRegistry = new AgentRegistry(db);
  const workflowRegistry = new WorkflowRegistry(db);
  const toolRegistry = new ToolRegistry(db, projectId);
  agentRegistry.refresh();
  workflowRegistry.refresh();
  toolRegistry.refresh();

  const traceBus = new TraceEventBus(db);
  const engine = new FrameworkRuntimeEngine({
    projectId,
    db,
    agentRegistry,
    workflowRegistry,
    toolRegistry,
    promptCompiler: new PromptCompiler(),
    toolRuntime: new ToolRuntime({
      workspaceRoot: path.resolve(backendRoot, ".."),
      shellAllowPrefixes: ["echo "]
    }),
    providerClient: new UnifiedProviderClient(),
    traceBus,
    workspaceRoot: path.resolve(backendRoot, ".."),
    dataDir
  });

  const created = await engine.createRun({
    workflowId: "workflow.default",
    userInput: "请演示一个简单任务：先拆解再给出回答。",
    provider: {
      vendor: "mock",
      apiMode: "chat_completions",
      model: "mock-model"
    },
    runConfig: {
      interruptBeforeNodes: [],
      interruptAfterNodes: []
    }
  });

  // 等待后台异步执行一小段时间（首版运行时以后台任务方式推进）。
  await sleep(300);

  const summary = engine.getRunSummary(created.runId);
  const traces = traceBus.replay(created.runId, 0, 100);

  console.log("SMOKE_RUN_CREATED", created);
  console.log("SMOKE_RUN_SUMMARY", {
    runId: summary?.run_id,
    status: summary?.status,
    currentNode: summary?.current_node_id
  });
  console.log("SMOKE_TRACE_COUNT", traces.length);

  if (!summary) {
    throw new Error("冒烟失败：run summary 不存在");
  }
  if (traces.length === 0) {
    throw new Error("冒烟失败：trace 事件为空");
  }
}

main().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
