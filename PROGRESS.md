# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：根目录仍混放旧 ChatGPT 静态复刻实验文件、测试文件、根级 npm 文件和运行产物；本轮已先写入目录整理 ExecPlan。
- 已完成：确认旧实验当前由 `tem.html`、`assets/chatgpt/`、`tests/chat-ui.spec.js`、根级 `package.json` 与 `package-lock.json` 组成。
- 正在做：把旧实验统一归档到 `chatgpt-temp/`，再初始化新的 Vite React 前端到 `frontend/`。
- 下一步：迁移旧实验文件，验证旧 Playwright 测试从新目录仍可运行，然后提交归档变更。

## 关键决策与理由（防止“吃书”）
- 决策A：旧 ChatGPT 复刻实验统一命名为 `chatgpt-temp/`。（原因：这是临时测试实验，不应继续散落在正式项目根目录。）
- 决策B：新正式前端目录使用 `frontend/`。（原因：语义清晰，便于后续与后端或其他服务目录并列维护。）
- 决策C：根目录保留 `.gitignore`、`PLANS.md`、`PROGRESS.md`。（原因：这些属于仓库级管理文件，不应放入旧实验归档目录。）

## 常见坑 / 复现方法
- 坑1：移动旧实验后，测试工作目录会变化；需要从 `chatgpt-temp/` 执行测试，避免相对路径失效。
- 坑2：直接删除根级 npm 文件会丢失旧 Playwright 测试依赖锁定；应随旧实验一起移动。
