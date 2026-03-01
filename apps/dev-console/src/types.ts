/**
 * 本文件作用：
 * - 集中定义 dev-console 前端用到的 DTO 类型。
 * - 这些类型对齐 runtime-node 当前接口，避免页面层散落 `any`。
 *
 * 教学说明：
 * - DTO（Data Transfer Object）就是“接口传输数据形状”；
 * - 你可以把它理解为“前后端交接单据”。
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
  details?: unknown;
  meta?: JsonValue;
}

export interface RunSnapshotDTO {
  run_id: string;
  thread_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  current_node_id?: string | null;
  snapshotVersionRefs?: JsonValue;
}

export interface TraceEventDTO {
  runId: string;
  threadId: string;
  seq: number;
  eventId: string;
  type: string;
  nodeId?: string;
  agentId?: string;
  summary: string;
  payload?: JsonValue;
  timestamp: string;
}

export interface NodeExecutionSnapshotDTO {
  nodeId?: string;
  agentId?: string;
  type: string;
  summary: string;
  timestamp: string;
  seq: number;
  payload?: JsonValue;
}

export interface ToolExposurePlanRow {
  planId: string;
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  adapterKind: string;
  createdAt: string;
  plan: JsonValue;
}

export interface UserInputRequestRow {
  requestId: string;
  runId: string;
  threadId: string;
  nodeId?: string;
  agentId?: string;
  status: string;
  payload: JsonValue;
  answer?: JsonValue;
  requestedAt: string;
  answeredAt?: string;
}

export interface SettingsDTO {
  defaultModelRoute: {
    vendor: string;
    apiMode: "responses" | "chat_completions";
    model: string;
    baseURL?: string;
    toolProtocolProfile?: string;
    temperature?: number;
  };
  contextWindow: {
    conversationRounds: number;
  };
  tracePolicy: {
    wsLogLimit: number;
    traceEventLimit: number;
    stateDiffLimit: number;
    sideEffectLimit: number;
  };
}

export interface BuiltinToolDTO {
  name: string;
  toolId: string;
  description: string;
  runtimeConfig: {
    enabled: boolean;
    exposurePolicy: {
      preferredAdapter?: string;
      fallbackAdapters?: string[];
      exposureLevel: string;
      exposeByDefault: boolean;
    };
    permissionPolicy: {
      permissionProfileId: string;
      shellPermissionLevel?: string;
      timeoutMs?: number;
    };
  };
}

export interface TemplateSummaryDTO {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  counts: {
    agents: number;
    promptBlocks: number;
    workflows: number;
  };
}

