# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：v0.2 已进入“主干可用阶段”：后端已完成 `stream` 驱动多轮工具循环 + 三层工具架构执行面 + PromptUnit 装配落地；前端测试工作台可联调主要能力。
- 已完成：
  - v0.1 主链路保留可用（LangGraph.js 运行时、HTTP API、WS 调试通道、SQLite 配置/Trace、checkpoint/history/patch/fork）。
  - v0.2 类型契约扩展（Canonical Tool Layer / PromptUnit / ToolExposurePlan / SideEffect / StateDiff / BuiltinToolConfig / PlanState / UserInputRequestState）。
  - SQLite schema + `AppDatabase` 新增表与方法：`state_diffs`、`side_effects`、`tool_exposure_plans`、`run_plans`、`user_input_requests`。
  - 三层工具架构从骨架推进到执行面：
    - `exposurePlanner` 不再只产计划，新增 `buildModelRequest + parseModelToolSignal`；
    - 五类适配器已接入运行时：`responses_native/chat_function/chat_custom/structured_output/prompt_protocol`；
    - `fallbackChain` 已在 runtime 生效：当首选适配器与模型能力不匹配时自动降级。
    - 模型路由 `toolProtocolProfile` 可直接驱动内层适配选择。
  - builtin tools 默认定义：`shell_command`、`apply_patch`、`read_file`、`web_search`、`update_plan`、`request_user_input`、`view_image`。
  - `apply_patch` 模块最小可用实现：parser / validator / applier + dry-run 执行器。
  - `engine.ts` 的 `runAgentNode()` 已接入“适配器驱动”链路：
    - 先由适配器构建模型请求；
    - 再由 `ToolLoopExecutor` 进行多轮循环；
    - 当 provider 原生 tool_call 缺失时，自动走适配器文本协议解析（structured/prompt/custom fallback）。
  - PromptCompiler 已升级到 `PromptUnit + PromptAssemblyPlan`：
    - block/history/memory/task/tool catalog 全部统一成 PromptUnit；
    - 支持 `promptUnitOverrides`（enable/disable/改内容/改角色/改位置/改排序）；
    - `promptTrace.promptAssemblyPlan` 已落库可查。
  - 节点级最小 `state diff` 摘要落库与 trace。
  - HTTP 新接口：builtin tools、`apply_patch dry-run`、`state-diffs`、`side-effects`、`run plan`、`tool exposure policies`、`prompt-unit-overrides patch`。
  - WS 增强：`run_snapshot.latestTraceSeq`、`REPLAY_WINDOW_MISS` warning。
  - 前端测试工作台（Vite/React）：白皮书风单页，多面板覆盖 run/trace/history/fork/builtin/apply_patch/WS 日志。
- 验证：`backend npm run build` 通过、`backend npm run test:smoke` 通过、根前端 `npm run build` 通过（2026-02-28）。
- 正在做：补测试与前端对 `promptUnitOverrides` 的可视化编辑。
- 下一步：
  1. 增加 `tool_exposure_plans` 与 `user_input_requests` 查询接口（便于前端面板补全）。
  2. 前端补 `promptUnitOverrides` 编辑器（当前已有后端 patch 接口）。
  3. 加强 structured/prompt 模式下的“工具结果回填模板”与回合终止策略可配置化。
  4. 增加端到端测试：多协议工具循环、`request_user_input` 中断恢复、WS 重连补拉。

## 关键决策与理由（防止“吃书”）
- 决策A：执行内核采用 LangGraph.js（原因：直接获得 checkpoint / interrupt / replay / history / updateState，避免自研运行时黑洞）。
- 决策B：配置与 Trace 基线使用 SQLite（原因：单机迭代快、结构清晰、便于调试与查询）。
- 决策C：Provider 层不依赖 SDK，统一 `fetch + REST/SSE`（原因：兼容 OpenAI 与 Gemini/OpenAI-compatible，更可控）。
- 决策D：工具系统采用统一抽象（function/shell/http/mcp_proxy），而非全量 shell 化（原因：兼容性和安全性更稳）。
- 决策E：v0.2 工具体系采用“三层架构”（外层来源层 -> 中间 Canonical Tool Layer -> 内层模型暴露适配层），原因：换模型 API 时不重写工具定义，只切暴露策略。
- 决策F：memory/history/worldbook 在提示词编译侧统一为 `PromptUnit`，原因：避免“记忆特殊化”导致能力不一致，便于可视化装配与人工编辑。
- 决策G：runtime 先完成“真流式 + 多轮工具循环”主链路，再逐步细化 `chat_custom/structured/prompt` 的真实请求转换，原因：先把可观测性和循环时序跑通，避免同时改协议与运行时导致调试面过宽。
- 决策H：内层暴露适配器的选择由“模型路由配置（API家族/工具协议画像）”决定，而不是由人按工具逐个指定，原因：工具定义应保持 API 无关，换模型只改路由画像配置即可。
- 决策I：PromptCompiler 统一以 PromptUnit 为最小控制单元，保留 block trace 仅用于兼容，原因：实现“万物皆提示词块”的统一编排与可编辑性。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
- 坑4：LangGraph `StateGraph` 在动态节点 ID 的 TypeScript 泛型约束比较严格，动态构图时容易报类型错误；首版可在构图处使用 `any` 包裹 builder，后续再做更强类型化封装。
- 坑5：`JsonValue` 类型不允许 `undefined`，前端/执行器返回对象里如果带 `undefined` 字段会导致 TypeScript 报错；需在返回前删除字段或改用显式 `null`。
- 坑6：PowerShell 会把 `rg` 正则中的 `|` 当成管道符；复杂正则查询时需改用更简单模式或额外转义。
