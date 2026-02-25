/**
 * 本文件作用：
 * - Tool 配置注册表。
 */

import type { ToolSpec } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";

export class ToolRegistry {
  private cache = new Map<string, ToolSpec>();

  constructor(private readonly db: AppDatabase) {}

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
}

