# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：`backend/` 已有 v0.1 可运行骨架，当前正在升级到 v0.2（重点是三层工具架构、真流式工具循环、PromptUnit 与更完整可观测性）。
- 已完成：v0.1 主链路（LangGraph.js 运行时、HTTP API、WS 调试通道、SQLite 配置/Trace、PromptCompiler、ToolRuntime、Provider 兼容层、checkpoint/history/patch/fork、build/smoke 测试）；并已开始 v0.2 基础设施升级：类型契约扩展（Canonical Tool Layer / PromptUnit / ToolExposurePlan / SideEffect / StateDiff / BuiltinToolConfig / PlanState / UserInputRequestState 等）、SQLite schema / `AppDatabase` 新增表与方法（`state_diffs`、`side_effects`、`tool_exposure_plans`、`run_plans`、`user_input_requests`），以及三层工具架构骨架（canonical mapper、router、exposure planner）、builtin tools 默认定义、`apply_patch` parser/validator/applier 与部分 builtin executors 骨架；`backend` 编译仍通过。
- 正在做：按“三份计划合并执行”推进 v0.2 第二阶段，准备把 canonical 工具层接入 runtime，并将 `runAgentNode()` 从 `invoke` 重构为 `stream` 驱动的多轮工具循环。
- 下一步：重构 runtime（`providerClient.stream(...)`、增量 tool call 组装、多轮循环、exposure adapter 接入）；随后补 `state diff`/`side_effect_recorded` 实际落库与 HTTP/WS 接口。

## 关键决策与理由（防止“吃书”）
- 决策A：执行内核采用 LangGraph.js（原因：直接获得 checkpoint / interrupt / replay / history / updateState，避免自研运行时黑洞）。
- 决策B：配置与 Trace 基线使用 SQLite（原因：单机迭代快、结构清晰、便于调试与查询）。
- 决策C：Provider 层不依赖 SDK，统一 `fetch + REST/SSE`（原因：兼容 OpenAI 与 Gemini/OpenAI-compatible，更可控）。
- 决策D：工具系统采用统一抽象（function/shell/http/mcp_proxy），而非全量 shell 化（原因：兼容性和安全性更稳）。
- 决策E：v0.2 工具体系采用“三层架构”（外层来源层 -> 中间 Canonical Tool Layer -> 内层模型暴露适配层），原因：换模型 API 时不重写工具定义，只切暴露策略。
- 决策F：memory/history/worldbook 在提示词编译侧统一为 `PromptUnit`，原因：避免“记忆特殊化”导致能力不一致，便于可视化装配与人工编辑。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
- 坑4：LangGraph `StateGraph` 在动态节点 ID 的 TypeScript 泛型约束比较严格，动态构图时容易报类型错误；首版可在构图处使用 `any` 包裹 builder，后续再做更强类型化封装。
