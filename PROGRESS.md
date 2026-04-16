# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：旧 ChatGPT 静态复刻实验已统一归档到 `chatgpt-temp/`；根目录不再散落旧实验 HTML、assets、tests、根级 npm 文件和测试产物。
- 已完成：移动 `tem.html`、`assets/`、`tests/`、`package.json`、`package-lock.json`、`node_modules/`、`test-results/` 到 `chatgpt-temp/`；从新目录运行旧 Playwright 测试，2 个用例全部通过。
- 正在做：提交旧实验归档变更，然后初始化新的 Vite React 前端到 `frontend/`。
- 下一步：用 Vite CLI 创建 `frontend/`，安装依赖并运行构建验证。

## 关键决策与理由（防止“吃书”）
- 决策A：旧 ChatGPT 复刻实验统一命名为 `chatgpt-temp/`。（原因：这是临时测试实验，不应继续散落在正式项目根目录。）
- 决策B：新正式前端目录使用 `frontend/`。（原因：语义清晰，便于后续与后端或其他服务目录并列维护。）
- 决策C：根目录保留 `.gitignore`、`PLANS.md`、`PROGRESS.md`。（原因：这些属于仓库级管理文件，不应放入旧实验归档目录。）

## 常见坑 / 复现方法
- 坑1：移动旧实验后，测试工作目录会变化；需要从 `chatgpt-temp/` 执行测试，避免相对路径失效。
- 坑2：直接删除根级 npm 文件会丢失旧 Playwright 测试依赖锁定；应随旧实验一起移动。
- 坑3：根目录执行 `rg --files -uu` 会扫出 `.git/` 和移动后的依赖目录；盘点源码时应显式排除 `.git/`、`node_modules/` 与测试产物。
