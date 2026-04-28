/**
 * 本文件保存 SimpAgent 的 SQLite schema。
 *
 * 重要约定：
 * - `docs/SQLite表结构.md` 是人类可读真源，改这里之前必须先改文档。
 * - 本 schema 不创建 `graphs`、`runs`、`turns` 表。
 * - tag 是查询重点，必须进入 `tags` 与绑定表，不能退回 `tags_json`。
 */

/**
 * 默认 SQLite 文件名。
 *
 * 说明：
 * - 文件放在哪个目录由 runtime 决定。
 * - 文件名作为框架约定放在 core，方便所有 runtime 保持一致。
 */
export const DEFAULT_SQLITE_FILE_NAME = "simpagent.sqlite";

/**
 * SQLite 建表 SQL。
 *
 * 核心逻辑：
 * - 定义层：`conversations`、`nodes`、`edges` 与各类 node payload 表。
 * - tag 查询层：`tags`、`conversation_tags`、`node_tags`、`message_tags`。
 * - 运行层：`events` 与各类 event payload 表。
 */
export const SQLITE_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
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
    enabled INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_tags (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (node_id, tag_id)
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
    metadata_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS message_tags (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, tag_id)
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
  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
  CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag ON conversation_tags(tag_id, conversation_id);
  CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags(tag_id, node_id);
  CREATE INDEX IF NOT EXISTS idx_message_tags_tag ON message_tags(tag_id, message_id);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id, edge_type);
  CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_event_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
`;
