/**
 * 本文件作用：
 * - 将 Node 运行时（FrameworkRuntimeEngine）绑定到 core 的 `createRuntimeEngine` 入口。
 * - 让上层可以同时拿到：
 *   1) 原有 Node 引擎（完整能力）
 *   2) core 统一引擎接口（跨平台抽象）
 */

import { createRuntimeEngine, resolveThreeLayerConfig } from "@simpagent/core";
import type { CoreRuntimeDeps } from "@simpagent/core/ports";
import type { RuntimeDeps } from "./runtime/index.js";
import { FrameworkRuntimeEngine } from "./runtime/index.js";

/**
 * 创建 Node 绑定引擎。
 */
export function createNodeBoundRuntimeEngine(deps: RuntimeDeps) {
  const nodeEngine = new FrameworkRuntimeEngine(deps);

  const coreDeps: CoreRuntimeDeps = {
    storage: {
      saveVersionedConfig: (kind, payload) => deps.db.saveVersionedConfig(kind, payload),
      listWorkflows: () => deps.db.listWorkflows(),
      upsertRunSummary: (input) =>
        deps.db.upsertRunSummary({
          runId: input.runId,
          threadId: input.threadId,
          workflowId: input.workflowId,
          workflowVersion: input.workflowVersion,
          status: input.status as any,
          currentNodeId: input.currentNodeId,
          snapshotVersionRefs: input.snapshotVersionRefs,
          providerConfig: input.providerConfig,
          inputJson: input.inputJson,
          parentRunId: input.parentRunId,
          parentCheckpointId: input.parentCheckpointId
        }),
      getRunSummary: (runId) => (deps.db.getRunSummary(runId) as any) ?? null,
      insertTraceEvent: (event) => deps.db.insertTraceEvent(event),
      listTraceEvents: (runId, afterSeq, limit) => deps.db.listTraceEvents(runId, afterSeq ?? 0, limit ?? 200),
      insertPromptCompile: (input) =>
        deps.db.insertPromptCompile({
          compileId: input.compileId,
          runId: input.runId,
          threadId: input.threadId,
          agentId: input.agentId,
          providerApiType: input.providerApiType as any,
          promptTrace: input.promptTrace,
          finalMessages: input.finalMessages
        }),
      getPromptCompile: (compileId) => (deps.db.getPromptCompile(compileId) as any) ?? null,
      upsertRunPlan: (runId, threadId, plan) => deps.db.upsertRunPlan(runId, threadId, plan as any),
      getRunPlan: (runId) => deps.db.getRunPlan(runId) as any,
      upsertUserInputRequest: (input) =>
        deps.db.upsertUserInputRequest({
          requestId: input.requestId,
          runId: input.runId,
          threadId: input.threadId,
          nodeId: input.nodeId,
          agentId: input.agentId,
          state: input.state as any,
          payload: input.payload
        })
    },
    checkpoints: {
      async getCurrentState() {
        return null;
      },
      async updateState() {
        return;
      },
      async listHistory(threadId) {
        return (await nodeEngine.getThreadHistory(threadId)) as any;
      },
      async forkFromCheckpoint(input) {
        await nodeEngine.forkRunFromCheckpoint(input.threadId, input.checkpointId, { reason: "core_port_fork" });
      }
    },
    model: {
      stream: (req) => deps.providerClient.stream(req),
      invoke: (req) => deps.providerClient.invoke(req)
    },
    tools: {
      executeTool: async ({ toolName, args, workspaceRoot }) =>
        deps.toolRuntime.executeTool({
          toolCallId: deps.db.newId("toolcall"),
          toolId: toolName,
          toolName,
          argumentsJson: args as any
        }, { workspaceRoot: workspaceRoot ?? deps.workspaceRoot })
    },
    events: {
      emit: (event) => deps.traceBus.emit(event),
      replay: (runId, afterSeq, limit) => deps.traceBus.replay(runId, afterSeq ?? 0, limit ?? 200)
    },
    configResolver: {
      resolveConfig: (layers) => resolveThreeLayerConfig(layers as any)
    }
  };

  const coreEngine = createRuntimeEngine(coreDeps, {
    createRun: (req) => nodeEngine.createRun(req),
    getRunSummary: (runId) => nodeEngine.getRunSummary(runId) as any
  });

  return {
    nodeEngine,
    coreEngine
  };
}
