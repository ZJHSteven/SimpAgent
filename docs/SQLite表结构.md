# SQLite 表结构

本文档是 SimpAgent SQLite 持久化结构的人类可读真源。任何代码层面的 schema 改动，必须先更新本文档。

## 总体原则

- 顶层关系只有两类：`nodes` 和 `edges`。
- `nodes` 保存统一身份。conversation、event、message、agent、tool、prompt unit、provider strategy、workflow、memory、tag 都先是 node。
- 类型专属字段放在 node payload 分表。例如 conversation 专属字段放在 `conversations`，event 专属字段放在 `events`。
- `edges` 保存 node 与 node 之间的关系。tag 绑定、workflow 边界、workflow 顺序、handoff、prompt 绑定、模型绑定都走 edge。
- graph 不单独建真源表。固定工作流、动态 handoff、tag 绑定和前端子图加载都从 `nodes + edges` 查询得到。
- 不建立 `runs` / `turns` 表。一次模型请求、一次工具调用、一次提示词编译、一次 handoff 都是 event node。
- tag 是人工标注，不是自动分类结果。运行时不得默认给 conversation、event、message、tool call 自动写 tag。

## ID 规则

- 内部主键统一使用 UUID v7。
- `id` 只负责唯一身份，不承载语义。
- `name`、`description` 和人工 tag 才承载人类可读语义。
- `nodes.name` 可以为空。日志型 node，例如 event/message，不一定有稳定名称。
- 厂商返回的 `tool_call_id`、HTTP `x-request-id` 等外部协议 ID 不能混用为内部主键，只能保存在外部 ID 字段里。
- `metadata_json` 只保存非查询型补充信息，不能保存完整旧 thread 快照、旧 JSON trace 快照或其它兼容层大对象。

## 顶层表

### `nodes`

统一节点身份表。所有可被图谱引用、tag 标注、前端加载或日志追踪的实体都先进入本表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | TEXT PRIMARY KEY | 是 | node 的 UUID v7。 |
| `node_type` | TEXT | 是 | 节点类型，例如 `conversation`、`event`、`message`、`agent`、`tag`。 |
| `name` | TEXT | 否 | 可读名称。日志型 node 可以为空。 |
| `description` | TEXT | 否 | 人类可读说明。 |
| `enabled` | INTEGER | 是 | 1 表示启用，0 表示禁用。日志型 node 固定写 1。 |
| `created_at` | INTEGER | 是 | 创建时间，Unix epoch 毫秒。 |
| `updated_at` | INTEGER | 是 | 更新时间，Unix epoch 毫秒。 |
| `metadata_json` | TEXT | 否 | 非查询型补充元数据。 |

当前第一版允许的 `node_type`：

- `conversation`
- `event`
- `message`
- `agent`
- `tool`
- `prompt_unit`
- `provider_strategy`
- `workflow`
- `memory`
- `code_function`
- `external_agent`
- `tag`
- `side_effect`
- `runtime_log`

### `edges`

统一边表。它只连接 node，不连接任意裸表 ID。任何关系都先让实体成为 node，再用 edge 表达关系。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | TEXT PRIMARY KEY | 是 | edge 的 UUID v7。 |
| `source_node_id` | TEXT | 是 | 起点 node，指向 `nodes.id`。 |
| `target_node_id` | TEXT | 是 | 终点 node，指向 `nodes.id`。 |
| `edge_type` | TEXT | 是 | 边类型。 |
| `name` | TEXT | 否 | 人类可读名称。 |
| `description` | TEXT | 否 | 人类可读说明。 |
| `enabled` | INTEGER | 是 | 1 表示启用。日志事实边固定写 1。 |
| `condition_json` | TEXT | 否 | 激活条件。 |
| `metadata_json` | TEXT | 否 | 非查询型补充元数据。 |
| `created_at` | INTEGER | 是 | 创建时间。 |
| `updated_at` | INTEGER | 是 | 更新时间。 |

当前第一版允许的 `edge_type`：

- `has_tag`：人工 tag 绑定，例如 `conversation -> tag`、`event -> tag`。
- `contains`：子图边界，例如 `workflow -> step node`。
- `parent_of`：父子关系，例如 `tag -> child tag`。
- `discoverable`：agent 可发现另一个 agent 或 node。
- `handoff`：agent 可 handoff 到另一个 agent 或 node。
- `tool_access`：agent 可使用某个 tool。
- `prompt_binding`：agent 绑定某个 prompt unit。
- `model_binding`：agent 绑定某个 provider strategy。
- `workflow_next`：固定工作流顺序边。
- `workflow_parallel`：固定工作流并行边。
- `workflow_join`：固定工作流汇聚边。
- `memory_access`：agent 或 workflow 可访问某个 memory。
- `event_child`：事件从属关系，例如 tool call event 属于 agent invocation event。
- `event_caused_by`：事件因果关系，例如 llm call 产生 tool call。

`priority` 不放在 `edges` 主表。当前短期没有同级边排序需求；如果未来某一类 edge 需要排序，给该类型新增 edge payload 分表。

## Node Payload 分表

### `conversations`

conversation 节点的专属 payload。所有运行事件、消息、模型调用和工具调用都必须挂到一个 conversation node。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`，同时也是 conversation id。 |
| `entry_node_id` | TEXT | 否 | 本会话默认入口 node。 |

### `agent_nodes`

agent 节点的专属 payload。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`。 |
| `instruction` | TEXT | 是 | agent 的基础系统说明。 |
| `context_policy_json` | TEXT | 否 | 上下文窗口、压缩、裁剪策略。 |
| `tool_policy_json` | TEXT | 否 | 工具可见性与默认审批策略。 |
| `model_policy_json` | TEXT | 否 | 模型选择、fallback、参数覆盖策略。 |
| `memory_policy_json` | TEXT | 否 | 记忆访问策略。 |

### `tool_nodes`

tool 节点的专属 payload。tool 也是 node，区别只在于它有工具执行所需的结构化字段。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`。 |
| `tool_name` | TEXT | 是 | 暴露给模型调用的工具名。 |
| `description` | TEXT | 是 | 工具说明。 |
| `parameters_json` | TEXT | 是 | JSON Schema 字符串。 |
| `executor_kind` | TEXT | 是 | 执行器类型，例如 `builtin`、`codemode`、`mcp`、`shell_bridge`。 |
| `approval_policy` | TEXT | 是 | `ask`、`deny` 或 `always_approve`。 |
| `config_json` | TEXT | 否 | 执行器配置。 |

### `prompt_units`

可复用提示词片段。agent 通过 `prompt_binding` edge 引用 prompt unit，运行时在 `prompt_compilations` 保存展开快照。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`。 |
| `role` | TEXT | 是 | `system`、`developer`、`user`、`assistant` 等。 |
| `content_template` | TEXT | 是 | 支持变量插入的模板文本。 |
| `variables_json` | TEXT | 否 | 变量定义或默认值。 |
| `priority` | INTEGER | 是 | 同一角色内的拼接优先级。 |

### `provider_strategies`

模型路由策略。可以绑定单模型，也可以保存 fallback/select 策略。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`。 |
| `provider` | TEXT | 是 | provider 类型，例如 `openai-chat-completions`、`deepseek-chat-completions`。 |
| `base_url` | TEXT | 是 | API base URL。 |
| `model` | TEXT | 是 | 默认模型。 |
| `strategy_json` | TEXT | 否 | fallback、候选模型、选择策略。 |
| `parameters_json` | TEXT | 否 | temperature、top_p、max_tokens 等参数。 |

### `events`

event 节点的专属 payload。任何运行中发生的动作都必须先成为 event node，再按类型写入更细 payload 表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`，同时也是 event id。 |
| `conversation_node_id` | TEXT | 是 | 所属 conversation node。 |
| `event_type` | TEXT | 是 | 事件类型。 |
| `status` | TEXT | 是 | `pending`、`running`、`completed`、`failed`、`cancelled`。 |
| `started_at` | INTEGER | 是 | 开始时间。 |
| `completed_at` | INTEGER | 否 | 完成时间。 |
| `input_json` | TEXT | 否 | 事件输入快照。 |
| `output_json` | TEXT | 否 | 事件输出快照。 |
| `error_json` | TEXT | 否 | 结构化错误。 |

当前第一版允许的 `event_type`：

- `user_message`
- `assistant_message`
- `agent_invocation`
- `prompt_compile`
- `llm_call`
- `tool_call`
- `tool_approval`
- `handoff`
- `runtime_log`
- `side_effect`

### `messages`

message 节点的专属 payload。用户消息、助手消息、工具消息、thinking 消息都写入这里。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`，同时也是 message id。 |
| `conversation_node_id` | TEXT | 是 | 所属 conversation node。 |
| `event_node_id` | TEXT | 否 | 产生该消息的 event node。 |
| `parent_message_node_id` | TEXT | 否 | 消息级父节点，用于 fork / targeting。 |
| `role` | TEXT | 是 | `system`、`developer`、`user`、`assistant`、`tool`、`thinking`。 |
| `content_json` | TEXT | 是 | 消息内容，字符串也用 JSON 包装保存。 |
| `tool_call_id` | TEXT | 否 | provider 工具调用 ID。 |
| `name` | TEXT | 否 | tool role 等场景的 name。 |
| `selector_json` | TEXT | 否 | 上下文定位信息。 |
| `created_at` | INTEGER | 是 | 创建时间。 |

### `prompt_compilations`

提示词编译事件的 payload 表。保存“由哪些 prompt unit / history / memory / tool catalog 编译出了最终消息”。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event_node_id` | TEXT PRIMARY KEY | 是 | 对应 `events.node_id`，类型为 `prompt_compile`。 |
| `agent_node_id` | TEXT | 否 | 编译所属 agent。 |
| `input_json` | TEXT | 是 | 编译输入。 |
| `assembly_plan_json` | TEXT | 否 | 拼接计划。 |
| `rendered_messages_json` | TEXT | 是 | 最终提交给 adapter 前的 messages。 |
| `trace_json` | TEXT | 否 | 编译 trace。 |

### `llm_calls`

模型 API 调用事件的 payload 表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event_node_id` | TEXT PRIMARY KEY | 是 | 对应 `events.node_id`，类型为 `llm_call`。 |
| `provider_strategy_node_id` | TEXT | 否 | 使用的 provider strategy。 |
| `provider` | TEXT | 是 | provider 类型。 |
| `model` | TEXT | 是 | 实际请求模型。 |
| `request_json` | TEXT | 是 | 最终 API 请求体快照。 |
| `response_json` | TEXT | 否 | 完整响应或解析后摘要。 |
| `stream_events_json` | TEXT | 否 | 流式事件数组。 |
| `status_code` | INTEGER | 否 | HTTP status。 |
| `request_id` | TEXT | 否 | provider / HTTP request id。 |
| `first_token_ms` | INTEGER | 否 | 首 token 延迟。 |
| `total_ms` | INTEGER | 否 | 总耗时。 |
| `usage_json` | TEXT | 否 | token usage。 |

### `tool_calls`

工具调用事件的 payload 表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event_node_id` | TEXT PRIMARY KEY | 是 | 对应 `events.node_id`，类型为 `tool_call`。 |
| `tool_node_id` | TEXT | 否 | 对应工具 node。 |
| `provider_tool_call_id` | TEXT | 否 | provider 传来的 tool call id。 |
| `tool_name` | TEXT | 是 | 模型请求调用的工具名。 |
| `arguments_json` | TEXT | 否 | 解析后的参数。 |
| `arguments_text` | TEXT | 是 | 原始参数文本。 |
| `result_json` | TEXT | 否 | 工具执行结果。 |
| `ok` | INTEGER | 否 | 1 成功，0 失败，NULL 表示尚未完成。 |

### `tool_approvals`

工具审批事件的 payload 表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event_node_id` | TEXT PRIMARY KEY | 是 | 对应 `events.node_id`，类型为 `tool_approval`。 |
| `tool_call_event_node_id` | TEXT | 是 | 被审批的 tool call event node。 |
| `risk_summary` | TEXT | 是 | 风险摘要。 |
| `decision` | TEXT | 否 | `approve` 或 `deny`。 |
| `reason` | TEXT | 否 | 人类或策略给出的原因。 |
| `requested_at` | INTEGER | 是 | 发起审批时间。 |
| `resolved_at` | INTEGER | 否 | 审批完成时间。 |

### `side_effects`

记录文件写入、shell 命令、网络调用等副作用摘要。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`，同时也是 side effect id。 |
| `conversation_node_id` | TEXT | 是 | 所属 conversation node。 |
| `event_node_id` | TEXT | 是 | 触发副作用的 event node。 |
| `effect_type` | TEXT | 是 | `file_read`、`file_write`、`shell_command` 等。 |
| `target` | TEXT | 否 | 文件路径、命令、URL 等目标。 |
| `summary` | TEXT | 否 | 人类可读摘要。 |
| `details_json` | TEXT | 否 | 结构化详情。 |
| `created_at` | INTEGER | 是 | 创建时间。 |

### `runtime_logs`

普通运行日志。用于保存 debug/info/warn/error 级别日志，不替代结构化事件。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `node_id` | TEXT PRIMARY KEY | 是 | 指向 `nodes.id`，同时也是 log id。 |
| `conversation_node_id` | TEXT | 否 | 关联 conversation node。 |
| `event_node_id` | TEXT | 否 | 关联 event node。 |
| `level` | TEXT | 是 | `debug`、`info`、`warn`、`error`。 |
| `message` | TEXT | 是 | 日志正文。 |
| `details_json` | TEXT | 否 | 结构化详情。 |
| `created_at` | INTEGER | 是 | 创建时间。 |

## Tag 规则

- tag 是 `nodes.node_type = 'tag'` 的普通 node。
- tag 绑定使用 `edges.edge_type = 'has_tag'`。
- tag 只能由人类显式添加、修改或删除。
- 运行日志、模型请求、工具调用、prompt compile 不得默认自动写 tag。
- tag 层级第一版优先使用命名空间字符串，例如 `project::simpagent`。如果未来需要显式层级图，再用 `edges.edge_type = 'parent_of'` 表达。

## Workflow / 子图边界

- 不建 `graphs` 表。
- workflow 是 `nodes.node_type = 'workflow'` 的普通 node。
- workflow 包含哪些节点，用 `workflow -> node` 且 `edge_type = 'contains'` 表达。
- 节点之间的流程顺序，用 `workflow_next`、`workflow_parallel`、`workflow_join` 表达。
- 前端加载固定 workflow 时，先查 `contains` 边得到子图边界，再加载边界内节点和相关 workflow edge。

## 索引

第一版只建必要索引，避免写入成本被过度放大。

- `idx_nodes_type`：`nodes(node_type)`，用于按类型加载 agent、workflow、tag、event。
- `idx_nodes_name`：`nodes(node_type, name)`，用于按类型和名称查定义层节点或人工 tag。
- `idx_edges_source`：`edges(source_node_id, edge_type)`，用于正向查关系。
- `idx_edges_target`：`edges(target_node_id, edge_type)`，用于反向查关系。
- `idx_events_conversation`：`events(conversation_node_id, started_at)`，用于按会话读取事件流。
- `idx_messages_conversation`：`messages(conversation_node_id, created_at)`，用于按会话读取消息。

暂不为所有 payload 表建立额外索引。第一版只保留顶层图关系和会话流的必要索引，其他字段等真实查询稳定后再补。

## 第一版实现边界

第一版 SQLite 代码必须先替换旧 JSON trace store，并建立完整 schema。当前 agent loop 仍可先通过现有 `TraceStore` 接口写入：

- `saveThread()` 映射为 conversation node + conversation payload + message nodes + message payload。
- `saveTrace()` 映射为 event nodes + event payload + `llm_calls` + `tool_calls` + `tool_approvals`。
- 只有输入快照里显式带 `tags` 时，才写入 tag node 和 `has_tag` edge。
- 后续再把 agent loop 改成直接生成细粒度 event，而不是保存完 trace 后再拆分。

明确禁止：

- 不迁移旧 `.simpagent/threads/*.json` 历史。
- 不在 `metadata_json` 保存 `threadSnapshot`。
- 不为了兼容旧 MVP 而把完整 thread 快照塞进 JSON 字段。
