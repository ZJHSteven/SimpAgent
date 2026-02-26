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
/**
 * 首批内置工具名称（借鉴 Codex 工具思路）。
 * 说明：
 * - 这些工具在“外层工具来源层”注册；
 * - 后续会被转换到 Canonical Tool Layer，再由模型暴露层适配。
 */
export type BuiltinToolName =
  | "shell_command"
  | "apply_patch"
  | "read_file"
  | "web_search"
  | "update_plan"
  | "request_user_input"
  | "view_image";

/**
 * 三层工具架构里的“外层来源分类”。
 */
export type CanonicalToolKind = "builtin" | "mcp" | "skill_tool" | "plugin" | "user_defined";

/**
 * 工具对模型的暴露层级（用于渐进式披露）。
 * 说明：
 * - 不是所有轮次都把完整 schema 暴露给模型；
 * - 可以先只暴露名字/简介，再逐步展开。
 */
export type CanonicalToolExposureLevel = "name_only" | "summary" | "description" | "full_schema";

/**
 * 内层暴露适配器种类（面向模型 API）。
 * 注意：这是“暴露协议策略”，不是内部统一抽象。
 */
export type ToolExposureAdapterKind =
  | "responses_native"
  | "chat_function"
  | "chat_custom"
  | "structured_output_tool_call"
  | "prompt_protocol_fallback";

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

/**
 * 工具来源层 -> 中间统一层（Canonical Tool Layer）的统一规格。
 * 说明：
 * - 该结构不绑定任何具体模型 API；
 * - runtime / tool loop / trace 一律面向该结构工作。
 */
export interface CanonicalToolSpec {
  id: ID;
  name: string;
  kind: CanonicalToolKind;
  displayName: string;
  description: string;
  summary?: string;
  tags?: string[];
  routeTarget: CanonicalToolRouteTarget;
  executorType: ToolExecutorType;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  enabled: boolean;
  exposure: CanonicalToolExposurePolicy;
  permissionPolicy: CanonicalToolPermissionPolicy;
  sourceMeta?: JsonObject;
  version: number;
}

/**
 * 工具路由目标：
 * - 中间层只记录“应该路由到哪里”，不关心模型如何发起调用。
 */
export type CanonicalToolRouteTarget =
  | { kind: "builtin"; builtin: BuiltinToolName }
  | { kind: "mcp"; server: string; tool: string }
  | { kind: "plugin"; pluginId: string; tool: string }
  | { kind: "skill_tool"; skillId: string; tool: string }
  | { kind: "user_defined"; toolId: string };

/**
 * Canonical 层权限策略（统一于 shell/function/http 等执行器之前）。
 */
export interface CanonicalToolPermissionPolicy {
  permissionProfileId: ID;
  shellPermissionLevel?: ShellPermissionLevel;
  requiresHumanApproval?: boolean;
  workingDirPolicy?: ToolSpec["workingDirPolicy"];
  allowCommandPrefixes?: string[];
  timeoutMs?: number;
}

/**
 * Canonical 层暴露策略（中间层的策略意图）。
 * 说明：
 * - 内层适配器会结合模型能力把它翻译成具体 API 参数。
 */
export interface CanonicalToolExposurePolicy {
  preferredAdapter?: ToolExposureAdapterKind;
  fallbackAdapters?: ToolExposureAdapterKind[];
  exposureLevel: CanonicalToolExposureLevel;
  exposeByDefault: boolean;
  catalogPath?: string[];
  supportsFreeformPayload?: boolean;
  providerHints?: Record<string, JsonValue>;
}

/**
 * 模型工具信号经过“内层暴露适配层”解析后，统一回到 Canonical 调用意图。
 */
export interface CanonicalToolCallIntent {
  toolCallId: ID;
  canonicalToolId: ID;
  toolName: string;
  adapterKind: ToolExposureAdapterKind;
  payloadMode: "json_args" | "freeform_text" | "mixed";
  args?: JsonObject;
  freeformText?: string;
  rawSignal?: JsonValue;
}

/**
 * Canonical 工具执行上下文（运行时传给工具执行器）。
 */
export interface CanonicalToolExecutionEnvelope {
  runId: ID;
  threadId: ID;
  nodeId?: ID;
  agentId?: ID;
  workspaceRoot?: string;
  provider?: {
    vendor: ProviderVendor;
    apiMode: ProviderApiMode;
    model: string;
  };
  interruptOnHighRisk?: boolean;
  metadata?: JsonObject;
}

/**
 * Canonical 工具执行结果（内部统一格式）。
 * 说明：
 * - `toolResult` 保留旧结构，便于兼容现有 ToolRuntime；
 * - `sideEffects` 用于可观测性与重放/审计。
 */
export interface CanonicalToolCallResult {
  intent: CanonicalToolCallIntent;
  canonicalTool: Pick<CanonicalToolSpec, "id" | "name" | "kind" | "routeTarget">;
  toolResult: ToolResult;
  toolTrace?: ToolTrace;
  sideEffects: CanonicalToolSideEffectRecord[];
}

/**
 * 统一副作用记录（工具执行、文件写入、外部请求等）。
 */
export interface CanonicalToolSideEffectRecord {
  sideEffectId: ID;
  runId: ID;
  threadId: ID;
  nodeId?: ID;
  agentId?: ID;
  type: "tool_exec" | "file_write" | "file_read" | "http_request" | "web_search" | "plan_update" | "user_input" | "image_read";
  target?: string;
  summary: string;
  details?: JsonValue;
  timestamp: TimestampISO;
}

/**
 * 内置工具配置（可热更新）。
 * 说明：
 * - 这是工具层配置，不是调用参数。
 */
export interface BuiltinToolConfig {
  name: BuiltinToolName;
  enabled: boolean;
  description?: string;
  exposurePolicy: CanonicalToolExposurePolicy;
  permissionPolicy: CanonicalToolPermissionPolicy;
  uiConfig?: JsonObject;
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

/**
 * PromptUnit：统一提示词单元（你强调的“万物皆提示词块”）。
 * 说明：
 * - 普通 prompt block / 历史消息 / memory / 世界书 / 工具目录摘要都用同一结构表示；
 * - 最终会由 PromptAssemblyPlan 排序装配。
 */
export interface PromptUnit {
  id: ID;
  source: PromptUnitSource;
  enabled: boolean;
  role: MessageRole;
  title?: string;
  contentTemplate: string;
  renderedContent?: string;
  variables?: Record<string, JsonValue>;
  placement: PromptPlacement;
  sortWeight: number;
  tags?: string[];
  metadata?: JsonObject;
}

export type PromptUnitSource =
  | { kind: "prompt_block"; blockId: ID; blockVersion?: number; promptKind?: PromptBlockKind }
  | { kind: "history_message"; messageIndex: number; originalRole: MessageRole }
  | { kind: "memory_delegate"; adapterId?: ID; producerAgentId?: ID }
  | { kind: "worldbook"; entryId: ID }
  | { kind: "tool_catalog"; scope?: string }
  | { kind: "manual_override"; operator?: string }
  | { kind: "artifact"; artifactId: ID };

/**
 * Prompt 插入位置：
 * - 保留旧 insertionPoint（slot）能力；
 * - 同时支持按具体消息前后插入。
 */
export type PromptPlacement =
  | { mode: "slot"; slot: PromptInsertionPoint }
  | { mode: "before_message_id"; messageId: ID }
  | { mode: "after_message_id"; messageId: ID }
  | { mode: "before_role_anchor"; role: MessageRole }
  | { mode: "after_role_anchor"; role: MessageRole }
  | { mode: "end" };

/**
 * Prompt 装配计划（供调试器与人工编辑）。
 */
export interface PromptAssemblyPlan {
  assemblyId: ID;
  agentId: ID;
  threadId: ID;
  runId: ID;
  units: PromptUnit[];
  orderedUnitIds: ID[];
  finalMessages: UnifiedMessage[];
  notes?: string[];
}

/**
 * PromptUnit 人工覆盖（run-scope）。
 */
export interface PromptUnitOverride {
  overrideId: ID;
  unitId: ID;
  action: "enable" | "disable" | "replace_content" | "change_role" | "change_placement" | "change_sort";
  payload: JsonObject;
}

/**
 * 历史切片计划（用于把历史当作 PromptUnit 并可委派摘要）。
 */
export interface PromptHistorySlicePlan {
  planId: ID;
  sourceMessageIds: ID[];
  selectedMessageIds: ID[];
  strategy: "manual" | "recent_n" | "token_budget" | "agent_summary";
  summaryTargetAgentId?: ID;
}

/**
 * 提示词委派总结任务（最小接口）。
 * 说明：
 * - 首版可以只落接口与 trace，不必先做复杂调度器。
 */
export interface PromptDelegationSummaryJob {
  jobId: ID;
  fromAgentId?: ID;
  toAgentId: ID;
  inputUnitIds: ID[];
  outputUnitId?: ID;
  status: "created" | "running" | "completed" | "failed";
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
  /**
   * v0.2 新增：
   * - 保留原有 block 级 trace，同时开始承载 PromptUnit 装配计划。
   * - 这样旧接口不需要立刻废弃，前端可逐步迁移。
   */
  promptAssemblyPlan?: PromptAssemblyPlan;
  toolExposurePlan?: ToolExposurePlan;
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
 * 内层暴露适配层生成的计划（供模型调用 + 调试器查看）。
 */
export interface ToolExposurePlan {
  planId: ID;
  adapterKind: ToolExposureAdapterKind;
  exposedTools: Array<{
    canonicalToolId: ID;
    toolName: string;
    exposureLevel: CanonicalToolExposureLevel;
    exposedAs: "responses_native" | "function" | "custom" | "structured_output" | "prompt_protocol";
    schemaIncluded: boolean;
  }>;
  fallbackChain: ToolExposureAdapterKind[];
  metadata?: JsonObject;
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
    lastCanonicalToolCalls?: CanonicalToolCallIntent[];
    lastCanonicalToolResults?: CanonicalToolCallResult[];
    lastToolExposurePlanId?: ID;
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
    pendingUserInputRequestId?: ID;
  };
  debugRefs: {
    promptCompileIds: ID[];
    traceEventSeqLast: number;
    promptOverrides: PromptOverridePatch[];
    promptUnitOverrides?: PromptUnitOverride[];
    stateDiffIds?: ID[];
    sideEffectIds?: ID[];
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
  planState?: PlanState;
  userInputState?: UserInputRequestState;
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

/**
 * 节点前后状态差异（供调试器快速展示）。
 */
export interface StateDiffTrace {
  diffId: ID;
  runId: ID;
  threadId: ID;
  nodeId?: ID;
  agentId?: ID;
  beforeSummary?: JsonValue;
  afterSummary?: JsonValue;
  diff: JsonValue;
  createdAt: TimestampISO;
}

/**
 * Run 内部计划状态（由 update_plan 内置工具维护）。
 */
export interface PlanState {
  lastUpdatedAt?: TimestampISO;
  explanation?: string;
  items: Array<{
    step: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

/**
 * request_user_input 内置工具的运行状态。
 */
export interface UserInputRequestState {
  requestId?: ID;
  status: "idle" | "waiting" | "answered";
  questions?: Array<{
    id: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
  }>;
  answer?: JsonValue;
  requestedAt?: TimestampISO;
  answeredAt?: TimestampISO;
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
        latestTraceSeq?: number;
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
    toolExposurePolicyOverride?: {
      preferredAdapter?: ToolExposureAdapterKind;
      fallbackAdapters?: ToolExposureAdapterKind[];
    };
    streamBreakStrategy?: "abort_on_stream_break" | "retry_same_round_once" | "retry_round_with_marker" | "fallback_invoke_once" | "manual_interrupt";
  };
}

export interface CreateRunResponse {
  runId: ID;
  threadId: ID;
  status: RunStatus;
}
