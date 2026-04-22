# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：SimpChat 前端仍然是真实接后端的状态；SimpAgent 后端测试已经分成两层，现有 mock 测试继续负责稳定回归，真 LLM smoke test 已经改成从 `simpagent.toml` 读取配置，不再依赖环境变量。
- 已完成：
  - [x] 后端 monorepo、agent-core、runtime、CLI/server、流式 token、工具错误回填与基础测试已完成。
  - [x] React 前端迁移、ChatGPT 风格布局、受控输入器、移动端侧栏和 focus 视觉回归已完成。
  - [x] 已为 `frontend` 新增 `simpagentApi` 客户端层，默认通过 `/api` 访问后端，可用 `VITE_SIMPAGENT_API_BASE` 覆盖。
  - [x] 已为 `frontend` 新增 `useSimpAgentChat` 状态 hook，集中维护 threads、当前消息、run 状态、工具审批和思考步骤。
  - [x] 已将左侧栏改为真实 thread 列表，支持创建新聊天、选择历史聊天和本地搜索。
  - [x] 已将发送消息改为 `POST /threads/:id/runs` + `EventSource /runs/:runId/events`，支持 `message_delta` 打字式输出。
  - [x] 已将 `thinking_delta`、`tool_call`、`tool_result`、`trace_snapshot` 和 `error` 渲染到右侧“已思考”面板。
  - [x] 已将 `tool_approval_requested` 渲染为审批按钮，允许/拒绝会回填 `POST /runs/:runId/tool-approvals/:toolCallId`。
  - [x] 已修复 `UserMessage.jsx` 直接修改 props 导致的 React lint 错误。
  - [x] 已为后端补强启动恢复 thread、首次发送自动标题、稳定 404/400、SSE 终止后关闭连接。
  - [x] 已新增 server Vitest，覆盖 thread 恢复、标题生成、SSE 输出和错误边界。
  - [x] 已确认现有后端测试主要是 mock/本地可控回归，适合稳定覆盖解析、流式转发和 trace 逻辑。
  - [x] 已决定新增独立的真 LLM smoke test 层，用于真实厂商 SSE 的手工验证。
  - [x] 已新增 `npm run test:smoke` 和专用 `vitest.smoke.config.ts`，默认只收集 `.smoke.test.ts` 文件。
  - [x] 已新增 smoke 专用 TOML 读取器和普通单测，确认可从 `simpagent.toml` 读取 `smokeChatModel`、`smokeReasoningModel` 等字段。
  - [x] 已新增 `GET /models` 接口，并在 smoke test 中先拉模型列表再校验配置里的模型是否可用。
  - [x] 已把 smoke test 运行条件写入根目录 README，明确需要在 `simpagent.toml` 中填写 smoke 字段。
  - [x] 已更新 README，补充前端真实连接后的启动方式：后端 `npm run server`，前端 `npm.cmd --prefix frontend run dev -- --host 127.0.0.1`。
  - [x] 已更新 `frontend` Playwright 测试，用 mock HTTP API 和 mock EventSource 验证真实连接行为。
- 正在做：
  - [x] 正在新增 smoke test 分层和真实 API 用例。
- 下一步：把本地 `simpagent.toml` 的 smoke 字段补齐后，直接跑 `npm run test:smoke` 做一次真实 DeepSeek/LLM 验证。

## 关键决策与理由（防止“吃书”）
- 决策A：`agent-core` 继续负责 agent loop、事件协议、工具闭环；`runtime-node` 继续只注入 Node 环境能力。（原因：保持 large core + environment runtime 的主线边界。）
- 决策B：前端默认使用 Vite `/api` proxy 连接 `http://127.0.0.1:8787`，并允许用 `SIMPAGENT_PROXY_TARGET` 改代理目标；不是在浏览器里直连裸后端地址。（原因：本地开发避免 CORS，默认端口被占用时也能换后端端口。）
- 决策C：前端不引入额外状态库，先用 `useSimpAgentChat` 管理真实连接状态。（原因：当前状态规模可控，少一层依赖更容易让初学者阅读。）
- 决策D：run 完成后前端重新拉取 thread 快照，但保留本轮 live thought steps。（原因：后端 thread 快照有最终消息，live steps 有 trace 等可观测事件，两者不能互相覆盖。）
- 决策E：server 在 `done/error` 后主动结束 SSE response。（原因：浏览器 EventSource 和自动化测试都不应无限挂着已结束 run 的连接。）

## 常见坑 / 复现方法
- 坑1：`chatgpt-temp/` 是视觉参考归档，不是当前 React 主应用入口。
- 坑2：ChatGPT 兼容 CSS 很大，Vite build 会提示部分 `/cdn/assets/*.woff*` 运行时路径未解析，以及 `::scroll-button` 伪元素兼容警告；当前不阻断构建。
- 坑3：输入框上下蓝线不是 `outline`，而是 `textarea.ProseMirror` focus 后继承的蓝色 `box-shadow`；只断言 `outline-style: none` 会漏测。
- 坑4：server 启动恢复历史 thread 后，`IncrementalIdGenerator` 会重新从 `thread_1` 开始；`AgentPool` 必须避让已有 thread id，避免新建会话覆盖历史。
- 坑5：SSE 如果在 `done` 后不主动关闭，浏览器和测试都会留下长连接；server 现在在 `done/error` 后结束 SSE response。
- 坑6：前端 run done 后会重新拉取 thread 快照；如果直接覆盖思考步骤，会丢掉 live `trace_snapshot` 等事件，所以刷新消息时保留本轮 live thought steps。
- 复测记录：本轮已通过 `npm run typecheck`、`npm test`、`npm.cmd --prefix frontend run lint`、`npm.cmd --prefix frontend run build`、`npm.cmd --prefix frontend run test:e2e`。
