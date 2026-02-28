/**
 * 本文件作用：
 * - 定义 core 层依赖的端口（Ports）接口。
 * - 通过“接口隔离”实现 runtime-node / runtime-worker / runtime-tauri-bridge 的可替换实现。
 *
 * 教学说明：
 * - core 只依赖“能力描述”，不依赖具体技术栈（SQLite/D1/HTTP/WS 等）。
 * - 适配层负责把具体技术细节翻译为这些端口实现。
 */

import type {
  CreateRunRequest,
  CreateRunResponse,
  JsonObject,
  JsonValue,
  PromptTrace,
  RunState,
  ToolResult,
  TraceEvent,
  UnifiedMessage,
  UnifiedModelFinalResult,
  UnifiedModelRequest,
  UnifiedModelStreamEvent,
  WorkflowSpec
} from "../types/index.js";

/**
 * StoragePort：
 * - 负责配置版本、运行摘要、trace/prompt/plan/user-input 等持久化能力。
 */
export interface StoragePort {
  saveVersionedConfig<T extends { id: string; enabled: boolean }>(kind: "agent" | "prompt_block" | "workflow" | "tool", payload: T): number;
  listWorkflows(): WorkflowSpec[];
  upsertRunSummary(input: {
    runId: string;
    threadId: string;
    workflowId: string;
    workflowVersion: number;
    status: string;
    currentNodeId?: string;
    snapshotVersionRefs: JsonValue;
    providerConfig: JsonValue;
    inputJson: JsonValue;
    parentRunId?: string;
    parentCheckpointId?: string;
  }): void;
  getRunSummary(runId: string): JsonObject | null;
  insertTraceEvent(event: TraceEvent): void;
  listTraceEvents(runId: string, afterSeq?: number, limit?: number): TraceEvent[];
  insertPromptCompile(input: {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  }): void;
  getPromptCompile(compileId: string): {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  } | null;
  upsertRunPlan(runId: string, threadId: string, plan: JsonValue): void;
  getRunPlan(runId: string): JsonValue | null;
  upsertUserInputRequest(input: {
    requestId: string;
    runId: string;
    threadId: string;
    nodeId?: string;
    agentId?: string;
    state: JsonValue;
    payload: JsonValue;
  }): void;
}

/**
 * CheckpointPort：
 * - 负责 checkpoint 的写入、读取、fork 恢复。
 */
export interface CheckpointPort {
  getCurrentState(threadId: string): Promise<RunState | null>;
  updateState(threadId: string, state: RunState): Promise<void>;
  listHistory(threadId: string): Promise<JsonValue[]>;
  forkFromCheckpoint(input: {
    threadId: string;
    checkpointId: string;
    newThreadId: string;
    newState?: RunState;
  }): Promise<void>;
}

/**
 * ModelPort：
 * - 负责统一模型调用接口。
 */
export interface ModelPort {
  stream(req: UnifiedModelRequest): AsyncIterable<UnifiedModelStreamEvent>;
  invoke(req: UnifiedModelRequest): Promise<UnifiedModelFinalResult>;
}

/**
 * ToolExecutionPort：
 * - 负责工具执行。
 */
export interface ToolExecutionPort {
  executeTool(input: {
    runId: string;
    threadId: string;
    nodeId: string;
    agentId: string;
    toolName: string;
    args: JsonObject;
    workspaceRoot?: string;
  }): Promise<ToolResult>;
}

/**
 * EventStreamPort：
 * - 负责 trace 事件分发（WS/SSE/消息总线等）。
 */
export interface EventStreamPort {
  emit(event: TraceEvent): void;
  replay(runId: string, afterSeq?: number, limit?: number): TraceEvent[];
}

/**
 * ConfigResolverPort：
 * - 负责 Preset + Override + RuntimePatch 三层合并。
 */
export interface ConfigResolverPort {
  resolveConfig<T extends JsonValue>(layers: {
    preset: T;
    userOverride?: Partial<T> | null;
    runtimePatch?: Partial<T> | null;
  }): T;
}

/**
 * CoreRuntimeDeps：
 * - core 运行引擎可用依赖集合。
 */
export interface CoreRuntimeDeps {
  storage: StoragePort;
  checkpoints: CheckpointPort;
  model: ModelPort;
  tools: ToolExecutionPort;
  events: EventStreamPort;
  configResolver: ConfigResolverPort;
}

/**
 * CoreRuntimeEngine：
 * - core 层统一引擎接口。
 */
export interface CoreRuntimeEngine {
  createRun(req: CreateRunRequest): Promise<CreateRunResponse>;
  getRunSummary(runId: string): JsonObject | null;
  resolveEffectiveConfig<T extends JsonValue>(layers: {
    preset: T;
    userOverride?: Partial<T> | null;
    runtimePatch?: Partial<T> | null;
  }): T;
}
