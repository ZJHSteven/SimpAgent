# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：TS 后端首版纵向跑通已完成；当前任务切换为把 `chatgpt-temp/tem.html` 无感知迁移到 `frontend/` React 静态界面。
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
- 正在做：
    - [ ] 为 React 前端补充 Playwright 行为测试和截图验证。
- 下一步：添加桌面/移动端 E2E 测试，覆盖发送、新聊天、侧栏、思考面板、图标和无横向溢出。

## 关键决策与理由（防止“吃书”）
- 决策A：`chatgpt-temp/tem.html` 保留为视觉和行为参考，不删除。（原因：迁移需要可回看原始 DOM、样式和交互。）
- 决策B：本轮不接入真实 AI 后端，只保留本地模拟回复。（原因：用户当前目标是技术栈迁移和静态界面可用性。）
- 决策C：`frontend/` 暂不强行加入根 npm workspace。（原因：当前前端已有独立 `package.json` 和 lockfile，先降低迁移范围。）
- 决策D：输入框用受控 `textarea` 承载真实文本。（原因：`contenteditable` 很容易绕过 React 状态管理，长期不可控。）
- 决策E：样式先做兼容迁移，再考虑清理。（原因：无感知迁移的第一优先级是视觉稳定。）

## 常见坑 / 复现方法
- 坑1：当前工作区已有未跟踪文件 `chatgpt-temp/extract_svg.py` 与 `chatgpt-temp/extracted_symbols.txt`；本轮不要误删或误提交无关文件。
- 坑2：现有 `chatgpt-temp` Playwright 测试迁移前已失败，不能把失败当成 React 迁移新增问题。
- 坑3：移动端侧栏按钮之前重复绑定 click，React 版只能绑定一次。
- 坑4：SVG sprite 放到 Vite `public` 后，引用路径应使用 `/icons.svg#id`。
- 坑5：React 组件拆分不能只把整段 HTML 塞进 `App.jsx`；状态、布局、聊天流、输入器、面板需要分层。
- 坑6：ChatGPT 兼容 CSS 很大，Vite build 会提示部分 `/cdn/assets/*.woff*` 运行时路径未解析，以及 `::scroll-button` 伪元素兼容警告；当前不阻断构建，后续裁剪兼容 CSS 时可清理。
