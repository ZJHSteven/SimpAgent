# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：SimpChat 前端仍然是真实接后端的状态；SQLite 持久化边界修正已完成，schema/trace 映射已下沉到 `agent-core`，`runtime-node` 只保留 Node SQLite 驱动薄层。
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
  - [x] 已新增 `AGENTS.md`，规定 SQLite schema 改动必须先更新人类可读表结构文档。
  - [x] 已新增 `docs/SQLite表结构.md`，明确 `conversations`、`nodes`、`edges`、`events` 和 payload tables 的字段。
  - [x] 已用 `SqliteTraceStore` 替换旧 `JsonFileTraceStore`，默认写入 `.simpagent/simpagent.sqlite`。
  - [x] 已让现有 `TraceStore` 接口映射到 `conversations`、`messages`、`events`、`llm_calls`、`tool_calls`、`tool_approvals`。
  - [x] 已在 SQLite 持久化中脱敏 HTTP `Authorization` header，避免 API key 明文落库。
  - [x] 已把 SQLite schema、tag 关系表、trace 拆分和脱敏规则下沉到 `agent-core/src/storage`。
  - [x] 已把 `runtime-node/src/trace-store.ts` 收缩为 `node:sqlite` 薄适配层。
  - [x] 已删除 `threadSnapshot` 过渡债，不再把完整旧 thread 快照写入 `metadata_json`。
  - [x] 已把 tag 从 `tags_json` 改成 `tags`、`conversation_tags`、`node_tags`、`message_tags` 关系表。
- [x] 已更新 README，补充前端真实连接后的启动方式：后端 `npm run server`，前端 `npm.cmd --prefix frontend run dev -- --host 127.0.0.1`。
- [x] 已将 SimpAgent 默认后端端口从 `8787` 调整为 `8788`，并同步更新前端代理默认目标，避开本机上被其他服务占用的端口。
  - [x] 已更新 `frontend` Playwright 测试，用 mock HTTP API 和 mock EventSource 验证真实连接行为。
- 正在做：
  - [x] SQLite 存储边界修正本轮实现与验证已完成。
- 下一步：通过最终回归后，把 agent loop 从“保存完 trace 后拆分”继续推进到“运行中直接生成细粒度 event”。

## 关键决策与理由（防止“吃书”）
- 决策A：`agent-core` 继续负责 agent loop、事件协议、工具闭环；`runtime-node` 继续只注入 Node 环境能力。（原因：保持 large core + environment runtime 的主线边界。）
- 决策B：前端默认使用 Vite `/api` proxy 连接 `http://127.0.0.1:8788`，并允许用 `SIMPAGENT_PROXY_TARGET` 改代理目标；不是在浏览器里直连裸后端地址。（原因：本地开发避免 CORS，默认端口被占用时也能换后端端口。）
- 决策C：前端不引入额外状态库，先用 `useSimpAgentChat` 管理真实连接状态。（原因：当前状态规模可控，少一层依赖更容易让初学者阅读。）
- 决策D：run 完成后前端重新拉取 thread 快照，但保留本轮 live thought steps。（原因：后端 thread 快照有最终消息，live steps 有 trace 等可观测事件，两者不能互相覆盖。）
- 决策E：server 在 `done/error` 后主动结束 SSE response。（原因：浏览器 EventSource 和自动化测试都不应无限挂着已结束 run 的连接。）
- 决策F：SQLite 第一版不建立 `graphs`、`runs`、`turns` 表；graph 是 `nodes + edges` 的投影，运行事实统一进入 `events`。（原因：动态 handoff/discovery 是主线，固定 workflow 可由 node/edge 子图表达。）
- 决策G：`docs/SQLite表结构.md` 是 schema 真源，任何 SQLite 表结构代码变更必须先改文档。（原因：SQLite 本身不适合人类直接 review，文档必须先于实现。）
- 决策H：tag 不再使用 `tags_json`，统一进入 tag 字典和多对多绑定表。（原因：tag 是后续查询、筛选和管理的重点字段。）
- 决策I：SQLite schema/trace 映射属于 `agent-core`，`runtime-node` 只负责 Node SQLite driver。（原因：SQLite 存储语义需要被 Node、Cloudflare Worker、Tauri 等 runtime 复用。）

## 常见坑 / 复现方法
- 坑1：`chatgpt-temp/` 是视觉参考归档，不是当前 React 主应用入口。
- 坑2：ChatGPT 兼容 CSS 很大，Vite build 会提示部分 `/cdn/assets/*.woff*` 运行时路径未解析，以及 `::scroll-button` 伪元素兼容警告；当前不阻断构建。
- 坑3：输入框上下蓝线不是 `outline`，而是 `textarea.ProseMirror` focus 后继承的蓝色 `box-shadow`；只断言 `outline-style: none` 会漏测。
- 坑4：历史文档或旧 `.simpagent` 数据里可能残留 `thread_1` / `run_1` / `turn_1` 示例；内部新 ID 必须继续使用 UUID v7。
- 坑5：SSE 如果在 `done` 后不主动关闭，浏览器和测试都会留下长连接；server 现在在 `done/error` 后结束 SSE response。
- 坑6：前端 run done 后会重新拉取 thread 快照；如果直接覆盖思考步骤，会丢掉 live `trace_snapshot` 等事件，所以刷新消息时保留本轮 live thought steps。
- 坑7：SQLite 表结构不能只看建表 SQL；后续任何字段、索引、事件类型、节点类型变化都要先更新 `docs/SQLite表结构.md`。
- 复测记录：SQLite 存储边界修正本轮已通过 `npm run typecheck`、`npm test`、`npm run build`、`npm run lint`。前端上一轮已通过 `npm.cmd --prefix frontend run lint`、`npm.cmd --prefix frontend run build`、`npm.cmd --prefix frontend run test:e2e`。
