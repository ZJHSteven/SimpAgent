# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：修复了由于 HTML 换行符格式导致 `contenteditable` 悬空撑爆高度的 Bug，并修正了圆角边框设计。目前已完成终端功能测试，确认环境连接正常。
- 已完成：终端连接性测试（`ls` 命令成功执行）；删除了 `contenteditable` 内部多余换行；回滚了 CSS 绝对定位方案；修正了 `border` 和 `border-radius` 设计。
- 正在做：将聊天元素 UI 精修至贴合网站效果和 ChatGPT 原始形态。
- 下一步：对目前的布局与功能做确认，然后在 `frontend` 的 React 工程下复刻和抽离组件，正式实现交互和业务。

## 关键决策与理由（防止“吃书”）
- 决策A：旧 ChatGPT 复刻实验统一命名为 `chatgpt-temp/`。（原因：这是临时测试实验，不应继续散落在正式项目根目录。）
- 决策B：新正式前端目录使用 `frontend/`。（原因：语义清晰，便于后续与后端或其他服务目录并列维护。）
- 决策C：根目录保留 `.gitignore`、`PLANS.md`、`PROGRESS.md`。（原因：这些属于仓库级管理文件，不应放入旧实验归档目录。）
- 决策D：Vite React 初始化命令使用 `npm create vite@latest frontend -- --template react`。（原因：Context7 查询到 Vite 官方文档仍推荐 npm 7+ 使用额外 `--` 传递模板参数。）

## 常见坑 / 复现方法
- 坑1：移动旧实验后，测试工作目录会变化；需要从 `chatgpt-temp/` 执行测试，避免相对路径失效。
- 坑2：直接删除根级 npm 文件会丢失旧 Playwright 测试依赖锁定；应随旧实验一起移动。
- 坑3：根目录执行 `rg --files -uu` 会扫出 `.git/` 和移动后的依赖目录；盘点源码时应显式排除 `.git/`、`node_modules/` 与测试产物。
