/**
 * 本文件实现 driver-agnostic 的 SQLite TraceStore。
 *
 * 分层边界：
 * - 这里属于 `agent-core`，负责 schema 初始化、trace 拆分、tag 绑定、脱敏等框架语义。
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
  readonly parent_message_node_id: string | null;
  readonly role: string;
  readonly content_json: string;
  readonly tool_call_id: string | null;
  readonly name: string | null;
  readonly selector_json: string | null;
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
 * 从 JSON object 中读取人工 tag 数组。
 *
 * 重要边界：
 * - 这里不会给日志自动加 tag。
 * - 只有调用方显式传入 `tags` 字段，才会创建 tag node 和 `hashtag` edge。
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
 * 从 node metadata 中提取保存顺序。
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
 * - 将 TraceStore 的 conversation 快照映射为 conversation node + message node。
 * - 将 TraceRecord 映射为 event node + llm/tool/approval payload。
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
   * 写入或更新 node。
   *
   * 输入：
   * - id: node 的 UUID v7。
   * - nodeType: node 类型，例如 conversation / event / message / tag。
   * - name: 可读名称，日志型 node 可以为空。
   * - metadata: 非查询型补充信息。
   *
   * 核心逻辑：
   * - 所有实体都先进入 `nodes`。
   * - payload 表只保存该类型额外字段。
   */
  private upsertNode(input: {
    readonly id: string;
    readonly nodeType: string;
    readonly name?: string | null;
    readonly description?: string | null;
    readonly enabled?: boolean;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly metadata?: unknown;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO nodes (id, node_type, name, description, enabled, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          node_type = excluded.node_type,
          name = excluded.name,
          description = excluded.description,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json
      `
      )
      .run(
        input.id,
        input.nodeType,
        input.name ?? null,
        input.description ?? null,
        input.enabled === false ? 0 : 1,
        input.createdAt,
        input.updatedAt,
        jsonOrNull(input.metadata)
      );
  }

  /**
   * 确保 conversation node 存在。
   *
   * 输入：
   * - conversationId: 当前旧接口中的 threadId，在新 schema 中就是 conversation node id。
   * - now: 当前写入时间。
   *
   * 核心逻辑：
   * - 如果 conversation 不存在，就创建一个最小 conversation node。
   * - 如果已经存在，只刷新 node.updated_at，不覆盖人类可读名称。
   */
  private ensureConversation(conversationId: string, now: number): void {
    this.db
      .prepare(
        `
        INSERT INTO nodes (id, node_type, name, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `
      )
      .run(conversationId, "conversation", "未命名会话", 1, now, now);

    this.db
      .prepare(
        `
        INSERT INTO conversations (node_id, entry_node_id)
        VALUES (?, NULL)
        ON CONFLICT(node_id) DO NOTHING
      `
      )
      .run(conversationId);
  }

  /**
   * 确保引用到的 node 存在。
   *
   * 使用场景：
   * - 当前 server/thread 快照里会带 `agentId`。
   * - 在完整定义层落地前，这个 agent 可能还没有自己的 payload 记录。
   * - 既然 schema 要求 edge 和外键都指向 node，这里先补一个最小 node，避免保存裸 ID。
   */
  private ensureReferencedNode(nodeId: string, nodeType: string, now: number): void {
    this.db
      .prepare(
        `
        INSERT INTO nodes (id, node_type, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
      `
      )
      .run(nodeId, nodeType, 1, now, now);
  }

  /**
   * 创建或复用 tag node，并返回 tag node id。
   *
   * 注意：
   * - tag 是普通 node，不再有 `tags` 专表。
   * - 同名 tag 通过 `nodes(node_type, name)` 查询复用。
   */
  private getOrCreateTagNodeId(tagName: string, now: number): string {
    const row = this.db.prepare("SELECT id FROM nodes WHERE node_type = ? AND name = ?").get("tag", tagName) as
      | { readonly id: string }
      | undefined;

    if (row !== undefined) {
      return row.id;
    }

    const tagNodeId = createUuidV7Id();
    this.upsertNode({
      id: tagNodeId,
      nodeType: "tag",
      name: tagName,
      createdAt: now,
      updatedAt: now
    });

    return tagNodeId;
  }

  /**
   * 写入 edge。
   */
  private insertEdge(input: {
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly edgeType: string;
    readonly name?: string;
    readonly description?: string;
    readonly condition?: unknown;
    readonly metadata?: unknown;
    readonly now: number;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO edges (
          id, source_node_id, target_node_id, edge_type, name, description,
          enabled, condition_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        createUuidV7Id(),
        input.sourceNodeId,
        input.targetNodeId,
        input.edgeType,
        input.name ?? null,
        input.description ?? null,
        1,
        jsonOrNull(input.condition),
        jsonOrNull(input.metadata),
        input.now,
        input.now
      );
  }

  /**
   * 同步某个 node 的人工 tag 绑定。
   *
   * 核心逻辑：
   * - 删除该 node 现有 `hashtag` edge。
   * - 为显式传入的 tag 创建 tag node，并写 `source -> tag` edge。
   */
  private syncNodeHashtags(sourceNodeId: string, tags: readonly string[], now: number): void {
    this.db.prepare("DELETE FROM edges WHERE source_node_id = ? AND edge_type = ?").run(sourceNodeId, "hashtag");

    for (const tag of tags) {
      this.insertEdge({
        sourceNodeId,
        targetNodeId: this.getOrCreateTagNodeId(tag, now),
        edgeType: "hashtag",
        now
      });
    }
  }

  /**
   * 读取某个 node 的人工 tag 名称。
   */
  private listNodeHashtags(sourceNodeId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT target_nodes.name AS name
        FROM edges
        JOIN nodes AS target_nodes ON target_nodes.id = edges.target_node_id
        WHERE edges.source_node_id = ?
          AND edges.edge_type = ?
          AND target_nodes.node_type = ?
        ORDER BY target_nodes.name
      `
      )
      .all(sourceNodeId, "hashtag", "tag") as unknown as Array<{ readonly name: string | null }>;

    return rows.flatMap((row) => (row.name === null ? [] : [row.name]));
  }

  /**
   * 写入事件 node 和 event payload。
   */
  private insertEvent(input: {
    readonly id: string;
    readonly conversationId: string;
    readonly parentEventId?: string;
    readonly causedByEventId?: string;
    readonly eventType: string;
    readonly status: EventStatus;
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly input?: unknown;
    readonly output?: unknown;
    readonly error?: unknown;
    readonly metadata?: unknown;
  }): void {
    const completedAt = input.completedAt ?? input.startedAt;

    this.upsertNode({
      id: input.id,
      nodeType: "event",
      createdAt: input.startedAt,
      updatedAt: completedAt,
      metadata: input.metadata
    });

    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO events (
          node_id, conversation_node_id, event_type, status, started_at, completed_at,
          input_json, output_json, error_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.id,
        input.conversationId,
        input.eventType,
        input.status,
        input.startedAt,
        input.completedAt ?? null,
        jsonOrNull(input.input),
        jsonOrNull(input.output),
        jsonOrNull(input.error)
      );

    if (input.parentEventId !== undefined) {
      this.insertEdge({
        sourceNodeId: input.parentEventId,
        targetNodeId: input.id,
        edgeType: "event_child",
        now: completedAt
      });
    }

    if (input.causedByEventId !== undefined) {
      this.insertEdge({
        sourceNodeId: input.causedByEventId,
        targetNodeId: input.id,
        edgeType: "event_caused_by",
        now: completedAt
      });
    }
  }

  /**
   * 保存 conversation 快照。
   *
   * 当前 HTTP 层仍把顶层会话称作 thread；SQLite 层把它映射为 conversation node。
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
      if (agentId !== null) {
        this.ensureReferencedNode(agentId, "agent", updatedAt);
      }

      this.upsertNode({
        id: threadId,
        nodeType: "conversation",
        name: title,
        createdAt,
        updatedAt,
        metadata
      });
      this.db
        .prepare(
          `
          INSERT INTO conversations (node_id, entry_node_id)
          VALUES (?, ?)
          ON CONFLICT(node_id) DO UPDATE SET entry_node_id = excluded.entry_node_id
        `
        )
        .run(threadId, agentId);
      this.syncNodeHashtags(threadId, tagListFromField(snapshot), updatedAt);

      const oldMessageRows = this.db
        .prepare("SELECT node_id FROM messages WHERE conversation_node_id = ?")
        .all(threadId) as unknown as Array<{ readonly node_id: string }>;
      const deleteNode = this.db.prepare("DELETE FROM nodes WHERE id = ?");

      for (const row of oldMessageRows) {
        deleteNode.run(row.node_id);
      }

      const insertMessage = this.db.prepare(
        `
        INSERT INTO messages (
          node_id, conversation_node_id, event_node_id, parent_message_node_id, role,
          content_json, tool_call_id, name, selector_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        this.upsertNode({
          id: messageId,
          nodeType: "message",
          name: stringField(message, "name") ?? null,
          createdAt: updatedAt,
          updatedAt,
          metadata: messageMetadata
        });

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
          updatedAt
        );

        this.syncNodeHashtags(messageId, tagListFromField(message), updatedAt);
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
      .prepare(
        `
        SELECT
          nodes.id AS id,
          nodes.name AS name,
          conversations.entry_node_id AS entry_node_id,
          nodes.created_at AS created_at,
          nodes.updated_at AS updated_at,
          nodes.metadata_json AS metadata_json
        FROM nodes
        JOIN conversations ON conversations.node_id = nodes.id
        WHERE nodes.id = ?
      `
      )
      .get(threadId) as ConversationRow | undefined;

    if (row === undefined) {
      return undefined;
    }

    const messageRows = this.db
      .prepare(
        `
        SELECT
          messages.node_id AS id,
          messages.parent_message_node_id AS parent_message_node_id,
          messages.role AS role,
          messages.content_json AS content_json,
          messages.tool_call_id AS tool_call_id,
          messages.name AS name,
          messages.selector_json AS selector_json,
          nodes.metadata_json AS metadata_json,
          messages.created_at AS created_at
        FROM messages
        JOIN nodes ON nodes.id = messages.node_id
        WHERE messages.conversation_node_id = ?
        ORDER BY messages.created_at, messages.node_id
      `
      )
      .all(threadId) as unknown as MessageRow[];

    const messages = [...messageRows]
      .sort((left, right) => snapshotIndexFromMetadata(left.metadata_json) - snapshotIndexFromMetadata(right.metadata_json))
      .map((message): JsonObject => {
        const metadata = parseJsonObjectOrUndefined(message.metadata_json);
        const { snapshotIndex: _snapshotIndex, ...publicMetadata } = metadata ?? {};
        const tags = this.listNodeHashtags(message.id);

        return {
          id: message.id,
          role: message.role,
          content: parseJson(message.content_json) as JsonValue,
          ...(message.parent_message_node_id === null ? {} : { parentId: message.parent_message_node_id }),
          ...(message.tool_call_id === null ? {} : { toolCallId: message.tool_call_id }),
          ...(message.name === null ? {} : { name: message.name }),
          ...(message.selector_json === null ? {} : { selector: parseJson(message.selector_json) as JsonValue }),
          ...(tags.length === 0 ? {} : { tags }),
          ...(Object.keys(publicMetadata).length === 0 ? {} : { metadata: publicMetadata })
        };
      });
    const tags = this.listNodeHashtags(row.id);
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
      .prepare(
        `
        SELECT nodes.id AS id
        FROM nodes
        JOIN conversations ON conversations.node_id = nodes.id
        WHERE nodes.node_type = ?
        ORDER BY nodes.updated_at DESC
      `
      )
      .all("conversation") as unknown as Array<{ readonly id: string }>;
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
              event_node_id, provider_strategy_node_id, provider, model, request_json, response_json,
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
              event_node_id, tool_node_id, provider_tool_call_id, tool_name, arguments_json,
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
        const toolCallEventId =
          providerToolCallId === undefined ? trace.turnId : (toolCallEventIds.get(providerToolCallId) ?? trace.turnId);

        this.insertEvent({
          id: approvalEventId,
          conversationId: trace.threadId,
          parentEventId: trace.turnId,
          causedByEventId: toolCallEventId,
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
              event_node_id, tool_call_event_node_id, risk_summary, decision, reason, requested_at, resolved_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
          )
          .run(
            approvalEventId,
            toolCallEventId,
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
