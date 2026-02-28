/**
 * 本文件作用：
 * - Workflow 配置注册表（版本化 + 缓存）。
 */

import type { WorkflowSpec } from "../types/index.js";

/**
 * 工作流存储端口（核心层依赖抽象，不依赖具体数据库实现）。
 */
export interface WorkflowConfigStore {
  listWorkflows(): WorkflowSpec[];
  saveVersionedConfig(kind: "workflow", payload: WorkflowSpec): number;
}

export class WorkflowRegistry {
  private cache = new Map<string, WorkflowSpec>();

  constructor(private readonly store: WorkflowConfigStore) {}

  refresh(): void {
    this.cache.clear();
    for (const item of this.store.listWorkflows()) {
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
    const version = this.store.saveVersionedConfig("workflow", spec);
    const saved = { ...spec, version };
    this.cache.set(saved.id, saved);
    return saved;
  }
}
