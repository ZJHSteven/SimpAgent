# ExecPlan：前端首屏加载性能修复

## 目标
- 修复 `localhost:5173` 首次 HTML 请求可能卡 2 秒以上的问题。
- 降低聊天首屏同步加载的 JS 体量，避免非聊天工作区和 Markdown/代码渲染链阻塞首屏。
- 用构建、类型检查、Playwright 和浏览器性能脚本验证修复结果。

## 计划
1. 将 Vite dev server 调整为 IPv4/IPv6 双栈监听，消除 `localhost` 地址族回退造成的连接等待。
2. 把非首屏工作区页面、右侧思考面板、Markdown 渲染器、工具代码块渲染器改为按需加载。
3. 更新 `PROGRESS.md` 记录本次根因、修复和复测方式。
4. 运行 `lint`、严格类型检查、生产构建、Playwright e2e 和本地浏览器加载时序复测。
