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
 *
 * 进一步说明：
 * - 这里故意只描述“要存什么”，不描述“怎么存”；
 * - 因为 core 不应该知道底层是 SQLite、D1、内存 map，还是远端服务；
 * - review 这一层时，重点看“抽象边界是否完整”，而不是看 SQL 细节。
 */
export interface StoragePort {
  /**
   * 保存版本化配置，并返回新版本号。
   * 常见使用场景：
   * - Agent / PromptUnit / Workflow / Tool 热更新时，不覆盖旧版本，而是追加新版本。
   */
  saveVersionedConfig<T extends { id: string; enabled?: boolean }>(
    kind: "agent" | "prompt_block" | "workflow" | "tool",
    payload: T
  ): number;
  /**
   * 列出当前可见的工作流定义。
   * 说明：
   * - core 只关心“当前有哪些 workflow 可选”，不关心底层用了什么缓存策略。
   */
  listWorkflows(): WorkflowSpec[];
  /**
   * 创建或更新 run 摘要。
   * 说明：
   * - 这是调试台列表页最常读的数据；
   * - 它不是完整 RunState，只是一份轻量级索引。
   */
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
  /**
   * 读取 run 摘要。
   */
  getRunSummary(runId: string): JsonObject | null;
  /**
   * 追加一条 trace 事件。
   * 说明：
   * - trace 是“发生过什么”的顺序日志；
   * - 它和 checkpoint/state patch 不同，不负责恢复状态，只负责可观测性。
   */
  insertTraceEvent(event: TraceEvent): void;
  /**
   * 按顺序回放 trace 事件。
   */
  listTraceEvents(runId: string, afterSeq?: number, limit?: number): TraceEvent[];
  /**
   * 记录一次 Prompt 编译结果。
   * 作用：
   * - 让调试器能回看“这一轮到底喂给模型什么 messages”。
   */
  insertPromptCompile(input: {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  }): void;
  /**
   * 读取指定 compileId 的 Prompt 编译记录。
   */
  getPromptCompile(compileId: string): {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  } | null;
  /**
   * 更新 run 级计划状态。
   * 典型来源：
   * - update_plan builtin tool
   * - 后续人工编辑计划
   */
  upsertRunPlan(runId: string, threadId: string, plan: JsonValue): void;
  /**
   * 读取 run 级计划状态。
   */
  getRunPlan(runId: string): JsonValue | null;
  /**
   * 记录一次“等待用户输入”的请求。
   * 说明：
   * - 这类数据既用于 resume，也用于调试台展示当前卡点。
   */
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
 *
 * review 提示：
 * - 这一层是“可恢复执行”的抽象边界；
 * - 真正底层可能是 LangGraph checkpoint、数据库快照，或别的持久化方案。
 */
export interface CheckpointPort {
  /**
   * 读取线程当前头部状态。
   */
  getCurrentState(threadId: string): Promise<RunState | null>;
  /**
   * 将状态写回当前线程头部。
   */
  updateState(threadId: string, state: RunState): Promise<void>;
  /**
   * 枚举历史 checkpoint。
   */
  listHistory(threadId: string): Promise<JsonValue[]>;
  /**
   * 从指定 checkpoint 分叉出一条新线程。
   * 说明：
   * - fork 的核心不是“复制一份 run 记录”；
   * - 而是从某个历史状态继续演化出另一条分支。
   */
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
 *
 * 设计取舍：
 * - 保留 `stream + invoke` 两条能力，是因为有些流程必须真流式拿事件，
 *   但也有些场景只需要一次性最终结果。
 */
export interface ModelPort {
  /**
   * 统一流式输出接口。
   */
  stream(req: UnifiedModelRequest): AsyncIterable<UnifiedModelStreamEvent>;
  /**
   * 统一非流式接口。
   */
  invoke(req: UnifiedModelRequest): Promise<UnifiedModelFinalResult>;
}

/**
 * ToolExecutionPort：
 * - 负责工具执行。
 *
 * 说明：
 * - core 不关心 builtin / shell / mcp / skill 的具体执行差异；
 * - 它只需要知道：给定 toolName + args，运行时能返回统一 ToolResult。
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
 *
 * 说明：
 * - `emit` 负责实时推送；
 * - `replay` 负责断线重连后的补拉。
 */
export interface EventStreamPort {
  emit(event: TraceEvent): void;
  replay(runId: string, afterSeq?: number, limit?: number): TraceEvent[];
}

/**
 * ConfigResolverPort：
 * - 负责 Preset + Override + RuntimePatch 三层合并。
 *
 * review 提示：
 * - 这里是配置优先级的“唯一抽象口”；
 * - 如果后续多端行为不一致，优先检查是否都实现了同一套合并语义。
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
 *
 * 理解方式：
 * - 可以把它看成“core 运行所需的最小外部世界”。
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
 *
 * 说明：
 * - 这是给外层 runtime 适配层调用的最小入口；
 * - 真正复杂的执行细节不暴露在这里，而是藏在具体实现中。
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
