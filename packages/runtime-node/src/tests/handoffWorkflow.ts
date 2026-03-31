/**
 * 本文件作用：
 * - 验证 handoff 已经成为一等 builtin tool，而不是旧的 orchestrator JSON 特判。
 * - 覆盖一条最小但完整的三节点多 Agent 通路：`research -> summary -> review`。
 *
 * 测试思路：
 * - 使用 `mock provider` 的规则化输出，让不同 agent 在各自 prompt marker 下稳定产出指定工具调用；
 * - 前两个 agent 显式调用 `handoff`；
 * - runtime 需要把 handoff 写入 packet，并让 `decideNextNode()` 优先消费 `pendingHandoff`；
 * - 最终 run 必须结束在 `node.review`，并且 trace 中能看到 handoff 路由原因。
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
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
import type { AgentSpec, PromptBlock, WorkflowSpec } from "../types/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const projectId = `handoff-${Date.now()}`;
  const __filename = fileURLToPath(import.meta.url);
  const runtimeRoot = path.resolve(path.dirname(__filename), "../..");
  const workspaceRoot = path.resolve(runtimeRoot, "..", "..");
  const dataDir = path.join(runtimeRoot, "data", `${projectId}-${process.pid}`);
  rmSync(dataDir, { recursive: true, force: true });

  const db = new AppDatabase(path.join(dataDir, "framework.sqlite"));
  seedDefaultConfigs(db, projectId);

  const promptBlocks: PromptBlock[] = [
    {
      id: "block.handoff.system",
      name: "handoff.system",
      kind: "system_rule",
      template: "你运行在 handoff 测试环境中。看到自己的 marker 后按要求行动。",
      insertionPoint: "system_pre",
      priority: 100,
      enabled: true,
      version: 1
    },
    {
      id: "block.handoff.research",
      name: "handoff.research",
      kind: "persona",
      template: "MARKER_RESEARCH_NODE: 你必须把研究结果 handoff 给 summary agent。",
      insertionPoint: "system_post",
      priority: 90,
      trigger: { agentIds: ["agent.test.research"] },
      enabled: true,
      version: 1
    },
    {
      id: "block.handoff.summary",
      name: "handoff.summary",
      kind: "persona",
      template: "MARKER_SUMMARY_NODE: 你必须把总结结果 handoff 给 review agent。",
      insertionPoint: "system_post",
      priority: 90,
      trigger: { agentIds: ["agent.test.summary"] },
      enabled: true,
      version: 1
    },
    {
      id: "block.handoff.review",
      name: "handoff.review",
      kind: "persona",
      template: "MARKER_REVIEW_NODE: 你负责做最终审查并直接回答。",
      insertionPoint: "system_post",
      priority: 90,
      trigger: { agentIds: ["agent.test.review"] },
      enabled: true,
      version: 1
    }
  ];
  for (const block of promptBlocks) {
    db.saveVersionedConfig("prompt_block", block);
  }

  const agents: AgentSpec[] = [
    {
      id: "agent.test.research",
      name: "研究代理",
      role: "research",
      description: "负责调研后 handoff 给总结代理。",
      promptBindings: [
        { bindingId: "bind.research.system", unitId: "block.handoff.system", enabled: true, order: 10 },
        { bindingId: "bind.research.marker", unitId: "block.handoff.research", enabled: true, order: 20 }
      ],
      toolAllowList: ["handoff"],
      toolRoutePolicy: { mode: "native_function_first", reason: "测试 handoff 原生工具调用" },
      handoffPolicy: {
        allowedTargets: ["agent.test.summary"],
        allowDynamicHandoff: true
      },
      enabled: true,
      version: 1
    },
    {
      id: "agent.test.summary",
      name: "总结代理",
      role: "summary",
      description: "负责总结后 handoff 给审查代理。",
      promptBindings: [
        { bindingId: "bind.summary.system", unitId: "block.handoff.system", enabled: true, order: 10 },
        { bindingId: "bind.summary.marker", unitId: "block.handoff.summary", enabled: true, order: 20 }
      ],
      toolAllowList: ["handoff"],
      toolRoutePolicy: { mode: "native_function_first", reason: "测试 handoff 原生工具调用" },
      handoffPolicy: {
        allowedTargets: ["agent.test.review"],
        allowDynamicHandoff: true
      },
      enabled: true,
      version: 1
    },
    {
      id: "agent.test.review",
      name: "审查代理",
      role: "review",
      description: "负责最终审查并结束流程。",
      promptBindings: [
        { bindingId: "bind.review.system", unitId: "block.handoff.system", enabled: true, order: 10 },
        { bindingId: "bind.review.marker", unitId: "block.handoff.review", enabled: true, order: 20 }
      ],
      toolAllowList: [],
      toolRoutePolicy: { mode: "native_function_first", reason: "最终节点不再 handoff" },
      enabled: true,
      version: 1
    }
  ];
  for (const agent of agents) {
    db.saveVersionedConfig("agent", agent);
  }

  const workflow: WorkflowSpec = {
    id: "workflow.test.handoff",
    name: "handoff workflow test",
    entryNode: "node.research",
    nodes: [
      { id: "node.research", type: "agent", label: "研究", agentId: "agent.test.research" },
      { id: "node.summary", type: "agent", label: "总结", agentId: "agent.test.summary" },
      { id: "node.review", type: "agent", label: "审查", agentId: "agent.test.review" }
    ],
    edges: [
      { id: "edge.research.summary", from: "node.research", to: "node.summary", condition: { type: "always" } },
      { id: "edge.summary.review", from: "node.summary", to: "node.review", condition: { type: "always" } }
    ],
    interruptPolicy: {
      defaultInterruptBefore: false,
      defaultInterruptAfter: false
    },
    enabled: true,
    version: 1
  };
  db.saveVersionedConfig("workflow", workflow);

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
      workspaceRoot,
      shellAllowPrefixes: ["echo "]
    }),
    providerClient: new UnifiedProviderClient(),
    traceBus,
    workspaceRoot,
    dataDir
  });

  const created = await engine.createRun({
    workflowId: workflow.id,
    userInput: "请从研究阶段开始，然后逐步总结并审查。",
    provider: {
      vendor: "mock",
      apiMode: "chat_completions",
      model: "mock-handoff-model",
      vendorExtra: {
        mockRules: [
          {
            match: "MARKER_RESEARCH_NODE",
            toolCalls: [
              {
                toolName: "handoff",
                argumentsJson: {
                  targetAgentId: "agent.test.summary",
                  taskSummary: "研究阶段完成，交给总结代理",
                  reason: "research_done"
                }
              }
            ]
          },
          {
            match: "MARKER_SUMMARY_NODE",
            toolCalls: [
              {
                toolName: "handoff",
                argumentsJson: {
                  targetAgentId: "agent.test.review",
                  taskSummary: "总结阶段完成，交给审查代理",
                  reason: "summary_done"
                }
              }
            ]
          },
          {
            match: "MARKER_REVIEW_NODE",
            text: "最终审查完成。"
          }
        ]
      }
    },
    runConfig: {
      interruptBeforeNodes: [],
      interruptAfterNodes: []
    }
  });

  await sleep(500);

  const summary = engine.getRunSummary(created.runId);
  const traces = traceBus.replay(created.runId, 0, 200);
  const routingReasons = traces
    .filter((item) => item.type === "routing_decided")
    .map((item) => {
      const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? (item.payload as Record<string, unknown>)
        : {};
      return payload.reason;
    });

  assert.ok(summary, "handoff 测试 run summary 不应为空");
  assert.equal(summary!.status, "completed", "handoff 三节点流程最终应完成");
  assert.equal(summary!.current_node_id, "node.review", "handoff 三节点流程最终应停在 review 节点");
  assert.ok(routingReasons.filter((item) => item === "handoff_pending").length >= 2, "trace 中应至少出现两次 handoff 路由");

  console.log("HANDOFF_WORKFLOW_TEST_OK", {
    runId: created.runId,
    currentNode: summary!.current_node_id,
    routingReasons
  });
}

main().catch((error) => {
  console.error("HANDOFF_WORKFLOW_TEST_FAILED", error);
  process.exitCode = 1;
});
