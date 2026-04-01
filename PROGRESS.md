# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：`packages/runtime-node` 仍是当前框架真源，`packages/core` 提供跨运行时抽象；现有 package 级构建与测试已通过，说明 Node 主链可运行。
- 现状：项目记忆文件此前混入大量历史流水，`PLANS.md` 与 `PROGRESS.md` 的职责边界不清；本轮已开始收口。
- 现状：`apps/dev-console` 在 git 中存在被删除状态，但根 `README.md`、运行时代码默认 `projectId`、部分注释仍把它当成现成调试台，说明“调试台定位仍存在，但工程未恢复”，属于当前最明显的文档/目录漂移。
- 已完成：
  - Monorepo/workspaces 已建立，主线目录为 `packages/*`、`apps/*`、`backend` 兼容壳。
  - `@simpagent/core` 已提供核心契约、PromptCompiler、ToolLoop、WorkflowRegistry、Ports 与统一运行时抽象。
  - `@simpagent/runtime-node` 已接通 SQLite、LangGraph、HTTP API、WebSocket、工具执行、PromptTrace、checkpoint/history/patch/fork、approval 等主链能力。
  - 工具主链已具备：
    - builtin tools（`shell_command`、`apply_patch`、`read_file`、`web_search`、`update_plan`、`request_user_input`、`view_image`、`handoff`）
    - canonical tool 抽象
    - provider 侧暴露适配
    - MCP / skill 结构化执行器
  - 统一图谱 `catalog` 已进入运行时主链，支持节点 / facet / relation CRUD，并能投影为 PromptUnit 与上下文块。
  - human-in-the-loop 已具备：
    - interrupt / resume
    - approval request
    - state patch
    - prompt override
    - fork
  - 现有验证已通过（2026-04-01 再次确认）：
    - `npm run --workspace @simpagent/runtime-node build`
    - `npm run --workspace @simpagent/runtime-node test`
- 正在做：
  - 收缩 `PLANS.md` 与 `PROGRESS.md`，把“当前计划”和“历史沉淀”分开。
  - 清理根 `README.md` 与调试台相关漂移描述。
  - 准备新增“框架给 App 开发者用”的开发指南。
  - 评估并恢复最小 `apps/dev-console` 调试台，用真实框架接口做烟雾测试。
- 下一步：
  1. 补 `README.md` 与新增框架开发指南文档，明确当前对外暴露能力与推荐接线方式。
  2. 核查 `packages/core` 与 `packages/runtime-node` 是否还有“文档说已完成、但代码没接上”的缺口。
  3. 恢复 `apps/dev-console`，并让它覆盖 run / trace / history / prompt / catalog / approval / fork 等关键观察面。
  4. 跑完整构建与测试，确认调试台不是展示壳，而是能走真实最小链路。

## 关键决策与理由（防止“吃书”）
- 决策A：框架真源继续以 `packages/runtime-node` 为准，而不是回退到 `backend` 或某个 app 内部后端副本。
  原因：运行时、HTTP、WS、SQLite、LangGraph、权限、测试都已集中在这里，继续分叉只会制造双主线。
- 决策B：`PLANS.md` 只记录“当前未完成执行计划”，不再保留已完成历史任务。
  原因：计划文件的作用是指导接下来怎么做，不是保存执行墓碑。
- 决策C：`PROGRESS.md` 只保留最新结论、关键决策、当前风险与下一步。
  原因：项目记忆需要短快，避免长上下文下继续失真。
- 决策D：新增一份面向 App 开发的框架文档，而不是继续把所有信息堆在总览文档里。
  原因：`docs/SimpleAgent框架总览与代码导览.md` 适合“找代码”，但不够直接回答“怎么基于框架造一个 app”。
- 决策E：调试台继续复用 `@simpagent/runtime-node`，通过 `projectId/dataDir/presetDir/port` 做隔离，不另写一套后端。
  原因：调试台的目标是验证框架，而不是复制框架。

## 常见坑 / 复现方法
- 坑1：仓库里曾存在 `apps/dev-console`，但当前工作区该目录被删除；如果只看 README 会误以为它仍可直接运行。
- 坑2：`apps/mededu-cockpit` 的 `App.tsx` 文件头仍提到 `apps/dev-console`，这属于历史注释漂移，不代表当前目录角色正确。
- 坑3：根 `README.md` 仍引用旧的 dev-console 运行方式，和当前文件树不一致；文档判断前必须先对照实际目录与 `git status`。
- 坑4：Windows 下大补丁改文档容易一次过大，必要时拆分提交；否则后续 review 很难定位真正的结构变化。
- 坑5：当前测试已经能证明 package/framework 主链可运行，但还不能自动证明“调试台前端”这层也已经恢复并接通，因此本轮必须补一条 app 级验证链。
