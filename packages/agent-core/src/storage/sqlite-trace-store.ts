/**
 * 本文件实现 driver-agnostic 的 SQLite TraceStore。
 *
 * 分层边界：
 * - 这里属于 `agent-core`，负责 schema 初始化、trace 拆分、tag 关系表、脱敏等框架语义。
 * - 这里不 import `node:sqlite`，也不关心数据库文件路径。
 * - 具体 runtime 只需要实现 `SqlDatabase`，再把执行器传进来。
 */
import { createUuidV7Id, type JsonObject, type JsonValue } from "../types/common.js";
import type { TraceRecord, TraceStore } from "../types/trace.js";
import type { SqlDatabase } from "./sql-executor.js";
import { SQLITE_SCHEMA_SQL } from "./sqlite-schema.js";

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
 * 从 SQLite 读出的 message 行。
 */
interface MessageRow {
  readonly id: string;
  readonly parent_message_id: string | null;
  readonly role: string;
  readonly content_json: string;
  readonly tool_call_id: string | null;
  readonly name: string | null;
  readonly metadata_json: string | null;
  readonly created_at: number;
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
 * - SQLite 的 NULL 能表达“字段不存在”。
 * - 空对象 / 空数组仍保存成 JSON 字符串，避免丢失真实输入。
 */
function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * 解析 SQLite 中的 JSON TEXT。
 *
 * 异常策略：
 * - 数据库里如果出现坏 JSON，说明历史写入已经不可信。
 * - 读取会抛出原始 JSON.parse 错误，避免静默吞掉损坏数据。
 */
function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

/**
 * 解析 SQLite 中的 JSON object。
 */
function parseJsonObjectOrUndefined(value: string | null): JsonObject | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = parseJson(value);
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
 * 从 JSON object 中读取 tag 数组。
 *
 * 输入：
 * - value: 可能带有 `tags` 字段的对象。
 *
 * 输出：
 * - 去重后的非空字符串 tag 列表。
 *
 * 核心逻辑：
 * - tag 是查询重点，写库时进入关系表。
 * - 非字符串、空白字符串会被忽略，避免污染 tag 字典。
 */
function tagListFromField(value: JsonObject): string[] {
  const tags = value.tags;
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))];
}

/**
 * 脱敏 HTTP 请求观测对象。
 *
 * 为什么要做：
 * - trace 会保存完整 headers，其中可能包含 Authorization。
 * - SQLite 是长期调试真源，不能把 API key 明文落库。
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
 * 从 message metadata 中提取保存顺序。
 */
function snapshotIndexFromMetadata(value: string | null): number {
  const metadata = parseJsonObjectOrUndefined(value);
  const snapshotIndex = metadata?.snapshotIndex;
  return typeof snapshotIndex === "number" ? snapshotIndex : Number.MAX_SAFE_INTEGER;
}

/**
 * SQLite TraceStore。
 *
 * 关键职责：
 * - 初始化完整 schema。
 * - 将 TraceStore 的 conversation 快照映射为 `conversations` + `messages` + tag 关系表。
 * - 将 TraceRecord 映射为 `events` + `llm_calls` / `tool_calls` / `tool_approvals`。
 */
export class SqliteTraceStore implements TraceStore {
  constructor(private readonly db: SqlDatabase) {
    this.initializeSchema();
  }

  /**
   * 初始化 schema。
   *
   * 注意：
   * - 这里不创建 graphs / runs / turns 表。
   * - 建表 SQL 必须和 `docs/SQLite表结构.md` 保持同步。
   */
  private initializeSchema(): void {
    this.db.exec(SQLITE_SCHEMA_SQL);
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
   * 创建或复用 tag，并返回 tag id。
   */
  private getOrCreateTagId(tagName: string, now: number): string {
    const tagId = createUuidV7Id();

    this.db
      .prepare(
        `
        INSERT INTO tags (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at
      `
      )
      .run(tagId, tagName, now, now);

    const row = this.db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName) as { readonly id: string } | undefined;
    if (row === undefined) {
      throw new Error(`写入 tag 后无法读取 tag id：${tagName}`);
    }

    return row.id;
  }

  /**
   * 同步 conversation 的 tag 绑定。
   */
  private syncConversationTags(conversationId: string, tags: readonly string[], now: number): void {
    this.db.prepare("DELETE FROM conversation_tags WHERE conversation_id = ?").run(conversationId);

    const insert = this.db.prepare(
      `
      INSERT OR IGNORE INTO conversation_tags (conversation_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `
    );

    for (const tag of tags) {
      insert.run(conversationId, this.getOrCreateTagId(tag, now), now);
    }
  }

  /**
   * 同步 message 的 tag 绑定。
   */
  private syncMessageTags(messageId: string, tags: readonly string[], now: number): void {
    this.db.prepare("DELETE FROM message_tags WHERE message_id = ?").run(messageId);

    const insert = this.db.prepare(
      `
      INSERT OR IGNORE INTO message_tags (message_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `
    );

    for (const tag of tags) {
      insert.run(messageId, this.getOrCreateTagId(tag, now), now);
    }
  }

  /**
   * 读取某条 message 的 tag 名称。
   */
  private listMessageTags(messageId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT tags.name AS name
        FROM message_tags
        JOIN tags ON tags.id = message_tags.tag_id
        WHERE message_tags.message_id = ?
        ORDER BY tags.name
      `
      )
      .all(messageId) as unknown as Array<{ readonly name: string }>;

    return rows.map((row) => row.name);
  }

  /**
   * 读取某个 conversation 的 tag 名称。
   */
  private listConversationTags(conversationId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT tags.name AS name
        FROM conversation_tags
        JOIN tags ON tags.id = conversation_tags.tag_id
        WHERE conversation_tags.conversation_id = ?
        ORDER BY tags.name
      `
      )
      .all(conversationId) as unknown as Array<{ readonly name: string }>;

    return rows.map((row) => row.name);
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
   * 保存 conversation 快照。
   *
   * 当前 HTTP 层仍把顶层会话称作 thread；SQLite 层把它映射为 conversation。
   * 这里不保存完整 `threadSnapshot`，因为旧快照兼容债已经明确删除。
   */
  async saveThread(threadId: string, snapshot: JsonObject): Promise<void> {
    const now = Date.now();
    const title = stringField(snapshot, "title") ?? "未命名会话";
    const createdAt = numberField(snapshot, "createdAt") ?? now;
    const updatedAt = numberField(snapshot, "updatedAt") ?? now;
    const agentId = stringField(snapshot, "agentId") ?? null;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const metadata = isJsonObject(snapshot.metadata) ? snapshot.metadata : undefined;

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
        .run(threadId, title, agentId, createdAt, updatedAt, jsonOrNull(metadata));

      this.syncConversationTags(threadId, tagListFromField(snapshot), updatedAt);
      this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(threadId);

      const insertMessage = this.db.prepare(
        `
        INSERT INTO messages (
          id, conversation_id, event_id, parent_message_id, role, content_json,
          tool_call_id, name, selector_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );

      messages.forEach((message, index) => {
        if (!isJsonObject(message)) {
          return;
        }

        const messageId = stringField(message, "id") ?? createUuidV7Id();
        const role = stringField(message, "role") ?? "assistant";
        const messageMetadata = {
          ...(isJsonObject(message.metadata) ? message.metadata : {}),
          snapshotIndex: index
        };

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
          jsonOrNull(messageMetadata),
          updatedAt
        );

        this.syncMessageTags(messageId, tagListFromField(message), updatedAt);
      });

      this.db.exec("COMMIT");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * 读取 conversation 快照。
   */
  async loadThread(threadId: string): Promise<JsonObject | undefined> {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(threadId) as ConversationRow | undefined;

    if (row === undefined) {
      return undefined;
    }

    const messageRows = this.db
      .prepare(
        `
        SELECT *
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at, id
      `
      )
      .all(threadId) as unknown as MessageRow[];

    const messages = [...messageRows]
      .sort((left, right) => snapshotIndexFromMetadata(left.metadata_json) - snapshotIndexFromMetadata(right.metadata_json))
      .map((message): JsonObject => {
        const metadata = parseJsonObjectOrUndefined(message.metadata_json);
        const { snapshotIndex: _snapshotIndex, ...publicMetadata } = metadata ?? {};
        const tags = this.listMessageTags(message.id);

        return {
          id: message.id,
          role: message.role,
          content: parseJson(message.content_json) as JsonValue,
          ...(message.parent_message_id === null ? {} : { parentId: message.parent_message_id }),
          ...(message.tool_call_id === null ? {} : { toolCallId: message.tool_call_id }),
          ...(message.name === null ? {} : { name: message.name }),
          ...(tags.length === 0 ? {} : { tags }),
          ...(Object.keys(publicMetadata).length === 0 ? {} : { metadata: publicMetadata })
        };
      });
    const tags = this.listConversationTags(row.id);
    const metadata = parseJsonObjectOrUndefined(row.metadata_json);

    return {
      id: row.id,
      ...(row.entry_node_id === null ? {} : { agentId: row.entry_node_id }),
      title: row.name ?? "未命名会话",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages,
      ...(tags.length === 0 ? {} : { tags }),
      ...(metadata === undefined ? {} : { metadata })
    };
  }

  /**
   * 列出所有 conversation 快照。
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
          source: "TraceRecord"
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
