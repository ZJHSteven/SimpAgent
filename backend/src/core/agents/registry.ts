/**
 * 本文件作用：
 * - Agent 配置注册表（从 SQLite 读取当前版本配置）。
 * - 提供简单缓存与刷新接口，支撑热更新。
 */

import type { AgentSpec } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";

export class AgentRegistry {
  private cache = new Map<string, AgentSpec>();

  constructor(private readonly db: AppDatabase) {}

  refresh(): void {
    this.cache.clear();
    for (const item of this.db.listAgents()) {
      this.cache.set(item.id, item);
    }
  }

  list(): AgentSpec[] {
    if (this.cache.size === 0) this.refresh();
    return [...this.cache.values()];
  }

  get(id: string): AgentSpec | null {
    if (this.cache.size === 0) this.refresh();
    return this.cache.get(id) ?? null;
  }

  save(spec: AgentSpec): AgentSpec {
    const version = this.db.saveVersionedConfig("agent", spec);
    const saved = { ...spec, version };
    this.cache.set(saved.id, saved);
    return saved;
  }
}

