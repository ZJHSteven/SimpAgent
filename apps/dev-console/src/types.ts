/**
 * 文件作用：
 * - 收敛调试台前端要消费的主要接口类型。
 * - 这里只保留界面真正会读取的字段，避免把整个后端契约原样搬进前端。
 */

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
  message?: string;
  details?: unknown;
}

export interface RuntimeHealth {
  ok: boolean;
  service: string;
  now: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  role?: string;
  description?: string;
  enabled?: boolean;
  promptBindings?: Array<{
    bindingId: string;
    unitId: string;
    enabled: boolean;
    order: number;
  }>;
  toolAllowList?: string[];
  toolRoutePolicy?: {
    mode?: string;
    reason?: string;
  };
  handoffPolicy?: {
    allowedTargets?: string[];
    allowDynamicHandoff?: boolean;
    strategy?: string;
  };
  memoryPolicies?: string[];
  tags?: string[];
  version: number;
}

export interface WorkflowNodeLite {
  id: string;
  type: string;
  label?: string;
  agentId?: string;
  toolId?: string;
}

export interface WorkflowEdgeLite {
  id?: string;
  from: string;
  to: string;
  priority?: number;
  condition?: Record<string, unknown>;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  entryNode: string;
  nodes: WorkflowNodeLite[];
  edges: WorkflowEdgeLite[];
  version: number;
}

export interface PromptUnitSummary {
  id: string;
  name: string;
  kind: string;
  template: string;
  insertionPoint?: string;
  priority?: number;
  enabled: boolean;
  trigger?: {
    agentIds?: string[];
  };
  tags?: string[];
  version: number;
}

export interface BuiltinToolRuntimeConfig {
  name: string;
  enabled: boolean;
  description: string;
  exposurePolicy?: Record<string, unknown>;
  permissionPolicy?: Record<string, unknown>;
}

export interface BuiltinToolSummary {
  name: string;
  description: string;
  runtimeConfig: BuiltinToolRuntimeConfig;
}

export interface CatalogNodeSummary {
  nodeId: string;
  projectId: string;
  parentNodeId?: string;
  nodeClass: string;
  name: string;
  title?: string;
  summaryText?: string;
  primaryKind?: string;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface CatalogRelationSummary {
  relationId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  projectId: string;
}

export interface RuntimeTemplateSummary {
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

export interface RunSummary {
  run_id: string;
  thread_id: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  current_node_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TraceEventSummary {
  seq: number;
  eventId: string;
  runId: string;
  threadId: string;
  type: string;
  timestamp: string;
  nodeId?: string;
  agentId?: string;
  summary: string;
  payload?: unknown;
}

export interface StateDiffSummary {
  diffId: string;
  nodeId?: string;
  agentId?: string;
  createdAt: string;
  diff: unknown;
}

export interface SideEffectSummary {
  sideEffectId: string;
  type: string;
  target?: string;
  summary: string;
  timestamp: string;
  details?: unknown;
}

export interface ToolExposurePlanSummary {
  planId: string;
  adapterKind: string;
  createdAt: string;
  plan: unknown;
}

export interface ApprovalRequestSummary {
  requestId: string;
  status: string;
  summary: string;
  scope: string;
  requestedAt: string;
  payload: unknown;
}

export interface CheckpointHistoryItem {
  checkpointId: string;
  parentCheckpointId?: string | null;
  createdAt?: string | null;
  runStateSummary?: {
    runId?: string;
    status?: string;
    currentNodeId?: string;
  } | null;
}

export interface PromptCompileDetail {
  compileId: string;
  promptTrace: {
    compileId: string;
    selectedUnits?: Array<Record<string, unknown>>;
    tokenEstimate?: number;
    promptAssemblyPlan?: unknown;
    toolExposurePlan?: unknown;
  };
  finalMessages: Array<Record<string, unknown>>;
}

export interface ToolExposurePolicyMeta {
  adapters: string[];
  builtinDefaults: Array<{
    name: string;
    preferredAdapter?: string;
    fallbackAdapters?: string[];
    exposureLevel?: string;
  }>;
}

export interface SystemConfigView {
  defaultModelRoute: Record<string, unknown>;
  contextWindow: Record<string, unknown>;
  permissionPolicy: Record<string, unknown>;
  tracePolicy: Record<string, unknown>;
}

export interface WsRunSnapshot {
  status: string;
  currentNodeId?: string;
  threadId: string;
  traceEventSeqLast?: number;
  latestTraceSeq?: number;
}

export type WsServerEvent =
  | { type: "hello_ack"; connectionId: string; serverTime: string }
  | { type: "subscribed"; runId: string }
  | { type: "heartbeat"; serverTime: string }
  | { type: "trace_event"; runId: string; event: TraceEventSummary }
  | { type: "run_snapshot"; runId: string; snapshot: WsRunSnapshot }
  | { type: "replay_events_batch"; runId: string; events: TraceEventSummary[] }
  | { type: "warning"; code: string; message: string }
  | { type: "error"; code: string; message: string };

export interface ProviderFormState {
  vendor: string;
  apiMode: "chat_completions" | "responses";
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: string;
}
