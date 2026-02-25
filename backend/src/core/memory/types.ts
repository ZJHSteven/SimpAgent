/**
 * 本文件作用：
 * - 定义记忆适配器接口。
 * - 首版只提供最小接口，避免强绑定某一种“万能记忆”。
 */

import type { JsonObject, PromptBlock, RunState } from "../../types/index.js";

export interface MemoryRetrieveContext {
  runState: RunState;
  queryText: string;
  agentId: string;
  taskType: string;
}

export interface MemoryAdapter {
  id: string;
  retrieveAsPromptBlocks(context: MemoryRetrieveContext): Promise<PromptBlock[]>;
  writeEvent?(event: { type: string; payload: JsonObject; runId: string; threadId: string }): Promise<void>;
}

/**
 * 空实现（默认）：
 * - 用于首版快速跑通框架。
 */
export class NullMemoryAdapter implements MemoryAdapter {
  id = "memory.null";

  async retrieveAsPromptBlocks(): Promise<PromptBlock[]> {
    return [];
  }
}

