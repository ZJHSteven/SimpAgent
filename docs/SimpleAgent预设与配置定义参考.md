# SimpleAgent 预设与配置定义参考

## 1. 这份文档解决什么问题

这份文档专门回答下面这个问题：

> 如果我要基于 SimpleAgent 框架开发一个新 App，不改 runtime 主实现，只做二次开发，那我到底能定义什么？每个 JSON 能写哪些键？这些键会产生什么效果？

它不是“代码总览”，也不是“怎么启动 runtime”的重复版，而是偏 **preset / setup / 配置定义** 的参考手册。

适用对象：

- 要给新 App 写 `preset`
- 要给现有 App 扩写 `prompt_blocks.json / agents.json / workflows.json`
- 要决定哪些内容放 preset，哪些内容走 API，哪些内容该进 catalog

---

## 2. 先记住一个总边界

当前框架的“二次开发入口”分 3 层，不是只有一层。

### 2.1 文件预设层

当前 `seedPresetConfigsFromDir()` 直接支持从目录读取的文件只有 3 个：

- `prompt_blocks.json`
- `agents.json`
- `workflows.json`

也就是说，**当前 repo 里“开箱即用的文件型 preset”只正式支持这三类定义**。

### 2.2 运行时配置 / HTTP API 层

有些东西不是通过 preset 文件导入，而是通过运行时 API 改：

- builtin tool 配置
- system config
- checkpoint patch / override / fork

也就是说，**tool 开关、暴露策略、权限策略，不属于当前 `presetDir` 自动导入的 3 个 JSON 之一**。

### 2.3 Catalog 图谱层

更复杂的扩展内容走统一图谱 `catalog`：

- memory
- tool
- MCP
- skill
- integration
- prompt 节点

也就是说，**memory / MCP / skill / tool 的“结构化真源”更多是 catalog facet，不是单独一个 `memory.json` 或 `mcp.json` 文件**。

这点很重要：

- 如果你只看 `prompt_blocks.json / agents.json / workflows.json`
- 你会误以为框架只能定义这三类

其实不是。

更准确地说：

- **文件预设层**目前只吃这三类
- **框架扩展面**实际比这三类大，另外一大块在 API 和 catalog

---

## 3. 当前最推荐的二次开发分工

### 3.1 你不改 runtime 时，最常改的是这些

最常见的 App 二次开发是：

1. 写 `prompt_blocks.json`
2. 写 `agents.json`
3. 写 `workflows.json`
4. 用前端或后端 API 改 builtin tools / system config
5. 用 catalog 节点和 facet 补 memory / MCP / skill / tool / integration

### 3.2 你什么时候需要改框架源码

下面这些通常就不是单纯 preset 能解决的：

- 新增一种全新的 builtin tool 执行器
- 新增一种全新的 provider/tool 暴露协议
- 修改 PromptCompiler 组装规则
- 修改 WorkflowRuntime / ToolLoop 主链逻辑

一句话：

- **换内容、换角色、换流程、换图谱定义**：优先走 preset / API / catalog
- **换运行时机制**：才去改 `packages/core` 或 `packages/runtime-node`

---

## 4. 当前文件预设层到底支持哪些文件

当前 `packages/runtime-node/src/storage/seed.ts` 里的 `seedPresetConfigsFromDir()` 会读取：

```text
<presetDir>/
  prompt_blocks.json
  agents.json
  workflows.json
```

它当前不会自动读取：

- `tools.json`
- `memory.json`
- `mcp.json`
- `skills.json`

所以如果你看到旧目录里曾经有 `tools.json`，那不代表它现在仍然是框架正式入口。

### 4.1 当前最小 preset 目录示例

```text
apps/<your-app>/backend/presets/<preset-name>/
  prompt_blocks.json
  agents.json
  workflows.json
```

### 4.2 这三类文件的职责

#### `prompt_blocks.json`

定义“全局可复用 PromptUnit / PromptBlock”。

它回答的是：

- 你有哪些提示词块
- 它们插到哪里
- 它们优先级多高
- 它们是否带变量
- 它们是否只对某些 agent 生效

#### `agents.json`

定义“哪些 agent 存在，以及每个 agent 绑定哪些 PromptUnit、能看到哪些工具、能 handoff 给谁”。

#### `workflows.json`

定义“这些 agent / tool / interrupt 节点怎么串起来跑”。

---

## 5. PromptBlock / PromptUnit 怎么写

类型真源：

- `packages/core/src/types/contracts.ts`
- `PromptUnitSpec`
- `PromptBlock = PromptUnitSpec`（兼容别名）

### 5.1 最常用字段

| 字段 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 全局唯一 ID |
| `name` | `string` | 是 | 展示名 |
| `kind` | `PromptUnitKind` | 是 | 提示词块类型 |
| `template` | `string` | 是 | 提示词正文 |
| `role` | `MessageRole` | 否 | 指定消息角色，通常可不填 |
| `variablesSchema` | `object` | 否 | 模板变量 schema |
| `insertionPoint` | `PromptInsertionPoint` | 是 | 插入位置 |
| `priority` | `number` | 是 | 排序优先级 |
| `trigger` | `object` | 否 | 生效条件 |
| `tokenLimit` | `number` | 否 | 单块 token 预算提示 |
| `enabled` | `boolean` | 否 | 兼容字段，通常建议保留 |
| `version` | `number` | 是 | 配置版本 |
| `tags` | `string[]` | 否 | 标签 |

### 5.2 `kind` 可选值

当前可选值：

- `system_rule`
- `persona`
- `worldbook`
- `memory`
- `history_window`
- `workflow_packet`
- `handoff_packet`
- `task`
- `format`
- `safety`
- `tool_catalog`
- `tool_detail`
- `tool_hint`
- `hidden_internal`

推荐理解方式：

- `persona`：角色设定
- `task`：任务包装
- `safety` / `system_rule`：系统约束
- `tool_hint`：工具提示
- `worldbook` / `memory`：上下文知识

### 5.3 `insertionPoint` 可选值

当前可选值：

- `system_pre`
- `system_post`
- `developer`
- `task_pre`
- `task_post`
- `memory_context`
- `tool_context`

建议：

- 最常用的是 `system_pre`、`system_post`、`task_pre`、`tool_context`
- 不要一上来全塞 `system_pre`
- 工具说明优先放 `tool_context`
- 任务包装优先放 `task_pre`

### 5.4 `trigger` 常见写法

`trigger` 常用键：

- `keywords`
- `taskTypes`
- `agentIds`
- `tagsAny`
- `expression`

最常见的是：

```json
{
  "agentIds": ["agent.devconsole.orchestrator"]
}
```

这表示这个 PromptUnit 只在指定 agent 上生效。

### 5.5 最小示例

```json
{
  "id": "block.example.system",
  "name": "example.system",
  "kind": "safety",
  "template": "你必须保持结构化、可审计，不要伪造事实。",
  "insertionPoint": "system_pre",
  "priority": 100,
  "enabled": true,
  "version": 1,
  "tags": ["example"]
}
```

### 5.6 带变量示例

```json
{
  "id": "block.example.task",
  "name": "example.task",
  "kind": "task",
  "template": "用户输入：{{userInput}}",
  "variablesSchema": {
    "type": "object",
    "properties": {
      "userInput": { "type": "string" }
    },
    "required": ["userInput"]
  },
  "insertionPoint": "task_pre",
  "priority": 70,
  "enabled": true,
  "version": 1
}
```

### 5.7 实际效果怎么理解

- 改 `template`：改这个块的正文
- 改 `insertionPoint`：改它插入 Prompt 的位置
- 改 `priority`：改同层排序
- 改 `trigger.agentIds`：控制它只在哪些 agent 上生效

---

## 6. Agent 怎么写

类型真源：

- `packages/core/src/types/contracts.ts`
- `AgentSpec`
- `AgentPromptBinding`
- `AgentToolRoutePolicy`

### 6.1 最常用字段

| 字段 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | agent ID |
| `name` | `string` | 是 | 展示名 |
| `role` | `string` | 否 | 语义标签，不是运行逻辑真源 |
| `description` | `string` | 是 | 描述 |
| `promptBindings` | `AgentPromptBinding[]` | 否 | 绑定哪些 PromptUnit |
| `toolAllowList` | `string[]` | 否 | 工具白名单 |
| `toolRoutePolicy` | `object` | 否 | 工具调用路由偏好 |
| `memoryPolicies` | `string[]` | 否 | 记忆策略引用位 |
| `handoffPolicy` | `object` | 否 | handoff 规则 |
| `enabled` | `boolean` | 是 | 是否启用 |
| `version` | `number` | 是 | 配置版本 |
| `tags` | `string[]` | 否 | 标签 |

### 6.2 `promptBindings` 怎么理解

`promptBindings` 才是 agent 真正的 Prompt 输入配置核心。

单个 binding 常见字段：

| 字段 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `bindingId` | `string` | 否 | 绑定记录 ID |
| `unitId` | `string` | 是 | 绑定哪个 PromptUnit |
| `enabled` | `boolean` | 是 | 这个绑定是否启用 |
| `order` | `number` | 是 | 顺序 |
| `roleOverride` | `MessageRole` | 否 | 局部覆盖 role |
| `insertionPointOverride` | `PromptInsertionPoint` | 否 | 局部覆盖插入点 |
| `priorityOverride` | `number` | 否 | 局部覆盖优先级 |
| `variableOverrides` | `object` | 否 | 局部变量覆盖 |
| `tokenLimitOverride` | `number` | 否 | 局部 token 限制 |
| `tags` | `string[]` | 否 | 标签 |

最重要的事实：

- **PromptUnit 是全局定义**
- **启用/禁用、顺序、局部覆盖是在 Agent binding 层完成**

### 6.3 `toolRoutePolicy.mode` 可选值

- `auto`
- `native_function_first`
- `shell_only`
- `prompt_protocol_only`

推荐理解：

- `auto`：让 runtime 按 provider 能力自动选
- `native_function_first`：优先原生 function/tool calling
- `prompt_protocol_only`：强制走提示词协议回退
- `shell_only`：只适合非常特殊的场景

### 6.4 `handoffPolicy` 怎么写

```json
{
  "allowedTargets": ["agent.b", "agent.c"],
  "allowDynamicHandoff": true,
  "strategy": "hybrid"
}
```

`strategy` 可选值：

- `fixed`
- `dynamic`
- `hybrid`

### 6.5 最小示例

```json
{
  "id": "agent.example.orchestrator",
  "name": "Example Orchestrator",
  "role": "orchestrator",
  "description": "负责任务拆分和路由。",
  "promptBindings": [
    {
      "bindingId": "bind.example.system",
      "unitId": "block.example.system",
      "enabled": true,
      "order": 10
    }
  ],
  "toolAllowList": ["update_plan", "handoff"],
  "toolRoutePolicy": {
    "mode": "auto"
  },
  "memoryPolicies": [],
  "handoffPolicy": {
    "allowedTargets": ["agent.example.worker"],
    "allowDynamicHandoff": true,
    "strategy": "hybrid"
  },
  "enabled": true,
  "version": 1
}
```

### 6.6 实际效果怎么理解

- 改 `promptBindings`：改这个 agent 最终吃到哪些 PromptUnit
- 改 `toolAllowList`：改它看见哪些工具
- 改 `toolRoutePolicy`：改它更偏向哪种工具协议
- 改 `handoffPolicy`：改它能把任务交给谁

---

## 7. Workflow 怎么写

类型真源：

- `packages/core/src/types/contracts.ts`
- `WorkflowNodeSpec`
- `WorkflowEdgeSpec`
- `WorkflowSpec`

### 7.1 最常用字段

| 字段 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | workflow ID |
| `name` | `string` | 是 | 名称 |
| `entryNode` | `string` | 是 | 入口节点 ID |
| `nodes` | `WorkflowNodeSpec[]` | 是 | 节点列表 |
| `edges` | `WorkflowEdgeSpec[]` | 是 | 边列表 |
| `interruptPolicy` | `object` | 否 | 中断策略 |
| `enabled` | `boolean` | 是 | 是否启用 |
| `version` | `number` | 是 | 版本 |

### 7.2 `nodes` 怎么写

节点类型：

- `agent`
- `tool`
- `interrupt`
- `router`

最常见的是 `agent`。

示例：

```json
{
  "id": "node.example.worker",
  "type": "agent",
  "label": "执行代理",
  "agentId": "agent.example.worker"
}
```

### 7.3 `edges` 怎么写

边常见字段：

| 字段 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `id` | `string` | 建议填 | 边 ID |
| `from` | `string` | 是 | 起点节点 |
| `to` | `string` | 是 | 终点节点 |
| `condition` | `object` | 否 | 触发条件 |
| `priority` | `number` | 否 | 优先级 |

`condition.type` 可选值：

- `always`
- `state_field`
- `expression`

最小边示例：

```json
{
  "id": "edge.a_to_b",
  "from": "node.a",
  "to": "node.b",
  "condition": { "type": "always" }
}
```

### 7.4 `interruptPolicy` 怎么理解

```json
{
  "defaultInterruptBefore": false,
  "defaultInterruptAfter": false,
  "interruptBeforeNodes": ["node.a"],
  "interruptAfterNodes": ["node.b"]
}
```

适合做：

- 关键节点前审批
- 某些节点后强制人工确认

### 7.5 最小示例

```json
{
  "id": "workflow.example.default",
  "name": "示例工作流",
  "entryNode": "node.orchestrator",
  "nodes": [
    {
      "id": "node.orchestrator",
      "type": "agent",
      "label": "编排器",
      "agentId": "agent.example.orchestrator"
    },
    {
      "id": "node.worker",
      "type": "agent",
      "label": "执行代理",
      "agentId": "agent.example.worker"
    }
  ],
  "edges": [
    {
      "id": "edge.orchestrator_to_worker",
      "from": "node.orchestrator",
      "to": "node.worker",
      "condition": { "type": "always" }
    }
  ],
  "interruptPolicy": {
    "defaultInterruptBefore": false,
    "defaultInterruptAfter": false
  },
  "enabled": true,
  "version": 1
}
```

---

## 8. Tools 到底怎么定义

这部分最容易误解。

### 8.1 先说结论

**当前文件 preset 层不会自动从 `presetDir` 导入 tools 定义。**

也就是说，当前没有正式的：

- `tools.json` 文件入口

### 8.2 那工具怎么配

当前主要分两类：

#### A. builtin tools 配置

类型真源：

- `BuiltinToolConfig`

主要字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `name` | `BuiltinToolName` | 内置工具名 |
| `enabled` | `boolean` | 开关 |
| `description` | `string` | 描述 |
| `exposurePolicy` | `CanonicalToolExposurePolicy` | 暴露策略 |
| `permissionPolicy` | `CanonicalToolPermissionPolicy` | 权限策略 |
| `uiConfig` | `object` | UI 配置 |

这部分当前主要通过 API 改：

- `GET /api/tools/builtin`
- `PUT /api/tools/builtin/:name`

#### B. catalog tool 节点

如果你要定义：

- MCP 工具
- skill 工具
- catalog tool

更推荐走 `catalog_nodes + catalog_node_facets`。

`CatalogToolFacetPayload` 关键字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `toolKind` | `builtin \| mcp \| skill_tool` | 工具类型 |
| `route` | `object` | 真正执行去哪里 |
| `executorType` | `string` | 执行器类型 |
| `inputSchema` | `object` | 输入 schema |
| `outputSchema` | `object` | 输出 schema |
| `exposurePolicy` | `object` | 暴露策略 |
| `permissionPolicy` | `object` | 权限策略 |
| `executionConfig` | `object` | 执行配置 |

`route` 典型值：

```json
{ "kind": "builtin", "builtin": "read_file" }
```

或：

```json
{ "kind": "mcp", "serverNodeId": "node.mcp.fs", "toolName": "read_text_file" }
```

或：

```json
{ "kind": "skill_tool", "skillId": "skill.example" }
```

---

## 9. Memory 到底怎么定义

### 9.1 `memoryPolicies` 不是完整记忆内容本身

`AgentSpec.memoryPolicies` 当前更像是“记忆策略引用位 / 挂点”，例如：

```json
"memoryPolicies": ["memory.timeline", "memory.affinity"]
```

它本身不是完整 memory 内容。

### 9.2 真正结构化的 memory 更推荐走 catalog memory facet

类型真源：

- `CatalogMemoryFacetPayload`

主要字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `memoryType` | `fact \| summary \| persona \| worldbook \| episodic \| semantic` | 记忆类型 |
| `namespace` | `string` | 命名空间 |
| `source` | `string` | 来源 |
| `freshnessScore` | `number` | 新鲜度 |
| `confidenceScore` | `number` | 置信度 |
| `embeddingRef` | `string` | 向量引用 |
| `trigger` | `object` | 触发条件 |

推荐理解：

- worldbook / 事实 / 摘要 / 语义记忆，都更适合做成 catalog 节点 + memory facet
- 如果只是简化版场景，也可以先用 `PromptBlock.kind = "worldbook"` 或 `"memory"`

### 9.3 一个 memory 节点的形状

最少需要：

1. 一个 `CatalogNode`
2. 一个 `CatalogNodeFacet`，其中 `facetType = "memory"`

---

## 10. MCP / Skill / Integration 怎么定义

这部分也不属于当前 `presetDir` 的 3 个 JSON 文件直读范围。

更推荐走 catalog。

### 10.1 MCP / skill 工具本体：走 tool facet

用 `CatalogToolFacetPayload`：

- `toolKind = "mcp"` 或 `"skill_tool"`
- `route` 指到 MCP server / skill

### 10.2 外部来源与连接方式：走 integration facet

类型真源：

- `CatalogIntegrationFacetPayload`

主要字段：

| 字段 | 类型 | 作用 |
| --- | --- | --- |
| `sourceType` | `mcp_server \| mcp_tool \| skill_bundle \| preset \| imported` | 来源类型 |
| `transport` | `stdio \| streamable-http \| sse \| custom` | 传输方式 |
| `serverName` | `string` | 服务名 |
| `originalName` | `string` | 原始名称 |
| `originalSchema` | `object` | 原始 schema |
| `clientConfig` | `object` | 客户端配置 |

### 10.3 实操建议

如果你现在只是做 App 级二次开发：

- 不要先追求把 MCP / skill 做成新的文件格式
- 先用现有 catalog HTTP CRUD 或 seed 代码导入

因为当前框架真源已经是：

- catalog node
- catalog facet
- relation

---

## 11. 当前“preset 能力边界”到底是什么

这是最核心的一段。

### 11.1 当前完全文件化的二次开发入口

当前完全文件化、开箱可被 `presetDir` 直接导入的是：

1. PromptUnit / PromptBlock
2. Agent
3. Workflow

### 11.2 当前不是“presetDir 三文件直读”，但仍然属于框架扩展面的

这些能力仍然能定义，但不主要靠那三份 JSON：

1. builtin tool config
2. system config
3. catalog prompt nodes
4. catalog memory nodes
5. catalog tool nodes
6. MCP / skill / integration facet

### 11.3 所以更准确的说法是

不是：

> 框架二次开发只有 prompt / agent / workflow 三块

而是：

> 当前“文件型 preset 层”主要只有 prompt / agent / workflow 三块；  
> 其余扩展面主要走 API 层和 catalog 层。

---

## 12. 开发一个新 App 时，建议按什么顺序落定义

推荐顺序：

1. 先写 `prompt_blocks.json`
2. 再写 `agents.json`
3. 再写 `workflows.json`
4. 如果只需要 builtin tools，直接配 `toolAllowList` 并通过 `/api/tools/builtin` 调整开关
5. 如果需要 memory / MCP / skill / tool graph，再补 catalog

这样做的好处是：

- 先把主链跑通
- 再补高级上下文和外部集成
- 不会一上来就把所有配置层混成一坨

---

## 13. 推荐阅读顺序

如果你正在写 preset / setup，建议按这个顺序读：

1. `docs/基于SimpleAgent框架开发App指南.md`
2. 本文档
3. `packages/core/src/types/contracts.ts`
4. `packages/runtime-node/src/storage/seed.ts`
5. `packages/runtime-node/src/storage/templates.ts`
6. `packages/runtime-node/src/api/http.ts`

---

## 14. 最后一条判断规则

以后如果你拿不准一段配置该放哪，就按下面这个规则判断：

- 这是 **角色 / 提示词 / 流程** 吗？
  - 优先放 `prompt_blocks.json / agents.json / workflows.json`
- 这是 **工具开关 / 系统配置** 吗？
  - 优先走运行时 API
- 这是 **memory / MCP / skill / tool 图谱定义** 吗？
  - 优先走 catalog
- 这是 **运行时机制本身** 吗？
  - 才去改框架源码

这样最不容易重复造轮子，也最符合当前仓库的真实结构。
