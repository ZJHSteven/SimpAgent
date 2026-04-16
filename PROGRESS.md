# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：已将原 ChatGPT CSS 与 SVG sprite 下载到 `assets/chatgpt/`，并让 composer 复用真实类名和真实 symbol 图标。
- 已完成：`tem.html` 已切换为 contenteditable 的 ProseMirror 风格输入区，包含加号、进阶思考、听写、发送按钮等原 DOM 结构。
- 正在做：Playwright 测试导入改回官方 `@playwright/test`，运行时将通过 `npx --package @playwright/test` 提供依赖。
- 下一步：重新运行静态检查和 Playwright 桌面/移动测试，修复渲染或交互问题。

## 关键决策与理由（防止“吃书”）
- 决策A：仍不保留原始 ChatGPT 全量快照。（原因：全量快照包含大量 React 运行数据、用户态信息和第三方脚本，不适合作为干净模板。）
- 决策B：保留纯 HTML/CSS/JS 主体，但下载并复用原始 CSS 与 SVG sprite。（原因：用户明确要求不要手工重绘图标和 composer 样式。）

## 常见坑 / 复现方法
- 坑1：直接打开原始快照会缺少 `/cdn/assets/...` 等站点资源，导致样式或图标丢失。
- 坑2：复制的页面含有大量用户历史、实验配置和第三方脚本，不能作为干净模板长期维护。
