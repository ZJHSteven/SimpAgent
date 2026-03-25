/**
 * 本文件作用：
 * - 提供统一图谱节点 <-> 运行时对象之间的纯函数映射。
 * - 当前首批映射目标有两类：
 *   1) catalog prompt 节点 -> PromptUnitSpec（供 PromptCompiler 主链路使用）
 *   2) catalog 的 tool / memory / skill / mcp 节点 -> 上下文 PromptUnit 投影
 *
 * 设计说明：
 * - 这里保持“纯函数”，避免把 SQL 查询逻辑揉进来；
 * - 调用方先负责把 node 与 facet 取出来，再交给本文件做结构变换。
 */

import type {
  CatalogIntegrationFacetPayload,
  CatalogMemoryFacetPayload,
  CatalogNode,
  CatalogNodeFacet,
  CatalogPromptFacetPayload,
  CatalogToolFacetPayload,
  PromptBlock,
  PromptInsertionPoint,
  PromptUnitKind
} from "../types/index.js";

function asPromptFacet(facet: CatalogNodeFacet | undefined): CatalogPromptFacetPayload | null {
  if (!facet || facet.facetType !== "prompt") return null;
  return facet.payload as CatalogPromptFacetPayload;
}

function asMemoryFacet(facet: CatalogNodeFacet | undefined): CatalogMemoryFacetPayload | null {
  if (!facet || facet.facetType !== "memory") return null;
  return facet.payload as CatalogMemoryFacetPayload;
}

function asToolFacet(facet: CatalogNodeFacet | undefined): CatalogToolFacetPayload | null {
  if (!facet || facet.facetType !== "tool") return null;
  return facet.payload as CatalogToolFacetPayload;
}

function asIntegrationFacet(facet: CatalogNodeFacet | undefined): CatalogIntegrationFacetPayload | null {
  if (!facet || facet.facetType !== "integration") return null;
  return facet.payload as CatalogIntegrationFacetPayload;
}

function normalizeInsertionPoint(value: PromptInsertionPoint | undefined): PromptInsertionPoint {
  return value ?? "developer";
}

function normalizePromptKind(node: CatalogNode, facet: CatalogPromptFacetPayload | null): PromptUnitKind {
  if (facet?.promptKind) return facet.promptKind;
  if (node.primaryKind === "worldbook") return "worldbook";
  if (node.primaryKind === "memory") return "memory";
  if (node.primaryKind === "tool" || node.primaryKind === "mcp" || node.primaryKind === "skill") return "tool_hint";
  return "hidden_internal";
}

function buildToolBridgeInstruction(node: CatalogNode, toolFacet: CatalogToolFacetPayload, integrationFacet: CatalogIntegrationFacetPayload | null): string {
  const summary = node.summaryText?.trim() || node.title?.trim() || node.name;
  const detail = node.contentText?.trim() || "暂无更多详细说明。";
  if (toolFacet.toolKind === "mcp") {
    const serverRef =
      typeof toolFacet.executionConfig?.serverNodeId === "string"
        ? String(toolFacet.executionConfig.serverNodeId)
        : integrationFacet?.serverName || "mcp-server";
    const toolName =
      typeof toolFacet.executionConfig?.toolName === "string"
        ? String(toolFacet.executionConfig.toolName)
        : integrationFacet?.originalName || node.name;
    return [
      `MCP 工具：${summary}`,
      detail,
      `执行方式：使用 shell_command 调用内部桥接命令。`,
      `标准命令：simpagent mcp call --server ${serverRef} --tool ${toolName} --args-json '<JSON>'`,
      `说明：参数内部标准形态固定为 args-json；如需 flags，可在桥接层兼容输入后再归一化。`
    ].join("\n");
  }
  if (toolFacet.toolKind === "skill") {
    const skillId =
      typeof toolFacet.executionConfig?.skillId === "string" ? String(toolFacet.executionConfig.skillId) : node.nodeId;
    return [
      `技能工具：${summary}`,
      detail,
      `执行方式：使用 shell_command 调用内部桥接命令。`,
      `标准命令：simpagent skill call --skill ${skillId} --args-json '<JSON>'`
    ].join("\n");
  }
  return [
    `工具提示：${summary}`,
    detail
  ].join("\n");
}

/**
 * 将 catalog 中“显式 PromptUnit 节点”映射为 PromptBlock。
 * 说明：
 * - 只有挂了 prompt facet 的节点才会进这条主链；
 * - 生成后的 ID 直接等于图谱节点 ID，便于 Agent.promptBindings 直接引用。
 */
export function mapCatalogPromptNodeToPromptBlock(node: CatalogNode, facets: CatalogNodeFacet[]): PromptBlock | null {
  const promptFacet = asPromptFacet(facets.find((item) => item.facetType === "prompt"));
  if (!promptFacet) return null;
  if (node.enabled === false) return null;
  if (!node.contentText || !node.contentText.trim()) return null;
  return {
    id: node.nodeId,
    name: node.name,
    kind: normalizePromptKind(node, promptFacet),
    template: node.contentText,
    role: promptFacet.role,
    variablesSchema: promptFacet.variablesSchema,
    insertionPoint: normalizeInsertionPoint(promptFacet.insertionPoint),
    priority: Number(promptFacet.priority ?? node.sortOrder ?? 0),
    trigger: (promptFacet.trigger as PromptBlock["trigger"]) ?? undefined,
    tokenLimit: typeof promptFacet.tokenLimit === "number" ? promptFacet.tokenLimit : undefined,
    enabled: node.enabled,
    version: 1,
    tags: node.tags,
    sourceRef: {
      kind: "catalog_node",
      nodeId: node.nodeId,
      facetType: "prompt",
      primaryKind: node.primaryKind
    }
  };
}

/**
 * 把可上下文投影的图谱节点转为 PromptBlock。
 * 说明：
 * - 这批节点不依赖 Agent.promptBindings 显式绑定；
 * - 主要用于 tool/memory/worldbook/skill/mcp 的说明性注入。
 */
export function projectCatalogNodeToContextPromptBlocks(node: CatalogNode, facets: CatalogNodeFacet[]): PromptBlock[] {
  if (node.enabled === false) return [];
  if (node.visibility === "hidden") return [];

  const promptFacet = asPromptFacet(facets.find((item) => item.facetType === "prompt"));
  const memoryFacet = asMemoryFacet(facets.find((item) => item.facetType === "memory"));
  const toolFacet = asToolFacet(facets.find((item) => item.facetType === "tool"));
  const integrationFacet = asIntegrationFacet(facets.find((item) => item.facetType === "integration"));
  const results: PromptBlock[] = [];

  if (memoryFacet && node.contentText?.trim()) {
    const isWorldbook = memoryFacet.memoryType === "worldbook" || node.primaryKind === "worldbook";
    results.push({
      id: `catalog.projected.memory.${node.nodeId}`,
      name: `${node.name}.memory_projection`,
      kind: isWorldbook ? "worldbook" : "memory",
      template: node.contentText,
      role: "developer",
      insertionPoint: "memory_context",
      priority: Number(node.sortOrder ?? 0),
      enabled: true,
      version: 1,
      tags: node.tags,
      sourceRef: {
        kind: "catalog_node",
        nodeId: node.nodeId,
        facetType: "memory",
        primaryKind: node.primaryKind
      }
    });
  }

  if (toolFacet) {
    results.push({
      id: `catalog.projected.tool.${node.nodeId}`,
      name: `${node.name}.tool_projection`,
      kind: node.primaryKind === "mcp" ? "tool_detail" : "tool_hint",
      template: buildToolBridgeInstruction(node, toolFacet, integrationFacet),
      role: "developer",
      insertionPoint: "tool_context",
      priority: Number(node.sortOrder ?? 0),
      enabled: true,
      version: 1,
      tags: node.tags,
      sourceRef: {
        kind: "catalog_node",
        nodeId: node.nodeId,
        facetType: "tool",
        primaryKind: node.primaryKind
      }
    });
  }

  if (node.primaryKind === "skill" && promptFacet && node.contentText?.trim()) {
    results.push({
      id: `catalog.projected.skill.${node.nodeId}`,
      name: `${node.name}.skill_projection`,
      kind: "tool_hint",
      template: node.contentText,
      role: promptFacet.role ?? "developer",
      insertionPoint: normalizeInsertionPoint(promptFacet.insertionPoint ?? "tool_context"),
      priority: Number(promptFacet.priority ?? node.sortOrder ?? 0),
      enabled: true,
      version: 1,
      tags: node.tags,
      sourceRef: {
        kind: "catalog_node",
        nodeId: node.nodeId,
        facetType: "prompt",
        primaryKind: node.primaryKind
      }
    });
  }

  return results;
}
