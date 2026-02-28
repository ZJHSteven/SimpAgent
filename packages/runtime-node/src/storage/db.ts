/**
 * 本文件作用：
 * - 提供 SQLite 访问封装（Node.js 内置 `node:sqlite`）。
 * - 封装常用的配置版本化、Run、Trace、PromptCompile、ToolCall 的读写方法。
 *
 * 教学说明：
 * - 这里有意保持“薄封装”，让 SQL 结构清晰可见，便于初学者理解与排错。
 * - 复杂 ORM 会降低首版调试透明度，因此暂不引入。
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AgentSpec,
  CanonicalToolSideEffectRecord,
  ForkRunResponse,
  JsonValue,
  PlanState,
  PromptBlock,
  PromptTrace,
  RunStatus,
  StateDiffTrace,
  ToolSpec,
  ToolExposurePlan,
  TraceEvent,
  UnifiedMessage,
  UserInputRequestState,
  WorkflowSpec
} from "../types/index.js";
import { SCHEMA_SQL } from "./schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function fromJson<T>(value: unknown): T {
  if (typeof value !== "string") {
    throw new Error("数据库 JSON 字段不是字符串，数据可能已损坏");
  }
  return JSON.parse(value) as T;
}

/**
 * 版本化配置实体的类型标签。
 * 用于复用同一套 upsertVersion 逻辑。
 */
type VersionedEntityKind = "agent" | "prompt_block" | "workflow" | "tool";

interface RunRowSnapshot {
  run_id: string;
  thread_id: string;
  workflow_id: string;
  workflow_version: number;
  status: RunStatus;
  current_node_id: string | null;
  snapshot_version_refs_json: string;
  provider_config_json: string;
  input_json: string;
  created_at: string;
  updated_at: string;
  parent_run_id: string | null;
  parent_checkpoint_id: string | null;
}

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(dbFilePath: string) {
    // 先确保数据库文件所在目录存在，否则 SQLite 会直接报 unable to open database file。
    mkdirSync(path.dirname(dbFilePath), { recursive: true });
    this.db = new DatabaseSync(dbFilePath);
    // 启动时立即建表，避免运行到中间步骤才报表不存在。
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * 生成简单主键。
   * 说明：
   * - 使用 randomUUID，便于多线程/多请求下避免冲突。
   */
  newId(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, "")}`;
  }

  /**
   * 写入或发布一个“版本化配置对象”。
   * 返回新版本号。
   */
  saveVersionedConfig<T extends { id: string; enabled: boolean }>(
    kind: VersionedEntityKind,
    payload: T
  ): number {
    const now = nowIso();
    const map = {
      agent: {
        table: "agents",
        versionTable: "agent_versions",
        idCol: "agent_id",
        payloadIdField: "id"
      },
      prompt_block: {
        table: "prompt_blocks",
        versionTable: "prompt_block_versions",
        idCol: "block_id",
        payloadIdField: "id"
      },
      workflow: {
        table: "workflows",
        versionTable: "workflow_versions",
        idCol: "workflow_id",
        payloadIdField: "id"
      },
      tool: {
        table: "tools",
        versionTable: "tool_versions",
        idCol: "tool_id",
        payloadIdField: "id"
      }
    } as const;

    const conf = map[kind];
    const rootRow = this.db
      .prepare(`SELECT current_version FROM ${conf.table} WHERE id = ?`)
      .get(payload.id) as { current_version?: number } | undefined;
    const nextVersion = (rootRow?.current_version ?? 0) + 1;

    // 将 version 字段同步写入 payload（如果对象定义包含该字段，运行时会覆盖）。
    const versionedPayload = { ...payload, version: nextVersion } as T & { version: number };

    this.db
      .prepare(
        `INSERT INTO ${conf.versionTable} (${conf.idCol}, version, payload_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(payload.id, nextVersion, toJson(versionedPayload), now);

    this.db
      .prepare(
        `INSERT INTO ${conf.table} (id, current_version, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           current_version = excluded.current_version,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(payload.id, nextVersion, payload.enabled ? 1 : 0, now);

    return nextVersion;
  }

  listAgents(): AgentSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM agents a
         JOIN agent_versions v
           ON v.agent_id = a.id AND v.version = a.current_version
         ORDER BY a.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<AgentSpec>(row.payload_json));
  }

  getAgent(agentId: string, version?: number): AgentSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM agent_versions WHERE agent_id = ? AND version = ?`)
          .get(agentId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM agents a
             JOIN agent_versions v
               ON v.agent_id = a.id AND v.version = a.current_version
             WHERE a.id = ?`
          )
          .get(agentId) as { payload_json: string } | undefined);
    return row ? fromJson<AgentSpec>(row.payload_json) : null;
  }

  listPromptBlocks(): PromptBlock[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM prompt_blocks b
         JOIN prompt_block_versions v
           ON v.block_id = b.id AND v.version = b.current_version
         ORDER BY b.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<PromptBlock>(row.payload_json));
  }

  getPromptBlock(blockId: string, version?: number): PromptBlock | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM prompt_block_versions WHERE block_id = ? AND version = ?`)
          .get(blockId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM prompt_blocks b
             JOIN prompt_block_versions v
               ON v.block_id = b.id AND v.version = b.current_version
             WHERE b.id = ?`
          )
          .get(blockId) as { payload_json: string } | undefined);
    return row ? fromJson<PromptBlock>(row.payload_json) : null;
  }

  listWorkflows(): WorkflowSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM workflows w
         JOIN workflow_versions v
           ON v.workflow_id = w.id AND v.version = w.current_version
         ORDER BY w.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<WorkflowSpec>(row.payload_json));
  }

  getWorkflow(workflowId: string, version?: number): WorkflowSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM workflow_versions WHERE workflow_id = ? AND version = ?`)
          .get(workflowId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM workflows w
             JOIN workflow_versions v
               ON v.workflow_id = w.id AND v.version = w.current_version
             WHERE w.id = ?`
          )
          .get(workflowId) as { payload_json: string } | undefined);
    return row ? fromJson<WorkflowSpec>(row.payload_json) : null;
  }

  listTools(): ToolSpec[] {
    const rows = this.db
      .prepare(
        `SELECT v.payload_json
         FROM tools t
         JOIN tool_versions v
           ON v.tool_id = t.id AND v.version = t.current_version
         ORDER BY t.id`
      )
      .all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<ToolSpec>(row.payload_json));
  }

  getTool(toolId: string, version?: number): ToolSpec | null {
    const row = version
      ? (this.db
          .prepare(`SELECT payload_json FROM tool_versions WHERE tool_id = ? AND version = ?`)
          .get(toolId, version) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT v.payload_json
             FROM tools t
             JOIN tool_versions v
               ON v.tool_id = t.id AND v.version = t.current_version
             WHERE t.id = ?`
          )
          .get(toolId) as { payload_json: string } | undefined);
    return row ? fromJson<ToolSpec>(row.payload_json) : null;
  }

  /**
   * 写入 run 摘要。
   * 注意：
   * - snapshot_version_refs_json 会记录创建 run 时冻结的配置版本，避免热更新污染旧 run。
   */
  upsertRunSummary(input: {
    runId: string;
    threadId: string;
    workflowId: string;
    workflowVersion: number;
    status: RunStatus;
    currentNodeId?: string | null;
    snapshotVersionRefs: JsonValue;
    providerConfig: JsonValue;
    inputJson: JsonValue;
    parentRunId?: string;
    parentCheckpointId?: string;
  }): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO runs (
          run_id, thread_id, workflow_id, workflow_version, status, current_node_id,
          snapshot_version_refs_json, provider_config_json, input_json,
          created_at, updated_at, parent_run_id, parent_checkpoint_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          status = excluded.status,
          current_node_id = excluded.current_node_id,
          snapshot_version_refs_json = excluded.snapshot_version_refs_json,
          provider_config_json = excluded.provider_config_json,
          input_json = excluded.input_json,
          updated_at = excluded.updated_at,
          parent_run_id = COALESCE(excluded.parent_run_id, runs.parent_run_id),
          parent_checkpoint_id = COALESCE(excluded.parent_checkpoint_id, runs.parent_checkpoint_id)`
      )
      .run(
        input.runId,
        input.threadId,
        input.workflowId,
        input.workflowVersion,
        input.status,
        input.currentNodeId ?? null,
        toJson(input.snapshotVersionRefs),
        toJson(input.providerConfig),
        toJson(input.inputJson),
        now,
        now,
        input.parentRunId ?? null,
        input.parentCheckpointId ?? null
      );

    this.db
      .prepare(
        `INSERT INTO run_threads (thread_id, latest_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           latest_run_id = excluded.latest_run_id,
           updated_at = excluded.updated_at`
      )
      .run(input.threadId, input.runId, now, now);
  }

  updateRunStatus(runId: string, status: RunStatus, currentNodeId?: string | null): void {
    this.db
      .prepare(`UPDATE runs SET status = ?, current_node_id = ?, updated_at = ? WHERE run_id = ?`)
      .run(status, currentNodeId ?? null, nowIso(), runId);
  }

  getRunSummary(runId: string): (RunRowSnapshot & { snapshotVersionRefs: JsonValue }) | null {
    const row = this.db
      .prepare(`SELECT * FROM runs WHERE run_id = ?`)
      .get(runId) as RunRowSnapshot | undefined;
    if (!row) return null;
    return {
      ...row,
      snapshotVersionRefs: fromJson<JsonValue>(row.snapshot_version_refs_json)
    };
  }

  /**
   * 为一个 run 分配下一个 trace seq（单调递增）。
   * 说明：
   * - 直接查 max(seq) 实现最简单，首版性能可接受。
   */
  nextTraceSeq(runId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) AS max_seq FROM trace_events WHERE run_id = ?`)
      .get(runId) as { max_seq: number | null };
    return (row.max_seq ?? 0) + 1;
  }

  insertTraceEvent(event: TraceEvent): void {
    this.db
      .prepare(
        `INSERT INTO trace_events (
          run_id, thread_id, seq, event_id, type, node_id, agent_id, summary, payload_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.runId,
        event.threadId,
        event.seq,
        event.eventId,
        event.type,
        event.nodeId ?? null,
        event.agentId ?? null,
        event.summary,
        event.payload ? toJson(event.payload) : null,
        event.timestamp
      );
  }

  listTraceEvents(runId: string, afterSeq = 0, limit = 200): TraceEvent[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, thread_id, seq, event_id, type, node_id, agent_id, summary, payload_json, timestamp
         FROM trace_events
         WHERE run_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(runId, afterSeq, limit) as Array<{
      run_id: string;
      thread_id: string;
      seq: number;
      event_id: string;
      type: string;
      node_id: string | null;
      agent_id: string | null;
      summary: string;
      payload_json: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      runId: row.run_id,
      threadId: row.thread_id,
      seq: row.seq,
      eventId: row.event_id,
      type: row.type as TraceEvent["type"],
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      summary: row.summary,
      payload: row.payload_json ? fromJson<JsonValue>(row.payload_json) : undefined,
      timestamp: row.timestamp
    }));
  }

  insertPromptCompile(input: {
    compileId: string;
    runId: string;
    threadId: string;
    agentId: string;
    providerApiType: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  }): void {
    this.db
      .prepare(
        `INSERT INTO prompt_compiles (
          compile_id, run_id, thread_id, agent_id, provider_api_type,
          prompt_trace_json, final_messages_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.compileId,
        input.runId,
        input.threadId,
        input.agentId,
        input.providerApiType,
        toJson(input.promptTrace),
        toJson(input.finalMessages),
        nowIso()
      );
  }

  getPromptCompile(compileId: string): {
    compileId: string;
    promptTrace: PromptTrace;
    finalMessages: UnifiedMessage[];
  } | null {
    const row = this.db
      .prepare(`SELECT * FROM prompt_compiles WHERE compile_id = ?`)
      .get(compileId) as
      | {
          compile_id: string;
          prompt_trace_json: string;
          final_messages_json: string;
        }
      | undefined;
    if (!row) return null;
    return {
      compileId: row.compile_id,
      promptTrace: fromJson<PromptTrace>(row.prompt_trace_json),
      finalMessages: fromJson<UnifiedMessage[]>(row.final_messages_json)
    };
  }

  insertToolCallTrace(input: {
    toolCallId: string;
    runId: string;
    threadId: string;
    toolId: string;
    toolName: string;
    traceJson: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_calls (tool_call_id, run_id, thread_id, tool_id, tool_name, trace_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.toolCallId,
        input.runId,
        input.threadId,
        input.toolId,
        input.toolName,
        toJson(input.traceJson),
        nowIso()
      );
  }

  /**
   * v0.2：写入节点级状态差异。
   * 说明：
   * - 该表用于调试器快速展示“本节点改了什么”；
   * - 不替代 LangGraph checkpoint。
   */
  insertStateDiff(input: StateDiffTrace): void {
    this.db
      .prepare(
        `INSERT INTO state_diffs (
          diff_id, run_id, thread_id, node_id, agent_id,
          before_summary_json, after_summary_json, diff_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.diffId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.beforeSummary ? toJson(input.beforeSummary) : null,
        input.afterSummary ? toJson(input.afterSummary) : null,
        toJson(input.diff),
        input.createdAt
      );
  }

  listStateDiffs(runId: string, limit = 200): StateDiffTrace[] {
    const rows = this.db
      .prepare(
        `SELECT diff_id, run_id, thread_id, node_id, agent_id,
                before_summary_json, after_summary_json, diff_json, created_at
         FROM state_diffs
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      diff_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      before_summary_json: string | null;
      after_summary_json: string | null;
      diff_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      diffId: row.diff_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      beforeSummary: row.before_summary_json ? fromJson<JsonValue>(row.before_summary_json) : undefined,
      afterSummary: row.after_summary_json ? fromJson<JsonValue>(row.after_summary_json) : undefined,
      diff: fromJson<JsonValue>(row.diff_json),
      createdAt: row.created_at
    }));
  }

  /**
   * v0.2：统一副作用记录。
   */
  insertSideEffect(input: CanonicalToolSideEffectRecord): void {
    this.db
      .prepare(
        `INSERT INTO side_effects (
          side_effect_id, run_id, thread_id, node_id, agent_id,
          effect_type, target, summary, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sideEffectId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.type,
        input.target ?? null,
        input.summary,
        input.details ? toJson(input.details) : null,
        input.timestamp
      );
  }

  listSideEffects(runId: string, limit = 200): CanonicalToolSideEffectRecord[] {
    const rows = this.db
      .prepare(
        `SELECT side_effect_id, run_id, thread_id, node_id, agent_id,
                effect_type, target, summary, details_json, created_at
         FROM side_effects
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      side_effect_id: string;
      run_id: string;
      thread_id: string;
      node_id: string | null;
      agent_id: string | null;
      effect_type: string;
      target: string | null;
      summary: string;
      details_json: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      sideEffectId: row.side_effect_id,
      runId: row.run_id,
      threadId: row.thread_id,
      nodeId: row.node_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      type: row.effect_type as CanonicalToolSideEffectRecord["type"],
      target: row.target ?? undefined,
      summary: row.summary,
      details: row.details_json ? fromJson<JsonValue>(row.details_json) : undefined,
      timestamp: row.created_at
    }));
  }

  /**
   * v0.2：记录工具暴露计划（供调试器查看每轮工具是如何暴露给模型的）。
   */
  insertToolExposurePlan(input: {
    runId: string;
    threadId: string;
    nodeId?: string;
    agentId?: string;
    plan: ToolExposurePlan;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tool_exposure_plans (
          plan_id, run_id, thread_id, node_id, agent_id, adapter_kind, plan_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.plan.planId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.plan.adapterKind,
        toJson(input.plan),
        nowIso()
      );
  }

  listToolExposurePlans(runId: string, limit = 100): ToolExposurePlan[] {
    const rows = this.db
      .prepare(
        `SELECT plan_json
         FROM tool_exposure_plans
         WHERE run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{ plan_json: string }>;
    return rows.map((row) => fromJson<ToolExposurePlan>(row.plan_json));
  }

  /**
   * v0.2：写入 run 内部计划状态（update_plan 工具使用）。
   */
  upsertRunPlan(runId: string, threadId: string, plan: PlanState): void {
    this.db
      .prepare(
        `INSERT INTO run_plans (run_id, thread_id, plan_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           plan_json = excluded.plan_json,
           updated_at = excluded.updated_at`
      )
      .run(runId, threadId, toJson(plan), nowIso());
  }

  getRunPlan(runId: string): PlanState | null {
    const row = this.db
      .prepare(`SELECT plan_json FROM run_plans WHERE run_id = ?`)
      .get(runId) as { plan_json: string } | undefined;
    return row ? fromJson<PlanState>(row.plan_json) : null;
  }

  /**
   * v0.2：写入/更新 request_user_input 请求状态。
   */
  upsertUserInputRequest(input: {
    requestId: string;
    runId: string;
    threadId: string;
    nodeId?: string;
    agentId?: string;
    state: UserInputRequestState;
    payload: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO user_input_requests (
          request_id, run_id, thread_id, node_id, agent_id, status,
          payload_json, answer_json, requested_at, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          status = excluded.status,
          payload_json = excluded.payload_json,
          answer_json = excluded.answer_json,
          answered_at = excluded.answered_at`
      )
      .run(
        input.requestId,
        input.runId,
        input.threadId,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.state.status,
        toJson(input.payload),
        input.state.answer ? toJson(input.state.answer) : null,
        input.state.requestedAt ?? nowIso(),
        input.state.answeredAt ?? null
      );
  }

  getUserInputRequests(runId: string): Array<{
    requestId: string;
    status: string;
    payload: JsonValue;
    answer?: JsonValue;
    requestedAt: string;
    answeredAt?: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT request_id, status, payload_json, answer_json, requested_at, answered_at
         FROM user_input_requests
         WHERE run_id = ?
         ORDER BY requested_at DESC`
      )
      .all(runId) as Array<{
      request_id: string;
      status: string;
      payload_json: string;
      answer_json: string | null;
      requested_at: string;
      answered_at: string | null;
    }>;
    return rows.map((row) => ({
      requestId: row.request_id,
      status: row.status,
      payload: fromJson<JsonValue>(row.payload_json),
      answer: row.answer_json ? fromJson<JsonValue>(row.answer_json) : undefined,
      requestedAt: row.requested_at,
      answeredAt: row.answered_at ?? undefined
    }));
  }

  recordStatePatch(input: {
    threadId: string;
    checkpointId: string;
    runId?: string;
    patchKind: "state_patch" | "prompt_override";
    operator?: string;
    reason: string;
    patch: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO state_patches (
          thread_id, checkpoint_id, run_id, patch_kind, operator, reason, patch_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.threadId,
        input.checkpointId,
        input.runId ?? null,
        input.patchKind,
        input.operator ?? null,
        input.reason,
        toJson(input.patch),
        nowIso()
      );
  }

  getPromptOverridePatchesForCheckpoint(threadId: string, checkpointId: string): JsonValue[] {
    const rows = this.db
      .prepare(
        `SELECT patch_json FROM state_patches
         WHERE thread_id = ? AND checkpoint_id = ? AND patch_kind = 'prompt_override'
         ORDER BY id ASC`
      )
      .all(threadId, checkpointId) as Array<{ patch_json: string }>;
    return rows.map((row) => fromJson<JsonValue>(row.patch_json));
  }

  recordFork(input: {
    parentRunId: string;
    parentCheckpointId: string;
    childRunId: string;
    threadId: string;
    reason: string;
    operator?: string;
  }): ForkRunResponse {
    this.db
      .prepare(
        `INSERT INTO fork_relations (
          parent_run_id, parent_checkpoint_id, child_run_id, thread_id, reason, operator, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.parentRunId,
        input.parentCheckpointId,
        input.childRunId,
        input.threadId,
        input.reason,
        input.operator ?? null,
        nowIso()
      );

    return {
      parentRunId: input.parentRunId,
      parentCheckpointId: input.parentCheckpointId,
      newRunId: input.childRunId,
      threadId: input.threadId,
      status: "created"
    };
  }

  upsertCheckpointIndex(input: {
    threadId: string;
    checkpointId: string;
    parentCheckpointId?: string;
    runId?: string;
    metadata?: JsonValue;
  }): void {
    this.db
      .prepare(
        `INSERT INTO run_checkpoints_index (
          thread_id, run_id, checkpoint_id, parent_checkpoint_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, checkpoint_id) DO UPDATE SET
          run_id = COALESCE(excluded.run_id, run_checkpoints_index.run_id),
          parent_checkpoint_id = COALESCE(excluded.parent_checkpoint_id, run_checkpoints_index.parent_checkpoint_id),
          metadata_json = COALESCE(excluded.metadata_json, run_checkpoints_index.metadata_json)`
      )
      .run(
        input.threadId,
        input.runId ?? null,
        input.checkpointId,
        input.parentCheckpointId ?? null,
        input.metadata ? toJson(input.metadata) : null,
        nowIso()
      );
  }

  listCheckpointIndex(threadId: string): Array<{
    checkpointId: string;
    parentCheckpointId?: string;
    runId?: string;
    metadata?: JsonValue;
  }> {
    const rows = this.db
      .prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, run_id, metadata_json
         FROM run_checkpoints_index
         WHERE thread_id = ?
         ORDER BY id DESC`
      )
      .all(threadId) as Array<{
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      run_id: string | null;
      metadata_json: string | null;
    }>;
    return rows.map((row) => ({
      checkpointId: row.checkpoint_id,
      parentCheckpointId: row.parent_checkpoint_id ?? undefined,
      runId: row.run_id ?? undefined,
      metadata: row.metadata_json ? fromJson<JsonValue>(row.metadata_json) : undefined
    }));
  }

  writeAudit(action: string, targetType: string, targetId: string | null, details?: JsonValue): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(action, targetType, targetId, details ? toJson(details) : null, nowIso());
  }
}
