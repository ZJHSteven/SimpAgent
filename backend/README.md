# SimpAgent Observable Backend（v0.2）

这是一个从零实现的 **可观测 + 可中断 + 热更新** 多 Agent 框架后端（TypeScript + LangGraph.js）。

## 当前已实现（本仓库当前版本）

- LangGraph.js 运行时内核接入（SQLite checkpoint）
- 版本化配置存储（SQLite）
  - Agent
  - PromptBlock
  - Workflow
  - Tool
- Prompt 编译器（PromptUnit 装配 + Placement + PromptAssemblyPlan + PromptTrace）
- 三层工具架构
  - 外层来源层（builtin + ToolSpec）
  - 中间统一层（CanonicalToolSpec/Intent/Result）
  - 内层暴露适配层（responses/chat_function/chat_custom/structured/prompt）
- Provider 兼容层（不使用 SDK）
  - OpenAI `chat/completions`
  - OpenAI `responses`
  - Gemini OpenAI-compatible `chat/completions`
  - `mock` provider（本地调试）
- ToolRuntime（builtin + user_defined）
  - `function` 执行器
  - `shell` 执行器（白名单 + 超时 + 工作目录）
- 内置工具（首批）
  - `shell_command`
  - `apply_patch`
  - `read_file`
  - `web_search`
  - `update_plan`
  - `request_user_input`
  - `view_image`
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
- `POST /api/threads/:threadId/checkpoints/:checkpointId/prompt-unit-overrides`
- `POST /api/threads/:threadId/checkpoints/:checkpointId/fork`
- `GET /api/trace/:runId/events`
- `GET /api/trace/:runId/prompt/:compileId`
- `GET /api/runs/:runId/state-diffs`
- `GET /api/runs/:runId/side-effects`
- `GET /api/runs/:runId/plan`
- `GET /api/tools/builtin`
- `PUT /api/tools/builtin/:name`
- `POST /api/tools/apply-patch/dry-run`
- `GET /api/config/tool-exposure-policies`
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

### 1) PromptUnit 是一等公民

不是单一 `system prompt` 拼接，而是统一的 `PromptUnit` 装配：

- `PromptBlock` -> `PromptUnit`
- 历史上下文 -> `PromptUnit`
- memory 输入 -> `PromptUnit`
- 任务 payload -> `PromptUnit`
- `PromptUnitOverride`（run-scope）
- `PromptAssemblyPlan` + `PromptTrace`

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

### 3) 工具系统不是“全量 shell 化”，也不是“只暴露 function call”

统一工具抽象 = `CanonicalToolSpec / CanonicalToolCallIntent / CanonicalToolCallResult`

执行器只是实现细节（第二层之后）：

- `function`
- `shell`
- `http`
- `mcp_proxy`（预留）

内层暴露策略（第三层）：

- `responses_native`
- `chat_function`
- `chat_custom`
- `structured_output_tool_call`
- `prompt_protocol_fallback`

并支持按 `fallbackChain` 自动降级（能力不匹配时切换下一策略）。

## 后续建议（下一迭代）

1. 为 prompt-unit-overrides 增加专用前端编辑面板（当前后端接口已就绪）
2. 将 `chat_custom` 的 provider payload 再细化到更多厂商差异（目前已可执行，仍可增强）
3. 为 structured/prompt 模式增加“工具结果回填模板”可配置化
4. 增加更强的 context slicing 策略（token 预算 + 语义相关度）
5. 增加 E2E 测试覆盖更多 provider 真实流式场景
