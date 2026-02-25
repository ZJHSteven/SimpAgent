/**
 * 本文件作用：
 * - Workflow 配置注册表（版本化 + 缓存）。
 */

import type { WorkflowSpec } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";

export class WorkflowRegistry {
  private cache = new Map<string, WorkflowSpec>();

  constructor(private readonly db: AppDatabase) {}

  refresh(): void {
    this.cache.clear();
    for (const item of this.db.listWorkflows()) {
      this.cache.set(item.id, item);
    }
  }

  list(): WorkflowSpec[] {
    if (this.cache.size === 0) this.refresh();
    return [...this.cache.values()];
  }

  get(id: string): WorkflowSpec | null {
    if (this.cache.size === 0) this.refresh();
    return this.cache.get(id) ?? null;
  }

  save(spec: WorkflowSpec): WorkflowSpec {
    const version = this.db.saveVersionedConfig("workflow", spec);
    const saved = { ...spec, version };
    this.cache.set(saved.id, saved);
    return saved;
  }
}

