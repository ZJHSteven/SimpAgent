/**
 * 本文件作用：
 * - 在 Node 适配层装配 core 的 WorkflowRegistry。
 * - Node 侧使用 AppDatabase 作为 WorkflowConfigStore 实现。
 */

import { WorkflowRegistry as CoreWorkflowRegistry } from "@simpagent/core/workflows";
import type { AppDatabase } from "../../storage/index.js";

export class WorkflowRegistry extends CoreWorkflowRegistry {
  constructor(db: AppDatabase) {
    super(db);
  }
}
