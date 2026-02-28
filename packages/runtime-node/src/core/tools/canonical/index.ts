/**
 * 本文件作用：
 * - 定义“三层工具架构”中的中间统一抽象层（Canonical Tool Layer）辅助函数。
 * - 负责把外层工具来源（当前先是 ToolSpec + builtin 配置）转换成内部统一结构。
 *
 * 教学说明：
 * - 这里不是模型 API 层；不能出现 chat_function / responses_native 这种协议细节。
 * - 这里也不是具体执行器层；这里只处理“工具是什么、如何统一表示”。
 */

import type {
  BuiltinToolConfig,
  CanonicalToolCallIntent,
  CanonicalToolExecutionEnvelope,
  CanonicalToolSpec,
  JsonObject,
  ToolSpec
} from "../../../types/index.js";

/**
 * 将普通 ToolSpec 转换为 CanonicalToolSpec。
 * 说明：
 * - 这是从外层“通用函数/壳工具”来源进入中间统一层的入口之一；
 * - 后续 MCP / skills 也会走类似转换函数。
 */
export function canonicalFromToolSpec(spec: ToolSpec): CanonicalToolSpec {
  return {
    id: spec.id,
    name: spec.name,
    kind: "user_defined",
    displayName: spec.name,
    description: spec.description,
    summary: spec.description,
    routeTarget: { kind: "user_defined", toolId: spec.id },
    executorType: spec.executorType,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    enabled: spec.enabled,
    exposure: {
      exposureLevel: "full_schema",
      exposeByDefault: spec.enabled,
      preferredAdapter: "chat_function",
      fallbackAdapters: ["structured_output_tool_call", "prompt_protocol_fallback"],
      providerHints: {}
    },
    permissionPolicy: {
      permissionProfileId: spec.permissionProfileId,
      timeoutMs: spec.timeoutMs,
      workingDirPolicy: spec.workingDirPolicy
    },
    sourceMeta: {
      sourceType: "tool_spec",
      version: spec.version
    },
    version: spec.version
  };
}

/**
 * 将内置工具配置转换为 CanonicalToolSpec。
 * 说明：
 * - builtin tool 也是“外层来源层”的一种；
 * - 只是 routeTarget 会指向 builtin，而不是 user_defined。
 */
export function canonicalFromBuiltinConfig(input: {
  toolId: string;
  config: BuiltinToolConfig;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  executorType: CanonicalToolSpec["executorType"];
  tags?: string[];
}): CanonicalToolSpec {
  const { config } = input;
  return {
    id: input.toolId,
    name: config.name,
    kind: "builtin",
    displayName: config.name,
    description: config.description ?? config.name,
    summary: config.description ?? config.name,
    tags: input.tags,
    routeTarget: { kind: "builtin", builtin: config.name },
    executorType: input.executorType,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    enabled: config.enabled,
    exposure: config.exposurePolicy,
    permissionPolicy: config.permissionPolicy,
    sourceMeta: {
      sourceType: "builtin_config"
    },
    version: 1
  };
}

/**
 * 统一构造工具执行上下文（供 runtime / API / 测试用）。
 */
export function createCanonicalToolExecutionEnvelope(input: Partial<CanonicalToolExecutionEnvelope>): CanonicalToolExecutionEnvelope {
  return {
    runId: String(input.runId ?? "run_unknown"),
    threadId: String(input.threadId ?? "thread_unknown"),
    nodeId: input.nodeId,
    agentId: input.agentId,
    workspaceRoot: input.workspaceRoot,
    provider: input.provider,
    interruptOnHighRisk: Boolean(input.interruptOnHighRisk),
    metadata: input.metadata ?? {}
  };
}

/**
 * 统一工具调用意图的参数提取辅助函数。
 * 用途：
 * - runtime 在执行 canonical tool 前，经常需要“拿到 args”；
 * - 对 freeform 工具（例如 apply_patch custom 模式）则可能没有 args。
 */
export function getCanonicalIntentArgs(intent: CanonicalToolCallIntent): JsonObject {
  return (intent.args ?? {}) as JsonObject;
}

