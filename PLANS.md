# ExecPlan：SimpChat 静态页无感知迁移到 React

## 当前目标
- 将 `chatgpt-temp/tem.html` 的本地 SimpChat 静态聊天界面迁移到 `frontend/` Vite React 应用。
- 保持用户视觉感知尽量不变，只把底层实现改成 React 组件化、状态驱动、可继续扩展的结构。
- 修复迁移前已确认的明显故障：模型按钮缺少 `aria-label="选择模型"`，移动端侧栏按钮重复绑定导致点一次开关两次。

## 执行步骤
1. [x] **计划与进度基线**
   - 用本文件记录前端迁移 ExecPlan。
   - 更新 `PROGRESS.md`，避免后续上下文过长时遗忘当前目标。
2. [x] **React 页面迁移**
   - 替换 Vite 默认 `App.jsx` 页面。
   - 拆分 `layout`、`chat`、`composer`、`ui` 组件。
   - 把消息、历史、思考步骤和本地模拟回复改成数据驱动渲染。
3. [x] **样式与图标迁移**
   - 把 `tem.html` 的内联 CSS 迁入 `frontend/src/index.css`。
   - 复制 ChatGPT 兼容 CSS 到 `frontend/src/styles/chatgpt-compat.css` 并从入口引入。
   - 把页面使用的 SVG symbol 合并到 `frontend/public/icons.svg`，React 统一通过 `/icons.svg#id` 引用。
4. [x] **受控输入器**
   - 保留 `composer`、`composer-primary`、`composer-surface-local` 等外观结构。
   - 用受控 `textarea` 作为真实输入源。
   - 支持空输入拦截、Enter 发送、Shift+Enter 换行、中文输入法组合态不误发送。
5. [x] **测试与验收**
   - 增加 `frontend` Playwright E2E 测试。
   - 执行 `npm run build`、`npm run lint`、Playwright 行为测试和截图验证。

## 验收标准
- React 前端打开后视觉上与 `tem.html` 保持一致，差异只来自故障修复和浏览器渲染细节。
- 不再使用 `document.createElement`、`innerHTML`、`appendChild`、`replaceChildren`、手写 `addEventListener` 管理业务交互。
- 侧栏、移动遮罩、思考面板、消息列表、输入框和帮助提示都由 React state 驱动。
- 桌面端和移动端 E2E 行为测试通过，页面无横向溢出。
- Vite 生产构建和 ESLint 通过。

## 当前结果
- 已完成计划确认、React 页面迁移、样式兼容迁移、SVG sprite 迁移、受控输入器实现和 Playwright 测试补充。
- 已通过 `frontend` 的 `npm run lint`、`npm run build`、`npm run test:e2e`。
- 已通过根项目 `npm run typecheck`、`npm run build`、`npm run lint`、`npm test`。
- React 版 Playwright 测试会在桌面和移动用例中保存截图产物，用于人工视觉复核。

## 输入框 focus 样式返工计划
1. [x] **复现与定位**
   - 用真实 Chromium 聚焦并输入文本，读取 composer 和 textarea 的 computed style。
   - 确认绿色外圈来自上一版 `.composer-surface-local:focus-within`，蓝色横线来自 `textarea.ProseMirror` 的 focus `box-shadow`。
2. [x] **样式修复**
   - 删除外层 composer focus 时新增的绿色内描边，保留原本的 composer 阴影。
   - 在 `.composer-textarea:focus` / `.composer-textarea:focus-visible` 同时清掉 `outline` 和 `box-shadow`。
3. [x] **回归测试**
   - 扩展 Playwright 桌面用例，断言 focus 输入后 textarea 没有蓝色 `box-shadow`，外层 composer 没有绿色描边。
   - 运行 `frontend` 的 lint、build、E2E，并补一次真实浏览器 computed style 复查。

## 输入框 focus 样式返工结果
- 已通过 `frontend` 的 `npm run lint`。
- 已通过 `frontend` 的 `npm run build`；输出仍包含既有兼容 CSS 字体路径与 `::scroll-button` 警告，和本次修复无关。
- 已通过 `frontend` 的 `npm run test:e2e`，3 个 Chromium 用例全部通过。
- 已用真实 Chromium 复查 computed style：focus 并输入文字后 `#prompt-textarea` 的 `box-shadow` 为 `none`，`.composer-surface-local` 的阴影与未聚焦时一致，没有绿色 focus 内描边。

# ExecPlan：CLI 流式输出与工具错误回填修复

## 当前目标
- 修复 CLI 看不到实时“模拟打字效果”的问题，让 SSE token 到达时立刻触发 `message_delta` / `thinking_delta` 事件，而不是等完整响应结束后一次性打印。
- 修复工具调用失败时 agent loop 直接中断的问题，把参数解析失败、工具执行异常等错误转换成结构化 `tool` 消息回填给模型，允许模型继续下一轮处理。
- 新增根目录 `README.md`，说明项目结构、CLI/server 运行方式、agent loop 行为和常见故障定位方法。

## 执行步骤
1. [x] **提交现有注释改动**
   - 已对 `apps/cli/src/index.ts` 与 `apps/server/src/index.ts` 的教学注释改动执行 `npm run typecheck` 和 `npm test`。
   - 已提交为 `docs: 补充 CLI 与 server 教学注释`。
2. [x] **定位流式输出链路**
   - 检查 `readSseStream`、`sendChatCompletionsRequest`、`runAgentTurn`、CLI `printEvent` 的调用顺序。
   - 确认当前阻塞点是 adapter 先完整收集事件，再返回给 agent loop。
3. [x] **实现真流式事件转发**
   - 为 Chat Completions adapter 增加增量事件回调。
   - 保留完整事件列表用于 trace 和工具调用拼装。
   - 确保 CLI/server 仍能复用同一套事件协议。
4. [x] **实现工具错误回填**
   - 将工具参数 JSON 解析异常转换成 `TOOL_ARGUMENT_PARSE_ERROR`。
   - 将 runtime/tool executor 抛出的异常转换成 `TOOL_EXECUTION_ERROR`。
   - 确保错误结果写入 `tool` role 消息，并继续请求模型下一轮。
5. [x] **补齐测试**
   - 增加 adapter 事件回调的流式顺序测试。
   - 增加工具执行异常不会中断 agent loop 的回归测试。
   - 运行 `npm run typecheck`、`npm run build`、`npm run lint`、`npm test`。
6. [x] **补充 README**
   - 新增根目录 README，面向初学者说明项目模块、运行步骤、CLI/server 行为和调试建议。

## 当前结果
- 已提交现有注释改动。
- 已在 adapter 层新增流式事件回调，CLI/server 可在 SSE 分片到达时收到增量事件。
- 已在 agent loop 内将工具参数解析失败和 runtime 抛错转换为结构化工具结果，避免直接 fatal。
- 已新增根目录 `README.md`，说明项目结构、配置、CLI、server、agent loop 和常见问题。
- 已通过完整回归：`npm run typecheck`、`npm run build`、`npm run lint`、`npm test`。

## 验收标准
- CLI 能在流式响应尚未完全结束时收到并打印 token 增量。
- 工具调用异常不会让 CLI/server 直接 fatal，模型能收到结构化错误并继续处理。
- 新增测试覆盖实时事件回调、工具异常回填、原有 deny 策略继续可用。
- 根目录 README 能让初学者按步骤完成安装、配置、CLI 调用、server 调用和测试。
