# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：TS 后端首版纵向跑通已完成；当前任务切换为修复 CLI 流式输出、工具错误回填，并补充根目录 README。
- 已完成：
    - [x] 后端 monorepo、agent-core、runtime、CLI/server 与测试已完成并通过历史验收。
    - [x] 明确本轮前端迁移目标：视觉尽量不变，底层改成 React 组件化和状态驱动。
    - [x] 明确迁移时修复两个现有故障：模型按钮缺少可访问名称、移动端侧栏按钮重复触发。
    - [x] 明确样式采用兼容层优先：先保留关键 class、变量、DOM 层级和 ChatGPT 兼容 CSS，不做一次性纯原子类重写。
    - [x] 明确输入器最终使用 React 受控 `textarea`，外观继续模拟当前 ProseMirror 风格 composer。
    - [x] 已更新 `PLANS.md` 记录前端迁移 ExecPlan。
    - [x] 已将 Vite 默认页面替换为 SimpChat React 页面。
    - [x] 已拆分 `layout`、`chat`、`composer`、`ui` 组件，避免把整页塞进 `App.jsx`。
    - [x] 已把消息、历史记录、思考步骤改成数据驱动渲染。
    - [x] 已迁移 `tem.html` 内联 CSS 与 ChatGPT 兼容 CSS，并生成 `frontend/public/icons.svg`。
    - [x] 已把输入器改为 React 受控 `textarea`，保留 composer 外观结构。
    - [x] 已通过 `frontend` 的 `npm run lint` 与 `npm run build`。
    - [x] 已为 `frontend` 增加 Playwright 配置、`test:e2e` 脚本和桌面/移动端/中文输入法组合态测试。
    - [x] 已修复 Playwright 暴露的侧栏过渡断言、移动遮罩层级、表格重复 key 和组合态测试问题。
    - [x] 已通过 `frontend` 的 `npm run test:e2e`（3 个用例全部通过）。
    - [x] 已完成最终验证：`frontend` 的 `npm run lint`、`npm run build`、`npm run test:e2e` 全部通过。
    - [x] 已完成根项目回归：`npm run typecheck`、`npm run build`、`npm run lint`、`npm test` 全部通过。
    - [x] 已重新定位并修复 React 受控 `textarea` 聚焦视觉问题：两条蓝线来自兼容 CSS 的 ProseMirror focus `box-shadow`，绿色外圈来自上一版新增的 `.composer-surface-local:focus-within` 内描边。
    - [x] 已补齐 `apps/cli/src/index.ts` 与 `apps/server/src/index.ts` 的教学向中文注释（文件头、函数头、关键流程注释），并通过 `npm run typecheck` 与 `npm test` 回归验证。
    - [x] 已按要求先提交现有注释改动：`docs: 补充 CLI 与 server 教学注释`。
    - [x] 已确认 CLI 非真流式的根因：adapter 先完整读取 SSE，再把事件列表交给 agent loop。
    - [x] 已确认工具错误中断的根因：参数解析和工具执行异常没有转换成 `tool` 消息回填给模型。
- 正在做：
    - [ ] 按 `PLANS.md` 的新 ExecPlan 修复 CLI 流式输出与工具错误回填。
    - [ ] 新增根目录 `README.md`，说明项目结构与使用方式。
- 下一步：实现 adapter 增量事件回调、agent loop 工具错误回填，并补齐测试与 README。

## 关键决策与理由（防止“吃书”）
- 决策A：`chatgpt-temp/tem.html` 保留为视觉和行为参考，不删除。（原因：迁移需要可回看原始 DOM、样式和交互。）
- 决策B：本轮不接入真实 AI 后端，只保留本地模拟回复。（原因：用户当前目标是技术栈迁移和静态界面可用性。）
- 决策C：`frontend/` 暂不强行加入根 npm workspace。（原因：当前前端已有独立 `package.json` 和 lockfile，先降低迁移范围。）
- 决策D：输入框用受控 `textarea` 承载真实文本。（原因：`contenteditable` 很容易绕过 React 状态管理，长期不可控。）
- 决策E：样式先做兼容迁移，再考虑清理。（原因：无感知迁移的第一优先级是视觉稳定。）
- 决策F：流式修复放在 Chat Completions adapter 层，而不是 CLI 里重复解析 SSE。（原因：server、CLI 和后续 UI 都应复用同一套事件协议。）
- 决策G：工具错误要作为 `ToolExecutionResult` 回填给模型，而不是直接抛到进程级 fatal。（原因：agent loop 的设计目标是让模型看到工具失败原因并继续下一步处理。）

## 常见坑 / 复现方法
- 坑1：当前工作区已有未跟踪文件 `chatgpt-temp/extract_svg.py` 与 `chatgpt-temp/extracted_symbols.txt`；本轮不要误删或误提交无关文件。
- 坑2：现有 `chatgpt-temp` Playwright 测试迁移前已失败，不能把失败当成 React 迁移新增问题。
- 坑3：移动端侧栏按钮之前重复绑定 click，React 版只能绑定一次。
- 坑4：SVG sprite 放到 Vite `public` 后，引用路径应使用 `/icons.svg#id`。
- 坑5：React 组件拆分不能只把整段 HTML 塞进 `App.jsx`；状态、布局、聊天流、输入器、面板需要分层。
- 坑6：ChatGPT 兼容 CSS 很大，Vite build 会提示部分 `/cdn/assets/*.woff*` 运行时路径未解析，以及 `::scroll-button` 伪元素兼容警告；当前不阻断构建，后续裁剪兼容 CSS 时可清理。
- 坑7：输入框上下蓝线不是 `outline`，而是 `textarea.ProseMirror` focus 后继承的蓝色 `box-shadow`；只断言 `outline-style: none` 会漏测。
- 坑8：当前 CLI 的“实时打字”只是打印 `message_delta`，但 `message_delta` 事件本身被 adapter 延后到完整 SSE 结束后才产生。
- 坑9：工具执行链路里一旦 `JSON.parse`、文件读写、shell runtime 抛错，当前实现会中断整个 turn，模型拿不到错误信息。
- 复测记录：`frontend` 的 `npm run lint`、`npm run build`、`npm run test:e2e` 均通过；真实 Chromium computed style 复查显示 focus 输入后 `editorBoxShadow: "none"`，外层 composer 阴影与未聚焦时一致。
