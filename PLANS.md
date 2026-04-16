# ExecPlan：完善 ChatGPT 静态页面复刻

## 视觉结论
- 视觉主张：优先复用原 ChatGPT 快照引用的 CSS 和 SVG sprite，避免手工重绘导致图标、配色和 composer 观感偏差。
- 内容计划：左侧栏支持宽屏展开/收起，中间消息流补充“思考”按钮，右侧补充思考详情面板，底部 composer 保持已本地化的原资源样式。
- 交互主张：先把静态 HTML 页面排好；shadcn 组件抽取放到下一步，不在本轮引入组件库结构。

## 执行步骤
1. [已完成] 从原始快照确认核心资源地址：`/cdn/assets/style-hx6lsrxf.css` 和 `/cdn/assets/sprites-core-a066ed1a.svg`。
2. [已完成] 下载原始 CSS 和 SVG sprite 到本地 `assets/chatgpt/`，并内联 composer 所需 symbol。
3. [已完成] 修复 composer 刷新后 placeholder 导致输入区域偏高的问题。
4. [已完成] 改造侧栏：宽屏也支持展开/收起，收起态为窄 rail，展开态收紧宽度并复用原始菜单图标。
5. [已完成] 增加“思考”按钮和右侧思考面板，复用原始思考图标与步骤样式。
6. [进行中] 更新 Playwright 测试，覆盖 composer 初始高度、侧栏展开/收起、思考面板开关、桌面/移动无横向溢出。

## 验收标准
- `tem.html` 能直接用浏览器打开，不需要开发服务器。
- ChatGPT 原始 CSS 和 SVG sprite 已本地化，不再依赖在线 `/cdn/assets/...`。
- composer 的加号、进阶思考、听写、发送按钮使用真实 sprite `<use>` 图标。
- 页面在桌面端显示左侧栏，在移动端不横向溢出。
- 空输入不会发送，正常输入会追加消息并给出模拟回复。
- HTML/CSS/JS 没有基础语法错误，Playwright 能完成可视化与交互测试。
