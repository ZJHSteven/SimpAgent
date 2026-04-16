# ExecPlan：整理实验目录并初始化 Vite 前端

## 当前目标
- 把根目录里临时复刻 ChatGPT 网页产生的 HTML、资源、测试和 npm 文件统一收进 `chatgpt-temp/`。
- 根目录仅保留项目管理与编辑器相关文件，例如 `.git`、`.vscode`、`.gitignore`、`PLANS.md`、`PROGRESS.md`。
- 使用 Vite CLI 初始化新的 React 前端项目到 `frontend/`，作为后续正式前后端整合的起点。

## 执行步骤
1. [进行中] 记录本次目录整理计划，明确两次提交边界。
2. [待执行] 创建 `chatgpt-temp/`，迁移 `tem.html`、`assets/`、`tests/`、`package.json`、`package-lock.json` 等旧实验文件。
3. [待执行] 在 `chatgpt-temp/` 内运行旧 Playwright 测试，确认相对路径和测试入口仍可用。
4. [待执行] 更新 `PROGRESS.md`，提交旧实验归档变更。
5. [待执行] 查阅 Vite React 初始化方式，并用 CLI 在 `frontend/` 创建 React 项目。
6. [待执行] 运行 `frontend` 的安装、构建与基础校验，确认脚手架可用。
7. [待执行] 更新 `PROGRESS.md`，提交前端脚手架变更。

## 验收标准
- 根目录不再散落旧实验的 HTML、assets、tests、根级 npm 文件和测试产物。
- `chatgpt-temp/` 中保留旧静态实验的可运行结构，旧测试可以从该目录执行。
- `frontend/` 是独立 Vite React 项目，至少通过一次构建验证。
- `PROGRESS.md` 记录最新目录状态和下一步。
