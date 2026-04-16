import type { JsonObject, JsonValue, SimpAgentId } from "./common.js";
import type { ObservableHttpRequest } from "./api.js";

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

export interface TraceStore {
  saveTrace(trace: TraceRecord): Promise<void>;
  loadThread(threadId: SimpAgentId): Promise<JsonObject | undefined>;
  saveThread(threadId: SimpAgentId, snapshot: JsonObject): Promise<void>;
  listThreads(): Promise<readonly JsonObject[]>;
}
