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

/**
 * v0.3：内置工具运行配置（原先为内存态，重启即丢失）。
 * 说明：
 * - 采用 project_id 维度隔离，便于未来 learning / trpg / dev-console 分项目共存。
 * - payload_json 保留完整 BuiltinToolConfig 结构，先保证可回放与可扩展。
 */
CREATE TABLE IF NOT EXISTS builtin_tool_configs (
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, name)
);

/**
 * v0.3：系统级调试设置（模型默认路由、窗口、日志上限等）。
 */
CREATE TABLE IF NOT EXISTS system_configs (
  project_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/**
 * v0.4：统一图谱主表。
 * 说明：
 * - 统一存放 Prompt / Memory / Tool / Skill / MCP / Worldbook 等定义层节点；
 * - 树结构优先直接使用 parent_node_id 表示。
 */
CREATE TABLE IF NOT EXISTS catalog_nodes (
  node_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  parent_node_id TEXT,
  node_class TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  summary_text TEXT,
  content_text TEXT,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  primary_kind TEXT NOT NULL DEFAULT 'generic',
  visibility TEXT NOT NULL DEFAULT 'visible',
  expose_mode TEXT NOT NULL DEFAULT 'summary_first',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_nodes_project_parent
  ON catalog_nodes(project_id, parent_node_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_nodes_project_kind
  ON catalog_nodes(project_id, primary_kind);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_nodes_project_name
  ON catalog_nodes(project_id, name);

/**
 * v0.4：图谱横向关系表。
 * 说明：
 * - 只承载横向图关系；
 * - 父子树结构不走这里。
 */
CREATE TABLE IF NOT EXISTS catalog_relations (
  relation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  weight REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_relations_from
  ON catalog_relations(project_id, from_node_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_catalog_relations_to
  ON catalog_relations(project_id, to_node_id, relation_type);

/**
 * v0.4：节点 facet 表。
 * 说明：
 * - Prompt / Memory / Tool / Integration 这些附加能力统一走 facet；
 * - 首版先使用 payload_json 快速收口。
 */
CREATE TABLE IF NOT EXISTS catalog_node_facets (
  facet_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  facet_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id, facet_type)
);

CREATE INDEX IF NOT EXISTS idx_catalog_node_facets_node
  ON catalog_node_facets(node_id, facet_type);

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

/**
 * v0.2：节点级状态差异（用于调试器快速查看，不把整份 state 塞进 trace）。
 */
CREATE TABLE IF NOT EXISTS state_diffs (
  diff_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  node_id TEXT,
  agent_id TEXT,
  before_summary_json TEXT,
  after_summary_json TEXT,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_state_diffs_run_id ON state_diffs(run_id, created_at);

/**
 * v0.2：统一副作用记录（工具执行 / 文件读写 / 网络请求 / 计划更新 / 用户输入等）。
 */
CREATE TABLE IF NOT EXISTS side_effects (
  side_effect_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  node_id TEXT,
  agent_id TEXT,
  effect_type TEXT NOT NULL,
  target TEXT,
  summary TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_side_effects_run_id ON side_effects(run_id, created_at);

/**
 * v0.2：记录每轮工具暴露计划（用于排查“为什么这轮没暴露某工具”）。
 */
CREATE TABLE IF NOT EXISTS tool_exposure_plans (
  plan_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  node_id TEXT,
  agent_id TEXT,
  adapter_kind TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_exposure_plans_run_id ON tool_exposure_plans(run_id, created_at);

/**
 * v0.2：run 内部计划状态（由 update_plan 内置工具维护）。
 */
CREATE TABLE IF NOT EXISTS run_plans (
  run_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

/**
 * v0.2：request_user_input 工具请求记录（中断/恢复关联）。
 */
CREATE TABLE IF NOT EXISTS user_input_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  node_id TEXT,
  agent_id TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  answer_json TEXT,
  requested_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_input_requests_run_id ON user_input_requests(run_id, requested_at);

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
