# 统一图谱与统一 Schema 设计 v0.1（简化收敛版）

## 1. 文档目的

这份文档用于把“统一图谱”收敛到一个更简单、可落地、可逐步迁移的版本。

当前仓库里已经有两类 SQLite 数据：

1. 定义层：
   - `agents`
   - `prompt_blocks`
   - `workflows`
   - `tools`
   - `builtin_tool_configs`
   - `system_configs`
2. 运行层 / 审计层：
   - `runs`
   - `trace_events`
   - `prompt_compiles`
   - `tool_calls`
   - `state_diffs`
   - `side_effects`
   - `run_plans`
   - `user_input_requests`

这次统一图谱要统一的，是“定义层”，不是把运行日志也揉进图谱。

本轮目标很明确：

- 让 `Prompt / Memory / Tool / Skill / MCP / Worldbook` 用一套统一节点模型存储。
- 支持树状目录，也支持图状引用。
- 支持“短描述给模型看，长内容按需展开”。
- 支持“有些节点只是内容，有些节点带可执行工具定义”。
- 保留工具的结构化 schema 与执行配置，不能退化为纯文本。

---

## 2. 先冻结几个核心结论

### 2.1 统一图谱只统一“定义层”，不统一“运行层”

这件事必须先说死，否则后面一定越做越乱。

统一图谱负责：

- 存什么内容；
- 怎么分组；
- 怎么被引用；
- 怎么暴露给 Agent；
- 哪些节点带工具执行能力。

统一图谱不负责：

- 一次 run 的状态；
- trace 事件流；
- tool call 历史；
- diff / side effect / user input 请求。

所以结论是：

- `catalog_*` 系列表只承载“静态定义 + 项目级配置快照”。
- `runs / trace_events / tool_calls / side_effects ...` 继续保留为运行时数据库。

### 2.2 所有节点都长一个样，差别只在“附加 facet”

你前面说的重点是对的：

- 大工具集、小工具集、最终工具节点，本质上都是节点；
- 记忆集、Prompt 集、skills 集，本质上也都是节点；
- 真正的区别只是“这个节点额外带了什么能力”。

所以这里不再坚持把节点拆成很多强类型顶层表，而采用：

- 一个统一节点主表；
- 一个图关系表；
- 一个可选 facet 表。

节点主表负责“共性”；
facet 表负责“个性”。

### 2.3 树结构是主路径，图关系是补充路径

旧文档把“所有结构都抽象成边”写得太重了。

实际上你这里 80% 以上的需求都是目录树：

- 大集 -> 小集 -> 更小集 -> 最终节点；
- MCP 工作集 -> 工具；
- Prompt 集 -> Prompt 单元；
- Memory 集 -> 记忆条目。

因此这次改成：

- 树结构直接放在节点表里：`parent_node_id + sort_order`
- 只有横向关系才走 `catalog_relations`

这样查询目录树会简单很多，也更符合实际使用方式。

### 2.4 skill 不是特殊物种，MCP 也不是特殊物种

后面统一后：

- skill = 普通节点 + Prompt facet + 可选 Tool facet
- MCP server = 普通节点（通常是 group）+ integration facet
- MCP tool = 普通节点 + Tool facet + source 信息

也就是说：

- 不再把 skill 当成一套完全独立系统；
- 不再把 MCP 单独做一整套重型专属结构；
- 都只是统一节点体系里的具体用法。

### 2.5 Tool 仍然必须保留 schema

这一点不变，而且必须继续坚持。

原因很简单：

- function-call 直通时要用；
- CodeMode 时也要做参数校验；
- 前端 UI 以后要渲染工具表单也要用；
- MCP 原始 schema、用户自定义工具 schema、技能执行参数，本质上都是契约。

所以：

- “是否 function-call 暴露”是一层策略；
- “工具有没有 schema”是工具本体属性；
- 这两件事不能混为一谈。

---

## 3. 简化后的总模型

### 3.1 三张核心表就够了

本轮建议把统一图谱的核心压缩到三张表：

1. `catalog_nodes`
   - 存所有节点的共性字段。
   - 直接表达树结构。
2. `catalog_relations`
   - 只存横向图关系。
3. `catalog_node_facets`
   - 存节点的可选附加能力。

这三张表之外，如果后续真有必要，再增补：

- 版本表；
- 暴露快照表；
- 全文索引表；
- embedding / 检索索引表。

但这些都不应该成为第一阶段的阻碍。

### 3.2 节点长什么样

```ts
type CatalogNodeClass = "group" | "item";

type CatalogExposeMode =
  | "hidden"
  | "summary_only"
  | "summary_first"
  | "content_direct"
  | "manual";

interface CatalogNode {
  nodeId: string;
  projectId: string;
  parentNodeId?: string | null;
  nodeClass: CatalogNodeClass;
  name: string;
  title?: string;
  summaryText?: string;
  contentText?: string;
  contentFormat?: "markdown" | "plain_text" | "json";
  primaryKind?: "generic" | "prompt" | "memory" | "tool" | "skill" | "mcp" | "worldbook";
  visibility: "visible" | "internal" | "hidden";
  exposeMode: CatalogExposeMode;
  enabled: boolean;
  sortOrder: number;
  tags?: string[];
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}
```

字段解释：

- `parentNodeId`：
  - 用来直接表示树；
  - 比“什么都走 edge”更直观。
- `summaryText`：
  - 给 Agent 首轮暴露看的短描述；
  - 对应你说的 `description` 那一类东西。
- `contentText`：
  - 节点正文；
  - 可以是 Prompt 正文、记忆正文、技能正文、工具详细说明。
- `primaryKind`：
  - 只是 UI / 查询辅助标签；
  - 不是强类型分表开关；
  - 真正能力看 facet，不看这个字段。

### 3.3 facet 长什么样

```ts
type CatalogFacetType = "prompt" | "memory" | "tool" | "integration";

interface CatalogNodeFacet {
  facetId: string;
  nodeId: string;
  facetType: CatalogFacetType;
  payload: JsonObject;
  updatedAt: string;
}
```

核心思想：

- 一个节点可以没有 facet，只当目录或纯内容节点；
- 一个节点也可以同时挂多个 facet；
- skill 最典型的例子就是：
  - 同时有 `prompt` facet；
  - 也可能再挂一个 `tool` facet。

### 3.4 图关系长什么样

```ts
type CatalogRelationType =
  | "reference"
  | "use"
  | "depend_on"
  | "alias"
  | "expand"
  | "belong_to"
  | "trigger";

interface CatalogRelation {
  relationId: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: CatalogRelationType;
  weight?: number;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}
```

注意：

- 父子关系不再放这里；
- 这里只有“横向关系”。

---

## 4. 四类 facet 的建议载荷

### 4.1 Prompt facet

用于：

- Prompt 单元；
- skill 正文；
- 某些目录节点的展开说明；
- 某些工具节点的人工使用说明。

```ts
interface PromptFacetPayload {
  role?: "system" | "developer" | "user" | "assistant" | "tool";
  insertionPoint?:
    | "system_pre"
    | "system_post"
    | "developer"
    | "task_pre"
    | "task_post"
    | "memory_context"
    | "tool_context";
  variablesSchema?: JsonObject;
  tokenLimit?: number;
  priority?: number;
  trigger?: JsonObject;
}
```

说明：

- 具体正文不放 facet 里，直接放 `catalog_nodes.content_text`；
- 这样“所有节点都有短描述与正文”就能成立；
- Prompt facet 只补 Prompt 编译所需的结构化信息。

### 4.2 Memory facet

用于：

- 事实记忆；
- 人设；
- 世界书；
- 摘要记忆；
- 情节记忆。

```ts
interface MemoryFacetPayload {
  memoryType: "fact" | "summary" | "persona" | "worldbook" | "episodic" | "semantic";
  namespace?: string;
  source?: string;
  freshnessScore?: number;
  confidenceScore?: number;
  embeddingRef?: string;
  trigger?: JsonObject;
}
```

说明：

- 记忆正文仍然放 `content_text`；
- Memory facet 只保存记忆检索与分类元数据。

### 4.3 Tool facet

用于：

- 内置工具；
- 用户自定义工具；
- MCP 工具；
- 带执行能力的 skill；
- 以后可能的 plugin / http / exec 节点。

```ts
interface ToolFacetPayload {
  toolKind: "builtin" | "shell" | "exec" | "mcp" | "skill" | "http" | "plugin" | "user_defined";
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  executeMode?: "function_call" | "code_mode" | "direct_client";
  backendRef?: string;
  timeoutMs?: number;
  permissionProfileId?: string;
  workingDirPolicy?: JsonObject;
  executionConfig?: JsonObject;
}
```

这里最关键的几个字段：

- `inputSchema / outputSchema`
  - 工具契约；
  - 一定要保留。
- `executeMode`
  - 表示运行时怎么执行；
  - 不是暴露给模型的唯一方式。

本轮建议解释为：

- `function_call`
  - 当模型能力足够稳定时，允许把 schema 直通成 function/tool。
- `code_mode`
  - 默认主路线；
  - 模型只先看到节点的摘要/说明；
  - 真执行时通过统一 `execute` 工具或统一 runtime 路由。
- `direct_client`
  - 某些高稳定内置能力可以绕过 shell，直连专用客户端。

### 4.4 Integration facet

这个 facet 只做“来源与接入信息”，不要把它做太重。

用于：

- MCP server 配置；
- 外部资源来源；
- 远程工具注册来源。

```ts
interface IntegrationFacetPayload {
  sourceType: "mcp_server" | "mcp_tool" | "skill_bundle" | "preset" | "imported";
  serverName?: string;
  transport?: "stdio" | "http" | "ws" | "custom";
  originalName?: string;
  originalSchema?: JsonObject;
  clientConfig?: JsonObject;
}
```

说明：

- 这只是“来源信息”；
- 真正执行仍看 Tool facet；
- 真正文仍看 `content_text`。

---

## 5. 这个模型怎么覆盖你的场景

### 5.1 工具树

你举的例子：

```text
A 工具大集
  -> A1 工具小集
    -> A1.1 工具小集
      -> gamma 工具
      -> beta 工具
```

在新模型里就是：

- 每一个“集”都是 `catalog_nodes` 里的 `group` 节点；
- 最终 `gamma / beta` 也是 `catalog_nodes` 里的 `item` 节点；
- `gamma / beta` 再额外挂 `tool` facet；
- 如果要给模型看简短说明，就填 `summary_text`；
- 如果要给模型看完整用法，就填 `content_text`。

### 5.2 记忆树

同理：

```text
B 记忆大集
  -> 角色记忆
  -> 世界设定
  -> 剧情摘要
```

也是同一套节点。

区别只在于：

- 这些叶子节点通常挂的是 `memory` facet；
- 有些也可能同时挂 `prompt` facet；
- 世界书本质上只是 `memoryType = worldbook` 的一种记忆。

### 5.3 skill

skill 统一成：

- 一个普通节点；
- `summary_text` 是简介；
- `content_text` 是详细正文；
- 如果只是纯文本指导，则只挂 `prompt` facet；
- 如果还能触发执行，则再挂 `tool` facet。

### 5.4 MCP

MCP 统一成：

- server 节点通常是 `group`；
- tool 节点通常是 `item`；
- server 节点可挂 `integration` facet；
- tool 节点挂 `tool` facet；
- 如果要记录原始 schema / 原始名字，再放进 `integration` facet。

---

## 6. 对运行时的直接影响

### 6.1 Agent 首轮看到什么

默认建议：

1. 先暴露 group 节点的：
   - `name`
   - `title`
   - `summary_text`
2. 叶子节点默认也是先暴露：
   - `name`
   - `summary_text`
3. 命中后再展开：
   - `content_text`
   - 对应 facet 的额外信息

这样就能实现你要的：

- 先披露目录；
- 再下钻；
- 再执行。

### 6.2 function-call 与 CodeMode 怎么统一

统一规则建议这样定：

1. 节点是否是工具，看它有没有 `tool` facet。
2. 工具是否能 function-call 直通，看当前路由策略与模型能力。
3. 即使不走 function-call，也照样保留 `inputSchema`。

运行时大致流程：

```text
catalog_nodes
  + catalog_node_facets
  -> 生成对 Agent 可见的摘要目录
  -> 命中节点
  -> 若节点带 tool facet：
       - function-call 模式：把 inputSchema 暴露给模型
       - code_mode 模式：把说明注入上下文，执行时统一走 runtime.execute(...)
  -> 记录 side_effect / tool_call / trace
```

### 6.3 PromptUnit 在新模型里的位置

PromptUnit 继续保留，但它不再是数据库顶层本体。

新的关系应当是：

```text
catalog node
  -> 按 exposeMode / facet 生成 PromptUnit 视图
  -> PromptAssemblyPlan
  -> final messages
```

所以：

- PromptUnit 是“编译中间体”；
- catalog node 才是“统一存储本体”。

---

## 7. SQLite 建议 DDL（简化版）

### 7.1 节点表

```sql
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
```

### 7.2 图关系表

```sql
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
```

### 7.3 facet 表

```sql
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
```

### 7.4 为什么这次不再一开始就拆很多 payload 表

因为本轮最重要的是先把抽象收敛，而不是先把表拆得很“工整”。

如果一上来就拆成：

- prompt payload 表
- memory payload 表
- tool payload 表
- mcp server payload 表
- mcp tool payload 表

那么现在的问题会变成：

- 逻辑没收敛；
- 表先膨胀了；
- 迁移更难；
- 技能和 MCP 还是容易被重新特殊化。

所以第一阶段先用 facet 表收口，是更稳的做法。

后面若某类 facet 查询压力很大，再单独拆表即可。

---

## 8. 与现有 SQLite 的映射关系

### 8.1 保留不动的部分

以下表暂时不要并进统一图谱：

- `runs`
- `run_threads`
- `run_checkpoints_index`
- `trace_events`
- `prompt_compiles`
- `tool_calls`
- `state_diffs`
- `side_effects`
- `tool_exposure_plans`
- `run_plans`
- `user_input_requests`
- `audit_logs`

原因：

- 它们是运行记录，不是资源目录。

### 8.2 暂时继续保留的配置表

以下表第一阶段也先不强拆：

- `agents`
- `agent_versions`
- `workflows`
- `workflow_versions`
- `system_configs`

原因：

- 它们更接近“编排配置”；
- 不是这次最急需统一的“内容节点库”；
- 第一阶段应该让 Agent / Workflow 去引用 catalog node，而不是先把自己也塞进去。

### 8.3 重点迁移对象

第一批最值得迁移的是：

1. `prompt_blocks`
   - 转成 `catalog_nodes + prompt facet`
2. `tools`
   - 转成 `catalog_nodes + tool facet`
3. `builtin_tool_configs`
   - 先保留为“系统预装工具的项目级覆写表”
   - 后续再考虑映射成 catalog 节点覆写
4. memory / worldbook
   - 直接从无到有落在 `catalog_nodes + memory facet`
5. skills / MCP
   - 从一开始就按统一节点方案进入，不再额外造体系

---

## 9. 最小示例

### 9.1 一个“技能 + 工具 + 记忆”混合目录

```json
{
  "nodes": [
    {
      "nodeId": "group.root",
      "nodeClass": "group",
      "name": "root",
      "title": "项目根目录",
      "summaryText": "统一内容入口"
    },
    {
      "nodeId": "group.tools",
      "parentNodeId": "group.root",
      "nodeClass": "group",
      "name": "tools",
      "title": "工具目录",
      "summaryText": "可供 Agent 下钻选择的工具集合"
    },
    {
      "nodeId": "node.read_file",
      "parentNodeId": "group.tools",
      "nodeClass": "item",
      "name": "read_file",
      "title": "读取文件",
      "summaryText": "读取本地文件内容",
      "contentText": "用于读取工作区中的文件，适合查看配置、源码、文档。"
    },
    {
      "nodeId": "group.memories",
      "parentNodeId": "group.root",
      "nodeClass": "group",
      "name": "memories",
      "title": "记忆目录",
      "summaryText": "长期记忆与世界书"
    },
    {
      "nodeId": "node.world.rule1",
      "parentNodeId": "group.memories",
      "nodeClass": "item",
      "name": "world_rule_1",
      "title": "世界规则一",
      "summaryText": "魔法只能在夜间生效",
      "contentText": "在当前设定中，所有魔法效果只有在夜间才可以稳定触发。"
    },
    {
      "nodeId": "node.skill.review",
      "parentNodeId": "group.root",
      "nodeClass": "item",
      "name": "review_skill",
      "title": "代码审查技能",
      "summaryText": "发现 bug、风险和测试缺口",
      "contentText": "优先找行为回归、边界缺陷、缺失测试，不先做风格润色。"
    }
  ],
  "facets": [
    {
      "nodeId": "node.read_file",
      "facetType": "tool",
      "payload": {
        "toolKind": "builtin",
        "inputSchema": {
          "type": "object",
          "properties": {
            "path": { "type": "string" }
          },
          "required": ["path"]
        },
        "executeMode": "function_call"
      }
    },
    {
      "nodeId": "node.world.rule1",
      "facetType": "memory",
      "payload": {
        "memoryType": "worldbook"
      }
    },
    {
      "nodeId": "node.skill.review",
      "facetType": "prompt",
      "payload": {
        "role": "developer",
        "insertionPoint": "developer"
      }
    }
  ]
}
```

这个例子体现了一个关键事实：

- 三种完全不同用途的东西；
- 仍然可以落到同一个节点结构里；
- 区别只在 facet。

---

## 10. 实施顺序建议

### 阶段 A：先冻结抽象，不急着改运行时

本阶段只做：

1. 文档冻结。
2. `packages/core/src/types/contracts.ts` 增加 catalog 契约。
3. `packages/runtime-node/src/storage/schema.ts` 增加三张新表。
4. `packages/runtime-node/src/storage/db.ts` 增加 CRUD。

### 阶段 B：先接 Prompt 与 Tool，再接 Memory

顺序建议：

1. 先把 `prompt_blocks` 映射成 catalog node。
2. 再把 `tools` 映射成 catalog node。
3. 再接 `builtin_tool_configs` 的覆写逻辑。
4. 最后再把 memory / worldbook / skill / MCP 正式接入。

原因：

- Prompt 和 Tool 已经有现成表与运行逻辑；
- 迁移成本最低；
- 能最快验证“统一节点模型是不是顺手”。

### 阶段 C：再做 Prompt 投影

PromptCompiler 后续应改成：

```text
catalog nodes
  -> 按 parent / relation / facet 筛选
  -> 生成 PromptUnit 视图
  -> 进入 PromptAssemblyPlan
```

### 阶段 D：最后再统一 CodeMode 执行链

等节点系统稳定后，再继续做：

- CodeMode 风格工具暴露；
- 统一 execute runtime；
- Shell / Exec 权限内核；
- MCP / skill 执行接入。

---

## 11. 本轮冻结结论

本轮正式冻结以下结论：

1. 统一图谱只统一“定义层”，不合并运行日志与 trace。
2. 节点统一为一张主表，所有节点共用同一外形。
3. 树结构优先用 `parent_node_id`，横向引用才走关系表。
4. 节点的差异不靠很多顶层 node type 分裂，而靠 facet。
5. 最小核心结构收敛为：
   - `catalog_nodes`
   - `catalog_relations`
   - `catalog_node_facets`
6. `summary_text` 与 `content_text` 成为统一的“短描述 / 正文”承载字段。
7. Tool 只是在节点上额外挂一个 `tool` facet，但必须保留 schema。
8. skill / MCP / memory / prompt 都不再额外发明平行存储体系。

这版比旧版更适合马上开始写代码，也更贴近你当前真正想要的“大统一目录 + 渐进披露 + 按需执行”目标。
