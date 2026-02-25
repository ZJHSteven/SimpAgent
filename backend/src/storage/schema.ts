/**
 * 本文件作用：
 * - 存放 SQLite 建表 SQL。
 * - 将 schema 与业务逻辑分离，便于后续迁移维护。
 *
 * 教学说明：
 * - 首版使用 SQLite + JSON 文本字段，是为了快速迭代配置与 Trace 结构。
 * - 后续若性能/查询复杂度提升，可再拆更细字段或迁移到 PostgreSQL。
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(agent_id, version)
);

CREATE TABLE IF NOT EXISTS prompt_blocks (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_block_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(block_id, version)
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workflow_id, version)
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tool_id, version)
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_node_id TEXT,
  snapshot_version_refs_json TEXT NOT NULL,
  provider_config_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_run_id TEXT,
  parent_checkpoint_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS run_threads (
  thread_id TEXT PRIMARY KEY,
  latest_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_checkpoints_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  run_id TEXT,
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_thread ON run_checkpoints_index(thread_id);

CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT,
  agent_id TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT,
  timestamp TEXT NOT NULL,
  UNIQUE(run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_trace_run_seq ON trace_events(run_id, seq);

CREATE TABLE IF NOT EXISTS prompt_compiles (
  compile_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider_api_type TEXT NOT NULL,
  prompt_trace_json TEXT NOT NULL,
  final_messages_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  trace_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  run_id TEXT,
  patch_kind TEXT NOT NULL,
  operator TEXT,
  reason TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fork_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_run_id TEXT NOT NULL,
  parent_checkpoint_id TEXT NOT NULL,
  child_run_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  operator TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_sessions (
  session_id TEXT PRIMARY KEY,
  connected_at TEXT NOT NULL,
  disconnected_at TEXT,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  operator TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);
`;

