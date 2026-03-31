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
  CatalogNode,
  CatalogNodeFacet,
  CatalogToolFacetPayload,
  CatalogIntegrationFacetPayload,
  CanonicalToolCallIntent,
  CanonicalToolExecutionEnvelope,
  CanonicalToolSpec,
  JsonObject
} from "../../../types/index.js";
import { getBuiltinToolDefinition } from "../builtinSpecs.js";

/**
 * 从 facet 中取出 tool payload。
 */
function asToolFacet(facets: CatalogNodeFacet[]): CatalogToolFacetPayload | null {
  const facet = facets.find((item) => item.facetType === "tool");
  if (!facet) return null;
  return facet.payload as CatalogToolFacetPayload;
}

/**
 * 从 facet 中取出 integration payload。
 */
function asIntegrationFacet(facets: CatalogNodeFacet[]): CatalogIntegrationFacetPayload | null {
  const facet = facets.find((item) => item.facetType === "integration");
  if (!facet) return null;
  return facet.payload as CatalogIntegrationFacetPayload;
}

function emptySchema(): JsonObject {
  return { type: "object", properties: {}, additionalProperties: true };
}

/**
 * 从 catalog node + facet 构造 canonical tool。
 * 说明：
 * - 这是“catalog 成为唯一工具真源”后的核心映射函数；
 * - 允许兼容少量旧 facet 结构，避免 bridge / 测试在同一轮改造时完全断裂。
 */
export function canonicalFromCatalogToolNode(node: CatalogNode, facets: CatalogNodeFacet[]): CanonicalToolSpec | null {
  const toolFacet = asToolFacet(facets);
  if (!toolFacet || node.enabled === false) return null;

  const route =
    toolFacet.route ??
    (toolFacet.toolKind === "builtin"
      ? { kind: "builtin" as const, builtin: String((toolFacet.executionConfig as Record<string, unknown> | undefined)?.builtinName ?? node.name) as any }
      : toolFacet.toolKind === "mcp"
        ? {
            kind: "mcp" as const,
            serverNodeId: String((toolFacet.executionConfig as Record<string, unknown> | undefined)?.serverNodeId ?? ""),
            toolName: String((toolFacet.executionConfig as Record<string, unknown> | undefined)?.toolName ?? node.name)
          }
        : {
            kind: "skill_tool" as const,
            skillId: String((toolFacet.executionConfig as Record<string, unknown> | undefined)?.skillId ?? node.nodeId)
          });
  const integrationFacet = asIntegrationFacet(facets);
  const description = node.contentText?.trim() || node.summaryText?.trim() || node.title?.trim() || node.name;

  if (route.kind === "builtin") {
    const builtin = getBuiltinToolDefinition(route.builtin);
    if (!builtin) return null;
    return {
      id: node.nodeId,
      name: node.name,
      kind: "builtin",
      displayName: node.title || node.name,
      description,
      summary: node.summaryText || description,
      tags: node.tags,
      routeTarget: {
        kind: "builtin",
        builtin: builtin.name
      },
      executorType: toolFacet.executorType ?? builtin.executorType,
      inputSchema: toolFacet.inputSchema ?? builtin.inputSchema,
      outputSchema: toolFacet.outputSchema ?? builtin.outputSchema,
      enabled: node.enabled,
      exposure: toolFacet.exposurePolicy ?? builtin.exposurePolicy,
      permissionPolicy: toolFacet.permissionPolicy ?? builtin.permissionPolicy,
      sourceMeta: {
        sourceType: "catalog_node",
        nodeId: node.nodeId,
        primaryKind: node.primaryKind ?? "tool"
      },
      version: 1
    };
  }

  if (route.kind === "mcp") {
    return {
      id: node.nodeId,
      name: node.name,
      kind: "mcp",
      displayName: node.title || node.name,
      description,
      summary: node.summaryText || description,
      tags: node.tags,
      routeTarget: {
        kind: "mcp",
        server: route.serverNodeId,
        tool: route.toolName
      },
      executorType: toolFacet.executorType ?? "mcp_proxy",
      inputSchema: toolFacet.inputSchema ?? integrationFacet?.originalSchema ?? emptySchema(),
      outputSchema: toolFacet.outputSchema,
      enabled: node.enabled,
      exposure:
        toolFacet.exposurePolicy ?? {
          preferredAdapter: "chat_function",
          fallbackAdapters: ["structured_output_tool_call", "prompt_protocol_fallback"],
          exposureLevel: "description",
          exposeByDefault: true,
          catalogPath: ["catalog", "mcp"]
        },
      permissionPolicy:
        toolFacet.permissionPolicy ?? {
          permissionProfileId: "perm.readonly",
          shellPermissionLevel: "readonly",
          timeoutMs: 15_000
        },
      sourceMeta: {
        sourceType: "catalog_node",
        nodeId: node.nodeId,
        serverNodeId: route.serverNodeId,
        remoteToolName: route.toolName
      },
      version: 1
    };
  }

  return {
    id: node.nodeId,
    name: node.name,
    kind: "skill_tool",
    displayName: node.title || node.name,
    description,
    summary: node.summaryText || description,
    tags: node.tags,
    routeTarget: {
      kind: "skill_tool",
      skillId: route.skillId,
      tool: node.name
    },
    executorType: toolFacet.executorType ?? "shell",
    inputSchema: toolFacet.inputSchema ?? emptySchema(),
    outputSchema: toolFacet.outputSchema,
    enabled: node.enabled,
    exposure:
      toolFacet.exposurePolicy ?? {
        preferredAdapter: "chat_function",
        fallbackAdapters: ["structured_output_tool_call", "prompt_protocol_fallback"],
        exposureLevel: "description",
        exposeByDefault: true,
        catalogPath: ["catalog", "skill"]
      },
    permissionPolicy:
      toolFacet.permissionPolicy ?? {
        permissionProfileId: "perm.readonly",
        shellPermissionLevel: "readonly",
        timeoutMs: 15_000
      },
    sourceMeta: {
      sourceType: "catalog_node",
      nodeId: node.nodeId,
      skillId: route.skillId
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
