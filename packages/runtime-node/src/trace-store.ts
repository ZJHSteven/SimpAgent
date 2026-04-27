/**
 * 本文件提供基于 SQLite 的 TraceStore 实现。
 *
 * 设计背景：
 * - 旧版本把每个 thread 写成一个 JSON 文件，适合 MVP 验证，但不适合查询、回放和图谱化调试。
 * - 新版本以 `docs/SQLite表结构.md` 为 schema 真源，把 conversation / node / edge / event 作为后续
 *   多 agent 系统的持久化底座。
 * - 当前第一版仍然实现 agent-core 既有 TraceStore 接口，让 CLI/server 先无感切换到底层 SQLite；
 *   后续再把 agent loop 改为直接生成细粒度 events。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createUuidV7Id, type JsonObject, type JsonValue, type TraceRecord, type TraceStore } from "@simpagent/agent-core";

/**
 * SQLite 文件名固定在 storageDir 下。
 *
 * 说明：
 * - storageDir 仍由 simpagent.toml 控制，保持部署时可配置。
 * - 文件名固定，方便人工定位和后续 SQLite 客户端打开。
 */
const SQLITE_FILE_NAME = "simpagent.sqlite";

/**
 * 当前运行层允许写入的事件状态。
 */
type EventStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * 从 SQLite 读出的 conversation 行。
 */
interface ConversationRow {
  readonly id: string;
  readonly name: string | null;
  readonly entry_node_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly metadata_json: string | null;
}

/**
 * 判断 unknown 是否为普通 JSON 对象。
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把可选值转成 SQLite TEXT JSON。
 *
 * 返回 null 的原因：
 * - SQLite 的 NULL 能更清楚表达“字段不存在”。
 * - 空对象 / 空数组仍然会保存成 JSON 字符串，避免丢失真实输入。
 */
function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * 解析 SQLite 中的 JSON TEXT。
 */
function parseJsonObjectOrUndefined(value: string | null): JsonObject | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  return isJsonObject(parsed) ? parsed : undefined;
}

/**
 * 读取 JSON object 中的字符串字段。
 */
function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/**
 * 读取 JSON object 中的数字字段。
 */
function numberField(value: JsonObject, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

/**
 * 脱敏 HTTP 请求观测对象。
 *
 * 为什么要做：
 * - 旧 trace 会保存完整 headers，其中可能包含 Authorization。
 * - SQLite 变成长期调试真源后，不能把 API key 明文落库。
 */
function redactObservableRequest(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }

  const headers = value.headers;
  if (!isJsonObject(headers)) {
    return value;
  }

  return {
    ...value,
    headers: {
      ...headers,
      ...(typeof headers.authorization === "string" ? { authorization: "[redacted]" } : {}),
      ...(typeof headers.Authorization === "string" ? { Authorization: "[redacted]" } : {})
    }
  };
}

/**
 * SQLite TraceStore。
 *
 * 关键职责：
 * - 初始化完整 schema。
 * - 将旧 TraceStore 的 thread 快照映射为 conversation + messages。
 * - 将旧 TraceRecord 映射为 events + llm_calls / tool_calls / tool_approvals。
 */
export class SqliteTraceStore implements TraceStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(private readonly storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    this.databasePath = join(storageDir, SQLITE_FILE_NAME);
    this.db = new DatabaseSync(this.databasePath);
    this.initializeSchema();
  }

  /**
   * 关闭 SQLite 句柄。
   *
   * 测试里显式关闭可以避免 Windows 临时目录清理时遇到文件占用。
   */
  close(): void {
    this.db.close();
  }

  /**
   * 初始化 schema。
   *
   * 注意：
   * - 这里不创建 graphs / runs / turns 表。
   * - 建表 SQL 必须和 `docs/SQLite表结构.md` 保持同步。
   */
  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        tags_json TEXT,
        entry_node_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        tags_json TEXT,
        enabled INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_nodes (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        instruction TEXT NOT NULL,
        context_policy_json TEXT,
        tool_policy_json TEXT,
        model_policy_json TEXT,
        memory_policy_json TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_nodes (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        description TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        executor_kind TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        config_json TEXT
      );

      CREATE TABLE IF NOT EXISTS prompt_units (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content_template TEXT NOT NULL,
        variables_json TEXT,
        priority INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_strategies (
        node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        strategy_json TEXT,
        parameters_json TEXT
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL,
        name TEXT,
        description TEXT,
        enabled INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        condition_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        caused_by_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        edge_id TEXT REFERENCES edges(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        input_json TEXT,
        output_json TEXT,
        error_json TEXT,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        tool_call_id TEXT,
        name TEXT,
        selector_json TEXT,
        tags_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_compilations (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        agent_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        input_json TEXT NOT NULL,
        assembly_plan_json TEXT,
        rendered_messages_json TEXT NOT NULL,
        trace_json TEXT
      );

      CREATE TABLE IF NOT EXISTS llm_calls (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        provider_strategy_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        stream_events_json TEXT,
        status_code INTEGER,
        request_id TEXT,
        first_token_ms INTEGER,
        total_ms INTEGER,
        usage_json TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        tool_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        provider_tool_call_id TEXT,
        tool_name TEXT NOT NULL,
        arguments_json TEXT,
        arguments_text TEXT NOT NULL,
        result_json TEXT,
        ok INTEGER
      );

      CREATE TABLE IF NOT EXISTS tool_approvals (
        event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        tool_call_event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        risk_summary TEXT NOT NULL,
        decision TEXT,
        reason TEXT,
        requested_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS side_effects (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        effect_type TEXT NOT NULL,
        target TEXT,
        summary TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_logs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id, edge_type);
      CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_event_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    `);
  }

  /**
   * 确保 conversation 存在。
   *
   * 输入：
   * - conversationId: 当前旧接口中的 threadId，在新 schema 中就是 conversation id。
   * - now: 当前写入时间。
   *
   * 核心逻辑：
   * - 如果 conversation 不存在，就创建一个最小记录。
   * - 如果已经存在，只刷新 updated_at。
   */
  private ensureConversation(conversationId: string, now: number): void {
    this.db
      .prepare(
        `
        INSERT INTO conversations (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `
      )
      .run(conversationId, "未命名会话", now, now);
  }

  /**
   * 写入事件总表。
   */
  private insertEvent(input: {
    readonly id: string;
    readonly conversationId: string;
    readonly parentEventId?: string;
    readonly causedByEventId?: string;
    readonly nodeId?: string;
    readonly edgeId?: string;
    readonly eventType: string;
    readonly status: EventStatus;
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly input?: unknown;
    readonly output?: unknown;
    readonly error?: unknown;
    readonly metadata?: unknown;
  }): void {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO events (
          id, conversation_id, parent_event_id, caused_by_event_id, node_id, edge_id,
          event_type, status, started_at, completed_at, input_json, output_json, error_json, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.id,
        input.conversationId,
        input.parentEventId ?? null,
        input.causedByEventId ?? null,
        input.nodeId ?? null,
        input.edgeId ?? null,
        input.eventType,
        input.status,
        input.startedAt,
        input.completedAt ?? null,
        jsonOrNull(input.input),
        jsonOrNull(input.output),
        jsonOrNull(input.error),
        jsonOrNull(input.metadata)
      );
  }

  /**
   * 保存 thread 快照。
   *
   * 当前 HTTP 层仍把顶层会话称作 thread；SQLite 层把它映射为 conversation。
   */
  async saveThread(threadId: string, snapshot: JsonObject): Promise<void> {
    const now = Date.now();
    const title = stringField(snapshot, "title") ?? "未命名会话";
    const createdAt = numberField(snapshot, "createdAt") ?? now;
    const updatedAt = numberField(snapshot, "updatedAt") ?? now;
    const agentId = stringField(snapshot, "agentId") ?? null;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
          INSERT INTO conversations (id, name, entry_node_id, created_at, updated_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            entry_node_id = excluded.entry_node_id,
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json
        `
        )
        .run(
          threadId,
          title,
          agentId,
          createdAt,
          updatedAt,
          JSON.stringify({
            threadSnapshot: snapshot
          })
        );

      this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(threadId);

      const insertMessage = this.db.prepare(
        `
        INSERT INTO messages (
          id, conversation_id, event_id, parent_message_id, role, content_json,
          tool_call_id, name, selector_json, tags_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );

      messages.forEach((message, index) => {
        if (!isJsonObject(message)) {
          return;
        }

        const messageId = stringField(message, "id") ?? createUuidV7Id();
        const role = stringField(message, "role") ?? "assistant";

        insertMessage.run(
          messageId,
          threadId,
          stringField(message, "eventId") ?? null,
          stringField(message, "parentId") ?? null,
          role,
          JSON.stringify(message.content ?? ""),
          stringField(message, "toolCallId") ?? null,
          stringField(message, "name") ?? null,
          jsonOrNull(message.selector),
          jsonOrNull(message.tags),
          jsonOrNull({
            ...(isJsonObject(message.metadata) ? message.metadata : {}),
            snapshotIndex: index
          }),
          updatedAt
        );
      });

      this.db.exec("COMMIT");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * 读取 thread 快照。
   */
  async loadThread(threadId: string): Promise<JsonObject | undefined> {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(threadId) as ConversationRow | undefined;

    if (row === undefined) {
      return undefined;
    }

    const metadata = parseJsonObjectOrUndefined(row.metadata_json);
    const threadSnapshot = metadata?.threadSnapshot;

    if (isJsonObject(threadSnapshot)) {
      return threadSnapshot;
    }

    return {
      id: row.id,
      ...(row.entry_node_id === null ? {} : { agentId: row.entry_node_id }),
      title: row.name ?? "未命名会话",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: []
    };
  }

  /**
   * 列出所有 thread 快照。
   */
  async listThreads(): Promise<readonly JsonObject[]> {
    const rows = this.db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as unknown as ConversationRow[];
    const threads: JsonObject[] = [];

    for (const row of rows) {
      const loaded = await this.loadThread(row.id);

      if (loaded !== undefined) {
        threads.push(loaded);
      }
    }

    return threads;
  }

  /**
   * 保存一次 agent trace。
   *
   * 当前 TraceRecord 是旧 agent loop 的聚合快照。这里先把它拆成：
   * - 一个 `agent_invocation` 顶层事件。
   * - 多个 `llm_call` 事件。
   * - 多个 `tool_call` / `tool_approval` 事件。
   */
  async saveTrace(trace: TraceRecord): Promise<void> {
    const now = Date.now();
    const completedAt = now;
    const requests = trace.requests ?? (trace.request === undefined ? [] : [trace.request]);

    this.db.exec("BEGIN");
    try {
      this.ensureConversation(trace.threadId, now);

      this.insertEvent({
        id: trace.turnId,
        conversationId: trace.threadId,
        eventType: "agent_invocation",
        status: "completed",
        startedAt: trace.createdAt,
        completedAt,
        input: {
          firstRequest: trace.request === undefined ? undefined : redactObservableRequest(trace.request),
          requestCount: requests.length
        },
        output: {
          responseEvents: trace.responseEvents,
          toolResults: trace.toolResults,
          metrics: trace.metrics
        },
        error: trace.errors.length === 0 ? undefined : trace.errors,
        metadata: {
          source: "TraceRecord",
          legacyThreadId: trace.threadId,
          legacyTurnId: trace.turnId
        }
      });

      requests.forEach((request, index) => {
        const llmEventId = createUuidV7Id();
        const requestBody = isJsonObject(request.body) ? request.body : {};
        const model = typeof requestBody.model === "string" ? requestBody.model : "unknown";

        this.insertEvent({
          id: llmEventId,
          conversationId: trace.threadId,
          parentEventId: trace.turnId,
          eventType: "llm_call",
          status: "completed",
          startedAt: trace.createdAt,
          completedAt,
          input: redactObservableRequest(request),
          output: {
            responseEvents: trace.responseEvents,
            status: undefined
          },
          metadata: {
            requestIndex: index
          }
        });

        this.db
          .prepare(
            `
            INSERT OR REPLACE INTO llm_calls (
              event_id, provider_strategy_node_id, provider, model, request_json, response_json,
              stream_events_json, status_code, request_id, first_token_ms, total_ms, usage_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            llmEventId,
            null,
            "chat-completions",
            model,
            JSON.stringify(redactObservableRequest(request)),
            null,
            JSON.stringify(trace.responseEvents),
            null,
            null,
            null,
            null,
            null
          );
      });

      const toolCallEventIds = new Map<string, string>();

      trace.toolResults.forEach((item) => {
        const value = isJsonObject(item) ? item : {};
        const toolCall = isJsonObject(value.toolCall) ? value.toolCall : {};
        const result = isJsonObject(value.result) ? value.result : undefined;
        const toolEventId = createUuidV7Id();
        const rawArguments = stringField(toolCall, "argumentsText") ?? "";
        const providerToolCallId = stringField(toolCall, "id");

        if (providerToolCallId !== undefined) {
          toolCallEventIds.set(providerToolCallId, toolEventId);
        }

        this.insertEvent({
          id: toolEventId,
          conversationId: trace.threadId,
          parentEventId: trace.turnId,
          eventType: "tool_call",
          status: result?.ok === false ? "failed" : "completed",
          startedAt: trace.createdAt,
          completedAt,
          input: toolCall,
          output: result,
          metadata: {
            source: "TraceRecord.toolResults"
          }
        });

        this.db
          .prepare(
            `
            INSERT OR REPLACE INTO tool_calls (
              event_id, tool_node_id, provider_tool_call_id, tool_name, arguments_json,
              arguments_text, result_json, ok
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            toolEventId,
            null,
            providerToolCallId ?? null,
            stringField(toolCall, "name") ?? "unknown_tool",
            jsonOrNull(safeParseJson(rawArguments)),
            rawArguments,
            jsonOrNull(result),
            typeof result?.ok === "boolean" ? (result.ok ? 1 : 0) : null
          );
      });

      trace.toolApprovals.forEach((item) => {
        const value = isJsonObject(item) ? item : {};
        const request = isJsonObject(value.request) ? value.request : {};
        const approval = isJsonObject(value.approval) ? value.approval : {};
        const requestToolCall = isJsonObject(request.toolCall) ? request.toolCall : {};
        const providerToolCallId = stringField(requestToolCall, "id");
        const approvalEventId = createUuidV7Id();

        this.insertEvent({
          id: approvalEventId,
          conversationId: trace.threadId,
          parentEventId: trace.turnId,
          eventType: "tool_approval",
          status: "completed",
          startedAt: trace.createdAt,
          completedAt,
          input: request,
          output: approval,
          metadata: {
            source: "TraceRecord.toolApprovals"
          }
        });

        this.db
          .prepare(
            `
            INSERT OR REPLACE INTO tool_approvals (
              event_id, tool_call_event_id, risk_summary, decision, reason, requested_at, resolved_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            approvalEventId,
            providerToolCallId === undefined ? trace.turnId : (toolCallEventIds.get(providerToolCallId) ?? trace.turnId),
            stringField(request, "riskSummary") ?? "工具审批请求",
            stringField(approval, "decision") ?? null,
            stringField(approval, "reason") ?? null,
            trace.createdAt,
            completedAt
          );
      });

      this.db.exec("COMMIT");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

/**
 * 尝试解析工具参数 JSON。
 */
function safeParseJson(text: string): JsonValue | undefined {
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}
