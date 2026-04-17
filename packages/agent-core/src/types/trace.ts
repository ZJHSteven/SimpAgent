/**
 * 本文件定义 trace 存储协议。
 * trace 的目标是让一次 turn 的请求/响应/工具审批/错误具备可追溯性。
 */
import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";
import type { ObservableHttpRequest } from "./api.js";

/**
 * 单次 turn 的 trace 记录。
 * request 是首请求便捷字段，requests 是完整请求序列。
 */
export interface TraceRecord {
  readonly threadId: SimpAgentId;
  readonly turnId: SimpAgentId;
  readonly createdAt: number;
  readonly request?: ObservableHttpRequest;
  readonly requests?: readonly ObservableHttpRequest[];
  readonly responseEvents: readonly JsonValue[];
  readonly toolApprovals: readonly JsonValue[];
  readonly toolResults: readonly JsonValue[];
  readonly errors: readonly JsonValue[];
  readonly metrics: JsonObject;
}

/**
 * TraceStore 抽象存储接口，可由 Node 文件系统、数据库、KV 等实现。
 */
export interface TraceStore {
  saveTrace(trace: TraceRecord): Promise<void>;
  loadThread(threadId: SimpAgentId): Promise<JsonObject | undefined>;
  saveThread(threadId: SimpAgentId, snapshot: JsonObject): Promise<void>;
  listThreads(): Promise<readonly JsonObject[]>;
}
