# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：SimpChat 前端已从本地模拟切换为真实调用 `apps/server`；thread 列表、历史选择、搜索、发送、SSE 流式输出、工具审批和思考面板都已接入。
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
  - [x] 已更新 README，补充前端真实连接后的启动方式：后端 `npm run server`，前端 `npm.cmd --prefix frontend run dev -- --host 127.0.0.1`。
  - [x] 已更新 `frontend` Playwright 测试，用 mock HTTP API 和 mock EventSource 验证真实连接行为。
  - [x] 已将 `frontend` 统一迁移到 Tailwind CSS 4 + `@tailwindcss/vite`，并用 shadcn CLI 初始化 `components.json`、`button` 和 `cn` 工具函数。
  - [x] 已在 `ai-element-refactor` 分支安装 AI Elements 组件源码和配套 shadcn/ui 组件，作为本轮前端重构基线。
  - [x] 已补装 shadcn `sidebar`，并用 shadcn Sidebar 重建左侧工作区入口。
  - [x] 已用 AI Elements `Conversation`、`Message`、`PromptInput`、`ModelSelector`、`Context`、`Confirmation`、`Tool`、`ChainOfThought` 替换聊天主路径、输入框、工具审批和思考栏。
  - [x] 已删除旧 ChatGPT 复刻组件、`chatgpt-compat.css` 和本地 SVG sprite。
- 正在做：
  - [ ] 正在执行根项目 typecheck/build/lint/test 回归，确认前端分支没有误伤后端和 runtime。
- 下一步：完成根项目回归后收口提交；启动联调仍使用后端 `npm run server` 和前端 `npm.cmd --prefix frontend run dev -- --host 127.0.0.1`。

## 关键决策与理由（防止“吃书”）
- 决策A：`agent-core` 继续负责 agent loop、事件协议、工具闭环；`runtime-node` 继续只注入 Node 环境能力。（原因：保持 large core + environment runtime 的主线边界。）
- 决策B：前端默认使用 Vite `/api` proxy 连接 `http://127.0.0.1:8787`，并允许用 `SIMPAGENT_PROXY_TARGET` 改代理目标；不是在浏览器里直连裸后端地址。（原因：本地开发避免 CORS，默认端口被占用时也能换后端端口。）
- 决策C：前端不引入额外状态库，先用 `useSimpAgentChat` 管理真实连接状态。（原因：当前状态规模可控，少一层依赖更容易让初学者阅读。）
- 决策D：run 完成后前端重新拉取 thread 快照，但保留本轮 live thought steps。（原因：后端 thread 快照有最终消息，live steps 有 trace 等可观测事件，两者不能互相覆盖。）
- 决策E：server 在 `done/error` 后主动结束 SSE response。（原因：浏览器 EventSource 和自动化测试都不应无限挂着已结束 run 的连接。）
- 决策F：`frontend` 使用 Tailwind CSS 4 的 CSS-first 配置，不再保留 `tailwind.config.js` / `postcss.config.js`。（原因：Tailwind 4 的 Vite 官方接入方式是 `@tailwindcss/vite` + `@import "tailwindcss"`；shadcn v4 的 `components.json` 中 `tailwind.config` 应为空。）
- 决策G：本轮删除业务层旧 CSS，不删除 AI Elements/shadcn 组件源码内部自带的默认 Tailwind class。（原因：组件库源码里的 class 是组件默认实现；真正需要移除的是项目自己复制和手写的视觉层。）

## 常见坑 / 复现方法
- 坑1：`chatgpt-temp/` 是视觉参考归档，不是当前 React 主应用入口。
- 坑2：ChatGPT 兼容 CSS 很大，Vite build 会提示部分 `/cdn/assets/*.woff*` 运行时路径未解析，以及 `::scroll-button` 伪元素兼容警告；当前不阻断构建。
- 坑3：输入框上下蓝线不是 `outline`，而是 `textarea.ProseMirror` focus 后继承的蓝色 `box-shadow`；只断言 `outline-style: none` 会漏测。
- 坑4：server 启动恢复历史 thread 后，`IncrementalIdGenerator` 会重新从 `thread_1` 开始；`AgentPool` 必须避让已有 thread id，避免新建会话覆盖历史。
- 坑5：SSE 如果在 `done` 后不主动关闭，浏览器和测试都会留下长连接；server 现在在 `done/error` 后结束 SSE response。
- 坑6：前端 run done 后会重新拉取 thread 快照；如果直接覆盖思考步骤，会丢掉 live `trace_snapshot` 等事件，所以刷新消息时保留本轮 live thought steps。
- 坑7：shadcn 命令必须在 `frontend/` 下执行；仓库根目录不是 Vite 应用入口，直接在根目录跑会被识别成 `Manual` 或找不到 Tailwind CSS 入口。
- 坑8：Tailwind 4 正常情况下没有 `tailwind.config.js`；判断是否装好应看 `npx shadcn@latest info --json` 里的 `tailwindVersion: "v4"` 和 `tailwindCss: "src/index.css"`。
- 坑9：AI Elements 当前源码会用到 `String.replaceAll`、`Array.at`、`Array.toReversed`，前端 `tsconfig` 至少要使用 ES2023 lib，单靠 Vite build 不能替代严格类型检查。
- 坑10：AI Elements 的 Markdown/code 渲染会引入 shiki/mermaid 等异步 chunks，JS chunk 会明显增大；这和删除旧 CSS 是两个不同维度，后续可再做代码分割优化。
- 坑11：Playwright `reuseExistingServer: true` 会复用 5173 上已有 Vite 服务；如果旧 worktree 的 dev server 没停，测试会跑到旧页面。复测前需要确认 5173 来自当前 worktree，或停止旧进程后重跑。
- 复测记录：本轮已通过 `npm run typecheck`、`npm test`、`npm.cmd --prefix frontend run lint`、`npm.cmd --prefix frontend run build`、`npm.cmd --prefix frontend run test:e2e`、`cd frontend; npx tsc --noEmit --pretty false`、`cd frontend; npx shadcn@latest info --json`。
