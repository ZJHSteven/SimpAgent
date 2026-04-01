# SimpAgent Monorepo

SimpAgent 当前已经不是“单个 demo 后端”，而是一个以 `packages/core + packages/runtime-node` 为主干的多运行时 Agent 框架仓库。

当前最重要的结论只有两条：

1. `packages/runtime-node` 是现在真正的框架真源。
2. 后续做新 App 时，优先复用现成运行时、PromptCompiler、Workflow、Tool、Catalog、Trace、SQLite、HTTP/WS 调试面，不要再从零重写一套 Agent 后端。

## 先读哪几份文档

如果你要继续开发这个仓库，推荐按下面顺序读：

1. [`docs/SimpleAgent框架总览与代码导览.md`](docs/SimpleAgent框架总览与代码导览.md)
   说明框架主干在哪、关键目录和关键文件分别负责什么。
2. [`docs/基于SimpleAgent框架开发App指南.md`](docs/基于SimpleAgent框架开发App指南.md)
   说明“如果你要做一个新 App，到底应该怎么接这个框架”。
3. [`PROGRESS.md`](PROGRESS.md)
   看当前最新结论、已知边界、关键决策和下一步。
4. [`PLANS.md`](PLANS.md)
   只看当前还没完成的执行计划。

## 当前目录结构

```text
simpagent/
  packages/
    core/                  # 跨运行时抽象层：类型、Prompt、Ports、工具循环、WorkflowRegistry
    runtime-node/          # 当前主后端实现：SQLite、LangGraph、HTTP、WS、权限、Catalog、测试
    runtime-worker/        # Worker 轻量适配层（最小链路）
    runtime-tauri-bridge/  # Tauri 前端桥接契约
  apps/
    mededu-cockpit/        # 医学教育前端演示应用
    trpg-desktop/          # 跑团桌面端占位
    learning-desktop/      # 学习桌面端占位
  docs/
  PLANS.md
  PROGRESS.md
```

## 框架已经能直接复用的能力

下面这些能力，后续新 App 开发时都应优先复用，而不是重复造轮子：

- Agentic loop：`AgentRoundExecutor + ToolLoopExecutor`
- PromptCompiler：PromptUnit 装配、PromptTrace、PromptAssemblyPlan、Prompt override
- Workflow：多节点执行、条件边、interrupt、resume、fork、handoff
- Tool 系统：builtin tools、canonical tool、provider 暴露适配、MCP/skill 执行
- Catalog：统一节点 / facet / relation、Prompt 投影、上下文投影
- 存储：SQLite 版本化配置、run、trace、state diff、side effect、approval、checkpoint 索引
- 可观测性：HTTP 查询面 + WebSocket 实时 trace
- Human-in-the-loop：approval request、request_user_input、state patch、prompt patch、fork

## 推荐的 App 开发方式

### 1. 不要再单独发明一个 Agent runtime

当前推荐方式不是“每个 App 都写一个新 backend”，而是：

- 用 `@simpagent/runtime-node` 作为统一运行时；
- 每个 App 只做自己的运行包装：
  - `projectId`
  - `dataDir`
  - `presetDir`（可选）
  - `port`
- 前端直接连现成的 HTTP / WS 接口。

### 2. 不要手写 Prompt 拼接

如果你要控制提示词，请优先使用：

- `PromptUnit`
- `promptBindings`
- `PromptUnitOverride`
- `PromptTrace / PromptAssemblyPlan`

不要再退回“手写一个巨大 system prompt 字符串”的做法。

### 3. 不要手写 function-call 协议层

工具系统已经有三层：

- 外层来源层：builtin / catalog tool / MCP / skill
- 中层统一层：canonical tool
- 内层暴露层：responses / chat_function / prompt protocol 等适配器

如果你要接工具，请优先扩展现有工具主链，不要在 app 里直接重写 OpenAI function calling 拼装逻辑。

## 快速开始

在仓库根目录执行：

```bash
npm install
npm run build:workspaces
npm run test:workspaces
```

单独启动当前主后端：

```bash
npm run --workspace @simpagent/runtime-node dev
```

单独运行医学教育前端：

```bash
npm run --workspace @simpagent/app-mededu-cockpit dev
```

## 当前后端默认接口分组

### 控制面

- `POST /api/runs`
- `POST /api/runs/:runId/pause`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/interrupt`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/state-patch`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-unit-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/fork`

### 查询面

- `GET /api/runs/:runId`
- `GET /api/threads/:threadId/history`
- `GET /api/trace/:runId/events`
- `GET /api/trace/:runId/prompt/:compileId`
- `GET /api/runs/:runId/state-diffs`
- `GET /api/runs/:runId/side-effects`
- `GET /api/runs/:runId/tool-exposure-plans`
- `GET /api/runs/:runId/user-input-requests`
- `GET /api/runs/:runId/approval-requests`

### 定义层管理

- `GET/POST/PUT /api/agents`
- `GET/POST/PUT /api/workflows`
- `GET/POST/PUT /api/prompt-units`
- `GET /api/tools`
- `GET/PUT /api/tools/builtin/:name`
- `GET/POST/PUT/DELETE /api/catalog/*`
- `GET/PUT /api/config/system`
- `GET /api/templates`
- `POST /api/templates/:templateId/apply`

### 实时观察

WebSocket 默认路径：

```text
ws://localhost:3002/ws
```

主要消息：

- 客户端 -> 服务端：`hello`、`subscribe_run`、`unsubscribe_run`、`ping`、`request_replay_events`
- 服务端 -> 客户端：`hello_ack`、`subscribed`、`heartbeat`、`trace_event`、`run_snapshot`、`replay_events_batch`

## 当前已知边界

- `packages/runtime-node` 现在更像“可运行后端主实现”，不是一个已经完全稳定的通用 SDK。
- `projectId` 并没有覆盖所有版本化定义表的数据库分区；当前推荐通过独立 `dataDir` 隔离不同 App。
- `runtime-worker` 和 `runtime-tauri-bridge` 目前仍是适配层，不等价于 `runtime-node`。
- 根目录早期前端入口已经不再是主线，后续开发不要再把根 Vite 壳当成默认应用。

## 一句话开发守则

以后做新 App 时，先查文档，先看 `packages/runtime-node` 是否已有现成能力，再动手写代码。

只要框架里已经有：

- Prompt 装配
- Tool 主链
- Workflow / handoff
- Catalog / Prompt 投影
- HTTP / WS / Trace / Fork / Approval

就不要在应用层重写第二套。
