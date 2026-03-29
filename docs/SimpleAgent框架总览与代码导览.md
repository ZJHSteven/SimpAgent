# SimpleAgent 框架总览与代码导览

## 1. 文档目的与边界

这份文档只讲 **SimpleAgent 框架本身**，不讲 `apps/*` 里的应用层，也不讲根目录 `src/*` 那套早期前端页面。

本次梳理的目标是把下面几件事一次讲清楚，避免后续上下文越来越长之后出现“功能重复实现”“不知道该改哪一层”“把兼容壳误当成主实现”的问题：

- 当前真正的主实现在哪。
- 框架已经具备哪些核心能力。
- 每个关键目录、关键文件分别负责什么。
- 各模块之间的调用关系是什么。
- 哪些部分已经是主干，哪些只是兼容层或轻量适配层。

## 2. 当前真实边界：哪些目录才是框架主干

### 2.1 真正应该关注的目录

- `packages/core`
  - 跨运行时的核心抽象层。
  - 负责类型契约、Prompt 编译、工具循环、工作流注册、配置合并、Ports 抽象。
- `packages/runtime-node`
  - 当前 **真正的主后端实现**。
  - 负责把 `core` 抽象接到 SQLite、LangGraph、HTTP/WS、权限内核、catalog、MCP/skill bridge、测试。
- `packages/runtime-worker`
  - Cloudflare Workers 轻量适配层。
  - 目前只提供最小链路，不是主实现。
- `packages/runtime-tauri-bridge`
  - Tauri 前端桥接契约。
  - 只负责前端调用原生命令的协议封装，不承载运行时主逻辑。
- `backend`
  - 兼容壳。
  - 目的是让旧命令还能工作，主实现已经迁到 `packages/runtime-node`。

### 2.2 本次明确不关注的目录

- `apps/*`
  - 这些是未来或演示用应用，不是框架核心。
- 根目录 `src/*`
  - 属于早期前端遗留，不代表现在的框架主线。

## 3. 一句话架构结论

当前 SimpleAgent 已经从“单个 backend demo”演进为一个 **monorepo 多运行时 Agent 框架**：

- `packages/core` 负责统一抽象与可复用逻辑。
- `packages/runtime-node` 负责真实运行时落地。
- 运行时核心基于 **LangGraph.js + SQLite**。
- 配置层已经支持 **版本化 Agent / PromptUnit / Workflow / Tool**。
- 提示词层已经支持 **PromptUnit 装配、trace、覆盖与回放**。
- 工具体系已经支持 **三层工具架构 + builtin tools + shell bridge + MCP/skill 接入**。
- 资源定义层已经引入 **统一图谱 catalog**，用于统一建模 Prompt / Memory / Tool / Skill / MCP / Worldbook。
- 调试层已经支持 **HTTP API + WebSocket + trace + state diff + side effects + approval requests**。

## 4. 框架核心能力地图

下面这部分可以视为“当前框架到底已经做到了什么”。

### 4.1 Prompt / PromptUnit 装配

核心思想不是“拼一个 system prompt”，而是把多种上下文统一装配成 `messages[]`：

- 持久化提示词定义是 `PromptUnitSpec`，兼容旧名 `PromptBlock`。
- Agent 自己通过 `promptBindings` 决定启用、顺序和局部覆盖。
- 历史消息、记忆输入、工具目录、任务输入也会被投影成 PromptUnit。
- 编译结果除了最终 `messages[]`，还会生成完整 `PromptTrace` 和 `PromptAssemblyPlan`。
- 运行中支持：
  - `overridePatches`
  - `promptUnitOverrides`
  - checkpoint 上的 prompt patch

这意味着后端不是“黑箱提示词拼接器”，而是“可追踪、可解释、可覆盖”的 Prompt 装配系统。

### 4.2 Agent / Workflow / 状态流转

框架运行时以工作流为核心：

- `WorkflowSpec` 描述节点、边、路由和中断策略。
- 节点支持：
  - `agent`
  - `tool`
  - `interrupt`
- `AgentSpec` 描述：
  - 角色
  - 提示词绑定
  - 工具白名单
  - 工具路由策略
  - 记忆策略
  - handoff 策略
  - 输出约束

真正执行时：

1. 创建 run。
2. 冻结一份 snapshot version refs。
3. 把 workflow 编译成 LangGraph `StateGraph`。
4. 每个节点执行后写 trace、state diff、工具记录。
5. 根据边条件或编排器输出来决定下一个节点。
6. 中间可 pause / interrupt / resume / patch / fork。

### 4.3 LangGraph.js 负责的底层能力

根据仓库实现和 LangGraph.js 官方文档语义，这里主要借用了它几类能力：

- `StateGraph`
  - 用来表达节点图和状态推进。
- checkpoint / persistence
  - 用于线程状态持久化和可恢复执行。
- `interrupt()`
  - 用于人工中断、审批、request_user_input、断点。
- `getStateHistory()`
  - 用于 checkpoint 历史回放与可视化。
- `updateState()`
  - 用于 checkpoint patch、time-travel 式修订、分叉恢复。

也就是说，LangGraph 在这里主要扮演“**长时状态机与可恢复执行底座**”，而不是整个框架的全部逻辑。框架自己的职责仍然包括：

- Prompt 编译
- Provider 兼容
- 工具执行
- trace / side effects / 审批
- HTTP / WS 接口
- catalog 与配置版本化

### 4.4 三层工具架构

这是当前框架最关键的一条主线之一。

工具不是直接写死成某一家模型 API 的 function calling，而是拆成三层：

1. 外层来源层
   - builtin tools
   - 普通 `ToolSpec`
   - 后续的 MCP / skill / plugin 等来源
2. 中间统一层
   - `CanonicalToolSpec`
   - `CanonicalToolCallIntent`
   - `CanonicalToolCallResult`
3. 内层暴露适配层
   - `responses_native`
   - `chat_function`
   - `chat_custom`
   - `structured_output_tool_call`
   - `prompt_protocol_fallback`

这样做的意义是：

- 换模型协议时，不需要重写工具定义。
- 同一份工具定义可以按 provider 能力自动降级。
- 工具执行与“如何暴露给模型”彻底解耦。

### 4.5 builtin tools 与 CodeMode 风格桥接

当前内置工具已经覆盖一条比较完整的“编程 Agent”基础链路：

- `shell_command`
- `apply_patch`
- `read_file`
- `web_search`
- `update_plan`
- `request_user_input`
- `view_image`

其中最重要的是 `shell_command` 已经不只是单纯 shell：

- 它先经过统一权限内核评估。
- 命令若是 `simpagent mcp call ...` 或 `simpagent skill call ...`，会进入内部 shell bridge。
- bridge 会把文本命令解析为结构化参数，再转到 MCP client 或本地 skill 脚本执行。

这条链路本质上就是当前框架里的 CodeMode 风格工具路径：

- 模型先看到工具说明或 shell 协议。
- 真执行时再进入可审计、可校验、可限权的桥接层。

### 4.6 统一图谱 catalog

统一图谱是当前 v0.4 的定义层收口方向，目的是把过去容易分散的资源统一到一套目录/图结构中：

- `catalog_nodes`
  - 统一节点主表
- `catalog_relations`
  - 横向图关系
- `catalog_node_facets`
  - 附加能力 facet

当前它已经能承载：

- Prompt
- Memory
- Tool
- Skill
- MCP
- Worldbook

并且已经打通两条重要链路：

1. 显式 prompt 节点 -> `PromptUnit` 主链路
2. tool / memory / skill / mcp 节点 -> 上下文 PromptUnit 投影

这意味着 catalog 不是只放元数据，而是已经实际参与 PromptCompiler 主链了。

### 4.7 权限、审批与副作用审计

执行层已经不是“命令跑了就完了”，而是具备统一权限和审计：

- 权限模式：
  - `deny`
  - `ask`
  - `allow`
- 作用域：
  - `command`
  - `path`
  - `fs`
  - `network`
  - `tool`
- 层级：
  - `system`
  - `project`
  - `agent`
  - `node`

当前已实际落地最成熟的是 shell 权限：

- 命令规则
- 工作目录规则
- `allowCommandPrefixes`
- `requiresHumanApproval`
- approval request 落库
- `interrupt -> resume` 审批恢复链路

同时运行态副作用也会独立落库：

- 文件读写
- 计划更新
- 用户输入
- 审批
- 工具执行
- Web 搜索

### 4.8 可观测性与调试接口

框架已经具备比较完整的调试面：

- SQLite 中保留：
  - runs
  - prompt_compiles
  - trace_events
  - state_diffs
  - side_effects
  - tool_exposure_plans
  - user_input_requests
  - approval_requests
- HTTP 提供命令面和查询面。
- WebSocket 提供实时 trace、心跳、重连补拉。

所以现在它不是“能跑的 Agent demo”，而是已经明显朝“**可调试框架内核**”演进了。

## 5. 主调用链：从创建 Run 到节点执行

下面是当前最值得记住的一条主链路。

### 5.1 启动装配

入口在 `packages/runtime-node/src/index.ts`：

1. 初始化 `AppDatabase`。
2. `seedDefaultConfigs()` 写入默认配置。
3. 创建 `AgentRegistry / WorkflowRegistry / ToolRegistry`。
4. 创建 `PromptCompiler / UnifiedProviderClient / TraceEventBus / ToolRuntime`。
5. 通过 `createNodeBoundRuntimeEngine()` 同时拿到：
   - `nodeEngine`
   - `coreEngine`
6. 注册 HTTP 路由与 WS 服务器。

### 5.2 创建 Run

入口通常是 `POST /api/runs` -> `FrameworkRuntimeEngine.createRun()`：

1. 解析 workflow。
2. 生成 `runId` 和 `threadId`。
3. 冻结本次运行使用的 agent / tool / promptUnit 版本快照。
4. 构造初始 `RunState`。
5. 写入 runs 表。
6. 发出 `run_started` trace。
7. 异步启动 `executeGraph()`。

### 5.3 Graph 执行

`executeGraph()` 会：

1. 获取或构建 LangGraph `StateGraph`。
2. 以 `streamMode: "values"` 执行图。
3. 中途若命中 `interrupt()`，run 状态进入 `waiting_human`。
4. 完成后更新 checkpoint index 与最终 run 状态。

### 5.4 Agent 节点执行

`runAgentNode()` 是最核心的一层：

1. 读取 Agent 快照。
2. 合并普通 PromptUnit 与 catalog context PromptUnit。
3. 按 `toolAllowList`、`toolRoutePolicy` 过滤 canonical tools。
4. 构造 `PromptCompileRequest`。
5. 执行 `PromptCompiler.compile()`。
6. 根据 provider 与 agent 路由策略选择工具暴露适配器。
7. 生成 `ToolExposurePlan`。
8. 写入 prompt compile 与 tool exposure plan。
9. 用 `AgentRoundExecutor + ToolLoopExecutor` 执行多轮“模型 -> 工具 -> 模型”循环。
10. 将工具调用、工具结果、对话消息、state diff 等写回状态。

### 5.5 Tool 节点执行

`runToolNode()` 处理 workflow 里显式的 tool 节点：

- 从节点 config 中取静态参数。
- 用 `inputMapping` 从 state 抽参数。
- 交给 `ToolRuntime.execute()` 执行。
- 再用 `outputMapping` 回写 state 或 artifact。

### 5.6 shell_command / bridge / 审批

当 Agent 在工具循环里触发 `shell_command` 时，路径是：

1. `executeCanonicalToolIntent()` 识别 builtin `shell_command`。
2. `evaluateShellPermission()` 判断 `deny / ask / allow`。
3. 若需要审批：
   - 写入 `approval_requests`
   - 发出 interrupt
   - 等待 resume
4. 若命令是 `simpagent mcp call` / `simpagent skill call`：
   - 进入 `InternalShellBridge`
   - 做命令解析、schema 校验、调用远端或本地脚本
5. 否则回退到 `ToolRuntime` 的普通 shell 执行器。

## 6. 目录与文件导览

下面这部分是“以后找代码要先看哪儿”的核心索引。

---

## 7. `packages/core`：跨运行时核心抽象层

### 7.1 包定位

`packages/core` 不直接依赖 SQLite、Express、WS、Node 子进程这些环境细节，它负责定义“框架应该长什么样”。

### 7.2 目录总览

- `src/types`
  - 框架全局类型契约。
- `src/ports`
  - core 依赖的 Ports 抽象。
- `src/config`
  - 三层配置合并器。
- `src/prompt`
  - Prompt 编译器。
- `src/workflows`
  - Workflow 注册表。
- `src/runtime`
  - Agent 单轮执行、工具循环、core 引擎入口。

### 7.3 文件职责清单

#### 包级文件

- `packages/core/package.json`
  - 定义 `@simpagent/core` 的导出入口。
  - 暴露 `types/contracts`、`ports`、`config`、`runtime`、`prompt`、`workflows`。
- `packages/core/tsconfig.json`
  - TypeScript 构建配置。

#### `src/index.ts`

- `packages/core/src/index.ts`
  - core 包统一出口。
  - 把 `types / ports / config / runtime / prompt / workflows` 汇总导出。

#### `src/types`

- `packages/core/src/types/index.ts`
  - 类型模块总出口。
- `packages/core/src/types/contracts.ts`
  - 框架最重要的总契约文件。
  - 这里定义了：
    - Provider / Run / Tool / Prompt / Workflow 的基础类型；
    - `AgentSpec`、`PromptUnitSpec`、`WorkflowSpec`、`ToolSpec`；
    - 三层工具架构相关 canonical types；
    - `PromptCompileRequest / PromptTrace / PromptAssemblyPlan`；
    - `RunState`、`TraceEvent`、`PlanState`、`ApprovalRequest`；
    - 统一图谱 catalog 相关类型。
  - 如果以后需要判断“某个概念在框架里到底叫什么”，优先先看这个文件。

#### `src/ports`

- `packages/core/src/ports/index.ts`
  - 定义 core 依赖的六类 Port：
    - `StoragePort`
    - `CheckpointPort`
    - `ModelPort`
    - `ToolExecutionPort`
    - `EventStreamPort`
    - `ConfigResolverPort`
  - 同时定义：
    - `CoreRuntimeDeps`
    - `CoreRuntimeEngine`
  - 它的作用是把“核心逻辑”和“具体平台”彻底隔开。

#### `src/config`

- `packages/core/src/config/index.ts`
  - 配置模块出口。
- `packages/core/src/config/resolver.ts`
  - 三层配置合并器。
  - 约定优先级是：
    - `runtimePatch > userOverride > preset`
  - 现在 Node、Worker、Tauri 都在复用这个语义。

#### `src/prompt`

- `packages/core/src/prompt/index.ts`
  - Prompt 模块出口。
- `packages/core/src/prompt/compiler.ts`
  - 当前 Prompt 主链的核心实现。
  - 主要负责：
    - 按 `promptBindings` 选择 PromptUnit；
    - 执行模板变量渲染；
    - 应用 trigger 判定；
    - 处理 tokenLimit；
    - 加入历史上下文、memory、tool catalog、task envelope；
    - 处理 `overridePatches` 和 `promptUnitOverrides`；
    - 组装最终 `messages[]`；
    - 生成 `PromptTrace` 和 `PromptAssemblyPlan`。
  - 这是“提示词装配器”最真实的实现位置。

#### `src/workflows`

- `packages/core/src/workflows/index.ts`
  - Workflow 模块出口。
- `packages/core/src/workflows/registry.ts`
  - Workflow 注册表。
  - 负责：
    - list/get/save
    - 读写缓存
    - 通过 store 读当前版本配置

#### `src/runtime`

- `packages/core/src/runtime/index.ts`
  - 运行时模块出口。
- `packages/core/src/runtime/engine.ts`
  - core 层统一引擎入口 `createRuntimeEngine()`。
  - 本身不负责真实运行，只负责对接 Ports 与适配层注入的 `runExecutor`。
- `packages/core/src/runtime/agentRoundExecutor.ts`
  - “单轮模型调用”执行器。
  - 把 provider 的流式事件归并成：
    - 文本
    - reasoning
    - tool call
    - trace 事件
- `packages/core/src/runtime/toolCallAssembler.ts`
  - 把 provider 流式返回的 tool call 分片重组为完整调用。
- `packages/core/src/runtime/toolLoopExecutor.ts`
  - 多轮工具循环执行器。
  - 统一处理：
    - 模型输出工具调用
    - 工具执行
    - tool message 回填
    - 下一轮模型继续执行

### 7.4 对 `core` 的一句总结

`packages/core` 解决的是“**框架抽象和跨平台复用**”问题，而不是“把后端全做完”。真正的业务后端主干在 `runtime-node`。

---

## 8. `packages/runtime-node`：当前真正的主实现

### 8.1 包定位

这是现在最重要的包。只要你关心“框架现在真的能做什么”，主要就看这里。

### 8.2 顶层目录总览

- `src/index.ts`
  - 启动装配入口。
- `src/runtime`
  - LangGraph 运行时主逻辑。
- `src/storage`
  - SQLite schema、DB 封装、seed、模板。
- `src/core/agents`
  - Agent 注册表。
- `src/core/workflows`
  - Workflow 注册表。
- `src/core/prompt`
  - 复用 core 的 PromptCompiler 出口。
- `src/core/tools`
  - 工具体系：registry、runtime、router、builtin、暴露适配、applyPatch。
- `src/core/trace`
  - trace 总线。
- `src/providers`
  - 模型 provider 兼容层。
- `src/catalog`
  - catalog 纯函数映射。
- `src/bridges`
  - shell bridge。
- `src/security`
  - 权限内核。
- `src/api`
  - HTTP 路由。
- `src/ws`
  - WS 实时调试通道。
- `src/tests`
  - package 级专项测试。

### 8.3 包级文件

- `packages/runtime-node/package.json`
  - 定义当前主后端的脚本：
    - `dev`
    - `build`
    - `start`
    - `test`
    - `test:smoke`
    - `test:catalog-bridge`
    - `test:permissions-catalog`
- `packages/runtime-node/README.md`
  - 当前 Node runtime 的概览说明。
- `packages/runtime-node/tsconfig.json`
  - TS 构建配置。
- `packages/runtime-node/src/index.ts`
  - 真实启动入口。
  - 负责装配数据库、注册表、运行时、HTTP、WS。

### 8.4 `src/engineNodeBindings.ts`

- `packages/runtime-node/src/engineNodeBindings.ts`
  - 把 Node 运行时绑定到 core 抽象层。
  - 同时提供：
    - `nodeEngine`
    - `coreEngine`
  - 它说明当前架构不是“抛弃 core”，而是“Node 主实现建立在 core 抽象之上”。

### 8.5 `src/runtime`：真正的执行内核

- `packages/runtime-node/src/runtime/index.ts`
  - 运行时出口。
- `packages/runtime-node/src/runtime/engine.ts`
  - 当前整个框架最核心的单文件。
  - 主要负责：
    - 创建 run
    - 构建/缓存 LangGraph `StateGraph`
    - 执行节点
    - safe-point interrupt
    - pause / resume / interrupt
    - checkpoint history
    - patch state / patch prompt
    - fork run
    - 运行 agent node / tool node
    - 执行 canonical tool
    - 写 trace / state diff / side effects / approval
  - 如果以后只允许先读一个文件理解“框架主线”，优先读它。
- `packages/runtime-node/src/runtime/agentRoundExecutor.ts`
  - runtime 层对 core 同名模块的复导出/承接。
- `packages/runtime-node/src/runtime/toolCallAssembler.ts`
  - runtime 层对 core 同名模块的复导出/承接。
- `packages/runtime-node/src/runtime/toolLoopExecutor.ts`
  - runtime 层对 core 同名模块的复导出/承接。

### 8.6 `src/storage`：SQLite 持久化层

- `packages/runtime-node/src/storage/index.ts`
  - 存储层出口。
- `packages/runtime-node/src/storage/schema.ts`
  - 所有 SQLite 建表 SQL。
  - 最重要的表分三类：
    - 版本化定义层：
      - `agents`
      - `agent_versions`
      - `prompt_blocks`
      - `prompt_block_versions`
      - `workflows`
      - `workflow_versions`
      - `tools`
      - `tool_versions`
      - `builtin_tool_configs`
      - `system_configs`
      - `catalog_nodes`
      - `catalog_relations`
      - `catalog_node_facets`
    - 运行态表：
      - `runs`
      - `run_threads`
      - `run_checkpoints_index`
      - `trace_events`
      - `prompt_compiles`
      - `tool_calls`
      - `state_diffs`
      - `side_effects`
      - `tool_exposure_plans`
      - `run_plans`
      - `user_input_requests`
      - `approval_requests`
      - `state_patches`
      - `fork_relations`
    - 审计/会话表：
      - `ws_sessions`
      - `audit_logs`
- `packages/runtime-node/src/storage/db.ts`
  - `AppDatabase` 薄封装。
  - 负责：
    - 版本化配置读写；
    - catalog CRUD；
    - run/trace/prompt/tool/state diff/side effect/plan/user input/approval 的读写；
    - system config/builtin config 持久化。
  - 它是整个 Node runtime 的数据中枢。
- `packages/runtime-node/src/storage/seed.ts`
  - 默认种子配置与 JSON preset 导入。
  - 会把默认 Prompt / Tool 同时写入 catalog。
- `packages/runtime-node/src/storage/templates.ts`
  - 框架级模板。
  - 当前内置了 `mededu-default-v1`，可一键写入多 Agent 医学教育模板。

### 8.7 `src/core/agents` 与 `src/core/workflows`

- `packages/runtime-node/src/core/agents/index.ts`
  - Agent 模块出口。
- `packages/runtime-node/src/core/agents/registry.ts`
  - Agent 注册表，负责缓存和版本化保存。
- `packages/runtime-node/src/core/workflows/index.ts`
  - Workflow 模块出口。
- `packages/runtime-node/src/core/workflows/registry.ts`
  - 继承 core 的 WorkflowRegistry，并绑定到 Node 存储实现。
- `packages/runtime-node/src/core/prompt/index.ts`
  - PromptCompiler 出口。
- `packages/runtime-node/src/core/prompt/compiler.ts`
  - 与 core 的 PromptCompiler 对齐的实际实现文件。

### 8.8 `src/core/tools`：工具体系的关键目录

这是理解框架第二条主线的重点目录。

#### 统一出口

- `packages/runtime-node/src/core/tools/index.ts`
  - 汇总导出工具相关所有子模块。

#### 外层来源层 + 中间统一层

- `packages/runtime-node/src/core/tools/builtinSpecs.ts`
  - 定义 builtin tools 的规格、schema、默认暴露策略、默认权限策略。
- `packages/runtime-node/src/core/tools/registry.ts`
  - Tool 注册表。
  - 把：
    - builtin tool config
    - 普通 ToolSpec
    - canonical tool 视图
    统一收口。
- `packages/runtime-node/src/core/tools/canonical/index.ts`
  - 把 builtin / ToolSpec 转成 `CanonicalToolSpec`。
  - 这是三层工具架构第二层的核心辅助。

#### 执行层

- `packages/runtime-node/src/core/tools/runtime.ts`
  - 统一 ToolRuntime。
  - 目前重点实现了：
    - function executor
    - shell executor
  - 负责权限校验、超时、stdout/stderr 收集、trace 组装。
- `packages/runtime-node/src/core/tools/router.ts`
  - canonical tool 路由辅助。
  - 负责根据 canonical tool 信息决定执行入口。

#### 模型暴露适配层

- `packages/runtime-node/src/core/tools/exposurePlanner.ts`
  - 三层工具架构第三层核心。
  - 负责：
    - 把 canonical tools 变成 provider 请求可接受的工具定义；
    - 选择暴露适配器；
    - 从模型文本/原生 tool calls 里解析回统一调用意图。

#### builtin 执行器

- `packages/runtime-node/src/core/tools/builtinExecutors/index.ts`
  - builtin executor 统一出口。
- `packages/runtime-node/src/core/tools/builtinExecutors/applyPatchExecutor.ts`
  - `apply_patch` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/readFileExecutor.ts`
  - `read_file` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/shellCommandExecutor.ts`
  - `shell_command` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/webSearchExecutor.ts`
  - `web_search` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/updatePlanExecutor.ts`
  - `update_plan` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/requestUserInputExecutor.ts`
  - `request_user_input` 执行入口。
- `packages/runtime-node/src/core/tools/builtinExecutors/viewImageExecutor.ts`
  - `view_image` 执行入口。

#### apply_patch 子模块

- `packages/runtime-node/src/core/tools/applyPatch/index.ts`
  - apply_patch 子模块出口。
- `packages/runtime-node/src/core/tools/applyPatch/types.ts`
  - patch AST 类型定义。
- `packages/runtime-node/src/core/tools/applyPatch/parser.ts`
  - patch DSL 解析器。
- `packages/runtime-node/src/core/tools/applyPatch/validator.ts`
  - patch 安全校验器，负责路径越界与基本结构检查。
- `packages/runtime-node/src/core/tools/applyPatch/applier.ts`
  - patch 执行器，负责 add/update/delete/move 的实际文件应用和 dry-run 预览。

### 8.9 `src/providers`：模型兼容层

- `packages/runtime-node/src/providers/index.ts`
  - provider 模块出口。
- `packages/runtime-node/src/providers/capabilities.ts`
  - provider 能力矩阵。
  - 负责在发请求前校验：
    - apiMode
    - tools
    - streaming
    - reasoning
    - thoughts
    - json schema response_format
- `packages/runtime-node/src/providers/sse.ts`
  - SSE 流解析器。
- `packages/runtime-node/src/providers/unifiedClient.ts`
  - 统一 provider client。
  - 负责：
    - OpenAI chat/completions
    - OpenAI responses
    - Gemini OpenAI-compatible chat
    - mock provider
  - 同时提供：
    - 非流式 `invoke`
    - 流式 `stream`
    - tool result message 回填辅助

### 8.10 `src/core/trace`

- `packages/runtime-node/src/core/trace/index.ts`
  - trace 模块出口。
- `packages/runtime-node/src/core/trace/eventBus.ts`
  - 进程内 trace 总线。
  - 一边写 SQLite，一边给 WS 实时订阅。

### 8.11 `src/catalog`

- `packages/runtime-node/src/catalog/index.ts`
  - catalog 模块出口。
- `packages/runtime-node/src/catalog/mappers.ts`
  - catalog 节点和 PromptUnit 之间的纯函数映射。
  - 负责两类转换：
    - 显式 prompt 节点 -> PromptUnit
    - tool/memory/skill/mcp 节点 -> 上下文 PromptUnit 投影

### 8.12 `src/bridges`

- `packages/runtime-node/src/bridges/index.ts`
  - bridge 模块出口。
- `packages/runtime-node/src/bridges/internalShellBridge.ts`
  - 当前 bridge 主实现。
  - 负责：
    - 解析 `simpagent mcp call`
    - 解析 `simpagent skill call`
    - 参数归一化
    - schema 校验
    - 连接 MCP server
    - 执行本地 skill 脚本
    - 标准化输出与 side effects

### 8.13 `src/security`

- `packages/runtime-node/src/security/permissions.ts`
  - 当前统一权限内核。
  - 负责：
    - 默认权限规则
    - 权限配置归一化
    - 工作目录解析
    - `evaluateShellPermission`
    - 审批答案解析

### 8.14 `src/api`：HTTP 控制面

- `packages/runtime-node/src/api/index.ts`
  - API 模块出口。
- `packages/runtime-node/src/api/http.ts`
  - 注册全部 HTTP 路由。
  - 目前可大致分成几类：
    - run 控制：
      - create / pause / resume / interrupt
    - checkpoint 操作：
      - history / state patch / prompt patch / fork
    - 调试查询：
      - trace / prompt compile / state diff / side effect / plan / tool exposure / user input / approval
    - 配置管理：
      - agents / workflows / prompt-units / tools / builtin tool config / system config
    - catalog CRUD：
      - nodes / facets / relations / prompt units
    - 模板：
      - list / apply

### 8.15 `src/ws`：实时调试面

- `packages/runtime-node/src/ws/index.ts`
  - WS 模块出口。
- `packages/runtime-node/src/ws/server.ts`
  - WebSocket 服务器。
  - 负责：
    - hello / ping / subscribe / unsubscribe
    - run_snapshot
    - trace_event 推送
    - replay_events_batch
    - heartbeat
    - 重连补拉窗口提醒

### 8.16 `src/tests`：框架回归测试

- `packages/runtime-node/src/tests/smoke.ts`
  - 最小冒烟测试。
  - 验证数据库初始化、默认种子、mock run、trace 是否连通。
- `packages/runtime-node/src/tests/catalogBridge.ts`
  - 统一图谱 + MCP/skill bridge 集成测试。
  - 覆盖：
    - catalog PromptUnit 兼容读取
    - relation CRUD
    - MCP `stdio / streamable-http / sse`
    - args-json / flags
    - skill 成功、缺参、失败路径
    - context PromptUnit 投影
- `packages/runtime-node/src/tests/permissionsCatalog.ts`
  - 权限内核 + catalog HTTP CRUD 专项测试。
  - 覆盖：
    - `allow / ask / deny`
    - approval request 落库
    - catalog node / facet / relation HTTP CRUD
- `packages/runtime-node/src/tests/fixtures/mockMcpStdioServer.mjs`
  - MCP stdio 测试桩。
- `packages/runtime-node/src/tests/fixtures/mockSkillScript.mjs`
  - skill 脚本测试桩。

### 8.17 对 `runtime-node` 的一句总结

`packages/runtime-node` 已经具备“**可跑、可查、可暂停、可恢复、可补丁、可分叉、可审计、可扩展工具**”的框架主干特征，它现在就是仓库里最应该优先维护的真源。

---

## 9. 其他相关包与兼容层

### 9.1 `packages/runtime-worker`

- `packages/runtime-worker/package.json`
  - Worker 包基础定义。
- `packages/runtime-worker/tsconfig.json`
  - TS 配置。
- `packages/runtime-worker/src/index.ts`
  - Cloudflare Workers 轻量适配入口。
  - 当前只实现：
    - health
    - `/api/config/resolve`
    - `POST /api/runs`
    - `GET /api/runs/:runId`
    - `GET /api/trace/:runId/events`
  - 它复用了 `resolveThreeLayerConfig`，说明配置语义已经具备跨运行时一致性。
  - 但它不是完整 runtime-node 的等价实现。

### 9.2 `packages/runtime-tauri-bridge`

- `packages/runtime-tauri-bridge/package.json`
  - Tauri bridge 包定义。
- `packages/runtime-tauri-bridge/tsconfig.json`
  - TS 配置。
- `packages/runtime-tauri-bridge/src/index.ts`
  - 定义 Tauri invoke 协议封装。
  - 提供：
    - `createTauriBridge`
    - `createMockTauriBridge`
  - 本质是“前端调用协议层”，不是服务器实现。

### 9.3 `backend`

- `backend/package.json`
  - 所有脚本都转发到 `@simpagent/runtime-node`。
- `backend/README.md`
  - 说明该目录已经是兼容壳。
- `backend/src/*`
  - 仍保留旧代码副本，但从当前项目主线来看，已经不应再作为真源继续演进。

结论很明确：

- 要开发框架，请改 `packages/runtime-node`。
- `backend` 只在兼容旧命令时有意义。

## 10. 以后排查问题时，优先阅读顺序

### 10.1 如果你想理解整体主线

按下面顺序读：

1. `packages/core/src/types/contracts.ts`
2. `packages/core/src/prompt/compiler.ts`
3. `packages/runtime-node/src/index.ts`
4. `packages/runtime-node/src/runtime/engine.ts`
5. `packages/runtime-node/src/storage/db.ts`
6. `packages/runtime-node/src/core/tools/exposurePlanner.ts`
7. `packages/runtime-node/src/bridges/internalShellBridge.ts`
8. `packages/runtime-node/src/api/http.ts`

### 10.2 如果你要改 Prompt / 提示词装配

优先看：

1. `packages/core/src/types/contracts.ts`
2. `packages/core/src/prompt/compiler.ts`
3. `packages/runtime-node/src/catalog/mappers.ts`
4. `packages/runtime-node/src/runtime/engine.ts`

### 10.3 如果你要改工具系统

优先看：

1. `packages/runtime-node/src/core/tools/builtinSpecs.ts`
2. `packages/runtime-node/src/core/tools/registry.ts`
3. `packages/runtime-node/src/core/tools/canonical/index.ts`
4. `packages/runtime-node/src/core/tools/exposurePlanner.ts`
5. `packages/runtime-node/src/runtime/engine.ts`
6. `packages/runtime-node/src/bridges/internalShellBridge.ts`
7. `packages/runtime-node/src/security/permissions.ts`

### 10.4 如果你要改 catalog / 统一图谱

优先看：

1. `docs/统一图谱与统一Schema设计-v0.1.md`
2. `packages/core/src/types/contracts.ts`
3. `packages/runtime-node/src/storage/schema.ts`
4. `packages/runtime-node/src/storage/db.ts`
5. `packages/runtime-node/src/catalog/mappers.ts`
6. `packages/runtime-node/src/api/http.ts`

### 10.5 如果你要改运行时控制流

优先看：

1. `packages/runtime-node/src/runtime/engine.ts`
2. `packages/core/src/runtime/agentRoundExecutor.ts`
3. `packages/core/src/runtime/toolLoopExecutor.ts`
4. `packages/runtime-node/src/core/trace/eventBus.ts`
5. `packages/runtime-node/src/ws/server.ts`

## 11. 当前已经稳定的主干结论

到当前这版代码为止，可以把下面这些视为“已经成型的框架主干”：

- `packages/core` 作为跨平台抽象层的边界已经基本成型。
- `packages/runtime-node` 作为当前真源已经明确。
- PromptUnit 主链已经成型。
- 三层工具架构已经成型。
- 统一图谱 catalog 已经进入运行时主链，不再只是设计文档。
- shell 权限 + approval request 已经成型。
- MCP/skill shell bridge 已经成型。
- HTTP/WS 调试面已经成型。
- package 级测试入口已经接通，不再是空跑。

## 12. 当前仍然属于“已开口但未完全收口”的部分

这些不是没做，而是还没有走到最终形态：

- `runtime-worker`
  - 目前只是最小链路，不是完整等价实现。
- `runtime-tauri-bridge`
  - 目前是桥接契约，不是独立 runtime。
- 更细粒度权限
  - `network / fs / extra permission request` 还有扩展空间。
- catalog 更深层统一
  - 现在已经打通定义层与 Prompt 投影，但不是所有资源都已完全纳入同一编辑体验。
- provider 兼容层
  - 主链可用，但不同厂商的 custom/structured/prompt 协议细节仍可继续增强。

## 13. 最后一句话：以后不要再混淆什么是“框架”

在当前仓库里，**SimpleAgent 框架** 指的是：

- `packages/core`
- `packages/runtime-node`
- `packages/runtime-worker`
- `packages/runtime-tauri-bridge`
- `backend` 兼容壳

其中真正的主实现是：

- `packages/runtime-node`

以后如果要判断“某个能力是不是已经做过”，优先去这几个位置查：

1. `packages/core/src/types/contracts.ts`
2. `packages/core/src/prompt/compiler.ts`
3. `packages/runtime-node/src/runtime/engine.ts`
4. `packages/runtime-node/src/storage/db.ts`
5. `packages/runtime-node/src/core/tools/exposurePlanner.ts`
6. `packages/runtime-node/src/bridges/internalShellBridge.ts`
7. `packages/runtime-node/src/api/http.ts`

只要这几处已经有对应实现，就不要再在别的应用层或新目录里重复造同一套。
