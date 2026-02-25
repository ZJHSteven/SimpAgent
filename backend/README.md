# SimpAgent Observable Backend（v0.1 骨架）

这是一个从零实现的 **可观测 + 可中断 + 热更新** 多 Agent 框架后端骨架（TypeScript + LangGraph.js）。

## 当前已实现（本仓库当前版本）

- LangGraph.js 运行时内核接入（SQLite checkpoint）
- 版本化配置存储（SQLite）
  - Agent
  - PromptBlock
  - Workflow
  - Tool
- Prompt 编译器（PromptBlock 装配 + 插槽 + 触发条件 + PromptTrace）
- Provider 兼容层（不使用 SDK）
  - OpenAI `chat/completions`
  - OpenAI `responses`
  - Gemini OpenAI-compatible `chat/completions`
  - `mock` provider（本地调试）
- ToolRuntime
  - `function` 执行器
  - `shell` 执行器（白名单 + 超时 + 工作目录）
- TraceEventBus（SQLite 存储 + 实时分发）
- HTTP API（run / history / patch / fork / config）
- WebSocket 实时调试通道（订阅 run / 心跳 / 按 seq 补发）

## 快速启动

在 `backend/` 目录执行：

```bash
npm install
npm run build
npm run dev
```

默认端口：

- HTTP: `http://localhost:3002`
- WS: `ws://localhost:3002/ws`

## 最小冒烟测试

```bash
npm run test:smoke
```

该脚本不会启动 HTTP 服务，而是直接创建运行时并发起一个 `mock` run，用于验证主干链路可用。

## 关键接口（首版）

### HTTP（控制面）

- `POST /api/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/pause`
- `POST /api/runs/:runId/resume`
- `POST /api/runs/:runId/interrupt`
- `GET /api/threads/:threadId/history`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/state-patch`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/fork`
- `GET /api/trace/:runId/events`
- `GET /api/trace/:runId/prompt/:compileId`
- `GET/POST/PUT /api/agents`
- `GET/POST/PUT /api/workflows`
- `GET/POST/PUT /api/prompt-blocks`
- `GET/PUT /api/tools`

### WebSocket（实时调试面）

客户端 -> 服务端：

- `hello`
- `subscribe_run`
- `unsubscribe_run`
- `ping`
- `ack`（预留）
- `request_replay_events`

服务端 -> 客户端：

- `hello_ack`
- `subscribed`
- `heartbeat`
- `trace_event`
- `run_snapshot`
- `replay_events_batch`
- `warning`
- `error`

## 设计说明（重要）

### 1) “提示词块系统”是一等公民

不是单一 `system prompt` 拼接，而是：

- `PromptBlock`
- `insertionPoint`
- `priority`
- `trigger`
- `override patch`
- `PromptTrace`

这样调试器可以看到“为什么某块被选中/被裁掉/插在什么位置”。

### 2) LangGraph 负责运行时脏活

LangGraph.js 在本项目中负责：

- checkpoint
- interrupt / resume
- state history
- updateState
- checkpoint 基础上的 replay/fork

框架层负责：

- PromptCompiler
- ToolRuntime
- Provider 兼容层
- Trace / Debug API / WS
- 配置版本化与热更新

### 3) 工具系统不是“全量 shell 化”

统一工具抽象 = `ToolSpec / ToolCall / ToolResult / ToolTrace`

执行器只是实现细节：

- `function`
- `shell`
- `http`
- `mcp_proxy`（预留）

## 后续建议（下一迭代）

1. 将 PromptBlock / ToolPolicy / ModelPolicy 增加 Zod 校验与错误定位
2. 引入 PromptBlock 表达式触发器解析器（替代 v0.1 的“占位接受”）
3. 提升 Provider 流式事件与工具循环（Responses API 深度事件支持）
4. 增加断线重连后的 `run_snapshot + trace diff` 优化策略
5. 增加调试前端（仅需消费当前 HTTP + WS 协议即可）

