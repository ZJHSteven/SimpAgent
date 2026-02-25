/**
 * 本文件作用（核心契约层）：
 * - 定义整个框架跨模块共享的类型契约。
 * - 这些类型会被 Prompt 编译器、Provider 兼容层、运行时、HTTP API、WS 调试器共同使用。
 *
 * 设计原则（教学向说明）：
 * 1. 先定义“数据契约”，再写实现，避免模块各自发明字段导致后期难以调试。
 * 2. 所有“可观测”数据都尽量结构化，避免只有字符串日志。
 * 3. 首版允许字段较多，但必须语义清晰，便于后续裁剪。
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ID = string;
export type TimestampISO = string;

/**
 * Provider API 模式：
 * - chat_completions: 兼容 OpenAI Chat Completions（也是 Gemini OpenAI-compatible 的主要入口）
 * - responses: OpenAI Responses API（更适合工具循环、复杂事件流）
 */
export type ProviderApiMode = "chat_completions" | "responses";

/**
 * Provider 厂商类型：
 * - mock: 本地假实现，便于离线开发与调试 UI
 * - openai: OpenAI 官方
 * - gemini_openai_compat: Gemini 的 OpenAI 兼容接口
 * - generic_openai_compat: 其他 OpenAI 兼容服务
 */
export type ProviderVendor =
  | "mock"
  | "openai"
  | "gemini_openai_compat"
  | "generic_openai_compat";

export type RunStatus =
  | "created"
  | "running"
  | "paused"
  | "waiting_human"
  | "completed"
  | "error"
  | "cancelled";

export type ToolExecutorType = "function" | "shell" | "http" | "mcp_proxy";
export type ShellPermissionLevel = "readonly" | "workspace_write" | "dangerous";

export type PromptBlockKind =
  | "system_rule"
  | "persona"
  | "worldbook"
  | "memory"
  | "task"
  | "format"
  | "safety"
  | "tool_hint"
  | "hidden_internal";

export type PromptInsertionPoint =
  | "system_pre"
  | "system_post"
  | "developer"
  | "task_pre"
  | "task_post"
  | "memory_context"
  | "tool_context";

export type MessageRole = "system" | "developer" | "user" | "assistant" | "tool";

/**
 * LLM 输入消息（统一抽象）。
 * 说明：
 * - 首版以文本为主，但保留 `metadata` 扩展位，方便后续挂图片、引用、来源标签等。
 */
export interface UnifiedMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: JsonObject;
}

/**
 * Agent 定义（配置对象，不是运行时实例）。
 * 注意：
 * - version 是“配置版本号”，不是 npm/package 版本。
 */
export interface AgentSpec {
  id: ID;
  name: string;
  role: string;
  description: string;
  modelPolicyId: ID;
  promptAssemblyPolicyId: ID;
  contextPolicyId: ID;
  toolPolicyId: ID;
  memoryPolicies: ID[];
  handoffPolicy?: {
    allowedTargets: ID[];
    allowDynamicHandoff: boolean;
    strategy?: "fixed" | "dynamic" | "hybrid";
  };
  outputContract?: {
    type: "json" | "markdown" | "text";
    jsonSchema?: JsonObject;
    instruction?: string;
  };
  postChecks: ID[];
  enabled: boolean;
  version: number;
  tags?: string[];
}

/**
 * 提示词块（Prompt Block）：
 * - 这是你框架的核心“可编排提示词单元”。
 */
export interface PromptBlock {
  id: ID;
  name: string;
  kind: PromptBlockKind;
  template: string;
  variablesSchema?: JsonObject;
  insertionPoint: PromptInsertionPoint;
  priority: number;
  trigger?: {
    /**
     * 说明：
     * - 首版使用“结构化条件 + 简单表达式字符串”的混合设计，便于后续升级。
     * - expression 首版可选，不一定实现复杂解析器。
     */
    keywords?: string[];
    taskTypes?: string[];
    agentIds?: ID[];
    tagsAny?: string[];
    expression?: string;
  };
  tokenBudgetHint?: number;
  enabled: boolean;
  version: number;
  tags?: string[];
}

/**
 * 工作流节点定义（配置层）。
 * type 说明：
 * - agent: 运行一个 Agent（最常见）
 * - tool: 直接跑工具节点（例如固定系统工具）
 * - interrupt: 显式人工审批节点
 * - router: 路由节点（可选，首版多由运行时包装）
 */
export interface WorkflowNodeSpec {
  id: ID;
  type: "agent" | "tool" | "interrupt" | "router";
  label: string;
  agentId?: ID;
  toolId?: ID;
  config?: JsonObject;
}

export interface WorkflowEdgeSpec {
  id: ID;
  from: ID;
  to: ID;
  condition?: {
    type: "always" | "state_field" | "expression";
    field?: string;
    equals?: JsonValue;
    expression?: string;
  };
  priority?: number;
}

export interface WorkflowSpec {
  id: ID;
  name: string;
  entryNode: ID;
  nodes: WorkflowNodeSpec[];
  edges: WorkflowEdgeSpec[];
  routingPolicies: Array<{
    id: ID;
    nodeId: ID;
    mode: "fixed" | "dynamic" | "hybrid";
    config?: JsonObject;
  }>;
  interruptPolicy?: {
    defaultInterruptBefore: boolean;
    defaultInterruptAfter: boolean;
    interruptBeforeNodes?: ID[];
    interruptAfterNodes?: ID[];
  };
  enabled: boolean;
  version: number;
}

/**
 * 工具定义（统一抽象）。
 * 重点：
 * - 不把 shell 当唯一工具，而是统一描述。
 */
export interface ToolSpec {
  id: ID;
  name: string;
  description: string;
  executorType: ToolExecutorType;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  permissionProfileId: ID;
  timeoutMs: number;
  workingDirPolicy?: {
    mode: "fixed" | "workspace" | "allowlist";
    fixedPath?: string;
    allowlist?: string[];
  };
  executorConfig?: JsonObject;
  enabled: boolean;
  version: number;
}

export interface ToolCall {
  toolCallId: ID;
  toolId: ID;
  toolName: string;
  arguments: JsonObject;
  issuedByAgentId?: ID;
  issuedAt: TimestampISO;
}

export interface ToolResult {
  toolCallId: ID;
  toolId: ID;
  ok: boolean;
  output?: JsonValue;
  error?: {
    code: string;
    message: string;
    details?: JsonValue;
  };
  startedAt: TimestampISO;
  finishedAt: TimestampISO;
  durationMs: number;
}

/**
 * ToolTrace：
 * - 调试器会直接使用该结构展示工具调用详情。
 */
export interface ToolTrace {
  toolCallId: ID;
  toolId: ID;
  toolName: string;
  executorType: ToolExecutorType;
  arguments: JsonObject;
  result?: ToolResult;
  permissionLevel?: ShellPermissionLevel;
  workingDir?: string;
  stdoutPreview?: string;
  stderrPreview?: string;
}

/**
 * Prompt 编译输入。
 * 说明：
 * - `contextSources` 是被裁剪前的原始上下文集合。
 * - `overridePatches` 用于调试器人工覆盖提示词块（run-scope）。
 */
export interface PromptCompileRequest {
  agentId: ID;
  threadId: ID;
  runId: ID;
  taskEnvelope: {
    taskType: string;
    input: JsonObject;
    labels?: string[];
  };
  contextSources: Array<{
    id: ID;
    type: "conversation" | "memory" | "artifact" | "tool_output" | "system";
    content: string;
    tags?: string[];
    importance?: number;
    metadata?: JsonObject;
  }>;
  memoryInputs: Array<{
    adapterId: ID;
    namespace?: string;
    content: string;
    score?: number;
    metadata?: JsonObject;
  }>;
  toolSchemas: Array<{
    toolId: ID;
    toolName: string;
    description: string;
    inputSchema: JsonObject;
  }>;
  overridePatches?: PromptOverridePatch[];
  providerApiType: ProviderApiMode;
}

export interface PromptOverridePatch {
  patchId: ID;
  type: "replace_block_template" | "disable_block" | "insert_ad_hoc_block";
  targetBlockId?: ID;
  payload: JsonObject;
}

export interface PromptTrace {
  compileId: ID;
  agentId: ID;
  providerApiType: ProviderApiMode;
  selectedBlocks: Array<{
    blockId: ID;
    version: number;
    insertionPoint: PromptInsertionPoint;
    priority: number;
    reason: string;
    renderedTextPreview: string;
    tokenEstimate?: number;
  }>;
  rejectedBlocks: Array<{
    blockId: ID;
    version: number;
    reason: string;
  }>;
  renderedVariables: Array<{
    blockId: ID;
    variable: string;
    valuePreview: string;
  }>;
  insertionPlan: Array<{
    insertionPoint: PromptInsertionPoint;
    blockIds: ID[];
  }>;
  finalMessages: UnifiedMessage[];
  contextSliceSummary: {
    totalSources: number;
    keptSources: number;
    omittedSources: number;
    policyLabel: string;
  };
  tokenEstimate: {
    inputApprox: number;
    outputReservedApprox: number;
    totalApprox: number;
  };
  redactions: Array<{
    field: string;
    reason: string;
  }>;
}

export interface PromptCompileResult {
  finalMessages: UnifiedMessage[];
  promptTrace: PromptTrace;
  tokenBudgetReport: {
    usedApprox: number;
    reservedOutputApprox: number;
    droppedApprox: number;
  };
  omittedContextReport: Array<{
    sourceId: ID;
    reason: string;
  }>;
}

/**
 * Provider 能力声明：
 * - 用于在请求前做能力检查，避免“静默忽略参数”。
 */
export interface ProviderCapabilities {
  vendor: ProviderVendor;
  apiModes: ProviderApiMode[];
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsReasoningEffort: boolean;
  supportsThoughts: boolean;
  supportsResponsesApi: boolean;
}

export interface UnifiedReasoningConfig {
  effort?: "none" | "minimal" | "low" | "medium" | "high";
  includeThoughts?: boolean;
}

export interface UnifiedModelRequest {
  vendor: ProviderVendor;
  apiMode: ProviderApiMode;
  baseURL?: string;
  apiKey?: string;
  model: string;
  messages?: UnifiedMessage[];
  responseInput?: JsonValue;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters: JsonObject;
    };
  }>;
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningConfig?: UnifiedReasoningConfig;
  vendorExtra?: JsonObject;
  stream?: boolean;
}

/**
 * 统一流式事件（调试器消费）。
 * 说明：
 * - 不同 Provider 的原始事件会被映射到该结构。
 */
export type UnifiedModelStreamEvent =
  | {
      type: "response_started";
      provider: ProviderVendor;
      requestId?: string;
      model?: string;
      apiMode?: ProviderApiMode;
    }
  | {
      type: "text_delta";
      delta: string;
      provider: ProviderVendor;
      apiMode: ProviderApiMode;
    }
  | {
      type: "tool_call_request";
      provider: ProviderVendor;
      apiMode: ProviderApiMode;
      toolCallId: ID;
      toolName: string;
      argumentsDelta?: string;
      argumentsJson?: JsonObject;
    }
  | {
      type: "reasoning";
      provider: ProviderVendor;
      apiMode: ProviderApiMode;
      reasoningSummary?: string;
      thoughts?: string[];
    }
  | {
      type: "response_completed";
      provider: ProviderVendor;
      apiMode: ProviderApiMode;
      finishReason?: string;
      usage?: JsonObject;
    }
  | {
      type: "raw_event";
      provider: ProviderVendor;
      apiMode: ProviderApiMode;
      event: JsonValue;
    };

export interface UnifiedModelFinalResult {
  provider: ProviderVendor;
  apiMode: ProviderApiMode;
  model: string;
  text: string;
  toolCalls: Array<{
    toolCallId: ID;
    toolName: string;
    argumentsJson: JsonObject;
  }>;
  reasoningSummary?: string;
  thoughts?: string[];
  usage?: JsonObject;
  raw?: JsonValue;
}

export interface ProviderErrorShape {
  code: string;
  message: string;
  details?: JsonValue;
}

/**
 * 运行时主状态（LangGraph State）。
 * 注意：
 * - 这里只放运行必要状态与索引引用。
 * - 大对象（完整 prompt_trace、完整工具输出、长 token 流）应写入 trace_store / DB，再在此处留引用。
 */
export interface RunState {
  runMeta: {
    runId: ID;
    threadId: ID;
    workflowId: ID;
    workflowVersion: number;
    startedAt: TimestampISO;
    parentRunId?: ID;
    parentCheckpointId?: ID;
  };
  threadMeta: {
    threadId: ID;
    checkpointCountApprox: number;
  };
  workflowSnapshot: WorkflowSpec;
  agentSnapshots: Record<string, AgentSpec>;
  conversationState: {
    messages: UnifiedMessage[];
    userInput: string;
    latestAssistantText?: string;
  };
  artifacts: {
    outputs: Array<{ id: ID; type: string; content: JsonValue }>;
  };
  memoryState: {
    injectedPromptBlocks: ID[];
    notes?: string[];
  };
  toolState: {
    lastToolCalls: ToolCall[];
    lastToolResults: ToolResult[];
  };
  routingState: {
    currentNodeId: ID;
    nextNodeId?: ID;
    history: Array<{ nodeId: ID; at: TimestampISO }>;
    reason?: string;
  };
  humanReviewState: {
    requireReview: boolean;
    pendingInterrupt?: {
      reason: string;
      payload?: JsonValue;
      at: TimestampISO;
    };
    lastResumePayload?: JsonValue;
  };
  debugRefs: {
    promptCompileIds: ID[];
    traceEventSeqLast: number;
    promptOverrides: PromptOverridePatch[];
  };
  controlConfig: {
    interruptBeforeNodes: ID[];
    interruptAfterNodes: ID[];
    requireHumanReview: boolean;
  };
  status: RunStatus;
  flags: {
    pauseRequested: boolean;
    softPauseAtNextSafePoint: boolean;
  };
}

/**
 * 统一 TraceEvent（调试器实时事件 + 历史检索）。
 */
export type TraceEventType =
  | "run_started"
  | "node_started"
  | "prompt_compiled"
  | "model_request_started"
  | "model_stream_delta"
  | "model_tool_call_detected"
  | "tool_call_started"
  | "tool_call_finished"
  | "side_effect_recorded"
  | "routing_decided"
  | "node_finished"
  | "interrupt_emitted"
  | "resume_received"
  | "state_patched"
  | "fork_created"
  | "run_finished"
  | "run_failed";

export interface TraceEvent {
  seq: number;
  eventId: ID;
  runId: ID;
  threadId: ID;
  type: TraceEventType;
  timestamp: TimestampISO;
  nodeId?: ID;
  agentId?: ID;
  summary: string;
  payload?: JsonValue;
}

export interface CheckpointRef {
  threadId: ID;
  checkpointId: ID;
  parentCheckpointId?: ID;
  runId?: ID;
  createdAt?: TimestampISO;
}

export interface StatePatchRequest {
  operator?: string;
  reason: string;
  patch: JsonObject;
  asNode?: string;
}

export interface PromptOverridePatchRequest {
  operator?: string;
  reason: string;
  patches: PromptOverridePatch[];
}

export interface ForkRunRequest {
  operator?: string;
  reason: string;
  resumeMode?: "auto" | "manual";
  resumePayload?: JsonValue;
}

export interface ForkRunResponse {
  parentRunId: ID;
  parentCheckpointId: ID;
  newRunId: ID;
  threadId: ID;
  status: RunStatus;
}

/**
 * WS 协议消息（客户端 -> 服务端）。
 */
export type WsClientMessage =
  | { type: "hello"; clientId?: string; lastEventSeq?: number }
  | { type: "subscribe_run"; runId: ID; lastEventSeq?: number }
  | { type: "unsubscribe_run"; runId: ID }
  | { type: "ping"; ts?: number }
  | { type: "ack"; runId: ID; seq: number }
  | { type: "request_replay_events"; runId: ID; afterSeq: number; limit?: number };

/**
 * WS 协议消息（服务端 -> 客户端）。
 */
export type WsServerMessage =
  | { type: "hello_ack"; connectionId: ID; serverTime: TimestampISO }
  | { type: "subscribed"; runId: ID }
  | { type: "heartbeat"; serverTime: TimestampISO }
  | { type: "trace_event"; runId: ID; event: TraceEvent }
  | {
      type: "run_snapshot";
      runId: ID;
      snapshot: {
        status: RunStatus;
        currentNodeId?: ID;
        threadId: ID;
        traceEventSeqLast: number;
      };
    }
  | { type: "run_status_changed"; runId: ID; status: RunStatus }
  | { type: "replay_events_batch"; runId: ID; events: TraceEvent[] }
  | { type: "warning"; code: string; message: string }
  | { type: "error"; code: string; message: string };

/**
 * Run 启动请求（HTTP）。
 */
export interface CreateRunRequest {
  workflowId: ID;
  workflowVersion?: number;
  userInput: string;
  provider: {
    vendor: ProviderVendor;
    apiMode: ProviderApiMode;
    model: string;
    baseURL?: string;
    apiKey?: string;
    temperature?: number;
    topP?: number;
    reasoningConfig?: UnifiedReasoningConfig;
    vendorExtra?: JsonObject;
  };
  runConfig?: {
    requireHumanReview?: boolean;
    interruptBeforeNodes?: ID[];
    interruptAfterNodes?: ID[];
  };
}

export interface CreateRunResponse {
  runId: ID;
  threadId: ID;
  status: RunStatus;
}
