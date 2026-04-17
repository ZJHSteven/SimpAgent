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
3. [ ] **回归测试**
   - 扩展 Playwright 桌面用例，断言 focus 输入后 textarea 没有蓝色 `box-shadow`，外层 composer 没有绿色描边。
   - 运行 `frontend` 的 lint、build、E2E，并补一次真实浏览器 computed style 复查。
