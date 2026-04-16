# ExecPlan：本地化 ChatGPT 资源并复刻聊天页面

## 视觉结论
- 视觉主张：优先复用原 ChatGPT 快照引用的 CSS 和 SVG sprite，避免手工重绘导致图标、配色和 composer 观感偏差。
- 内容计划：左侧历史栏、顶部模型/标题栏、中间消息流、底部输入器、简单的本地交互反馈。
- 交互主张：composer 尽量贴近原 DOM 结构，同时保留本地输入、发送、空输入拦截和移动端侧栏。

## 执行步骤
1. [已完成] 从原始快照确认核心资源地址：`/cdn/assets/style-hx6lsrxf.css` 和 `/cdn/assets/sprites-core-a066ed1a.svg`。
2. [进行中] 下载原始 CSS 和 SVG sprite 到本地 `assets/chatgpt/`。
3. [待执行] 改造 `tem.html`，让 composer 复用原 DOM 类名、按钮结构和真实 sprite 图标。
4. [待执行] 保留必要的本地 JS 交互：输入、发送、空输入拦截、Enter/Shift+Enter、移动端侧栏。
5. [待执行] 更新 Playwright 测试，验证真实图标资源加载、composer 结构、桌面/移动交互和横向溢出。

## 验收标准
- `tem.html` 能直接用浏览器打开，不需要开发服务器。
- ChatGPT 原始 CSS 和 SVG sprite 已本地化，不再依赖在线 `/cdn/assets/...`。
- composer 的加号、进阶思考、听写、发送按钮使用真实 sprite `<use>` 图标。
- 页面在桌面端显示左侧栏，在移动端不横向溢出。
- 空输入不会发送，正常输入会追加消息并给出模拟回复。
- HTML/CSS/JS 没有基础语法错误，Playwright 能完成可视化与交互测试。
