/**
 * 本文件作用：
 * - Tool 配置注册表（v0.2 起同时承担“外层来源层 -> 中间统一层”的桥接入口）。
 */

import type { BuiltinToolConfig, CanonicalToolSpec, ToolSpec } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";
import { BUILTIN_TOOL_DEFINITIONS, type BuiltinToolDefinition } from "./builtinSpecs.js";
import { canonicalFromBuiltinConfig, canonicalFromToolSpec } from "./canonical/index.js";

export class ToolRegistry {
  private cache = new Map<string, ToolSpec>();
  private readonly builtinConfigCache = new Map<string, BuiltinToolConfig>();

  constructor(
    private readonly db: AppDatabase,
    private readonly projectId = "default"
  ) {
    // 初始化内置工具默认配置（首版先使用内存默认值，后续再接 SQLite 版本化配置）。
    for (const def of BUILTIN_TOOL_DEFINITIONS) {
      this.builtinConfigCache.set(def.name, def.defaultConfig);
    }
    // v0.3：覆盖数据库中的项目级配置，解决重启丢失问题。
    for (const persisted of this.db.listBuiltinToolConfigs(this.projectId)) {
      this.builtinConfigCache.set(persisted.name, persisted);
    }
  }

  refresh(): void {
    this.cache.clear();
    for (const item of this.db.listTools()) {
      this.cache.set(item.id, item);
    }
  }

  list(): ToolSpec[] {
    if (this.cache.size === 0) this.refresh();
    return [...this.cache.values()];
  }

  get(id: string): ToolSpec | null {
    if (this.cache.size === 0) this.refresh();
    return this.cache.get(id) ?? null;
  }

  save(spec: ToolSpec): ToolSpec {
    const version = this.db.saveVersionedConfig("tool", spec);
    const saved = { ...spec, version };
    this.cache.set(saved.id, saved);
    return saved;
  }

  /**
   * 返回首批内置工具定义（外层来源层）。
   * 说明：
   * - 这些定义与普通 ToolSpec 并列存在；
   * - 后续会统一转换成 CanonicalToolSpec。
   */
  listBuiltinDefinitions(): BuiltinToolDefinition[] {
    return BUILTIN_TOOL_DEFINITIONS.map((item) => ({ ...item }));
  }

  getBuiltinDefinition(name: string): BuiltinToolDefinition | null {
    return BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === name) ?? null;
  }

  listBuiltinConfigs(): BuiltinToolConfig[] {
    return [...this.builtinConfigCache.values()].map((cfg) => ({ ...cfg }));
  }

  getBuiltinConfig(name: string): BuiltinToolConfig | null {
    return this.builtinConfigCache.get(name) ?? null;
  }

  saveBuiltinConfig(config: BuiltinToolConfig): BuiltinToolConfig {
    const saved = this.db.saveBuiltinToolConfig(config, this.projectId);
    this.builtinConfigCache.set(saved.name, saved);
    return saved;
  }

  /**
   * v0.2：输出中间统一抽象层（Canonical Tool Layer）视图。
   * 说明：
   * - builtin tools 与数据库中的 ToolSpec 在此汇合；
   * - 暴露适配层 / runtime 工具循环应该优先消费这个接口，而非直接消费 ToolSpec。
   */
  listCanonicalTools(): CanonicalToolSpec[] {
    const builtins = BUILTIN_TOOL_DEFINITIONS.map((def) => {
      const cfg = this.builtinConfigCache.get(def.name) ?? def.defaultConfig;
      return canonicalFromBuiltinConfig({
        toolId: def.toolId,
        config: cfg,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        executorType: def.executorType,
        tags: def.tags
      });
    });

    const customTools = this.list().map((spec) => canonicalFromToolSpec(spec));
    return [...builtins, ...customTools];
  }

  findCanonicalToolByName(name: string): CanonicalToolSpec | null {
    return this.listCanonicalTools().find((tool) => tool.name === name) ?? null;
  }
}
