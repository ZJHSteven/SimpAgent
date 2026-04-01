# ExecPlan（复杂任务先计划）

## 任务名称（2026-04-01）
- 文档收口 + 框架暴露面梳理 + 最小调试台恢复与验证

## 任务边界
- 本轮以 `packages/core`、`packages/runtime-node`、根级文档、`apps/dev-console` 调试台为主。
- `PLANS.md` 只保留当前仍未完成的计划；已完成事项统一沉淀到 `PROGRESS.md`。
- 目标不是再写一份“宣传型概述”，而是给后续 AI / 人类开发者提供一份可直接拿来开发 App 的框架使用说明，并通过最小调试台把关键能力跑通。

## 执行目标（当前进行中）
1. 收缩项目记忆文件：
- 整理 `PLANS.md` 与 `PROGRESS.md` 的职责边界；
- `PLANS.md` 仅保留当前未完成计划；
- `PROGRESS.md` 仅保留最新结论、关键决策、当前风险与下一步。
2. 补齐对外文档：
- 扩展根 `README.md`，明确仓库定位、快速启动、框架与应用关系；
- 新增“框架给 App 开发者用”的开发指南，系统列出当前真实可用的能力、入口、API、推荐接线方式与最小链路。
3. 做一次 package/framework 层核查：
- 只检查 `packages/core` 与 `packages/runtime-node`；
- 识别重复能力、文档漂移、接口断链、命名冲突、最小链路缺口；
- 需要时直接修正代码或测试。
4. 恢复并增强最小调试台：
- 在 `apps/dev-console` 下恢复最小前后端样例；
- 后端继续复用 `@simpagent/runtime-node`，用独立 `projectId/dataDir/presetDir/port` 隔离；
- 前端至少覆盖：run 创建、trace 事件、history、state diff、side effects、tool exposure、approval、catalog、PromptUnit、模板应用、fork 等关键观察面。
5. 做完整验证：
- `build`、package 级测试、调试台构建、最小运行链路、必要的冒烟脚本都要跑；
- 若发现框架问题，本轮直接修。

## 分阶段计划
1. 文档治理
- 重写 `PLANS.md` 与 `PROGRESS.md`。
- 清理 README / 注释 / 旧引用里对 `dev-console`、`mededu-cockpit`、`backend` 的漂移描述。

2. 框架暴露面文档
- 以 `docs/SimpleAgent框架总览与代码导览.md` 为总索引；
- 额外新增一份面向 App 开发的“框架能力与接口手册”；
- 重点写清楚：
  - Agentic loop
  - PromptCompiler / PromptUnit
  - Workflow / handoff
  - Tool / Catalog / MCP / Skill
  - Memory / SQLite / 调试与可观测性
  - Human-in-the-loop / patch / fork / approval

3. 框架核查与修正
- 对照代码、HTTP API、测试、README 检查真实功能边界；
- 优先修正“文档说有、代码里没有”或“代码已改、文档还在旧状态”的问题；
- 如发现最小链路 bug，补测试再修。

4. 调试台恢复
- 恢复 `apps/dev-console` 目录；
- 补齐前端 package、运行说明、运行时包装；
- 前端优先做“框架烟雾测试台”，不做复杂业务。

5. 回归验证与收口
- 运行 `@simpagent/core`、`@simpagent/runtime-node` 构建与测试；
- 运行调试台前后端构建；
- 补充最小使用步骤；
- 更新 `PROGRESS.md` 记录最终状态。

## 本轮完成判据
- `PLANS.md` 不再堆积历史完成任务，且能清晰指导当前执行。
- `PROGRESS.md` 保持短小、最新，并明确当前框架真实状态。
- 根 `README.md` 与新增开发指南能回答“如何基于当前框架开发一个 App”。
- `apps/dev-console` 恢复为可运行的最小调试台，能够观察并触发当前框架关键能力。
- `packages/core`、`packages/runtime-node`、调试台相关构建/测试通过。
