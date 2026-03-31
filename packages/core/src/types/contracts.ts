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
export type PermissionMode = "deny" | "ask" | "allow";
export type PermissionScope = "command" | "path" | "fs" | "network" | "tool";
export type PermissionRuleLayer = "system" | "project" | "agent" | "node";
export type PermissionMatcherType = "exact" | "prefix" | "regex" | "schema";
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
  | "view_image"
  | "handoff";

/**
 * 三层工具架构里的“外层来源分类”。
 */
export type CanonicalToolKind = "builtin" | "mcp" | "skill_tool";

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

/**
 * 模型工具协议画像（由“模型路由配置”决定，而不是由人手工按工具决定）。
 * 设计目的：
 * - 用户/配置只需描述“这个模型 API 大致属于哪类能力画像”；
 * - 框架自动选择内层暴露适配器与降级链路。
 */
export type ToolProtocolProfile =
  | "auto"
  | "openai_responses"
  | "openai_chat_function"
  | "openai_chat_custom"
  | "openai_compat_function_only"
  | "structured_output_first"
  | "prompt_protocol_only";

export type PromptUnitKind =
  | "system_rule"
  | "persona"
  | "worldbook"
  | "memory"
  | "history_window"
  | "workflow_packet"
  | "handoff_packet"
  | "task"
  | "format"
  | "safety"
  | "tool_catalog"
  | "tool_detail"
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
 * 统一图谱：节点基础分类。
 * 说明：
 * - group 表示目录/集合节点；
 * - item 表示具体内容节点或可执行节点。
 */
export type CatalogNodeClass = "group" | "item";

/**
 * 统一图谱：节点主用途标签。
 * 说明：
 * - 这是“主用途提示”，不是硬类型系统；
 * - 真正的能力仍由 facet 决定。
 */
export type CatalogPrimaryKind = "generic" | "prompt" | "memory" | "tool" | "skill" | "mcp" | "worldbook";

/**
 * 图谱节点对模型的暴露模式。
 */
export type CatalogExposeMode = "hidden" | "summary_only" | "summary_first" | "content_direct" | "manual";

/**
 * 图谱节点附加能力类型。
 */
export type CatalogFacetType = "prompt" | "memory" | "tool" | "integration";

/**
 * 图谱横向关系类型。
 * 说明：
 * - 父子树结构不走这里，而是直接用 parentNodeId；
 * - 这里只有跨树或横向引用。
 */
export type CatalogRelationType = "reference" | "use" | "depend_on" | "alias" | "expand" | "belong_to" | "trigger";

/**
 * 图谱节点统一结构。
 * 说明：
 * - 所有图谱内容都先落到这一个统一外形中；
 * - 差异由 facet 补充。
 */
export interface CatalogNode {
  nodeId: ID;
  projectId: string;
  parentNodeId?: ID | null;
  nodeClass: CatalogNodeClass;
  name: string;
  title?: string;
  summaryText?: string;
  contentText?: string;
  contentFormat?: "markdown" | "plain_text" | "json";
  primaryKind?: CatalogPrimaryKind;
  visibility: "visible" | "internal" | "hidden";
  exposeMode: CatalogExposeMode;
  enabled: boolean;
  sortOrder: number;
  tags?: string[];
  metadata?: JsonObject;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

/**
 * 图谱横向关系。
 */
export interface CatalogRelation {
  relationId: ID;
  projectId: string;
  fromNodeId: ID;
  toNodeId: ID;
  relationType: CatalogRelationType;
  weight?: number;
  metadata?: JsonObject;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

/**
 * Prompt facet 载荷。
 * 说明：
 * - 正文依然在 node.contentText；
 * - facet 只补 Prompt 编译所需的结构化字段。
 */
export interface CatalogPromptFacetPayload {
  promptKind?: PromptUnitKind;
  role?: MessageRole;
  insertionPoint?: PromptInsertionPoint;
  variablesSchema?: JsonObject;
  tokenLimit?: number;
  priority?: number;
  trigger?: JsonObject;
}

/**
 * Memory facet 载荷。
 */
export interface CatalogMemoryFacetPayload {
  memoryType: "fact" | "summary" | "persona" | "worldbook" | "episodic" | "semantic";
  namespace?: string;
  source?: string;
  freshnessScore?: number;
  confidenceScore?: number;
  embeddingRef?: string;
  trigger?: JsonObject;
}

/**
 * Tool facet 载荷。
 */
export interface CatalogToolFacetPayload {
  /**
   * 当前统一后的工具类型：
   * - builtin：框架内置工具，由代码提供执行器，但定义仍来自 catalog；
   * - mcp：远端 MCP 工具；
   * - skill_tool：本地 skill 脚本工具。
   */
  toolKind: "builtin" | "mcp" | "skill_tool";
  /**
   * route 是“真正执行去哪里”的统一声明。
   * 注意：
   * - 这里不再让 registry 从多套旧配置拼装路由；
   * - catalog 自己就是工具真源，因此 route 必须可直接产出 CanonicalToolRouteTarget。
   */
  route:
    | { kind: "builtin"; builtin: BuiltinToolName }
    | { kind: "mcp"; serverNodeId: ID; toolName: string }
    | { kind: "skill_tool"; skillId: ID };
  /**
   * executorType 仍保留，是为了让 trace / ToolTrace / 调试器显示正确执行器类型。
   */
  executorType?: ToolExecutorType;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  /**
   * 暴露策略与权限策略都直接落在 catalog tool facet，
   * 不再额外依赖 builtin config 或旧 ToolSpec 表。
   */
  exposurePolicy?: CanonicalToolExposurePolicy;
  permissionPolicy?: CanonicalToolPermissionPolicy;
  executionConfig?: JsonObject;
}

/**
 * Integration facet 载荷。
 * 说明：
 * - 用于描述节点外部来源与连接方式；
 * - 对 MCP server / imported skill bundle 尤其重要。
 */
export interface CatalogIntegrationFacetPayload {
  sourceType: "mcp_server" | "mcp_tool" | "skill_bundle" | "preset" | "imported";
  transport?: "stdio" | "streamable-http" | "sse" | "custom";
  serverName?: string;
  originalName?: string;
  originalSchema?: JsonObject;
  clientConfig?: JsonObject;
}

/**
 * 图谱 facet 统一结构。
 */
export interface CatalogNodeFacet {
  facetId: ID;
  nodeId: ID;
  facetType: CatalogFacetType;
  payload:
    | CatalogPromptFacetPayload
    | CatalogMemoryFacetPayload
    | CatalogToolFacetPayload
    | CatalogIntegrationFacetPayload;
  updatedAt: TimestampISO;
}

/**
 * 统一权限规则。
 * 说明：
 * - 首版主要用于 shell/工作目录权限判定；
 * - 但字段设计保留了 `network / fs / tool` 等作用域，便于后续扩展。
 */
export interface PermissionRule {
  ruleId: ID;
  layer: PermissionRuleLayer;
  scope: PermissionScope;
  action: PermissionMode;
  matcher: {
    type: PermissionMatcherType;
    value: string;
  };
  description?: string;
  metadata?: JsonObject;
}

/**
 * 一组权限规则。
 * 说明：
 * - `defaultMode` 表示“没有命中任何规则时怎么办”；
 * - 这正是 Zero Trust 是否成立的关键开关。
 */
export interface PermissionConfig {
  defaultMode: PermissionMode;
  rules: PermissionRule[];
}

/**
 * 权限命中详情。
 * 说明：
 * - 用于 error details、trace、approval request；
 * - 这样前端和开发者都能看到“到底是哪个规则生效了”。
 */
export interface PermissionMatchDetail {
  ruleId: ID;
  layer: PermissionRuleLayer;
  scope: PermissionScope;
  action: PermissionMode;
  matcherType: PermissionMatcherType;
  matcherValue: string;
  reason: string;
}

/**
 * Agent 内部对 PromptUnit 的绑定关系。
 * 说明：
 * - PromptUnit 是全局可复用定义；
 * - 是否启用、顺序、覆盖行为都放在 Agent 绑定层，不污染全局定义。
 */
export interface AgentPromptBinding {
  /**
   * 绑定记录 ID（便于前端编辑与审计）。
   */
  bindingId?: ID;
  unitId: ID;
  enabled: boolean;
  order: number;
  roleOverride?: MessageRole;
  insertionPointOverride?: PromptInsertionPoint;
  priorityOverride?: number;
  variableOverrides?: Record<string, JsonValue>;
  tokenLimitOverride?: number;
  tags?: string[];
}

/**
 * Agent 工具路由策略：
 * - 控制“内层怎么贴近模型 API”，而不是在 Tool 定义里逐个硬编码。
 */
export interface AgentToolRoutePolicy {
  mode: "auto" | "native_function_first" | "shell_only" | "prompt_protocol_only";
  reason?: string;
}

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
  /**
   * role 只作为显示层/语义标签保留。
   * 说明：
   * - 它不再驱动 PromptCompiler 装配；
   * - 也不参与工具路由或 handoff 决策；
   * - 真正生效的是 promptBindings / toolAllowList / handoffPolicy。
   */
  role?: string;
  description: string;
  /**
   * Agent 核心输入定义：绑定哪些 PromptUnit、是否启用、顺序与局部覆盖。
   */
  promptBindings?: AgentPromptBinding[];
  /**
   * Agent 工具白名单：可按 toolId 或 toolName 过滤可见工具。
   */
  toolAllowList?: ID[];
  /**
   * Agent 工具路由偏好：最终由 runtime + provider 能力共同决策。
   */
  toolRoutePolicy?: AgentToolRoutePolicy;
  memoryPolicies?: ID[];
  handoffPolicy?: {
    allowedTargets: ID[];
    allowDynamicHandoff: boolean;
    strategy?: "fixed" | "dynamic" | "hybrid";
  };
  enabled: boolean;
  version: number;
  tags?: string[];
}

/**
 * PromptUnit（持久化层统一概念）：
 * - 这是全局可复用提示词定义，供多个 Agent 通过 binding 复用。
 * - 本对象不承载“启用状态”；是否启用由 AgentPromptBinding 控制。
 */
export interface PromptUnitSpec {
  id: ID;
  name: string;
  kind: PromptUnitKind;
  template: string;
  role?: MessageRole;
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
  tokenLimit?: number;
  /**
   * 兼容旧字段（新模型建议把启用状态移到 AgentPromptBinding）。
   */
  enabled?: boolean;
  version: number;
  tags?: string[];
  /**
   * 图谱来源引用。
   * 说明：
   * - 当 PromptUnit 不是来自旧 `prompt_blocks`，而是由 catalog 节点映射而来时，
   *   这里记录其原始节点信息，便于 trace 与调试器显示来源。
   */
  sourceRef?: {
    kind: "catalog_node";
    nodeId: ID;
    facetType?: CatalogFacetType;
    primaryKind?: CatalogPrimaryKind;
  };
}

/**
 * 兼容别名：
 * - 旧代码中仍使用 PromptBlock 命名，逐步迁移到 PromptUnitSpec。
 */
export type PromptBlockKind = PromptUnitKind;
export type PromptBlock = PromptUnitSpec;

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
  | { kind: "skill_tool"; skillId: string; tool: string };

/**
 * 工作目录策略：
 * - 原先挂在 ToolSpec 上；
 * - 现在抽出来，供 catalog tool facet / canonical permission policy / shell 权限评估共同复用。
 */
export interface WorkingDirPolicy {
  mode: "fixed" | "workspace" | "allowlist";
  fixedPath?: string;
  allowlist?: string[];
}

/**
 * Canonical 层权限策略（统一于 shell/function/http 等执行器之前）。
 */
export interface CanonicalToolPermissionPolicy {
  permissionProfileId: ID;
  shellPermissionLevel?: ShellPermissionLevel;
  requiresHumanApproval?: boolean;
  workingDirPolicy?: WorkingDirPolicy;
  allowCommandPrefixes?: string[];
  extraRules?: PermissionRule[];
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
  type: "tool_exec" | "file_write" | "file_read" | "http_request" | "web_search" | "plan_update" | "user_input" | "image_read" | "approval";
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
  promptUnitOverrides?: PromptUnitOverride[];
  providerApiType: ProviderApiMode;
}

export interface PromptOverridePatch {
  patchId: ID;
  type:
    | "replace_unit_template"
    | "disable_unit"
    | "insert_ad_hoc_unit"
    | "replace_block_template"
    | "disable_block"
    | "insert_ad_hoc_block";
  targetUnitId?: ID;
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
  | { kind: "prompt_unit"; unitId: ID; unitVersion?: number; promptKind?: PromptUnitKind }
  | { kind: "catalog_node"; nodeId: ID; facetType?: CatalogFacetType; primaryKind?: CatalogPrimaryKind; promptKind?: PromptUnitKind }
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
  selectedUnits: Array<{
    unitId: ID;
    version: number;
    insertionPoint: PromptInsertionPoint;
    priority: number;
    reason: string;
    renderedTextPreview: string;
    tokenEstimate?: number;
  }>;
  rejectedUnits: Array<{
    unitId: ID;
    version: number;
    reason: string;
  }>;
  renderedVariables: Array<{
    unitId: ID;
    variable: string;
    valuePreview: string;
  }>;
  insertionPlan: Array<{
    insertionPoint: PromptInsertionPoint;
    unitIds: ID[];
  }>;
  /**
   * 兼容旧字段（逐步淘汰）。
   */
  selectedBlocks?: Array<{
    blockId: ID;
    version: number;
    insertionPoint: PromptInsertionPoint;
    priority: number;
    reason: string;
    renderedTextPreview: string;
    tokenEstimate?: number;
  }>;
  rejectedBlocks?: Array<{
    blockId: ID;
    version: number;
    reason: string;
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
  supportsResponseFormatJsonSchema?: boolean;
}

export interface UnifiedReasoningConfig {
  effort?: "none" | "minimal" | "low" | "medium" | "high";
  includeThoughts?: boolean;
}

/**
 * 统一工具定义（Provider 请求层）。
 * 说明：
 * - 这是“内层暴露适配层”输出给 Provider 的最终格式；
 * - 允许 function / custom 两类，避免把所有协议硬塞成 function。
 */
export type UnifiedModelTool =
  | {
      type: "function";
      function: {
        name: string;
        description?: string;
        parameters: JsonObject;
      };
    }
  | {
      type: "custom";
      custom: {
        name: string;
        description?: string;
        format?:
          | {
              type: "json_schema";
              json_schema: {
                name: string;
                schema: JsonObject;
                strict?: boolean;
              };
            }
          | {
              type: "text";
            };
      };
    };

export type UnifiedToolChoice =
  | "auto"
  | "none"
  | { type: "function"; function: { name: string } }
  | { type: "custom"; custom: { name: string } };

export interface UnifiedResponseFormat {
  type: "json_schema" | "json_object";
  json_schema?: {
    name: string;
    schema: JsonObject;
    strict?: boolean;
  };
}

export interface UnifiedPromptProtocol {
  name: string;
  instruction: string;
  responseSchema?: JsonObject;
}

export interface UnifiedModelRequest {
  vendor: ProviderVendor;
  apiMode: ProviderApiMode;
  baseURL?: string;
  apiKey?: string;
  model: string;
  messages?: UnifiedMessage[];
  responseInput?: JsonValue;
  tools?: UnifiedModelTool[];
  toolChoice?: UnifiedToolChoice;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoningConfig?: UnifiedReasoningConfig;
  responseFormat?: UnifiedResponseFormat;
  promptProtocol?: UnifiedPromptProtocol;
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
    injectedPromptUnitIds: ID[];
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
    pendingHandoff?: HandoffPacket;
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
 * Handoff 包：
 * - 这是 handoff builtin tool 的统一运行时载荷；
 * - 当前 agent 通过工具显式提交该包，runtime 校验后再切换到目标节点。
 */
export interface HandoffPacket {
  packetId: ID;
  targetAgentId: ID;
  targetNodeId?: ID;
  taskSummary: string;
  payload?: JsonObject;
  reason?: string;
  artifactRefs?: ID[];
  issuedByAgentId?: ID;
  issuedAt: TimestampISO;
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

export type ApprovalRequestStatus = "pending" | "approved" | "rejected";

/**
 * 工具审批请求。
 * 说明：
 * - 与普通 `request_user_input` 分开存储；
 * - 因为权限审批有更强的结构化语义：工具、作用域、通过/拒绝。
 */
export interface ApprovalRequest {
  requestId: ID;
  runId: ID;
  threadId: ID;
  nodeId?: ID;
  agentId?: ID;
  toolId: ID;
  toolName: string;
  scope: PermissionScope;
  status: ApprovalRequestStatus;
  summary: string;
  payload: JsonValue;
  answer?: JsonValue;
  requestedAt: TimestampISO;
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

export interface PromptUnitOverridePatchRequest {
  operator?: string;
  reason: string;
  overrides: PromptUnitOverride[];
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
    /**
     * v0.2：
     * - 由模型路由配置指定当前模型/网关的工具协议画像；
     * - 框架据此自动选择内层暴露适配层（人无需按工具手动理解实现细节）。
     */
    toolProtocolProfile?: ToolProtocolProfile;
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
