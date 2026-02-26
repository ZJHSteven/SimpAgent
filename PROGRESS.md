# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：v0.2 已进入“可体验阶段”：后端主链路已从 `invoke` 改为 `stream` 驱动的多轮工具循环（默认上限 4 轮），并新增三层工具架构骨架、builtin tools、状态差异/副作用落库、WS 重连增强；前端已替换为白皮书风测试工作台（可联调 run/trace/history/fork/builtin tools/apply_patch dry-run）。
- 已完成：
  - v0.1 主链路保留可用（LangGraph.js 运行时、HTTP API、WS 调试通道、SQLite 配置/Trace、checkpoint/history/patch/fork）。
  - v0.2 类型契约扩展（Canonical Tool Layer / PromptUnit / ToolExposurePlan / SideEffect / StateDiff / BuiltinToolConfig / PlanState / UserInputRequestState）。
  - SQLite schema + `AppDatabase` 新增表与方法：`state_diffs`、`side_effects`、`tool_exposure_plans`、`run_plans`、`user_input_requests`。
  - 三层工具架构骨架：canonical mapper / router / exposure planner（含策略选择器）。
  - builtin tools 默认定义：`shell_command`、`apply_patch`、`read_file`、`web_search`、`update_plan`、`request_user_input`、`view_image`。
  - `apply_patch` 模块最小可用实现：parser / validator / applier + dry-run 执行器。
  - `engine.ts` 的 `runAgentNode()` 已接入 `providerClient.stream(...)`、`AgentRoundExecutor`、`ToolLoopExecutor`，支持多轮工具循环并开始记录 `model_tool_call_detected`、`side_effect_recorded`、`tool_exposure_plan`。
  - 节点级最小 `state diff` 摘要落库与 trace。
  - HTTP 新接口：builtin tools、`apply_patch dry-run`、`state-diffs`、`side-effects`、`run plan`、`tool exposure policies`。
  - WS 增强：`run_snapshot.latestTraceSeq`、`REPLAY_WINDOW_MISS` warning。
  - 前端测试工作台（Vite/React）：白皮书风单页，多面板覆盖 run/trace/history/fork/builtin/apply_patch/WS 日志。
  - 验证：`backend npm run build` 通过、`backend npm run test:smoke` 通过、根前端 `npm run build` 通过。
- 正在做：继续把三层工具架构“真正打通”到内层暴露适配（当前 exposure plan 已生成并记录，但 custom/structured/prompt 协议仍以 function 形式承载），以及 PromptUnit 装配器对 PromptCompiler 的深度接入。
- 下一步：
  1. 将内层暴露适配器从“计划/trace”推进到真实请求转换（`chat_custom` / `structured_output` / `prompt_protocol`）。
  2. 将 `PromptCompiler` 从 PromptBlock 插槽拼接升级为 `PromptUnit + PromptAssemblyPlan` 真装配器（含位置/排序/人工覆盖）。
  3. 补齐 HTTP/WS 更多接口（`tool_exposure_plans` 查询、用户输入请求列表、更细粒度 prompt unit 编辑）。
  4. 增加端到端测试：真流式 tool call、多轮循环、`request_user_input` 中断恢复、WS 重连补拉。

## 关键决策与理由（防止“吃书”）
- 决策A：执行内核采用 LangGraph.js（原因：直接获得 checkpoint / interrupt / replay / history / updateState，避免自研运行时黑洞）。
- 决策B：配置与 Trace 基线使用 SQLite（原因：单机迭代快、结构清晰、便于调试与查询）。
- 决策C：Provider 层不依赖 SDK，统一 `fetch + REST/SSE`（原因：兼容 OpenAI 与 Gemini/OpenAI-compatible，更可控）。
- 决策D：工具系统采用统一抽象（function/shell/http/mcp_proxy），而非全量 shell 化（原因：兼容性和安全性更稳）。
- 决策E：v0.2 工具体系采用“三层架构”（外层来源层 -> 中间 Canonical Tool Layer -> 内层模型暴露适配层），原因：换模型 API 时不重写工具定义，只切暴露策略。
- 决策F：memory/history/worldbook 在提示词编译侧统一为 `PromptUnit`，原因：避免“记忆特殊化”导致能力不一致，便于可视化装配与人工编辑。
- 决策G：runtime 先完成“真流式 + 多轮工具循环”主链路，再逐步细化 `chat_custom/structured/prompt` 的真实请求转换，原因：先把可观测性和循环时序跑通，避免同时改协议与运行时导致调试面过宽。
- 决策H：内层暴露适配器的选择由“模型路由配置（API家族/工具协议画像）”决定，而不是由人按工具逐个指定，原因：工具定义应保持 API 无关，换模型只改路由画像配置即可。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
- 坑4：LangGraph `StateGraph` 在动态节点 ID 的 TypeScript 泛型约束比较严格，动态构图时容易报类型错误；首版可在构图处使用 `any` 包裹 builder，后续再做更强类型化封装。
- 坑5：`JsonValue` 类型不允许 `undefined`，前端/执行器返回对象里如果带 `undefined` 字段会导致 TypeScript 报错；需在返回前删除字段或改用显式 `null`。
- 坑6：PowerShell 会把 `rg` 正则中的 `|` 当成管道符；复杂正则查询时需改用更简单模式或额外转义。
