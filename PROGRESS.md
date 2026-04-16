# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：用户反馈手工重绘的 composer、SVG 和配色与原 ChatGPT 差异明显，要求直接下载原资源并复用。
- 已完成：已验证 `https://chatgpt.com/cdn/assets/style-hx6lsrxf.css` 和 `https://chatgpt.com/cdn/assets/sprites-core-a066ed1a.svg` 均可访问。
- 正在做：准备把原始 CSS 和 SVG sprite 下载到本地，并让 `tem.html` 的 composer 复用真实资源。
- 下一步：改造 composer 结构与测试，确保本地打开时图标、按钮和输入区域正常。

## 关键决策与理由（防止“吃书”）
- 决策A：仍不保留原始 ChatGPT 全量快照。（原因：全量快照包含大量 React 运行数据、用户态信息和第三方脚本，不适合作为干净模板。）
- 决策B：保留纯 HTML/CSS/JS 主体，但下载并复用原始 CSS 与 SVG sprite。（原因：用户明确要求不要手工重绘图标和 composer 样式。）

## 常见坑 / 复现方法
- 坑1：直接打开原始快照会缺少 `/cdn/assets/...` 等站点资源，导致样式或图标丢失。
- 坑2：复制的页面含有大量用户历史、实验配置和第三方脚本，不能作为干净模板长期维护。
