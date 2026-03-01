# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：已完成一次性工程分层重构，项目从“单 backend + 单前端”升级为 `monorepo + 多运行时适配` 结构；Node 主链路可用，Worker 与 Tauri bridge 已有可运行骨架。
- 已完成：
-  - Monorepo/workspaces 建立完成：`packages/*` + `apps/*` + `backend` 兼容壳。
-  - 新增 `@simpagent/core`：
-    - 抽离公共类型契约（`types/contracts`）。
-    - 抽离 PromptCompiler、ToolCallAssembler、AgentRoundExecutor、ToolLoopExecutor。
-    - 新增 Ports 抽象：`StoragePort / CheckpointPort / ModelPort / ToolExecutionPort / EventStreamPort / ConfigResolverPort`。
-    - 新增 `createRuntimeEngine(deps)` 统一入口。
-    - 新增三层配置合并器：`Runtime Patch > User Override > Preset`。
-  - 新增 `@simpagent/runtime-node`：
-    - 复制并承接原 backend 主实现。
-    - 通过 `engineNodeBindings` 接入 core 统一入口。
-    - 冒烟测试通过（`test:smoke`）。
-  - 新增 `@simpagent/runtime-worker`：
-    - 提供 Workers + D1 最小链路（health/run/trace/config resolve）。
-  - 新增 `@simpagent/runtime-tauri-bridge`：
-    - 定义 Tauri invoke 契约与 mock bridge。
-  - 新增 `apps/trpg-desktop`、`apps/learning-desktop`、`apps/dev-console` 工程位。
-  - `backend` 改为兼容壳，旧命令转发到 `@simpagent/runtime-node`。
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
  - `runtime-node` v0.3（框架层）补齐完成：
    - 新增 `GET /api/runs/:runId/tool-exposure-plans` 与 `GET /api/runs/:runId/user-input-requests`。
    - 新增 `GET/PUT /api/config/system`（系统级默认模型路由/窗口/日志上限）。
    - 新增 `GET /api/templates` 与 `POST /api/templates/:templateId/apply`。
    - 内置工具配置由“内存态”迁移到 SQLite 表 `builtin_tool_configs`（重启不丢失）。
    - 新增 `system_configs` 表与默认系统配置回退逻辑。
    - 内置医学模板 `mededu-default-v1` 已内置，可一键应用生成多 Agent 预设。
    - `runtime-node` 启动新增 `SIMPAGENT_PROJECT_ID` 项目隔离目录（默认 `dev-console`）。
  - `apps/dev-console` 已从占位升级为可运行工程（Vite + React + TS）并完成 7 页路由：
    - `/agents`：Agent/PromptBlock/Tool 配置入口（JSON 可编辑）。
    - `/workflow`：Workflow 配置入口与节点摘要。
    - `/memory`：state-diffs / side-effects / run plan 观察。
    - `/run`：融合运行舱（会话+时间线+节点详情+日志抽屉，含 WS 订阅）。
    - `/trace`：trace / prompt compile 审计页。
    - `/replay`：history / checkpoint / patch / fork 实验页。
    - `/settings`：system config + builtin tools + 模板应用。
  - Stitch 设计联动已执行：
    - Run Fusion 改造生成屏：`019a7de7174740a99d4dc7778be2ea61`（含 loading/error 变体）。
    - System Settings 新增屏：`65f544feea4b4d168e92dc6a96fe610b`（含 loading/success 变体）。
  - WS 增强：`run_snapshot.latestTraceSeq`、`REPLAY_WINDOW_MISS` warning。
  - 前端测试工作台（Vite/React）：白皮书风单页，多面板覆盖 run/trace/history/fork/builtin/apply_patch/WS 日志。
- 验证：`npm run build:workspaces` 通过、`npm run --workspace @simpagent/runtime-node test:smoke` 通过、根前端 `npm run build` 通过（2026-03-01）。
- 正在做：同步页面/API 对照文档与剩余细节校验（重点是配置三层可视化说明与工具协议策略说明）。
- 下一步：
  1. 在 Settings 页补充三层配置（Preset/Override/Runtime Patch）可视化对照卡片。
  2. 补充 Run Fusion 的分支图可视组件（当前为时间线列表，后续可升级成节点图）。
  3. 规划 `apps/learning-desktop` 与 `apps/trpg-desktop` 对 `dev-console` 配置能力的复用边界。
  4. 补齐 worker/tauri 路径下与 `config/system` 对齐的桥接协议。

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
- 决策J：工程形态升级为 monorepo（core + runtime-node + runtime-worker + runtime-tauri-bridge + apps），原因：避免“复制项目”导致分叉失控，支持多端复用与独立演进。
- 决策K：`backend` 保留兼容壳而不是立即删除，原因：一次性重构期间降低迁移风险，兼容旧脚本和使用习惯。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
- 坑4：LangGraph `StateGraph` 在动态节点 ID 的 TypeScript 泛型约束比较严格，动态构图时容易报类型错误；首版可在构图处使用 `any` 包裹 builder，后续再做更强类型化封装。
- 坑5：`JsonValue` 类型不允许 `undefined`，前端/执行器返回对象里如果带 `undefined` 字段会导致 TypeScript 报错；需在返回前删除字段或改用显式 `null`。
- 坑6：PowerShell 会把 `rg` 正则中的 `|` 当成管道符；复杂正则查询时需改用更简单模式或额外转义。
- 坑7：部分 npm 版本不支持 `workspace:*` 依赖声明；若安装报 `EUNSUPPORTEDPROTOCOL`，需改为明确版本号并依赖 workspaces 的本地链接机制。
