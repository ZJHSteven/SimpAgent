# 基于 SimpleAgent 框架开发 App 指南

## 1. 这份文档是干什么的

这份文档不是再重复一遍“框架代码总览”，而是专门回答下面这个问题：

> 如果你要基于当前仓库开发一个新的 App，到底应该怎么用现有框架，而不是重新发明一套 Agent 后端？

目标是让后续 AI / 人类开发者不用每次都把整个 `packages/` 重新读一遍，也能知道：

- 当前框架已经有哪些能力；
- 哪些接口已经可以直接拿来用；
- 哪些能力应该复用、不要重写；
- 新 App 的推荐结构是什么；
- 哪些边界和坑需要提前知道。

## 2. 先记住两个总原则

### 原则 A：当前框架真源是 `packages/runtime-node`

以后只要涉及：

- Run 创建与执行
- Prompt 编译
- Tool 暴露与执行
- Catalog
- HTTP / WS
- SQLite 存储
- trace / state diff / side effect / approval / fork

优先看：

- `packages/runtime-node`

而不是：

- `backend`
- 某个 `apps/*` 目录里的包装脚本
- 旧文档里提到的历史入口

### 原则 B：优先“复用现有运行时”，不要“为每个 App 重写 runtime”

当前推荐做法是：

1. App 自己提供前端；
2. App 自己提供一层很薄的运行包装；
3. 真正的 Agent 运行时仍然复用 `@simpagent/runtime-node`。

也就是说，App 层应该主要关心：

- 自己的界面
- 自己的预设
- 自己的项目隔离参数
- 自己需要暴露给用户的配置面板

而不是去复制或重写：

- PromptCompiler
- ToolLoop
- LangGraph runtime
- HTTP / WS server
- SQLite schema

## 3. 当前框架已经有哪些可直接复用的能力

下面这部分是“别再重复造轮子”的核心清单。

### 3.1 Agentic loop 与多节点 workflow

当前框架已经具备：

- `WorkflowSpec` 定义节点与边；
- agent 节点、tool 节点、interrupt 节点；
- 条件边与表达式边；
- `handoff` builtin tool；
- `pause / resume / interrupt / fork`；
- LangGraph checkpoint / history / updateState。

如果你要做多 Agent 协作、handoff、可恢复执行，不要再在 App 里重新写一个 orchestrator。

### 3.2 PromptCompiler 与 PromptUnit 体系

当前已经有完整的 Prompt 装配主链：

- `PromptUnit`
- `promptBindings`
- 历史消息注入
- memory / catalog context 注入
- task envelope 注入
- `PromptTrace`
- `PromptAssemblyPlan`
- `PromptOverridePatch`
- `PromptUnitOverride`

所以如果你要控制提示词：

- 用 `PromptUnit` 和 `promptBindings`
- 用 override / trace / assembly plan

不要把需求退化成“手写一个巨大的 prompt 字符串”。

### 3.3 Tool 系统

当前已经有三层工具主链：

1. 外层来源层：
- builtin
- catalog tool
- MCP
- skill

2. 中层统一层：
- `CanonicalToolSpec`
- `CanonicalToolCallIntent`
- `CanonicalToolCallResult`

3. 内层暴露层：
- `responses_native`
- `chat_function`
- `chat_custom`
- `structured_output_tool_call`
- `prompt_protocol_fallback`

这意味着：

- 你不应该在 app 里直接重写 OpenAI function calling 拼装；
- 你也不应该把所有工具都粗暴降级成 shell 文本协议；
- 应该沿用已有 canonical tool 主链扩展。

### 3.4 Catalog / 统一图谱

当前已经具备：

- `catalog_nodes`
- `catalog_relations`
- `catalog_node_facets`
- 节点 / facet / relation HTTP CRUD
- prompt 节点转 `PromptUnit`
- tool / memory / skill / mcp 节点转上下文 PromptUnit

如果你想做：

- 工具目录
- 技能目录
- 记忆目录
- Prompt 节点目录
- 统一关系图

优先用现有 catalog，而不是再自己造一套 JSON 树或另一张表。

### 3.5 可观测性与人工介入

当前已经有：

- trace events
- prompt compile 记录
- state diffs
- side effects
- tool exposure plans
- approval requests
- user input requests
- checkpoint history
- state patch
- prompt patch
- fork
- WebSocket 实时订阅

如果你要做调试面板、回放、审批、可观测性，不要再额外发明第二套日志系统。

### 3.6 存储与配置

当前已经有：

- SQLite 版本化配置存储
- Agent / PromptUnit / Workflow / Tool 定义表
- system config
- builtin tool config
- catalog
- run / trace / diff / side effect / approval / fork 持久化

如果你要做“配置热更新 + 可追溯版本”，优先接现有表和 API。

## 4. 当前推荐的 App 结构

## 4.1 推荐目录形态

一个新的 App，当前推荐至少拆成两层：

```text
apps/<your-app>/
  package.json           # 前端或桌面壳
  src/                   # UI
  backend/               # 仅做运行包装，不放另一份 runtime 主实现
```

其中 `backend/` 当前只应该承担：

- 设置 `SIMPAGENT_PROJECT_ID`
- 设置 `SIMPAGENT_DATA_DIR`
- 设置 `PORT`
- 设置 `SIMPAGENT_PRESET_DIR`（可选）
- 启动 `@simpagent/runtime-node`

不应该在这里继续复制：

- runtime engine
- HTTP routes
- WS server
- storage schema

## 4.2 当前最推荐的接线方式

### 后端层

App 后端推荐只做一层很薄的运行包装：

- 复用 `@simpagent/runtime-node`
- 为每个 App 指定独立 `projectId`
- 为每个 App 指定独立 `dataDir`

这是当前最稳的隔离方式。

### 前端层

前端直接连现成 HTTP / WS：

- HTTP 负责命令与查询；
- WS 负责实时 trace 与 run snapshot。

典型前端能力包括：

- 创建 run
- 查看 run summary
- 查看 trace
- 查看 prompt compile
- 查看 state diff / side effect
- 查看 history / fork
- 查看 approval / respond approval
- 查看 agents / workflows / prompt-units / catalog / builtin tools

## 5. 开发一个新 App 时，优先复用哪些接口

### 5.1 启动运行时

`packages/runtime-node/src/index.ts` 已经负责：

- 数据库初始化
- 默认 seed
- registry refresh
- PromptCompiler / Provider / ToolRuntime / TraceBus 装配
- HTTP 注册
- WS 注册

所以新 App 不应该再手写这些步骤。

### 5.2 创建一次真实运行

前端应优先调用：

```http
POST /api/runs
```

一个 OpenAI-compatible `chat_completions` 风格的最小请求示例：

```json
{
  "workflowId": "workflow.default",
  "userInput": "请开始处理这个任务",
  "provider": {
    "vendor": "openai",
    "apiMode": "chat_completions",
    "model": "gpt-4o-mini",
    "baseURL": "https://your-openai-compatible-base-url/v1",
    "apiKey": "your-api-key"
  }
}
```

如果你的服务商也是 OpenAI-compatible：

- 优先填 `apiMode = "chat_completions"`；
- `baseURL` 指到兼容接口根路径；
- `vendor` 可以继续走当前兼容层支持的厂商标识。
- `apps/dev-console` 调试台默认就应该走这条“真实 LLM 配置口”，不要把 mock provider 当成调试台主方案。
- mock provider 目前主要仍用于 package 级自动化测试，不代表新 App 的默认接入方式。

### 5.3 实时观察一次运行

前端建立 WebSocket：

```text
ws://<host>/ws
```

典型流程：

1. 发送 `hello`
2. 发送 `subscribe_run`
3. 接收：
- `run_snapshot`
- `trace_event`
- `replay_events_batch`
- `warning`

如果断线后恢复：

- 用 `lastEventSeq` 做补拉；
- 不够时再回退到 HTTP `GET /api/trace/:runId/events`。

### 5.4 回放与人工修正

已有能力：

- `GET /api/threads/:threadId/history`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/state-patch`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-unit-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/fork`

所以如果你要做“回到某个 checkpoint 修改后继续跑”的能力，不要自己设计另一套 time-travel 协议。

### 5.5 配置与资源编辑

已有资源管理接口：

- `GET/POST/PUT /api/agents`
- `GET/POST/PUT /api/workflows`
- `GET/POST/PUT /api/prompt-units`
- `GET /api/tools`
- `GET/PUT /api/tools/builtin/:name`
- `GET/POST/PUT/DELETE /api/catalog/*`
- `GET/PUT /api/config/system`
- `GET /api/templates`
- `POST /api/templates/:templateId/apply`

如果你要做配置面板，优先围绕这些接口扩展，而不是另写一套“只给前端看的本地配置文件格式”。

### 5.6 App 后端包装的最小接口面

如果你要新建一个 App 的 `backend/`，现在最推荐的做法就是复用统一包装脚本：

```bash
node ../../../scripts/run-runtime-node-app.mjs dev <projectId> <port> <dataDir> [presetDir]
```

它本质上只是帮你设置下面这些环境变量，再启动 `@simpagent/runtime-node`：

- `SIMPAGENT_PROJECT_ID`
- `SIMPAGENT_DATA_DIR`
- `PORT`
- `SIMPAGENT_PRESET_DIR`（可选）

也就是说，新 App 的 backend 层不该继续发明自己的启动协议；当前已经约定好的“框架入口面”就是这 4 个环境变量加 `runtime-node`。

### 5.7 HTTP 接口速查表

如果你后续要给 AI 或人类开发者一个“先别翻全仓库，先看这里”的入口，下面这组就是当前最值得先记住的 HTTP 接口面。

#### 健康检查

- `GET /api/health`

#### 运行控制

- `POST /api/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/pause`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/interrupt`

#### 运行调试查询

- `GET /api/trace/:runId/events`
- `GET /api/trace/:runId/prompt/:compileId`
- `GET /api/runs/:runId/state-diffs`
- `GET /api/runs/:runId/side-effects`
- `GET /api/runs/:runId/plan`
- `GET /api/runs/:runId/tool-exposure-plans`
- `GET /api/runs/:runId/user-input-requests`
- `GET /api/runs/:runId/approval-requests`
- `POST /api/runs/:runId/approval-requests/:requestId/respond`

#### Checkpoint / Time-travel

- `GET /api/threads/:threadId/history`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/state-patch`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-unit-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/fork`

#### 版本化定义与配置

- `GET/POST/PUT /api/agents`
- `GET/POST/PUT /api/workflows`
- `GET/POST/PUT /api/prompt-units`
- `GET/POST/PUT /api/prompt-blocks`
- `GET /api/tools`
- `GET /api/tools/builtin`
- `PUT /api/tools/builtin/:name`
- `POST /api/tools/apply-patch/dry-run`
- `GET /api/config/tool-exposure-policies`
- `GET/PUT /api/config/system`

#### Catalog / 图谱

- `GET/POST/PUT/DELETE /api/catalog/nodes`
- `GET /api/catalog/nodes/:nodeId`
- `GET/PUT/DELETE /api/catalog/nodes/:nodeId/facets/:facetType`
- `GET /api/catalog/nodes/:nodeId/facets`
- `GET/POST/PUT/DELETE /api/catalog/relations`
- `GET /api/catalog/prompt-units`
- `GET /api/catalog/context-prompt-units`

#### 模板

- `GET /api/templates`
- `POST /api/templates/:templateId/apply`

如果你要做一个新 App 的“最小可运行框架前端”，优先把这些接口接上，而不是绕开框架另写一套临时后端。

### 5.8 WebSocket 事件速查表

当前实时调试主线走：

```text
ws://<host>/ws
```

客户端至少要认识这些消息：

#### 客户端发给服务端

- `hello`
- `ping`
- `subscribe_run`
- `unsubscribe_run`

#### 服务端发给客户端

- `run_snapshot`
- `trace_event`
- `replay_events_batch`
- `warning`
- `error`
- `heartbeat`

推荐最小策略：

1. 先 `hello`，把 `lastEventSeq` 带上。
2. 再发 `subscribe_run` 订阅当前 run。
3. 优先吃增量 `trace_event`。
4. 若收到窗口不足的 `warning`，回退 HTTP `GET /api/trace/:runId/events` 做补拉。

## 6. 哪些能力目前最值得直接拿来用

### 6.1 适合直接复用

- `shell_command`
- `apply_patch`
- `read_file`
- `web_search`
- `update_plan`
- `request_user_input`
- `view_image`
- `handoff`

### 6.2 适合直接复用的调试接口

- `trace events`
- `prompt compile detail`
- `state diff`
- `side effect`
- `tool exposure plan`
- `approval requests`
- `history / fork`

### 6.3 适合直接复用的模板入口

现有模板接口：

- `GET /api/templates`
- `POST /api/templates/:templateId/apply`

如果你只是要快速起一个演示 App，先用模板和现成 API 跑通，再决定是否做自己专属 preset。

## 7. 什么时候该改 `packages/core`，什么时候该改 `packages/runtime-node`

### 改 `packages/core`

当你改的是：

- 类型契约
- Ports 抽象
- PromptCompiler 抽象逻辑
- ToolLoop / AgentRound 的跨运行时通用逻辑
- WorkflowRegistry / Runtime 抽象

### 改 `packages/runtime-node`

当你改的是：

- SQLite schema / DB 读写
- HTTP / WS
- LangGraph runtime 接线
- 权限与审批
- ToolRuntime / builtin executors
- provider 兼容层
- catalog 落地
- Node 专属 bridge / MCP / skill 执行

### 不建议优先改 App 层

如果你发现某个能力本来就属于框架，例如：

- Prompt 装配
- tool routing
- approval
- fork
- catalog

那就优先修框架层，不要先在某个 App 里打补丁式重写。

## 8. 当前已知边界与风险

### 8.1 `runtime-node` 目前是“主实现”，不是完全稳定 SDK

这意味着：

- 现在最稳的复用方式是“启动它、调用它的 HTTP/WS”；
- 而不是把它当一个已经彻底稳定、边界冻结的 npm SDK 直接嵌入。

### 8.2 `projectId` 不是所有定义表的完整隔离键

当前更可靠的隔离方式是：

- 每个 App 使用独立 `dataDir`

不要指望“多个项目共享一个 SQLite 文件，再完全靠 `projectId` 隔离全部定义层”。

### 8.3 Worker / Tauri 还不是等价实现

当前真正完整的是：

- `packages/runtime-node`

其他运行时适配目前更偏：

- 轻量桥接
- 最小链路

所以如果你要做一个真正能跑完整框架链路的 App，当前优先用 Node runtime。

## 9. 防止重复造轮子的检查清单

以后每次开新 App，先自问下面这些问题：

1. 我要的是 Prompt 装配，还是只是懒得去找 PromptCompiler？
2. 我要的是多 Agent workflow，还是想在 App 层临时写一个手搓 orchestrator？
3. 我要的是工具系统，还是准备在前端/业务层重写一套 function-call 协议？
4. 我要的是资源目录，还是准备绕开 catalog 再造一个树结构？
5. 我要的是可观测性，还是准备在业务层另外打日志而不进 trace/state diff/side effect？
6. 我要的是人工介入，还是准备自己发明一套 patch/fork/approval 协议？

只要答案指向框架已有能力，就优先复用现有实现。

## 10. 推荐阅读顺序（做 App 时）

1. `docs/SimpleAgent框架总览与代码导览.md`
2. 本文档
3. `packages/core/src/types/contracts.ts`
4. `packages/core/src/prompt/compiler.ts`
5. `packages/runtime-node/src/runtime/engine.ts`
6. `packages/runtime-node/src/api/http.ts`
7. `packages/runtime-node/src/ws/server.ts`
8. `packages/runtime-node/src/storage/db.ts`

## 11. 最后一句话

当前最推荐的新 App 开发模式是：

> 前端自己写，运行包装自己配，真正的 Agent runtime 继续复用 `packages/runtime-node`，配置、调试、回放、工具、Catalog、审批、Fork 都尽量走现成接口。

这样才能保证：

- 不重复造轮子；
- 不把框架能力埋没在应用层；
- 后续 AI 写新项目时不必重新阅读整个仓库才能知道哪些能力已经存在。
