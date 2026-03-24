# 统一图谱与统一 Schema 设计 v0.1

## 1. 文档目的

本文档用于冻结 SimpAgent 框架下一阶段的核心数据模型，解决当前以下问题：

1. `Prompt / Memory / Tool / Skill / MCP / Worldbook` 的定义彼此分散，虽然运行时已经在“提示词装配”层逐步靠近统一，但持久化层仍然是分裂的。
2. 当前 `PromptUnit` 已经证明“万物可提示词化”的方向是正确的，但如果把 Tool 本体完全退化成纯文本 Prompt，又会失去执行定义、权限策略、可观测性与审计能力。
3. 当前 `packages/runtime-node` 的 SQLite schema 仍以 `agents / prompt_blocks / workflows / tools / builtin_tool_configs` 为主，适合 v0.2/v0.3 的配置式框架，但不适合后续的统一目录、层级暴露、MCP/skills/记忆统一图谱。
4. 当前 Memory 仍然只有最小接口与空实现，尚未纳入统一装配与统一存储系统。

因此，本设计的目标不是“再加几个表”，而是给框架建立一套统一的上层内容图谱模型，并明确：

- 什么东西属于统一图谱。
- 什么东西属于 PromptUnit 投影层。
- 什么东西属于末端执行载荷层。
- SQLite 应该怎么存，运行时应该怎么取，旧结构应该怎么迁移。

---

## 2. 设计总原则

### 2.1 万物进入统一图谱，但不等于万物只有一张 JSON 表

统一图谱的含义是：

- 高层目录、集合、工具组、记忆组、Prompt 集、skills 集、MCP 工作集，全部使用统一节点/边模型表达。
- 任意节点都允许被投影为 Prompt 暴露单元。
- 任意节点都允许通过父子边形成树，也允许通过关系边形成图。

统一图谱 **不** 等于：

- 所有实体都塞进一张大表一个 `payload_json` 了事。
- Tool、Memory、Prompt 不再有各自的结构。

正确做法是：

- 高层使用统一节点/边；
- 末端实体使用统一节点挂接不同载荷表；
- Prompt 投影是统一的，但执行载荷不是统一文本，而是结构化定义。

### 2.2 树是图的特例

本框架中的绝大多数“工作集/目录/集合”关系，本质上是父子关系，可以直接用树表达。

但是以下情况必须允许图关系：

- 一个记忆同时属于多个集合。
- 一个工具既属于某个通用工具集，也属于某个场景工作流集合。
- 一个 skill 同时关联多个 Prompt 或多个工具。
- MCP 工作集与本地 skills、Prompt 目录、记忆集合发生横向引用。

因此设计上：

- 默认优先用 `parent_of / child_of` 形成树。
- 当需要交叉引用时，再用 `related_to / depends_on / aliases / uses / derives_from` 等图边。

### 2.3 PromptUnit 是统一暴露单位，不是唯一存储本体

统一图谱中的任意节点，最终都可以投影为 Prompt 暴露单元，这是为了实现：

- 渐进式暴露；
- 短描述/长描述切换；
- 命中后展开；
- 世界书、记忆、skills、工具目录共用一套装配逻辑。

但 Tool 节点不能只有 Prompt 投影，还必须保留：

- 输入 schema；
- 执行后端；
- 权限策略；
- 工作目录策略；
- 超时；
- 可观测性与副作用记录。

### 2.4 默认采用 Zero Trust

统一图谱中只要某个节点带有可执行载荷，就必须默认走 Zero Trust：

- 不在规则里明示放行的命令，不默认执行。
- 不在规则里明示允许的路径，不默认读写。
- 不在规则里明示允许的网络，不默认访问。
- 不在策略中显式允许的工具，不默认暴露给 Agent。

后续权限模型将以 `deny / ask / allow` 为主，不在本文件深入展开权限细则，但 schema 设计必须预留对应字段与规则挂点。

---

## 3. 统一图谱的概念分层

统一图谱分为四层理解：

### 3.1 图谱层

这是持久化层的统一表达，回答的是：

- 有哪些节点？
- 节点之间如何组织？
- 节点之间有什么关系？

### 3.2 暴露层

这是运行时暴露给模型看的内容层，回答的是：

- 当前轮次先给模型看哪些节点？
- 是只暴露名称？
- 还是暴露短描述？
- 还是命中后才展开长描述？

### 3.3 载荷层

这是节点所附带的具体内容或执行定义，回答的是：

- 这是普通 Prompt 文本？
- 还是 Memory 内容？
- 还是 Tool 的输入输出 schema？
- 还是某个 MCP 工作集的元信息？

### 3.4 执行层

这是末端节点的执行语义，回答的是：

- 这是纯内容节点，还是可执行节点？
- 如果可执行，它走 shell、exec、builtin、MCP client，还是其他 runtime？

---

## 4. 统一节点模型

### 4.1 节点分类

统一节点先分为两大类：

1. 集合节点（Collection Node）
2. 末端节点（Leaf / Payload Node）

集合节点主要负责组织结构，本身一般不直接执行。

末端节点主要承载最终内容或执行载荷。

### 4.2 建议的节点类型枚举

建议新增统一节点类型枚举 `CatalogNodeKind`：

```ts
type CatalogNodeKind =
  | "collection"
  | "prompt_unit"
  | "memory_entry"
  | "tool"
  | "skill"
  | "mcp_server"
  | "mcp_tool"
  | "worldbook_entry"
  | "artifact"
  | "tag"
  | "alias";
```

说明：

- `collection`：高层集合节点，工具集、记忆集、Prompt 集、场景集都可以用它。
- `prompt_unit`：显式 Prompt 节点。
- `memory_entry`：记忆节点。
- `tool`：统一末端工具节点。
- `skill`：skills 节点，本质上是内容节点，可选带执行挂载。
- `mcp_server`：MCP 工作集节点。
- `mcp_tool`：某个 MCP 服务器下的具体工具节点。
- `worldbook_entry`：世界书条目，可视作记忆的一个偏特化分类。
- `artifact`：文档、素材、模板、截图等可引用内容。
- `tag` / `alias`：辅助分类或别名节点。

### 4.3 节点通用字段

所有节点建议共享以下字段：

```ts
interface CatalogNode {
  nodeId: string;
  projectId: string;
  kind: CatalogNodeKind;
  name: string;
  title?: string;
  shortDescription?: string;
  longDescription?: string;
  visibility: "visible" | "hidden" | "internal";
  exposePolicy: "name_only" | "short_first" | "long_direct" | "manual";
  enabled: boolean;
  version: number;
  tags?: string[];
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}
```

字段语义：

- `name`：稳定标识名，偏程序引用。
- `title`：展示标题，偏 UI。
- `shortDescription`：用于首层暴露的短描述。
- `longDescription`：用于命中后展开的正文说明。
- `visibility`：是否默认可见。
- `exposePolicy`：暴露策略，决定首轮暴露什么。
- `metadata`：保留扩展位，但不能取代正式载荷表。

### 4.4 集合节点的语义

集合节点本身不需要复杂专属载荷，只需要：

- 是否允许展开；
- 默认展开层级；
- 展开后的排序策略；
- 是否允许混合子类型。

因此集合节点可用 `node_payloads` 或 `collection_payloads` 记录简单控制字段，例如：

```json
{
  "allowMixedChildren": true,
  "defaultExpandDepth": 1,
  "sortMode": "manual"
}
```

---

## 5. 统一边模型

### 5.1 边分类

建议统一边类型枚举 `CatalogEdgeKind`：

```ts
type CatalogEdgeKind =
  | "parent_of"
  | "belongs_to"
  | "related_to"
  | "depends_on"
  | "uses"
  | "derives_from"
  | "aliases"
  | "references"
  | "expands_to"
  | "triggered_by";
```

### 5.2 父子边与关系边的使用规则

- `parent_of`：默认树结构边，用于目录、集合、上下级归属。
- `belongs_to`：某节点归属于某集合，但不一定以主树结构体现。
- `related_to`：泛关联。
- `depends_on`：依赖关系，适合工具、Prompt、skills、工作流节点。
- `uses`：某 skill / tool / prompt 使用了另一个节点。
- `derives_from`：从模板、原型或外部来源派生。
- `aliases`：别名。
- `references`：引用内容。
- `expands_to`：命中某节点后，推荐展开某子节点。
- `triggered_by`：触发关系。

### 5.3 边字段

```ts
interface CatalogEdge {
  edgeId: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: CatalogEdgeKind;
  enabled: boolean;
  sortOrder?: number;
  weight?: number;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}
```

说明：

- `sortOrder` 主要给父子结构排序。
- `weight` 主要给图关系排序或打分。

---

## 6. 末端载荷模型

统一图谱的关键点在于：**所有节点共享上层结构，但末端节点的业务载荷分表存储。**

### 6.1 Prompt 载荷

适用于：

- `prompt_unit`
- `skill` 的文本正文
- 可被投影成 Prompt 的集合展开说明

```ts
interface PromptPayload {
  nodeId: string;
  role?: "system" | "developer" | "user" | "assistant" | "tool";
  insertionPoint?: string;
  template: string;
  variablesSchema?: JsonObject;
  tokenLimit?: number;
  priority?: number;
  trigger?: JsonObject;
}
```

### 6.2 Memory 载荷

适用于：

- `memory_entry`
- `worldbook_entry`

```ts
interface MemoryPayload {
  nodeId: string;
  memoryType: "fact" | "summary" | "persona" | "worldbook" | "episodic" | "semantic";
  content: string;
  summary?: string;
  namespace?: string;
  source?: string;
  freshnessScore?: number;
  confidenceScore?: number;
  embeddingRef?: string;
  trigger?: JsonObject;
}
```

### 6.3 Tool 载荷

适用于：

- `tool`
- `mcp_tool`
- `skill` 的可执行变体

```ts
interface ToolPayload {
  nodeId: string;
  toolKind: "builtin" | "shell" | "exec" | "mcp" | "skill" | "http" | "plugin" | "user_defined";
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  backendRefId?: string;
  timeoutMs?: number;
  workingDirPolicy?: JsonObject;
  permissionProfileId?: string;
  executionConfig?: JsonObject;
}
```

### 6.4 Skill 载荷

`skill` 节点建议拆成两部分：

- 文本正文走 Prompt 载荷；
- 若可执行，则再挂 Tool 载荷。

也就是说 skill 不需要单独发明一套完全不同的结构，它是：

- 一个节点；
- 一份 Prompt 正文；
- 可选一份 Tool 执行载荷。

### 6.5 MCP 载荷

MCP 建议区分：

- `mcp_server`：工作集节点
- `mcp_tool`：具体工具节点

`mcp_server` 载荷：

```ts
interface McpServerPayload {
  nodeId: string;
  serverName: string;
  transport: "stdio" | "http" | "ws" | "custom";
  clientConfig?: JsonObject;
  source?: string;
}
```

`mcp_tool` 载荷：

- 共享 Tool 载荷
- 额外记录 MCP 原始字段

```ts
interface McpToolPayload {
  nodeId: string;
  serverNodeId: string;
  originalToolName: string;
  originalDescription?: string;
  originalSchema?: JsonObject;
  executionMode: "prompt_plus_shell" | "prompt_plus_exec" | "direct_client";
}
```

---

## 7. Prompt 投影模型

### 7.1 为什么要做 Prompt 投影

统一图谱不是直接喂给模型的。模型看到的必须是经过裁剪、排序、策略控制后的 Prompt 暴露。

因此新增一个运行时概念：

```ts
interface GraphPromptProjection {
  projectionId: string;
  nodeId: string;
  exposeLevel: "name" | "short" | "long" | "payload";
  renderedTitle?: string;
  renderedText: string;
  sourceKind: CatalogNodeKind;
  metadata?: JsonObject;
}
```

### 7.2 暴露规则

建议默认规则如下：

1. 集合节点：
- 首轮优先暴露 `name + shortDescription`
- 没有 `shortDescription` 时，按策略决定是只暴露名称还是直接暴露 `longDescription`

2. Prompt / Memory 节点：
- 默认可直接投影为 PromptUnit

3. Tool / Skill / MCP 节点：
- 首轮暴露 `name + shortDescription`
- 命中后再暴露 `longDescription`
- 若需要执行，再进入末端执行流程

### 7.3 与现有 PromptUnit 的关系

现有 `PromptUnit` 不应删除，而应作为“最终装配时的统一中间体”保留。

新的关系是：

```text
CatalogNode / Edge
  -> GraphPromptProjection
  -> PromptUnit
  -> PromptAssemblyPlan
  -> finalMessages
```

---

## 8. SQLite Schema 设计

以下 schema 是本阶段建议的 v0.1 新结构，后续实现时可先新增，不要立刻破坏旧表。

### 8.1 节点表

```sql
CREATE TABLE IF NOT EXISTS catalog_nodes (
  node_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  short_description TEXT,
  long_description TEXT,
  visibility TEXT NOT NULL DEFAULT 'visible',
  expose_policy TEXT NOT NULL DEFAULT 'short_first',
  enabled INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  tags_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_nodes_project_kind
  ON catalog_nodes(project_id, kind);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_nodes_project_name
  ON catalog_nodes(project_id, name);
```

### 8.2 边表

```sql
CREATE TABLE IF NOT EXISTS catalog_edges (
  edge_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER,
  weight REAL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_edges_from
  ON catalog_edges(project_id, from_node_id, kind, sort_order);

CREATE INDEX IF NOT EXISTS idx_catalog_edges_to
  ON catalog_edges(project_id, to_node_id, kind);
```

### 8.3 Prompt 载荷表

```sql
CREATE TABLE IF NOT EXISTS catalog_prompt_payloads (
  node_id TEXT PRIMARY KEY,
  role TEXT,
  insertion_point TEXT,
  template_text TEXT NOT NULL,
  variables_schema_json TEXT,
  token_limit INTEGER,
  priority INTEGER,
  trigger_json TEXT,
  updated_at TEXT NOT NULL
);
```

### 8.4 Memory 载荷表

```sql
CREATE TABLE IF NOT EXISTS catalog_memory_payloads (
  node_id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  content_text TEXT NOT NULL,
  summary_text TEXT,
  namespace TEXT,
  source TEXT,
  freshness_score REAL,
  confidence_score REAL,
  embedding_ref TEXT,
  trigger_json TEXT,
  updated_at TEXT NOT NULL
);
```

### 8.5 Tool 载荷表

```sql
CREATE TABLE IF NOT EXISTS catalog_tool_payloads (
  node_id TEXT PRIMARY KEY,
  tool_kind TEXT NOT NULL,
  input_schema_json TEXT,
  output_schema_json TEXT,
  backend_ref_id TEXT,
  timeout_ms INTEGER,
  working_dir_policy_json TEXT,
  permission_profile_id TEXT,
  execution_config_json TEXT,
  updated_at TEXT NOT NULL
);
```

### 8.6 MCP Server 载荷表

```sql
CREATE TABLE IF NOT EXISTS catalog_mcp_server_payloads (
  node_id TEXT PRIMARY KEY,
  server_name TEXT NOT NULL,
  transport TEXT NOT NULL,
  client_config_json TEXT,
  source TEXT,
  updated_at TEXT NOT NULL
);
```

### 8.7 MCP Tool 载荷表

```sql
CREATE TABLE IF NOT EXISTS catalog_mcp_tool_payloads (
  node_id TEXT PRIMARY KEY,
  server_node_id TEXT NOT NULL,
  original_tool_name TEXT NOT NULL,
  original_description TEXT,
  original_schema_json TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'prompt_plus_shell',
  updated_at TEXT NOT NULL
);
```

### 8.8 暴露快照表（可选）

如果后续需要审计“某轮到底向模型暴露了哪些图谱节点”，建议增加：

```sql
CREATE TABLE IF NOT EXISTS graph_prompt_projections (
  projection_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  expose_level TEXT NOT NULL,
  rendered_text TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

### 8.9 统一版本/审计（建议沿用现有 audit_logs）

现有 `audit_logs` 可以继续复用，不急着重造。

---

## 9. 与现有结构的映射关系

### 9.1 PromptBlock / PromptUnit

当前：

- `prompt_blocks`
- `prompt_block_versions`

未来映射：

- `prompt_blocks` -> `catalog_nodes(kind='prompt_unit')`
- `prompt_block_versions.payload_json.template` -> `catalog_prompt_payloads.template_text`

迁移策略：

- 首阶段保留旧表读取兼容；
- 新写入优先落新图谱表；
- 提供兼容视图或兼容读取函数。

### 9.2 ToolSpec / BuiltinToolConfig

当前：

- `tools`
- `tool_versions`
- `builtin_tool_configs`

未来映射：

- `tools` -> `catalog_nodes(kind='tool')`
- `tool_versions.payload_json` -> `catalog_tool_payloads`
- `builtin_tool_configs` 暂时保留，后续可映射成某类系统级 Tool 覆写规则

说明：

- builtin tool 不是要立刻消失，而是后续可以视作“系统预装末端 Tool 节点 + 项目级覆写配置”。

### 9.3 Memory

当前：

- 只有接口，没有正式存储结构。

未来映射：

- 新增 `catalog_nodes(kind='memory_entry' | 'worldbook_entry')`
- 内容进入 `catalog_memory_payloads`

### 9.4 MCP / skills

当前：

- MCP 仍主要停留在 CanonicalToolRouteTarget / 未实现执行分支。
- skills 主要还是外部文档与 prompt 注入思路。

未来映射：

- `mcp_server` / `mcp_tool` 节点正式入图谱。
- `skill` 节点正式入图谱。
- 统一通过 Prompt 投影层控制暴露与命中展开。

---

## 10. 运行时读取策略

### 10.1 启动时

`runtime-node` 启动时应加载：

- 当前 project 的图谱节点；
- 当前 project 的图谱边；
- 必要的 Prompt/Tool/Memory/MCP payload；
- 旧表兼容数据。

### 10.2 编译 Prompt 时

PromptCompiler 不再只接收 `PromptBlock[]`，后续应支持：

```text
Catalog Graph
  -> 按 Agent / Workflow / Context 筛选相关节点
  -> 按 exposePolicy 决定暴露级别
  -> 投影成 GraphPromptProjection
  -> 转为 PromptUnit
```

### 10.3 执行 Tool 时

工具执行不能直接依赖 Prompt 文本，而应由末端 `catalog_tool_payloads` 提供：

- `tool_kind`
- `input_schema`
- `execution_config`
- `permission_profile`

然后再由运行时根据 `tool_kind` 路由到：

- shell/exec
- builtin
- mcp adapter
- skill runtime
- user-defined runtime

---

## 11. 为什么 MCP 默认走 prompt + shell/exec

本轮设计采纳当前主线决策：

- MCP 不以 function-style 作为默认主路线。
- MCP 默认主路线是：
  - `mcp_server / mcp_tool` 进入统一图谱；
  - 首轮只暴露名称/短描述；
  - 命中后暴露长描述或详细说明；
  - 真正执行时走 shell/exec 或专用 client。

这样做的好处：

1. 统一纳入 PromptUnit 管控。
2. 与 skills、记忆、世界书暴露逻辑一致。
3. 更容易做层级化暴露与审计。
4. 更容易接入统一权限模型。

这样做的代价：

1. 需要补一层“图谱节点 -> Prompt 投影 -> 命中 -> 执行”的中间态。
2. 需要构建明确的末端执行载荷，而不能只靠 MCP 原始 schema。

---

## 12. 为什么 Tool 仍然要保留 schema

虽然本轮主路线不以 function-style 为默认，但 Tool 节点仍然必须保留 `input_schema / output_schema`：

1. schema 是工具自身契约，不等于 function-style。
2. 即便最终走 shell/exec，也要靠 schema 约束参数结构、校验与 UI。
3. MCP 原始 schema、用户自定义工具 schema、skills 执行载荷，本质上都需要统一契约层。
4. 后续若某类工具确实适合 function-style，可以无缝切回兼容层。

因此本设计强调：

- **主暴露路线** 可以是 prompt + shell/exec；
- **底层工具契约** 仍保留 schema。

---

## 13. 实施顺序建议

### 阶段 A：只加新结构，不拆旧结构

本阶段只做：

- 新增图谱表；
- 新增统一节点/边/载荷契约；
- 新增读取与写入 API；
- 不删除旧 `prompt_blocks / tools` 表。

### 阶段 B：增加兼容映射

- 旧 PromptUnit / ToolSpec 继续能跑；
- 新结构开始成为新功能主来源；
- 运行时双读或映射。

### 阶段 C：让 PromptCompiler 接图谱

- 开始从图谱节点生成 Prompt 投影；
- 旧 PromptBlock 编译路径逐步退居兼容层。

### 阶段 D：让 Tool Runtime 接统一末端节点

- 统一 `tool_kind`
- 统一权限与执行策略
- 把 MCP / skills 正式纳入执行链路

---

## 14. 本文档对应的直接产出

本文档冻结以下事项，后续实现应以此为基线：

1. 统一图谱采用“节点 + 边 + 末端载荷表”模型。
2. Prompt / Memory / Tool / Skill / MCP 都进入同一图谱。
3. PromptUnit 是统一投影层，不是唯一存储本体。
4. Tool 节点必须保留结构化 schema 与执行定义。
5. SQLite 新增 `catalog_nodes / catalog_edges / catalog_*_payloads` 系列表。
6. 旧表先兼容，不做破坏性迁移。

---

## 15. 下一步实现入口

基于本文档，后续实现顺序建议为：

1. 在 `packages/core/src/types/contracts.ts` 新增统一图谱契约。
2. 在 `packages/runtime-node/src/storage/schema.ts` 新增图谱表 DDL。
3. 在 `packages/runtime-node/src/storage/db.ts` 增加图谱 CRUD。
4. 设计图谱节点到 `PromptUnit` 的投影器。
5. 再进入 Shell/Exec 权限模型与 MCP/skills 适配实现。
