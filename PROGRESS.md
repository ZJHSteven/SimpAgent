# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：旧 ChatGPT 静态复刻实验已统一归档到 `chatgpt-temp/`，新的 Vite React 前端已初始化到 `frontend/`。
- 已完成：`chatgpt-temp/` 旧 Playwright 测试 2 个用例通过；`frontend/` 已安装依赖，`npm run build` 与 `npm run lint` 均通过。
- 正在做：提交 `frontend/` 脚手架变更，完成本轮目录整理。
- 下一步：后续可从 `frontend/` 开始把旧静态复刻逐步组件化，并按正式 VI 前后端目标继续拆分模块。

## 关键决策与理由（防止“吃书”）
- 决策A：旧 ChatGPT 复刻实验统一命名为 `chatgpt-temp/`。（原因：这是临时测试实验，不应继续散落在正式项目根目录。）
- 决策B：新正式前端目录使用 `frontend/`。（原因：语义清晰，便于后续与后端或其他服务目录并列维护。）
- 决策C：根目录保留 `.gitignore`、`PLANS.md`、`PROGRESS.md`。（原因：这些属于仓库级管理文件，不应放入旧实验归档目录。）
- 决策D：Vite React 初始化命令使用 `npm create vite@latest frontend -- --template react`。（原因：Context7 查询到 Vite 官方文档仍推荐 npm 7+ 使用额外 `--` 传递模板参数。）

## 常见坑 / 复现方法
- 坑1：移动旧实验后，测试工作目录会变化；需要从 `chatgpt-temp/` 执行测试，避免相对路径失效。
- 坑2：直接删除根级 npm 文件会丢失旧 Playwright 测试依赖锁定；应随旧实验一起移动。
- 坑3：根目录执行 `rg --files -uu` 会扫出 `.git/` 和移动后的依赖目录；盘点源码时应显式排除 `.git/`、`node_modules/` 与测试产物。
