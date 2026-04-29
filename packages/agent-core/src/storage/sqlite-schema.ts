/**
 * 本文件保存 SimpAgent 的 SQLite schema。
 *
 * 重要约定：
 * - `docs/SQLite表结构.md` 是人类可读真源，改这里之前必须先改文档。
 * - 顶层身份统一在 `nodes`，关系统一在 `edges`。
 * - 本 schema 不创建 `graphs`、`runs`、`turns` 表。
 * - tag 是 `nodes.node_type = 'tag'`，绑定关系走 `edges.edge_type = 'has_tag'`。
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
 * - 顶层表只有 `nodes` 和 `edges`。
 * - conversation / event / message / agent / prompt unit 等实体都是 node payload 分表。
 * - edge 建 source 和 target 两侧索引，因为图查询会频繁正查和反查。
 */
export const SQLITE_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    name TEXT,
    description TEXT,
    enabled INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,
    name TEXT,
    description TEXT,
    enabled INTEGER NOT NULL,
    condition_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    entry_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS agent_nodes (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    prompt_bonding_json TEXT NOT NULL,
    tool_policy_json TEXT,
    provider_strategy_node_id TEXT REFERENCES provider_strategies(node_id) ON DELETE SET NULL,
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
    variables_json TEXT
  );

  CREATE TABLE IF NOT EXISTS provider_strategies (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    strategy_json TEXT,
    parameters_json TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    conversation_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    input_json TEXT,
    output_json TEXT,
    error_json TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    conversation_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    event_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    parent_message_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    role TEXT NOT NULL,
    content_json TEXT NOT NULL,
    tool_call_id TEXT,
    name TEXT,
    selector_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_compilations (
    event_node_id TEXT PRIMARY KEY REFERENCES events(node_id) ON DELETE CASCADE,
    agent_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    input_json TEXT NOT NULL,
    assembly_plan_json TEXT,
    rendered_messages_json TEXT NOT NULL,
    trace_json TEXT
  );

  CREATE TABLE IF NOT EXISTS llm_calls (
    event_node_id TEXT PRIMARY KEY REFERENCES events(node_id) ON DELETE CASCADE,
    provider_strategy_node_id TEXT REFERENCES provider_strategies(node_id) ON DELETE SET NULL,
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
    event_node_id TEXT PRIMARY KEY REFERENCES events(node_id) ON DELETE CASCADE,
    tool_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    provider_tool_call_id TEXT,
    tool_name TEXT NOT NULL,
    arguments_json TEXT,
    arguments_text TEXT NOT NULL,
    result_json TEXT,
    ok INTEGER
  );

  CREATE TABLE IF NOT EXISTS tool_approvals (
    event_node_id TEXT PRIMARY KEY REFERENCES events(node_id) ON DELETE CASCADE,
    tool_call_event_node_id TEXT NOT NULL REFERENCES events(node_id) ON DELETE CASCADE,
    risk_summary TEXT NOT NULL,
    decision TEXT,
    reason TEXT,
    requested_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS side_effects (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    conversation_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    event_node_id TEXT NOT NULL REFERENCES events(node_id) ON DELETE CASCADE,
    effect_type TEXT NOT NULL,
    target TEXT,
    summary TEXT,
    details_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runtime_logs (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    conversation_node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    event_node_id TEXT REFERENCES events(node_id) ON DELETE SET NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
  CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(node_type, name);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id, edge_type);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id, edge_type);
  CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_node_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_node_id, created_at);
`;
