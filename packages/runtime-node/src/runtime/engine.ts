/**
 * 本文件作用：
 * - 基于 LangGraph.js 实现框架运行时封装。
 * - 提供 run 创建/执行、暂停/恢复、中断、checkpoint 历史、状态补丁、分叉重跑能力。
 *
 * 教学说明（重要）：
 * - 这里的代码并不是“只让图跑起来”，而是把可观测性、可调试性、可人工介入一起纳入运行时。
 * - LangGraph 负责 checkpoint / interrupt / replay / updateState 这些底层能力；
 *   我们负责 Prompt 编译、Provider 兼容、工具执行、Trace 事件。
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type {
  AgentSpec,
  CanonicalToolSpec,
  CanonicalToolCallIntent,
  CanonicalToolCallResult,
  CanonicalToolSideEffectRecord,
  CreateRunRequest,
  CreateRunResponse,
  ForkRunRequest,
  ForkRunResponse,
  JsonObject,
  JsonValue,
  PromptBlock,
  PromptCompileRequest,
  PromptOverridePatchRequest,
  PromptUnitOverridePatchRequest,
  ProviderApiMode,
  RunState,
  RunStatus,
  StateDiffTrace,
  StatePatchRequest,
  ToolSpec,
  UnifiedMessage,
  UnifiedModelRequest,
  WorkflowEdgeSpec,
  WorkflowNodeSpec,
  WorkflowSpec
} from "../types/index.js";
import type { AppDatabase } from "../storage/index.js";
import type { AgentRegistry } from "../core/agents/index.js";
import type { WorkflowRegistry } from "../core/workflows/index.js";
import type { ToolRegistry } from "../core/tools/index.js";
import { ToolRuntime } from "../core/tools/index.js";
import {
  CanonicalToolRouter,
  buildUserInputRequestState,
  executeBuiltinApplyPatch,
  executeBuiltinReadFile,
  executeBuiltinViewImage,
  executeBuiltinWebSearch,
  exposureAdapters,
  normalizeAndValidatePlan,
  selectToolExposureAdapter
} from "../core/tools/index.js";
import { PromptCompiler } from "../core/prompt/index.js";
import { TraceEventBus } from "../core/trace/index.js";
import { UnifiedProviderClient, validateProviderRequestCapabilities } from "../providers/index.js";
import { InternalShellBridge } from "../bridges/index.js";
import { AgentRoundExecutor, ToolLoopExecutor } from "./index.js";

type GraphEnvelope = { state: RunState };
type RunRecord = {
  runId: string;
  threadId: string;
  workflowId: string;
  workflowVersion: number;
  provider: CreateRunRequest["provider"];
};

const GraphAnn = Annotation.Root({
  state: Annotation<RunState>()
});

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function safeJsonParseObject(text: string): JsonObject | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
    return null;
  } catch {
    return null;
  }
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return (patch as T) ?? base;
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const prev = result[k];
    if (v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev)) {
      result[k] = deepMerge(prev, v);
    } else {
      result[k] = v;
    }
  }
  return result as T;
}

function summarize(value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text.length <= 2000) return value;
  return { truncated: true, preview: text.slice(0, 2000) };
}

function normalizePath(pathExpr: string): string[] {
  return pathExpr
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getByPath(input: unknown, pathExpr: string): unknown {
  const parts = normalizePath(pathExpr);
  let current: unknown = input;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setByPath<T extends object>(input: T, pathExpr: string, value: unknown): T {
  const parts = normalizePath(pathExpr);
  if (parts.length === 0) return input;
  const root = Array.isArray(input) ? ([...input] as unknown as Record<string, unknown>) : ({ ...(input as any) } as Record<string, unknown>);
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    } else {
      cursor[key] = { ...(next as Record<string, unknown>) };
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return root as unknown as T;
}

function resolveAgentToolProtocolProfile(args: {
  providerProfile?: CreateRunRequest["provider"]["toolProtocolProfile"];
  providerApiMode: ProviderApiMode;
  agentRouteMode?: "auto" | "native_function_first" | "shell_only" | "prompt_protocol_only";
}): CreateRunRequest["provider"]["toolProtocolProfile"] {
  if (args.agentRouteMode === "prompt_protocol_only") return "prompt_protocol_only";
  if (args.agentRouteMode === "shell_only") {
    // shell_only 是“仅暴露 shell 桥接工具”，不是“禁用原生 tools”。
    return args.providerApiMode === "responses" ? "openai_responses" : "openai_chat_function";
  }
  if (args.agentRouteMode === "native_function_first") {
    return args.providerApiMode === "responses" ? "openai_responses" : "openai_chat_function";
  }
  return args.providerProfile;
}

function isShellBridgeCanonicalTool(tool: CanonicalToolSpec): boolean {
  const idText = String(tool.id).toLowerCase();
  const nameText = String(tool.name).toLowerCase();
  if (nameText === "shell_command") return true;
  if (idText.includes("shell_command")) return true;
  return false;
}

export interface RuntimeDeps {
  projectId: string;
  db: AppDatabase;
  agentRegistry: AgentRegistry;
  workflowRegistry: WorkflowRegistry;
  toolRegistry: ToolRegistry;
  promptCompiler: PromptCompiler;
  toolRuntime: ToolRuntime;
  providerClient: UnifiedProviderClient;
  traceBus: TraceEventBus;
  workspaceRoot: string;
  dataDir: string;
}

export class FrameworkRuntimeEngine {
  private readonly checkpointer: SqliteSaver;
  private readonly graphCache = new Map<string, any>();
  private readonly activeRuns = new Map<string, RunRecord>();
  private readonly internalShellBridge: InternalShellBridge;

  constructor(private readonly deps: RuntimeDeps) {
    mkdirSync(this.deps.dataDir, { recursive: true });
    this.checkpointer = SqliteSaver.fromConnString(path.join(this.deps.dataDir, "langgraph-checkpoints.sqlite"));
    this.internalShellBridge = new InternalShellBridge({
      projectId: this.deps.projectId,
      db: this.deps.db,
      workspaceRoot: this.deps.workspaceRoot
    });
  }

  async createRun(request: CreateRunRequest): Promise<CreateRunResponse> {
    const workflow = this.resolveWorkflow(request.workflowId, request.workflowVersion);
    const runId = newId("run");
    const threadId = newId("thread");
    const snapshotRefs = this.buildSnapshotVersionRefs(workflow);
    const state = this.buildInitialState(runId, threadId, workflow, request, snapshotRefs);

    this.deps.db.upsertRunSummary({
      runId,
      threadId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: "created",
      currentNodeId: workflow.entryNode,
      snapshotVersionRefs: snapshotRefs as unknown as JsonValue,
      providerConfig: request.provider as unknown as JsonValue,
      inputJson: { userInput: request.userInput },
      parentRunId: undefined,
      parentCheckpointId: undefined
    });

    const record: RunRecord = {
      runId,
      threadId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      provider: request.provider
    };
    this.activeRuns.set(runId, record);

    this.deps.traceBus.emit({
      runId,
      threadId,
      type: "run_started",
      summary: "Run 已创建",
      payload: { workflowId: workflow.id, workflowVersion: workflow.version }
    });

    void this.executeGraph(record, workflow, { state });

    return { runId, threadId, status: "running" };
  }

  getRunSummary(runId: string) {
    return this.deps.db.getRunSummary(runId);
  }

  async requestPause(runId: string, reason = "manual_pause"): Promise<void> {
    const record = this.getRunRecord(runId);
    await this.patchLiveHeadState(record, {
      flags: { pauseRequested: true, softPauseAtNextSafePoint: true },
      humanReviewState: { pendingInterrupt: { reason, at: nowIso() } }
    });
    this.deps.traceBus.emit({
      runId,
      threadId: record.threadId,
      type: "interrupt_emitted",
      summary: "已请求软暂停（下一安全点生效）",
      payload: { reason }
    });
  }

  async requestInterrupt(runId: string, reason: string, payload?: JsonValue): Promise<void> {
    const record = this.getRunRecord(runId);
    await this.patchLiveHeadState(record, {
      flags: { pauseRequested: true, softPauseAtNextSafePoint: true },
      humanReviewState: { pendingInterrupt: { reason, payload, at: nowIso() } }
    });
    this.deps.traceBus.emit({
      runId,
      threadId: record.threadId,
      type: "interrupt_emitted",
      summary: "已请求人工中断（下一安全点生效）",
      payload: { reason, payload: summarize(payload) ?? null } as unknown as JsonValue
    });
  }

  async resumeRun(runId: string, resumePayload?: JsonValue): Promise<void> {
    const record = this.getRunRecord(runId);
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);

    await this.patchLiveHeadState(record, {
      flags: { pauseRequested: false, softPauseAtNextSafePoint: false },
      humanReviewState: { lastResumePayload: resumePayload, pendingInterrupt: undefined },
      status: "running"
    });

    this.deps.traceBus.emit({
      runId,
      threadId: record.threadId,
      type: "resume_received",
      summary: "收到恢复指令",
      payload: summarize(resumePayload)
    });

    void this.executeGraph(record, workflow, new Command({ resume: resumePayload ?? "继续" }) as unknown);
  }

  async getThreadHistory(threadId: string): Promise<JsonValue[]> {
    const record = this.getRunRecordByThread(threadId);
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);
    const graph = this.getOrBuildGraph(workflow);
    const result: JsonValue[] = [];

    for await (const snapshot of graph.getStateHistory(this.threadConfig(threadId))) {
      const checkpointId = String(snapshot?.config?.configurable?.checkpoint_id ?? "");
      const parentCheckpointId = snapshot?.parentConfig?.configurable?.checkpoint_id
        ? String(snapshot.parentConfig.configurable.checkpoint_id)
        : undefined;
      const runState = (snapshot.values as GraphEnvelope | undefined)?.state;
      if (checkpointId) {
        this.deps.db.upsertCheckpointIndex({
          threadId,
          checkpointId,
          parentCheckpointId,
          runId: runState?.runMeta.runId,
          metadata: (snapshot.metadata ?? null) as JsonValue
        });
      }
      result.push({
        checkpointId,
        parentCheckpointId: parentCheckpointId ?? null,
        createdAt: snapshot.createdAt ?? null,
        next: snapshot.next,
        tasks: snapshot.tasks,
        runStateSummary: runState
          ? {
              runId: runState.runMeta.runId,
              status: runState.status,
              currentNodeId: runState.routingState.currentNodeId
            }
          : null
      });
    }
    return result;
  }

  async patchStateAtCheckpoint(threadId: string, checkpointId: string, req: StatePatchRequest): Promise<void> {
    const record = this.getRunRecordByThread(threadId);
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);
    const graph = this.getOrBuildGraph(workflow);
    const config = this.threadConfig(threadId, checkpointId);
    const snapshot = await graph.getState(config);
    const current = (snapshot.values as GraphEnvelope).state;
    const patched = deepMerge(current, req.patch);
    await graph.updateState(config, { state: patched }, req.asNode);
    this.deps.db.recordStatePatch({
      threadId,
      checkpointId,
      runId: record.runId,
      patchKind: "state_patch",
      operator: req.operator,
      reason: req.reason,
      patch: req.patch as unknown as JsonValue
    });
    this.deps.traceBus.emit({
      runId: record.runId,
      threadId,
      type: "state_patched",
      summary: `状态补丁已写入 checkpoint=${checkpointId}`,
      payload:
        {
          reason: req.reason,
          asNode: req.asNode ?? null,
          patch: summarize(req.patch as unknown as JsonValue) ?? null
        } as unknown as JsonValue
    });
  }

  async patchPromptOverridesAtCheckpoint(
    threadId: string,
    checkpointId: string,
    req: PromptOverridePatchRequest
  ): Promise<void> {
    const record = this.getRunRecordByThread(threadId);
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);
    const graph = this.getOrBuildGraph(workflow);
    const config = this.threadConfig(threadId, checkpointId);
    const snapshot = await graph.getState(config);
    const current = (snapshot.values as GraphEnvelope).state;
    const patched: RunState = {
      ...current,
      debugRefs: { ...current.debugRefs, promptOverrides: req.patches }
    };
    await graph.updateState(config, { state: patched });
    this.deps.db.recordStatePatch({
      threadId,
      checkpointId,
      runId: record.runId,
      patchKind: "prompt_override",
      operator: req.operator,
      reason: req.reason,
      patch: { patches: req.patches } as unknown as JsonValue
    });
    this.deps.traceBus.emit({
      runId: record.runId,
      threadId,
      type: "state_patched",
      summary: `PromptOverride 已写入 checkpoint=${checkpointId}`,
      payload: { reason: req.reason, patchCount: req.patches.length } as unknown as JsonValue
    });
  }

  async patchPromptUnitOverridesAtCheckpoint(
    threadId: string,
    checkpointId: string,
    req: PromptUnitOverridePatchRequest
  ): Promise<void> {
    const record = this.getRunRecordByThread(threadId);
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);
    const graph = this.getOrBuildGraph(workflow);
    const config = this.threadConfig(threadId, checkpointId);
    const snapshot = await graph.getState(config);
    const current = (snapshot.values as GraphEnvelope).state;
    const patched: RunState = {
      ...current,
      debugRefs: {
        ...current.debugRefs,
        promptUnitOverrides: req.overrides
      }
    };
    await graph.updateState(config, { state: patched });
    this.deps.db.recordStatePatch({
      threadId,
      checkpointId,
      runId: record.runId,
      patchKind: "prompt_override",
      operator: req.operator,
      reason: req.reason,
      patch: { promptUnitOverrides: req.overrides } as unknown as JsonValue
    });
    this.deps.traceBus.emit({
      runId: record.runId,
      threadId,
      type: "state_patched",
      summary: `PromptUnitOverride 已写入 checkpoint=${checkpointId}`,
      payload: { reason: req.reason, overrideCount: req.overrides.length } as unknown as JsonValue
    });
  }

  async forkRunFromCheckpoint(
    threadId: string,
    checkpointId: string,
    req: ForkRunRequest
  ): Promise<ForkRunResponse> {
    const parent = this.getRunRecordByThread(threadId);
    const parentRow = this.deps.db.getRunSummary(parent.runId);
    if (!parentRow) throw new Error("父 run 不存在");
    const workflow = this.resolveWorkflow(parent.workflowId, parent.workflowVersion);
    const newRunId = newId("run");

    this.deps.db.upsertRunSummary({
      runId: newRunId,
      threadId,
      workflowId: parent.workflowId,
      workflowVersion: parent.workflowVersion,
      status: "created",
      currentNodeId: parentRow.current_node_id,
      snapshotVersionRefs: parentRow.snapshotVersionRefs,
      providerConfig: JSON.parse(parentRow.provider_config_json) as JsonValue,
      inputJson: JSON.parse(parentRow.input_json) as JsonValue,
      parentRunId: parent.runId,
      parentCheckpointId: checkpointId
    });

    const fork = this.deps.db.recordFork({
      parentRunId: parent.runId,
      parentCheckpointId: checkpointId,
      childRunId: newRunId,
      threadId,
      reason: req.reason,
      operator: req.operator
    });

    const child: RunRecord = { ...parent, runId: newRunId };
    this.activeRuns.set(newRunId, child);
    this.deps.traceBus.emit({
      runId: parent.runId,
      threadId,
      type: "fork_created",
      summary: `创建分叉 run=${newRunId}`,
      payload: { checkpointId, reason: req.reason }
    });

    void this.executeGraph(
      child,
      workflow,
      req.resumeMode === "manual"
        ? (new Command({ resume: req.resumePayload ?? "继续" }) as unknown)
        : (null as unknown),
      checkpointId
    );
    return fork;
  }

  async getPromptCompile(compileId: string) {
    return this.deps.db.getPromptCompile(compileId);
  }

  private async executeGraph(record: RunRecord, workflow: WorkflowSpec, input: unknown, checkpointId?: string) {
    const graph = this.getOrBuildGraph(workflow);
    this.deps.db.updateRunStatus(record.runId, "running");
    try {
      const iterable = await graph.stream(input as never, {
        ...this.threadConfig(record.threadId, checkpointId),
        streamMode: "values"
      });
      for await (const chunk of iterable as AsyncIterable<any>) {
        if (chunk?.__interrupt__) {
          this.deps.db.updateRunStatus(record.runId, "waiting_human");
          return;
        }
        if (chunk?.state) {
          const st = (chunk as GraphEnvelope).state;
          this.deps.db.updateRunStatus(record.runId, st.status, st.routingState.currentNodeId);
        }
      }
      const finalSnapshot = await graph.getState(this.threadConfig(record.threadId));
      const st = (finalSnapshot.values as GraphEnvelope).state;
      const cp = finalSnapshot.config?.configurable?.checkpoint_id
        ? String(finalSnapshot.config.configurable.checkpoint_id)
        : "";
      const pcp = finalSnapshot.parentConfig?.configurable?.checkpoint_id
        ? String(finalSnapshot.parentConfig.configurable.checkpoint_id)
        : undefined;
      if (cp) {
        this.deps.db.upsertCheckpointIndex({
          threadId: record.threadId,
          checkpointId: cp,
          parentCheckpointId: pcp,
          runId: record.runId,
          metadata: (finalSnapshot.metadata ?? null) as JsonValue
        });
      }
      this.deps.db.updateRunStatus(record.runId, st.status, st.routingState.currentNodeId);
      if (st.status === "completed") {
        this.deps.traceBus.emit({
          runId: record.runId,
          threadId: record.threadId,
          type: "run_finished",
          summary: "Run 执行完成"
        });
      }
    } catch (error) {
      this.deps.db.updateRunStatus(record.runId, "error");
      this.deps.traceBus.emit({
        runId: record.runId,
        threadId: record.threadId,
        type: "run_failed",
        summary: `Run 执行失败：${error instanceof Error ? error.message : "未知错误"}`,
        payload: { message: error instanceof Error ? error.message : "未知错误" }
      });
    }
  }

  private getOrBuildGraph(workflow: WorkflowSpec): any {
    const key = `${workflow.id}@${workflow.version}`;
    const cached = this.graphCache.get(key);
    if (cached) return cached;

    const builder: any = new StateGraph(GraphAnn);

    for (const node of workflow.nodes) {
      builder.addNode(node.id, async (envelope: GraphEnvelope) => {
        return this.executeNode(workflow, node, envelope);
      });
    }

    builder.addEdge(START, workflow.entryNode);

    const outgoingMap = new Map<string, WorkflowEdgeSpec[]>();
    for (const edge of workflow.edges) {
      const arr = outgoingMap.get(edge.from) ?? [];
      arr.push(edge);
      outgoingMap.set(edge.from, arr);
    }

    for (const node of workflow.nodes) {
      const outgoing = (outgoingMap.get(node.id) ?? []).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      if (outgoing.length === 0) {
        builder.addEdge(node.id, END);
        continue;
      }
      if (outgoing.length === 1 && ((outgoing[0].condition?.type ?? "always") === "always")) {
        builder.addEdge(node.id, outgoing[0].to);
        continue;
      }
      builder.addConditionalEdges(node.id, (env: GraphEnvelope) => {
        const nextNodeId = env.state.routingState.nextNodeId;
        if (nextNodeId && outgoing.some((e) => e.to === nextNodeId)) return nextNodeId;
        return outgoing[0]?.to ?? END;
      });
    }

    const compiled = builder.compile({ checkpointer: this.checkpointer });
    this.graphCache.set(key, compiled);
    return compiled;
  }

  private async executeNode(workflow: WorkflowSpec, node: WorkflowNodeSpec, envelope: GraphEnvelope): Promise<GraphEnvelope> {
    let state = envelope.state;
    const runId = state.runMeta.runId;
    const threadId = state.runMeta.threadId;
    const stateBeforeForDiff = this.buildStateDiffSnapshot(state);

    state = {
      ...state,
      status: "running",
      routingState: {
        ...state.routingState,
        currentNodeId: node.id,
        history: [...state.routingState.history, { nodeId: node.id, at: nowIso() }]
      }
    };

    state = this.safePointInterrupt(state, node, "before");

    this.deps.traceBus.emit({
      runId,
      threadId,
      type: "node_started",
      nodeId: node.id,
      agentId: node.agentId,
      summary: `节点开始：${node.label}`,
      payload: { nodeType: node.type }
    });

    if (node.type === "agent" && node.agentId) {
      state = await this.runAgentNode(workflow, node, state);
    } else if (node.type === "tool" && node.toolId) {
      state = await this.runToolNode(node, state);
    } else if (node.type === "interrupt") {
      const resumePayload = interrupt({
        reason: "workflow_interrupt_node",
        nodeId: node.id,
        label: node.label
      });
      state = {
        ...state,
        status: "waiting_human",
        humanReviewState: {
          ...state.humanReviewState,
          lastResumePayload: resumePayload as JsonValue
        }
      };
    }

    state = this.decideNextNode(workflow, node, state);
    state = this.safePointInterrupt(state, node, "after");

    this.deps.traceBus.emit({
      runId,
      threadId,
      type: "node_finished",
      nodeId: node.id,
      agentId: node.agentId,
      summary: `节点完成：${node.label}`,
      payload: {
        nextNodeId: state.routingState.nextNodeId ?? null,
        status: state.status
      }
    });

    // v0.2 最小 state diff：记录节点前后摘要变化，避免一开始就把完整 state 全量落库。
    const stateAfterForDiff = this.buildStateDiffSnapshot(state);
    const diffTrace: StateDiffTrace = {
      diffId: newId("diff"),
      runId,
      threadId,
      nodeId: node.id,
      agentId: node.agentId,
      beforeSummary: stateBeforeForDiff as unknown as JsonValue,
      afterSummary: stateAfterForDiff as unknown as JsonValue,
      diff: this.computeShallowStateDiff(stateBeforeForDiff, stateAfterForDiff) as unknown as JsonValue,
      createdAt: nowIso()
    };
    this.deps.db.insertStateDiff(diffTrace);
    this.deps.traceBus.emit({
      runId,
      threadId,
      type: "state_patched",
      nodeId: node.id,
      agentId: node.agentId,
      summary: "记录节点状态差异摘要",
      payload: {
        diffId: diffTrace.diffId,
        diff: summarize(diffTrace.diff) ?? null
      } as unknown as JsonValue
    });

    return { state };
  }

  private safePointInterrupt(state: RunState, node: WorkflowNodeSpec, phase: "before" | "after"): RunState {
    const hitBreak =
      phase === "before"
        ? state.controlConfig.interruptBeforeNodes.includes(node.id)
        : state.controlConfig.interruptAfterNodes.includes(node.id);
    const hitPause = state.flags.pauseRequested && state.flags.softPauseAtNextSafePoint;
    if (!hitBreak && !hitPause) return state;

    const payload = {
      phase,
      nodeId: node.id,
      reason: hitPause ? (state.humanReviewState.pendingInterrupt?.reason ?? "soft_pause") : `breakpoint_${phase}`,
      pendingInterrupt: state.humanReviewState.pendingInterrupt ?? null
    };
    const resumed = interrupt(payload);
    return {
      ...state,
      status: "waiting_human",
      flags: { ...state.flags, pauseRequested: false, softPauseAtNextSafePoint: false },
      humanReviewState: {
        ...state.humanReviewState,
        pendingInterrupt: undefined,
        lastResumePayload: resumed as JsonValue
      }
    };
  }

  private async runAgentNode(workflow: WorkflowSpec, node: WorkflowNodeSpec, state: RunState): Promise<RunState> {
    const agent = state.agentSnapshots[node.agentId!] ?? this.deps.agentRegistry.get(node.agentId!);
    if (!agent) throw new Error(`Agent 不存在：${node.agentId}`);

    const promptUnits = this.loadPromptUnitsFromSnapshot(state);
    const catalogContextPromptUnits = this.deps.db.listCatalogContextPromptUnits(this.deps.projectId);
    const mergedPromptUnitMap = new Map<string, PromptBlock>();
    for (const item of promptUnits) mergedPromptUnitMap.set(item.id, item);
    for (const item of catalogContextPromptUnits) {
      if (!mergedPromptUnitMap.has(item.id)) mergedPromptUnitMap.set(item.id, item);
    }
    const effectivePromptUnits = [...mergedPromptUnitMap.values()];
    const allowSet = new Set((agent.toolAllowList ?? []).map((item) => String(item)));
    let canonicalTools = this.deps.toolRegistry.listCanonicalTools().filter((tool) => {
      if (!tool.enabled) return false;
      if (allowSet.size === 0) return true;
      return allowSet.has(tool.id) || allowSet.has(tool.name);
    });
    if (agent.toolRoutePolicy?.mode === "shell_only") {
      canonicalTools = canonicalTools.filter((tool) => isShellBridgeCanonicalTool(tool));
    }

    const compileReq: PromptCompileRequest = {
      agentId: agent.id,
      threadId: state.runMeta.threadId,
      runId: state.runMeta.runId,
      taskEnvelope: {
        taskType: `workflow_node:${node.id}`,
        input: {
          userInput: state.conversationState.userInput,
          latestAssistantText: state.conversationState.latestAssistantText ?? "",
          workflowId: workflow.id
        }
      },
      contextSources: state.conversationState.messages.map((m, i) => ({
        id: `ctx_${i + 1}`,
        type: "conversation",
        content: m.content,
        metadata: { role: m.role, name: m.name ?? null }
      })),
      memoryInputs: [],
      toolSchemas: canonicalTools.map((t) => ({
        toolId: t.id,
        toolName: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      })),
      overridePatches: state.debugRefs.promptOverrides,
      promptUnitOverrides: state.debugRefs.promptUnitOverrides,
      providerApiType: (this.getRunRecord(state.runMeta.runId).provider.apiMode as ProviderApiMode) ?? "chat_completions"
    };

    const compile = this.deps.promptCompiler.compile({
      agent,
      blocks: effectivePromptUnits,
      request: compileReq
    });

    const provider = this.getRunRecord(state.runMeta.runId).provider;
    const effectiveToolProtocolProfile = resolveAgentToolProtocolProfile({
      providerProfile: provider.toolProtocolProfile,
      providerApiMode: provider.apiMode,
      agentRouteMode: agent.toolRoutePolicy?.mode
    });
    const exposureSelection = selectToolExposureAdapter({
      provider: {
        vendor: provider.vendor,
        apiMode: provider.apiMode,
        toolProtocolProfile: effectiveToolProtocolProfile
      }
    });
    const baseModelReq: UnifiedModelRequest = {
      vendor: provider.vendor,
      apiMode: provider.apiMode,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      model: provider.model,
      messages: compile.finalMessages,
      temperature: provider.temperature,
      topP: provider.topP,
      reasoningConfig: provider.reasoningConfig,
      vendorExtra: provider.vendorExtra,
      stream: true
    };

    const adapterCandidates = [
      exposureSelection.adapter.kind,
      ...exposureSelection.fallbackChain
    ].filter((item, idx, arr) => arr.indexOf(item) === idx);
    let selectedAdapter = exposureSelection.adapter;
    let exposurePlan = selectedAdapter.buildToolExposure(
      {
            provider: {
              vendor: provider.vendor,
              apiMode: provider.apiMode,
              toolProtocolProfile: effectiveToolProtocolProfile
            },
            override: {
              preferredAdapter: selectedAdapter.kind,
          fallbackAdapters: exposureSelection.fallbackChain.filter((item) => item !== selectedAdapter.kind)
        }
      },
      canonicalTools
    );
    let modelReq = selectedAdapter.buildModelRequest({
      baseRequest: baseModelReq,
      exposurePlan,
      canonicalTools
    });
    let selectedCapabilityError = validateProviderRequestCapabilities(modelReq);
    const failedAdapters: Array<{ kind: string; code: string; message: string }> = [];
    if (selectedCapabilityError) {
      failedAdapters.push({
        kind: selectedAdapter.kind,
        code: selectedCapabilityError.code,
        message: selectedCapabilityError.message
      });
      for (const candidateKind of adapterCandidates) {
        if (candidateKind === selectedAdapter.kind) continue;
        const candidateAdapter = exposureAdapters[candidateKind];
        const candidatePlan = candidateAdapter.buildToolExposure(
          {
            provider: {
              vendor: provider.vendor,
              apiMode: provider.apiMode,
              toolProtocolProfile: effectiveToolProtocolProfile
            },
            override: {
              preferredAdapter: candidateAdapter.kind,
              fallbackAdapters: adapterCandidates.filter((item) => item !== candidateAdapter.kind)
            }
          },
          canonicalTools
        );
        const candidateReq = candidateAdapter.buildModelRequest({
          baseRequest: baseModelReq,
          exposurePlan: candidatePlan,
          canonicalTools
        });
        const candidateError = validateProviderRequestCapabilities(candidateReq);
        if (!candidateError) {
          selectedAdapter = candidateAdapter;
          exposurePlan = candidatePlan;
          modelReq = candidateReq;
          selectedCapabilityError = null;
          this.deps.traceBus.emit({
            runId: state.runMeta.runId,
            threadId: state.runMeta.threadId,
            type: "routing_decided",
            nodeId: node.id,
            agentId: agent.id,
            summary: `工具暴露适配器已降级：${exposureSelection.adapter.kind} -> ${candidateAdapter.kind}`,
            payload: {
              fallbackFrom: exposureSelection.adapter.kind,
              fallbackTo: candidateAdapter.kind
            } as unknown as JsonValue
          });
          break;
        }
        failedAdapters.push({
          kind: candidateAdapter.kind,
          code: candidateError.code,
          message: candidateError.message
        });
      }
    }
    if (selectedCapabilityError) {
      throw new Error(
        `所有工具暴露适配器均不可用：${failedAdapters.map((item) => `${item.kind}(${item.code})`).join(", ")}`
      );
    }

    this.deps.db.insertToolExposurePlan({
      runId: state.runMeta.runId,
      threadId: state.runMeta.threadId,
      nodeId: node.id,
      agentId: agent.id,
      plan: exposurePlan
    });
    // 将装配计划挂进 promptTrace，便于前端/接口一次取全。
    compile.promptTrace.toolExposurePlan = exposurePlan;

    this.deps.db.insertPromptCompile({
      compileId: compile.promptTrace.compileId,
      runId: state.runMeta.runId,
      threadId: state.runMeta.threadId,
      agentId: agent.id,
      providerApiType: compileReq.providerApiType,
      promptTrace: compile.promptTrace,
      finalMessages: compile.finalMessages
    });

    this.deps.traceBus.emit({
      runId: state.runMeta.runId,
      threadId: state.runMeta.threadId,
      type: "prompt_compiled",
      nodeId: node.id,
      agentId: agent.id,
      summary: "Prompt 编译完成",
      payload: {
        compileId: compile.promptTrace.compileId,
        selectedUnits: compile.promptTrace.selectedUnits.length,
        tokenEstimate: compile.promptTrace.tokenEstimate,
        toolExposurePlanId: exposurePlan.planId,
        toolExposureAdapter: exposurePlan.adapterKind,
        exposedToolCount: exposurePlan.exposedTools.length
      }
    });

    const exposedCanonicalTools = exposurePlan.exposedTools
      .map((item) => canonicalTools.find((tool) => tool.id === item.canonicalToolId))
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
    const canonicalToolById = new Map(exposedCanonicalTools.map((tool) => [tool.id, tool] as const));
    const canonicalToolByName = new Map(exposedCanonicalTools.map((tool) => [tool.name, tool] as const));
    modelReq = selectedAdapter.buildModelRequest({
      baseRequest: {
        ...baseModelReq,
        messages: compile.finalMessages
      },
      exposurePlan,
      canonicalTools: exposedCanonicalTools
    });

    this.deps.traceBus.emit({
      runId: state.runMeta.runId,
      threadId: state.runMeta.threadId,
      type: "model_request_started",
      nodeId: node.id,
      agentId: agent.id,
      summary: "开始调用模型",
      payload: {
        vendor: provider.vendor,
        apiMode: provider.apiMode,
        model: provider.model,
        exposureAdapter: selectedAdapter.kind,
        exposurePlanId: exposurePlan.planId
      }
    });
    const roundExecutor = new AgentRoundExecutor(this.deps.providerClient, {
      onEvent: ({ kind, ctx, summary, payload }) => {
        this.deps.traceBus.emit({
          runId: ctx.runId,
          threadId: ctx.threadId,
          type: kind === "tool_call_detected" ? "model_tool_call_detected" : "model_stream_delta",
          nodeId: ctx.nodeId,
          agentId: ctx.agentId,
          summary,
          payload
        });
      }
    });
    const loopExecutor = new ToolLoopExecutor();
    const router = new CanonicalToolRouter(canonicalTools);

    const canonicalCallRecords: CanonicalToolCallIntent[] = [];
    const canonicalResultRecords: CanonicalToolCallResult[] = [];
    const toolCalls: RunState["toolState"]["lastToolCalls"] = [];
    const toolResults: RunState["toolState"]["lastToolResults"] = [];

    const loopResult = await loopExecutor.execute({
      initialRequest: modelReq,
      roundExecutor,
      ctx: {
        runId: state.runMeta.runId,
        threadId: state.runMeta.threadId,
        nodeId: node.id,
        agentId: agent.id
      },
      maxRounds: 4,
      detectToolCalls: async ({ roundIndex, round }) => {
        // 先吃 provider 原生 tool_calls；若为空，则交给适配器从文本协议中解析（structured/prompt/custom fallback）。
        if (round.toolCalls.length > 0) {
          return round.toolCalls.map((call) => ({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            argumentsJson: call.argumentsJson,
            payloadMode: "json_args" as const
          }));
        }
        const parsedIntents = selectedAdapter.parseModelToolSignal({
          finalResult: round,
          canonicalTools: exposedCanonicalTools
        });
        if (parsedIntents.length === 0) {
          // 若已降级选择 adapter，则也尝试用“初始选择 adapter”再解析一次（兼容某些 provider 返回差异）。
          const backupParsed =
            selectedAdapter.kind === exposureSelection.adapter.kind
              ? []
              : exposureSelection.adapter.parseModelToolSignal({
                  finalResult: round,
                  canonicalTools: exposedCanonicalTools
                });
          if (backupParsed.length > 0) {
            return backupParsed.map((intent) => ({
              toolCallId: intent.toolCallId,
              toolName: intent.toolName,
              argumentsJson: intent.args ?? {},
              canonicalToolId: intent.canonicalToolId,
              payloadMode: intent.payloadMode,
              freeformText: intent.freeformText,
              rawSignal: intent.rawSignal
            }));
          }
          return [];
        }
        for (const intent of parsedIntents) {
          this.deps.traceBus.emit({
            runId: state.runMeta.runId,
            threadId: state.runMeta.threadId,
            type: "model_tool_call_detected",
            nodeId: node.id,
            agentId: agent.id,
            summary: `适配器解析到工具调用(round=${roundIndex + 1})：${intent.toolName}`,
            payload: {
              toolCallId: intent.toolCallId,
              adapterKind: intent.adapterKind,
              payloadMode: intent.payloadMode,
              args: summarize((intent.args ?? {}) as JsonValue) ?? null
            } as unknown as JsonValue
          });
        }
        return parsedIntents.map((intent) => ({
          toolCallId: intent.toolCallId,
          toolName: intent.toolName,
          argumentsJson: intent.args ?? {},
          canonicalToolId: intent.canonicalToolId,
          payloadMode: intent.payloadMode,
          freeformText: intent.freeformText,
          rawSignal: intent.rawSignal
        }));
      },
      onToolCalls: async ({ roundIndex, calls }) => {
        const toolRoleMessages: UnifiedMessage[] = [];
        const roundToolResults: RunState["toolState"]["lastToolResults"] = [];

        for (const call of calls) {
          const canonicalTool =
            (call.canonicalToolId ? canonicalToolById.get(call.canonicalToolId) : null) ??
            canonicalToolByName.get(call.toolName) ??
            this.deps.toolRegistry.findCanonicalToolByName(call.toolName);
          if (!canonicalTool) continue;
          const intent: CanonicalToolCallIntent = {
            toolCallId: call.toolCallId,
            canonicalToolId: canonicalTool.id,
            toolName: canonicalTool.name,
            adapterKind: exposurePlan.adapterKind,
            payloadMode: call.payloadMode ?? "json_args",
            args: call.argumentsJson,
            freeformText: call.freeformText,
            rawSignal: call.rawSignal
          };
          canonicalCallRecords.push(intent);

          const route = router.resolve(intent);
          this.deps.traceBus.emit({
            runId: state.runMeta.runId,
            threadId: state.runMeta.threadId,
            type: "tool_call_started",
            nodeId: node.id,
            agentId: agent.id,
            summary: `执行工具(round=${roundIndex + 1})：${call.toolName}`,
            payload: {
              toolCallId: call.toolCallId,
              routeKind: route.kind,
              adapterKind: exposurePlan.adapterKind,
              args: summarize((call.argumentsJson ?? {}) as JsonValue) ?? null
            } as unknown as JsonValue
          });

          const executed = await this.executeCanonicalToolIntent(intent, canonicalTool, {
            runId: state.runMeta.runId,
            threadId: state.runMeta.threadId,
            nodeId: node.id,
            agentId: agent.id,
            workspaceRoot: this.deps.workspaceRoot,
            provider: {
              vendor: provider.vendor,
              apiMode: provider.apiMode,
              model: provider.model
            }
          });
          canonicalResultRecords.push(executed);
          roundToolResults.push(executed.toolResult);
          toolResults.push(executed.toolResult);

          if (executed.toolTrace) {
            this.deps.db.insertToolCallTrace({
              toolCallId: executed.toolTrace.toolCallId,
              runId: state.runMeta.runId,
              threadId: state.runMeta.threadId,
              toolId: executed.toolTrace.toolId,
              toolName: executed.toolTrace.toolName,
              traceJson: executed.toolTrace as unknown as JsonValue
            });
          }

          for (const effect of executed.sideEffects) {
            this.deps.db.insertSideEffect(effect);
            this.deps.traceBus.emit({
              runId: state.runMeta.runId,
              threadId: state.runMeta.threadId,
              type: "side_effect_recorded",
              nodeId: node.id,
              agentId: agent.id,
              summary: effect.summary,
              payload: {
                sideEffectId: effect.sideEffectId,
                effectType: effect.type,
                target: effect.target ?? null,
                details: summarize(effect.details as JsonValue | undefined) ?? null
              } as unknown as JsonValue
            });
          }

          this.deps.traceBus.emit({
            runId: state.runMeta.runId,
            threadId: state.runMeta.threadId,
            type: "tool_call_finished",
            nodeId: node.id,
            agentId: agent.id,
            summary: `工具${executed.toolResult.ok ? "成功" : "失败"}：${call.toolName}`,
            payload: {
              toolCallId: call.toolCallId,
              routeKind: route.kind,
              ok: executed.toolResult.ok,
              output: summarize(executed.toolResult.output) ?? null,
              error: executed.toolResult.error ?? null
            } as unknown as JsonValue
          });

          toolCalls.push({
            toolCallId: call.toolCallId,
            toolId: canonicalTool.id,
            toolName: canonicalTool.name,
            arguments: (call.argumentsJson ?? {}) as JsonObject,
            issuedByAgentId: agent.id,
            issuedAt: nowIso()
          });

          const toolResultText = JSON.stringify(executed.toolResult.ok ? executed.toolResult.output : executed.toolResult.error);
          if (
            exposurePlan.adapterKind === "structured_output_tool_call" ||
            exposurePlan.adapterKind === "prompt_protocol_fallback"
          ) {
            toolRoleMessages.push({
              role: "developer",
              content: [
                `工具执行结果(${call.toolName})：`,
                toolResultText,
                "如果还需要继续调用工具，请继续输出工具调用协议；否则直接给出最终答复。"
              ].join("\n")
            });
          } else {
            toolRoleMessages.push({
              role: "tool",
              name: call.toolName,
              toolCallId: call.toolCallId,
              content: toolResultText
            });
          }
        }

        return {
          toolRoleMessages,
          toolResults: roundToolResults
        };
      }
    });

    const finalText = loopResult.finalText;

    const assistantMessage: UnifiedMessage = {
      role: "assistant",
      content: finalText || "",
      metadata: {
        agentId: agent.id,
        nodeId: node.id
      }
    };

    return {
      ...state,
      conversationState: {
        ...state.conversationState,
        messages: [...state.conversationState.messages, assistantMessage],
        latestAssistantText: finalText || state.conversationState.latestAssistantText
      },
      toolState: {
        lastToolCalls: toolCalls,
        lastToolResults: toolResults,
        lastCanonicalToolCalls: canonicalCallRecords,
        lastCanonicalToolResults: canonicalResultRecords,
        lastToolExposurePlanId: exposurePlan.planId
      },
      debugRefs: {
        ...state.debugRefs,
        promptCompileIds: [...state.debugRefs.promptCompileIds, compile.promptTrace.compileId]
      }
    };
  }

  private async runToolNode(node: WorkflowNodeSpec, state: RunState): Promise<RunState> {
    const tool = this.deps.toolRegistry.get(node.toolId!);
    if (!tool) throw new Error(`Tool 不存在：${node.toolId}`);
    const cfg = node.config && typeof node.config === "object" && !Array.isArray(node.config) ? (node.config as JsonObject) : {};
    const cfgArgs = cfg.args;
    const staticArgs = cfgArgs && typeof cfgArgs === "object" && !Array.isArray(cfgArgs) ? { ...(cfgArgs as JsonObject) } : {};
    const inputMapping =
      cfg.inputMapping && typeof cfg.inputMapping === "object" && !Array.isArray(cfg.inputMapping)
        ? (cfg.inputMapping as Record<string, JsonValue>)
        : {};
    const args: JsonObject = { ...staticArgs };
    for (const [argName, mappedPath] of Object.entries(inputMapping)) {
      if (typeof mappedPath !== "string") continue;
      const mappedValue = getByPath(state, mappedPath);
      if (mappedValue !== undefined) args[argName] = mappedValue as JsonValue;
    }
    if (args.input === undefined && state.conversationState.latestAssistantText) {
      args.input = state.conversationState.latestAssistantText;
    }

    const { result } = await this.deps.toolRuntime.execute(tool, args);
    let nextState: RunState = {
      ...state,
      toolState: {
        ...state.toolState,
        lastToolCalls: [],
        lastToolResults: [result]
      }
    };

    const packet = {
      nodeId: node.id,
      toolId: tool.id,
      toolName: tool.name,
      ok: result.ok,
      output: result.output ?? null,
      error: result.error ?? null
    };
    nextState = {
      ...nextState,
      conversationState: {
        ...nextState.conversationState,
        messages: [
          ...nextState.conversationState.messages,
          {
            role: "tool",
            name: tool.name,
            content: JSON.stringify(packet),
            metadata: {
              sourceKind: "workflow_packet",
              sourceNodeId: node.id,
              toolId: tool.id
            }
          }
        ]
      }
    };

    const outputMapping =
      cfg.outputMapping && typeof cfg.outputMapping === "object" && !Array.isArray(cfg.outputMapping)
        ? (cfg.outputMapping as Record<string, JsonValue>)
        : undefined;
    if (outputMapping) {
      const stateField = typeof outputMapping.stateField === "string" ? outputMapping.stateField : undefined;
      const artifactType = typeof outputMapping.artifactType === "string" ? outputMapping.artifactType : undefined;
      const writeMode = typeof outputMapping.writeMode === "string" ? outputMapping.writeMode : "result";
      const mappedValue =
        writeMode === "output"
          ? (result.output ?? null)
          : writeMode === "error"
            ? (result.error ?? null)
            : ({
                ok: result.ok,
                output: result.output ?? null,
                error: result.error ?? null
              } as JsonValue);

      if (stateField) {
        nextState = setByPath(nextState, stateField, mappedValue);
      }
      if (artifactType) {
        nextState = {
          ...nextState,
          artifacts: {
            ...nextState.artifacts,
            outputs: [...nextState.artifacts.outputs, { id: newId("artifact"), type: artifactType, content: mappedValue }]
          }
        };
      }
    }

    return nextState;
  }

  /**
   * v0.2：执行 CanonicalToolCallIntent（中间统一层）。
   * 说明：
   * - 这里先实现 builtin + user_defined 两类；
   * - MCP / plugin / skill_tool 先返回结构化未实现错误（后续迭代接入）。
   */
  private async executeCanonicalToolIntent(
    intent: CanonicalToolCallIntent,
    canonicalTool: any,
    envelope: {
      runId: string;
      threadId: string;
      nodeId: string;
      agentId: string;
      workspaceRoot: string;
      provider: { vendor: string; apiMode: string; model: string };
    }
  ): Promise<CanonicalToolCallResult> {
    const startedAt = nowIso();
    const startMs = Date.now();
    const sideEffects: CanonicalToolSideEffectRecord[] = [];

    const buildResult = (input: {
      ok: boolean;
      output?: JsonValue;
      error?: { code: string; message: string; details?: JsonValue };
      toolId: string;
      toolName: string;
    }): CanonicalToolCallResult => {
      const finishedAt = nowIso();
      const toolResult = {
        toolCallId: intent.toolCallId,
        toolId: input.toolId,
        ok: input.ok,
        output: input.output,
        error: input.error,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startMs
      };
      return {
        intent,
        canonicalTool: {
          id: canonicalTool.id,
          name: canonicalTool.name,
          kind: canonicalTool.kind,
          routeTarget: canonicalTool.routeTarget
        },
        toolResult,
        toolTrace: {
          toolCallId: intent.toolCallId,
          toolId: input.toolId,
          toolName: input.toolName,
          executorType: canonicalTool.executorType,
          arguments: (intent.args ?? {}) as JsonObject,
          result: toolResult,
          permissionLevel: canonicalTool.permissionPolicy?.shellPermissionLevel,
          workingDir: envelope.workspaceRoot
        },
        sideEffects
      };
    };

    const args = { ...((intent.args ?? {}) as JsonObject) };
    // 兼容 freeform 工具信号：
    // - 例如 chat_custom / prompt_protocol 下模型可能只给一段 patch 文本；
    // - 这里把 freeformText 映射回统一参数，避免执行层丢失信息。
    if (intent.payloadMode !== "json_args" && intent.freeformText && Object.keys(args).length === 0) {
      if (canonicalTool.name === "apply_patch") {
        args.patch = intent.freeformText;
      } else {
        args.input = intent.freeformText;
      }
    }
    const routeKind = canonicalTool.routeTarget?.kind;

    if (routeKind === "builtin") {
      const builtinName = canonicalTool.routeTarget.builtin as string;

      if (builtinName === "shell_command") {
        const rawCommand = String(args.command ?? "");
        const bridgeResult = await this.internalShellBridge.tryExecute(rawCommand, {
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          toolCallId: intent.toolCallId,
          toolId: canonicalTool.id,
          toolName: canonicalTool.name,
          workspaceRoot: envelope.workspaceRoot
        });
        if (bridgeResult?.handled && bridgeResult.toolResult) {
          return {
            intent,
            canonicalTool: {
              id: canonicalTool.id,
              name: canonicalTool.name,
              kind: canonicalTool.kind,
              routeTarget: canonicalTool.routeTarget
            },
            toolResult: bridgeResult.toolResult,
            toolTrace: bridgeResult.toolTrace,
            sideEffects: bridgeResult.sideEffects ?? sideEffects
          };
        }

        const syntheticShellSpec: ToolSpec = {
          id: canonicalTool.id,
          name: "shell_command",
          description: canonicalTool.description,
          executorType: "shell",
          inputSchema: canonicalTool.inputSchema,
          outputSchema: canonicalTool.outputSchema,
          permissionProfileId: String(canonicalTool.permissionPolicy?.permissionProfileId ?? "perm.readonly"),
          timeoutMs: Number(canonicalTool.permissionPolicy?.timeoutMs ?? 15000),
          workingDirPolicy: canonicalTool.permissionPolicy?.workingDirPolicy,
          enabled: true,
          version: 1
        };
        const { result, trace } = await this.deps.toolRuntime.execute(syntheticShellSpec, args, envelope.agentId);
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "tool_exec",
          target: builtinName,
          summary: `执行 shell_command（ok=${String(result.ok)}）`,
          details: {
            command: rawCommand,
            durationMs: result.durationMs
          },
          timestamp: nowIso()
        });
        return {
          intent,
          canonicalTool: {
            id: canonicalTool.id,
            name: canonicalTool.name,
            kind: canonicalTool.kind,
            routeTarget: canonicalTool.routeTarget
          },
          toolResult: result,
          toolTrace: trace,
          sideEffects
        };
      }

      if (builtinName === "apply_patch") {
        const output = await executeBuiltinApplyPatch(args, { workspaceRoot: envelope.workspaceRoot });
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "file_write",
          target: "apply_patch",
          summary: "执行 apply_patch",
          details: summarize(output as JsonValue) ?? null,
          timestamp: nowIso()
        });
        return buildResult({
          ok: Boolean((output as any)?.ok),
          output,
          error: (output as any)?.ok ? undefined : { code: "APPLY_PATCH_FAILED", message: "apply_patch 执行失败", details: output },
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }

      if (builtinName === "read_file") {
        const output = await executeBuiltinReadFile(args, envelope.workspaceRoot);
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "file_read",
          target: String(args.path ?? ""),
          summary: "读取文件片段",
          details: { path: String(args.path ?? "") } as unknown as JsonValue,
          timestamp: nowIso()
        });
        return buildResult({
          ok: Boolean((output as any)?.ok),
          output,
          error: (output as any)?.ok ? undefined : { code: "READ_FILE_FAILED", message: "read_file 执行失败", details: output },
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }

      if (builtinName === "web_search") {
        const output = await executeBuiltinWebSearch(args);
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "web_search",
          target: String(args.query ?? ""),
          summary: `执行 web_search：${String(args.query ?? "")}`,
          details: { query: String(args.query ?? "") } as unknown as JsonValue,
          timestamp: nowIso()
        });
        return buildResult({
          ok: Boolean((output as any)?.ok),
          output,
          error: (output as any)?.ok ? undefined : { code: "WEB_SEARCH_FAILED", message: "web_search 执行失败", details: output },
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }

      if (builtinName === "update_plan") {
        const normalized = normalizeAndValidatePlan(args);
        if (!normalized.ok) {
          return buildResult({
            ok: false,
            error: {
              code: String((normalized.error as any)?.code ?? "INVALID_PLAN"),
              message: String((normalized.error as any)?.message ?? "update_plan 参数非法"),
              details: normalized.error
            },
            toolId: canonicalTool.id,
            toolName: canonicalTool.name
          });
        }
        this.deps.db.upsertRunPlan(envelope.runId, envelope.threadId, normalized.plan);
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "plan_update",
          target: envelope.runId,
          summary: "更新 run 内部计划",
          details: {
            itemCount: normalized.plan.items.length
          } as unknown as JsonValue,
          timestamp: nowIso()
        });
        return buildResult({
          ok: true,
          output: { ok: true, plan: normalized.plan } as unknown as JsonValue,
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }

      if (builtinName === "request_user_input") {
        const reqState = buildUserInputRequestState(args);
        if (!reqState.ok) {
          return buildResult({
            ok: false,
            error: {
              code: String((reqState.error as any)?.code ?? "INVALID_USER_INPUT_REQUEST"),
              message: String((reqState.error as any)?.message ?? "request_user_input 参数非法"),
              details: reqState.error
            },
            toolId: canonicalTool.id,
            toolName: canonicalTool.name
          });
        }

        this.deps.db.upsertUserInputRequest({
          requestId: reqState.state.requestId!,
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          state: reqState.state,
          payload: reqState.payload
        });
        this.deps.traceBus.emit({
          runId: envelope.runId,
          threadId: envelope.threadId,
          type: "interrupt_emitted",
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          summary: "request_user_input 触发人工中断",
          payload: summarize(reqState.payload as JsonValue)
        });
        const answer = interrupt(reqState.payload);
        const answeredState = {
          ...reqState.state,
          status: "answered" as const,
          answer: answer as JsonValue,
          answeredAt: nowIso()
        };
        this.deps.db.upsertUserInputRequest({
          requestId: reqState.state.requestId!,
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          state: answeredState,
          payload: reqState.payload
        });
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "user_input",
          target: reqState.state.requestId,
          summary: "收到人工回复（request_user_input）",
          details: summarize(answer as JsonValue) ?? null,
          timestamp: nowIso()
        });
        this.deps.traceBus.emit({
          runId: envelope.runId,
          threadId: envelope.threadId,
          type: "resume_received",
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          summary: "request_user_input 收到恢复回复",
          payload: summarize(answer as JsonValue)
        });
        return buildResult({
          ok: true,
          output: { ok: true, answer } as unknown as JsonValue,
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }

      if (builtinName === "view_image") {
        const output = await executeBuiltinViewImage(args, envelope.workspaceRoot);
        sideEffects.push({
          sideEffectId: newId("sfx"),
          runId: envelope.runId,
          threadId: envelope.threadId,
          nodeId: envelope.nodeId,
          agentId: envelope.agentId,
          type: "image_read",
          target: String(args.path ?? ""),
          summary: "读取图片元数据",
          details: { path: String(args.path ?? "") } as unknown as JsonValue,
          timestamp: nowIso()
        });
        return buildResult({
          ok: Boolean((output as any)?.ok),
          output,
          error: (output as any)?.ok ? undefined : { code: "VIEW_IMAGE_FAILED", message: "view_image 执行失败", details: output },
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }
    }

    if (routeKind === "user_defined") {
      const spec = this.deps.toolRegistry.get(canonicalTool.routeTarget.toolId);
      if (!spec) {
        return buildResult({
          ok: false,
          error: { code: "TOOL_NOT_FOUND", message: `工具不存在：${canonicalTool.routeTarget.toolId}` },
          toolId: canonicalTool.id,
          toolName: canonicalTool.name
        });
      }
      const { result, trace } = await this.deps.toolRuntime.execute(spec, args, envelope.agentId);
      sideEffects.push({
        sideEffectId: newId("sfx"),
        runId: envelope.runId,
        threadId: envelope.threadId,
        nodeId: envelope.nodeId,
        agentId: envelope.agentId,
        type: "tool_exec",
        target: canonicalTool.name,
        summary: `执行自定义工具 ${canonicalTool.name}`,
        details: { ok: result.ok, durationMs: result.durationMs } as unknown as JsonValue,
        timestamp: nowIso()
      });
      return {
        intent,
        canonicalTool: {
          id: canonicalTool.id,
          name: canonicalTool.name,
          kind: canonicalTool.kind,
          routeTarget: canonicalTool.routeTarget
        },
        toolResult: result,
        toolTrace: trace,
        sideEffects
      };
    }

    return buildResult({
      ok: false,
      error: {
        code: "TOOL_ROUTE_NOT_IMPLEMENTED",
        message: `尚未实现该路由类型：${String(routeKind)}`
      },
      toolId: canonicalTool.id,
      toolName: canonicalTool.name
    });
  }

  private decideNextNode(workflow: WorkflowSpec, node: WorkflowNodeSpec, state: RunState): RunState {
    const outgoing = workflow.edges.filter((e) => e.from === node.id);
    let nextNodeId: string | undefined;
    let reason = "no_edges";

    // 编排器动态路由（首版约定：若输出 JSON 且包含 nextAgentId，则尝试映射）。
    if (node.type === "agent" && node.agentId === "agent.orchestrator") {
      const parsed = state.conversationState.latestAssistantText
        ? safeJsonParseObject(state.conversationState.latestAssistantText)
        : null;
      const nextAgentId = typeof parsed?.nextAgentId === "string" ? parsed.nextAgentId : undefined;
      if (nextAgentId) {
        const candidateNode = workflow.nodes.find((n) => n.agentId === nextAgentId)?.id;
        if (candidateNode && outgoing.some((e) => e.to === candidateNode)) {
          nextNodeId = candidateNode;
          reason = "orchestrator_json_nextAgentId";
        }
      }
    }

    if (!nextNodeId) {
      for (const edge of outgoing) {
        const condType = edge.condition?.type ?? "always";
        if (condType === "always") {
          nextNodeId = edge.to;
          reason = "fixed_always";
          break;
        }
        if (condType === "state_field" && edge.condition?.field) {
          const current = this.getStateFieldValue(state, edge.condition.field);
          if (current === edge.condition.equals) {
            nextNodeId = edge.to;
            reason = `state_field:${edge.condition.field}`;
            break;
          }
        }
        if (condType === "expression" && edge.condition?.expression) {
          if (this.evaluateEdgeExpression(state, edge.condition.expression)) {
            nextNodeId = edge.to;
            reason = `expression:${edge.condition.expression}`;
            break;
          }
        }
      }
    }

    const nextStatus: RunStatus = nextNodeId ? "running" : "completed";
    const nextState: RunState = {
      ...state,
      status: nextStatus,
      routingState: {
        ...state.routingState,
        nextNodeId,
        reason
      }
    };

    this.deps.traceBus.emit({
      runId: state.runMeta.runId,
      threadId: state.runMeta.threadId,
      type: "routing_decided",
      nodeId: node.id,
      agentId: node.agentId,
      summary: `路由：${node.id} -> ${nextNodeId ?? "END"}`,
      payload: { reason, nextNodeId: nextNodeId ?? null }
    });
    return nextState;
  }

  private getStateFieldValue(state: RunState, pathExpr: string): unknown {
    return getByPath(state, pathExpr);
  }

  private evaluateEdgeExpression(state: RunState, expression: string): boolean {
    try {
      // 仅在本地配置中使用，表达式上下文只暴露只读 state。
      const fn = new Function("state", `return Boolean(${expression});`) as (input: RunState) => boolean;
      return Boolean(fn(state));
    } catch {
      return false;
    }
  }

  /**
   * 构造用于 state diff 的轻量摘要（避免直接落整份 state）。
   */
  private buildStateDiffSnapshot(state: RunState): Record<string, unknown> {
    return {
      status: state.status,
      currentNodeId: state.routingState.currentNodeId,
      nextNodeId: state.routingState.nextNodeId ?? null,
      routingReason: state.routingState.reason ?? null,
      messageCount: state.conversationState.messages.length,
      latestAssistantTextPreview: (state.conversationState.latestAssistantText ?? "").slice(0, 200),
      outputArtifactCount: state.artifacts.outputs.length,
      lastToolCallCount: state.toolState.lastToolCalls.length,
      lastToolResultCount: state.toolState.lastToolResults.length,
      pauseRequested: state.flags.pauseRequested,
      waitingHuman: state.status === "waiting_human",
      promptCompileCount: state.debugRefs.promptCompileIds.length,
      lastToolExposurePlanId: state.toolState.lastToolExposurePlanId ?? null
    };
  }

  /**
   * 计算浅层差异（key 级）。
   * 说明：
   * - 首版先做最直观的“前后值对比”；
   * - 后续如需要更强 diff，再替换为深度 diff。
   */
  private computeShallowStateDiff(
    beforeSnapshot: Record<string, unknown>,
    afterSnapshot: Record<string, unknown>
  ): Record<string, { before: unknown; after: unknown }> {
    const keys = new Set([...Object.keys(beforeSnapshot), ...Object.keys(afterSnapshot)]);
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of keys) {
      const before = beforeSnapshot[key];
      const after = afterSnapshot[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        diff[key] = { before, after };
      }
    }
    return diff;
  }

  private loadPromptUnitsFromSnapshot(state: RunState): PromptBlock[] {
    const refs = this.getSnapshotRefs(state);
    const map = ((refs.promptUnits ?? refs.promptBlocks ?? {}) as Record<string, number>) ?? {};
    const list: PromptBlock[] = [];
    for (const [id, version] of Object.entries(map)) {
      const item = this.deps.db.getPromptUnit(id, version, this.deps.projectId);
      if (item) list.push(item);
    }
    return list;
  }

  private loadToolsFromSnapshot(state: RunState): ToolSpec[] {
    const refs = this.getSnapshotRefs(state);
    const map = (refs.tools ?? {}) as Record<string, number>;
    const list: ToolSpec[] = [];
    for (const [id, version] of Object.entries(map)) {
      const item = this.deps.db.getTool(id, version);
      if (item) list.push(item);
    }
    return list;
  }

  private getSnapshotRefs(state: RunState): JsonObject {
    const artifact = state.artifacts.outputs.find((a) => a.type === "snapshot_version_refs");
    if (artifact && artifact.content && typeof artifact.content === "object" && !Array.isArray(artifact.content)) {
      return artifact.content as JsonObject;
    }
    return {};
  }

  private buildSnapshotVersionRefs(workflow: WorkflowSpec): JsonObject {
    const agents: Record<string, number> = {};
    const tools: Record<string, number> = {};
    const promptUnits: Record<string, number> = {};

    for (const node of workflow.nodes) {
      if (node.agentId) {
        const agent = this.deps.agentRegistry.get(node.agentId);
        if (agent) agents[agent.id] = agent.version;
      }
      if (node.toolId) {
        const tool = this.deps.toolRegistry.get(node.toolId);
        if (tool) tools[tool.id] = tool.version;
      }
    }

    // 运行开始时冻结当前 PromptUnit 版本，避免 run 中途受全局热更新污染。
    for (const unit of this.deps.db.listPromptUnits(this.deps.projectId)) {
      promptUnits[unit.id] = unit.version;
    }

    return {
      workflow: { id: workflow.id, version: workflow.version },
      agents,
      tools,
      promptUnits,
      // 兼容旧字段，便于旧 run 回放。
      promptBlocks: promptUnits
    };
  }

  private buildInitialState(
    runId: string,
    threadId: string,
    workflow: WorkflowSpec,
    request: CreateRunRequest,
    snapshotRefs: JsonObject
  ): RunState {
    const agentSnapshots: Record<string, AgentSpec> = {};
    for (const node of workflow.nodes) {
      if (node.agentId) {
        const agent = this.deps.agentRegistry.get(node.agentId);
        if (agent) agentSnapshots[agent.id] = agent;
      }
    }
    return {
      runMeta: {
        runId,
        threadId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        startedAt: nowIso()
      },
      threadMeta: { threadId, checkpointCountApprox: 0 },
      workflowSnapshot: workflow,
      agentSnapshots,
      conversationState: {
        messages: [],
        userInput: request.userInput
      },
      artifacts: {
        outputs: [{ id: newId("artifact"), type: "snapshot_version_refs", content: snapshotRefs as unknown as JsonValue }]
      },
      memoryState: { injectedPromptUnitIds: [] },
      toolState: { lastToolCalls: [], lastToolResults: [] },
      routingState: {
        currentNodeId: workflow.entryNode,
        history: []
      },
      humanReviewState: {
        requireReview: Boolean(request.runConfig?.requireHumanReview)
      },
      debugRefs: {
        promptCompileIds: [],
        traceEventSeqLast: 0,
        promptOverrides: [],
        promptUnitOverrides: []
      },
      controlConfig: {
        interruptBeforeNodes: request.runConfig?.interruptBeforeNodes ?? [],
        interruptAfterNodes: request.runConfig?.interruptAfterNodes ?? [],
        requireHumanReview: Boolean(request.runConfig?.requireHumanReview)
      },
      status: "created",
      flags: {
        pauseRequested: false,
        softPauseAtNextSafePoint: false
      }
    };
  }

  private resolveWorkflow(workflowId: string, version?: number): WorkflowSpec {
    const workflow = version
      ? this.deps.db.getWorkflow(workflowId, version)
      : this.deps.workflowRegistry.get(workflowId);
    if (!workflow) throw new Error(`工作流不存在：${workflowId}${version ? `@${version}` : ""}`);
    return workflow;
  }

  private threadConfig(threadId: string, checkpointId?: string): any {
    return {
      configurable: {
        thread_id: threadId,
        ...(checkpointId ? { checkpoint_id: checkpointId } : {})
      }
    };
  }

  private getRunRecord(runId: string): RunRecord {
    const cached = this.activeRuns.get(runId);
    if (cached) return cached;
    const row = this.deps.db.db
      .prepare(
        `SELECT run_id, thread_id, workflow_id, workflow_version, provider_config_json FROM runs WHERE run_id = ?`
      )
      .get(runId) as
      | {
          run_id: string;
          thread_id: string;
          workflow_id: string;
          workflow_version: number;
          provider_config_json: string;
        }
      | undefined;
    if (!row) throw new Error(`run 不存在：${runId}`);
    const rebuilt: RunRecord = {
      runId: row.run_id,
      threadId: row.thread_id,
      workflowId: row.workflow_id,
      workflowVersion: row.workflow_version,
      provider: JSON.parse(row.provider_config_json) as CreateRunRequest["provider"]
    };
    this.activeRuns.set(rebuilt.runId, rebuilt);
    return rebuilt;
  }

  private getRunRecordByThread(threadId: string): RunRecord {
    for (const rec of this.activeRuns.values()) {
      if (rec.threadId === threadId) return rec;
    }
    const row = this.deps.db.db
      .prepare(
        `SELECT run_id, thread_id, workflow_id, workflow_version, provider_config_json
         FROM runs WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(threadId) as
      | {
          run_id: string;
          thread_id: string;
          workflow_id: string;
          workflow_version: number;
          provider_config_json: string;
        }
      | undefined;
    if (!row) throw new Error(`thread 不存在：${threadId}`);
    const rebuilt: RunRecord = {
      runId: row.run_id,
      threadId: row.thread_id,
      workflowId: row.workflow_id,
      workflowVersion: row.workflow_version,
      provider: JSON.parse(row.provider_config_json) as CreateRunRequest["provider"]
    };
    this.activeRuns.set(rebuilt.runId, rebuilt);
    return rebuilt;
  }

  private async patchLiveHeadState(record: RunRecord, patch: Record<string, unknown>): Promise<void> {
    const workflow = this.resolveWorkflow(record.workflowId, record.workflowVersion);
    const graph = this.getOrBuildGraph(workflow);
    const snapshot = await graph.getState(this.threadConfig(record.threadId));
    const current = (snapshot.values as GraphEnvelope).state;
    const merged = deepMerge(current, patch);
    await graph.updateState(this.threadConfig(record.threadId), { state: merged });
  }
}
