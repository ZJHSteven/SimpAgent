# ExecPlan：SimpChat Frontend AI Elements 重构收口

## 当前目标
- 使用已经安装到 `frontend/src/components/ai-elements/` 的 AI Elements 组件重构聊天主路径。
- 使用 shadcn/ui 组件重建左侧工作区导航和基础交互，不继续沿用旧 ChatGPT 复刻 CSS。
- 保持现有 `simpagentApi.js` 与 `useSimpAgentChat.js` 后端连接能力：thread、SSE、工具审批和思考事件仍然可用。
- 删除业务层旧样式：不再使用 `chatgpt-compat.css`，业务组件不再依赖 `.app-shell`、`.sidebar`、`.composer-*`、`.message-*`、`.thought-*` 等旧 class。

## 执行步骤
1. [x] **基础工程与组件基线**
   - 将 `frontend/tsconfig.json` 的 target/lib 升级到 ES2023。
   - 修正本计划文档，避免旧计划和乱码转义继续干扰上下文。
   - 更新 `PROGRESS.md`，记录当前进入 AI Elements 重构收口。
   - 补装缺失的 shadcn `sidebar` 组件。
2. [x] **三栏应用骨架**
   - 用 shadcn `SidebarProvider`、`Sidebar`、`SidebarMenu*` 重建左侧栏。
   - 左侧栏提供 Chat、Agent 设置、Graph、Plans、Queue、Task、Tools、Commit、Environment、Files、Preview、Package、Sandbox、Schema、Stack Trace 等入口。
   - 主区域根据当前入口切换：Chat 显示聊天；其他入口显示 AI Elements 诊断/配置/图视图。
3. [x] **聊天主路径**
   - 用 `Conversation`、`ConversationContent`、`ConversationScrollButton` 替代旧消息滚动容器。
   - 用 `Message`、`MessageContent`、`MessageResponse` 渲染 user/assistant markdown。
   - 用 `PromptInput`、`PromptInputTextarea`、`PromptInputSubmit` 替代旧 `Composer*`。
   - 用 `ModelSelector` 替代固定模型按钮，用 `Context` 显示估算上下文。
   - 用 `Attachments`/`Attachment` 展示上传附件状态。
4. [x] **工具、审批、思考与诊断**
   - 用 `Confirmation` 替换旧 Human Approval 卡片，并继续调用现有审批接口。
   - 用 `Tool`、`Terminal`、`CodeBlock` 渲染工具、终端和代码类内容。
   - 用 `ChainOfThought`、`Reasoning`、`Shimmer` 重建右侧思考栏。
   - Graph 页面用 `@xyflow/react` + AI Elements `Canvas`、`Node`、`Edge`、`Panel`、`Controls` 拼出静态工作流视图。
5. [ ] **清理与验证**
   - [x] 删除 `frontend/src/styles/chatgpt-compat.css` 引入和旧业务样式。
   - [x] 更新 Playwright 用例，改用 role、文本、可访问名称和稳定组件行为断言。
   - [x] 执行前端 lint、tsc、build、E2E。
   - [x] 用真实 Chromium 检查桌面/移动截图、console/pageerror 和横向溢出。
   - [ ] 执行根项目 typecheck/build/lint/test。

## 验收标准
- 前端业务 UI 主路径由 AI Elements 和 shadcn/ui 组件组成，旧 ChatGPT 复刻样式层不再参与构建。
- 历史 thread、新聊天、搜索、发送、SSE 流式输出、工具审批、思考右栏和移动侧栏均可用。
- `npm.cmd --prefix frontend run lint`、`npx.cmd tsc -p frontend/tsconfig.json --noEmit`、`npm.cmd --prefix frontend run build`、`npm.cmd --prefix frontend run test:e2e` 全部通过。
- 根目录 `npm run typecheck`、`npm run build`、`npm run lint`、`npm test` 全部通过。
- 生产构建不再出现 `chatgpt-compat.css` 引起的 `/cdn/assets/*` 字体路径警告，CSS 体积明显下降。
