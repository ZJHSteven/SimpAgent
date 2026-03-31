/**
 * 本文件作用：
 * - Tool 配置注册表（v0.2 起同时承担“外层来源层 -> 中间统一层”的桥接入口）。
 */

import type { BuiltinToolConfig, CanonicalToolSpec, CatalogNodeFacet } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";
import { BUILTIN_TOOL_DEFINITIONS, type BuiltinToolDefinition } from "./builtinSpecs.js";
import { canonicalFromCatalogToolNode } from "./canonical/index.js";

export class ToolRegistry {
  private cache = new Map<string, CanonicalToolSpec>();

  constructor(private readonly db: AppDatabase, private readonly projectId = "default") {}

  refresh(): void {
    this.cache.clear();
    const nodes = this.db.listCatalogNodes(this.projectId);
    const facets = this.db.listCatalogNodeFacets(this.projectId);
    const facetsByNode = new Map<string, CatalogNodeFacet[]>();
    for (const facet of facets) {
      const list = facetsByNode.get(facet.nodeId) ?? [];
      list.push(facet);
      facetsByNode.set(facet.nodeId, list);
    }
    for (const node of nodes) {
      const canonical = canonicalFromCatalogToolNode(node, facetsByNode.get(node.nodeId) ?? []);
      if (canonical) {
        this.cache.set(canonical.id, canonical);
      }
    }
  }

  list(): CanonicalToolSpec[] {
    if (this.cache.size === 0) this.refresh();
    return [...this.cache.values()];
  }

  get(id: string): CanonicalToolSpec | null {
    if (this.cache.size === 0) this.refresh();
    return this.cache.get(id) ?? null;
  }

  /**
   * 返回内置工具定义元数据。
   * 说明：
   * - 这里保留静态定义，主要给 seed / 调试面展示使用；
   * - 真正运行时启停和权限来自 catalog。
   */
  listBuiltinDefinitions(): BuiltinToolDefinition[] {
    return BUILTIN_TOOL_DEFINITIONS.map((item) => ({ ...item }));
  }

  getBuiltinDefinition(name: string): BuiltinToolDefinition | null {
    return BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === name) ?? null;
  }

  listBuiltinConfigs(): BuiltinToolConfig[] {
    return this.listCanonicalTools()
      .filter((tool) => tool.kind === "builtin")
      .map((tool) => ({
        name: tool.routeTarget.kind === "builtin" ? tool.routeTarget.builtin : tool.name,
        enabled: tool.enabled,
        description: tool.description,
        exposurePolicy: tool.exposure,
        permissionPolicy: tool.permissionPolicy
      }));
  }

  getBuiltinConfig(name: string): BuiltinToolConfig | null {
    return this.listBuiltinConfigs().find((item) => item.name === name) ?? null;
  }

  saveBuiltinConfig(config: BuiltinToolConfig): BuiltinToolConfig {
    const builtinNode = this.db
      .listCatalogNodes(this.projectId)
      .find((node) => node.nodeId === `builtin.${config.name}` || node.name === config.name);
    if (!builtinNode) {
      throw new Error(`找不到 builtin tool catalog 节点：${config.name}`);
    }
    const currentFacet = this.db.getCatalogFacet(builtinNode.nodeId, "tool");
    if (!currentFacet) {
      throw new Error(`builtin tool 节点缺少 tool facet：${builtinNode.nodeId}`);
    }
    this.db.saveCatalogNode({
      ...builtinNode,
      enabled: config.enabled,
      summaryText: config.description ?? builtinNode.summaryText,
      contentText: config.description ?? builtinNode.contentText
    });
    this.db.saveCatalogFacet({
      ...currentFacet,
      payload: {
        ...(currentFacet.payload as Record<string, unknown>),
        exposurePolicy: config.exposurePolicy,
        permissionPolicy: config.permissionPolicy
      }
    });
    this.refresh();
    return config;
  }

  /**
   * 输出中间统一抽象层（Canonical Tool Layer）视图。
   * 说明：
   * - 现在唯一来源是 catalog；
   * - registry 不再从旧 tools/tool_versions 表拼接工具。
   */
  listCanonicalTools(): CanonicalToolSpec[] {
    if (this.cache.size === 0) this.refresh();
    return [...this.cache.values()];
  }

  findCanonicalToolByName(name: string): CanonicalToolSpec | null {
    return this.listCanonicalTools().find((tool) => tool.name === name) ?? null;
  }
}
