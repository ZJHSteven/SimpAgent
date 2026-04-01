# ExecPlan（复杂任务先计划）

## 任务名称
- 从零实现「可观测 + 可中断 + 热更新」多 Agent 框架后端（TypeScript + LangGraph.js）v0.1

## 执行目标（本轮实现）
- 在当前目录新建 `backend/` 子工程，独立于旧 demo 项目。
- 实现后端主干骨架：类型契约、SQLite 存储与版本化配置、Prompt 编译器、Provider 兼容层、ToolRuntime。
- 基于 LangGraph.js 接入真实运行时能力：checkpoint、interrupt/resume、history、state patch、fork。
- 提供 HTTP API + WebSocket 调试事件通道（含心跳与重连补拉接口）。
- 补充最小文档与冒烟脚本，确保本地可启动验证。

## 分阶段计划
1. 工程骨架与依赖（TypeScript / Express / WS / LangGraph / SQLite）
2. 核心类型契约与 SQLite schema（版本化配置、run、trace、patch、fork）
3. Registry / PromptCompiler / ToolRuntime / Provider 兼容层
4. LangGraph Runtime 封装（图构建、中断恢复、历史、patch、fork）
5. HTTP API 与 WS 实时调试协议
6. README / 冒烟脚本 / 当前目录 PROGRESS 更新

## 实施约束
- 不依赖 OpenAI/Gemini 官方 SDK，统一使用 `fetch` + REST/SSE 协议。
- 不将提示词系统退化为单一 system prompt，必须保留 PromptBlock 编译与 Trace。
- 不将 trace 大对象全部塞进 LangGraph state，使用 SQLite 独立存储。
- Shell 工具必须具备白名单、超时、工作目录与审计约束。

## 本轮完成判据
- `backend` 可以完成 TypeScript 编译并启动服务（即使部分 API 先返回最小实现）。
- 至少实现一个可运行默认工作流，支持创建 run 与查看 trace。
- 至少实现 checkpoint 历史查询、state patch、fork 接口的最小可用链路。
- 文档与 `PROGRESS.md` 同步更新。

---

## 任务名称（2026-02-26）
- 生成“标书可用”的项目框架梳理文案与流程图生图提示词文档

## 执行目标（本轮实现）
- 基于当前仓库真实实现（重点是 `backend/`）梳理系统架构、能力闭环与技术亮点。
- 产出一份可直接粘贴到自然科学基金/大创/创新创业计划书中的宣传型文案（项目优势、创新性、可行性、应用价值）。
- 额外提供一份适配生图 AI 的“流程图视觉化提示词”，用于生成美观流程图底图素材。
- 同步更新 `PROGRESS.md`，记录文档产出成果。

## 分阶段计划（本轮）
1. 读取 `backend` 核心模块与说明文档，提炼真实卖点（已完成）
2. 撰写标书文案与流程图提示词文档（进行中）
3. 更新 `PROGRESS.md` 并提交版本（待执行）

## 本轮完成判据
- 新增文档包含：项目梳理、优势/创新性文案、流程图提示词、使用建议。
- `PROGRESS.md` 已记录本次文档交付结果。

---

## 任务名称（2026-03-01）
- 一次性重构为 Monorepo + 三适配环境（Node / Tauri Bridge / CF Workers）

## 执行目标（本轮实现）
- 建立 `npm workspaces`。
- 新增 `packages/core`，抽离公共类型、PromptCompiler、工具循环、WorkflowRegistry（端口化）与 Ports 抽象。
- 将 Node 主实现迁移为 `packages/runtime-node`，保留 `backend/` 兼容壳。
- 新增 `packages/runtime-worker`（Workers + D1 最小链路）。
- 新增 `packages/runtime-tauri-bridge`（Tauri invoke 契约 + mock）。
- 新增 `apps/trpg-desktop`、`apps/learning-desktop`、`apps/dev-console` 占位。

## 分阶段计划（本轮）
1. 复制 `backend` 到 `packages/runtime-node`，确保链路不中断（已完成）
2. 建立 `packages/core` 并抽离核心模块（已完成）
3. 增加 `createRuntimeEngine(deps)` + Ports + 三层配置合并器（已完成）
4. 增加 Worker 与 Tauri bridge 适配包（已完成）
5. 调整根配置、跑构建与冒烟测试（已完成）
6. 更新 README / PROGRESS（进行中）

## 本轮完成判据
- `npm run build:workspaces` 通过。
- `npm run --workspace @simpagent/runtime-node test:smoke` 通过。
- 根前端 `npm run build` 通过。
- 文档同步到 `README.md` 与 `PROGRESS.md`。

---

## 任务名称（2026-03-03）
- 临床场景 AI 教育前端样例重做（全中文 + 非线性画布 + 可截图展示）

## 执行目标（本轮实现）
- 在 `apps/mededu-cockpit` 独立前端工程实现一个可直接演示的临床教学运行舱界面，全部中文文案。
- 布局采用四区结构：左侧会话区、中间无限画布区、右侧上下文监控区、底部系统日志区。
- 中间区域改为可拖拽平移的“无限画布”效果，包含点阵背景、多 Agent 非线性节点、动态连线动画。
- 使用 mock 数据驱动固定流程，保证动画与文本稳定可截图，不出现“演示专用”等字样。
- UI 视觉升级为浅色专业风格，保证桌面与移动端都能正常展示。

## 分阶段计划（本轮）
1. 梳理现有前端入口与样式边界，明确替换范围（已完成）
2. 设计页面信息架构与 mock 叙事内容（已完成）
3. 实现可拖拽画布、节点动画、连线状态与多角色卡片（已完成）
4. 完成左右侧面板与底部日志的中文可视化内容（已完成）
5. 运行 `npm run --workspace @simpagent/app-dev-console build` 验证并修复（已完成）
6. 同步更新 `PROGRESS.md` 并提交版本（进行中）

## 本轮完成判据
- 页面不包含英文业务词，主要展示文案为中文临床教学语境。
- 画布可通过鼠标拖拽平移，视觉上具备“无限扩展”感。
- 三大专家 Agent（虚拟患者、临床专家、基础研究专家）+ 学生角色在流程中可见且连线动态。
- 页面可在本地运行并构建通过，适合截取到标书材料。
- `PROGRESS.md` 记录本轮实现结果与下一步计划。

---

## 任务名称（2026-03-04）
- PromptUnit 统一命名改造 + Agent 绑定装配 + 三层工具路由对齐（不含 ToolSpec 最终统一方案）

## 执行目标（本轮实现）
- 将持久化提示词核心概念统一为 `PromptUnit`（兼容旧 `PromptBlock` 字段与接口）。
- 将 Agent 输入装配中心迁移到 `promptBindings`（启用状态/顺序/局部覆盖由 Agent 管理）。
- 运行时继续以 `messages[]` 作为唯一直接执行输入，并保留 trace 来源映射。
- 在不改 ToolSpec 统一定义的前提下，对齐工具三层运行逻辑（外层来源 -> 中层 canonical -> 内层 API 暴露适配）。
- 落地 Agent 级工具控制：`toolAllowList + toolRoutePolicy`。

## 分阶段计划（本轮）
1. 扩展类型契约：新增 `PromptUnit`/`AgentPromptBinding`/`AgentToolRoutePolicy`，并保留旧字段兼容（已完成）
2. 改造 Prompt 编译器：以 `promptBindings` 作为主装配入口，输出 message-first + trace（已完成）
3. 改造 runtime-node：接入 `toolAllowList` 与 `toolRoutePolicy`，补齐 workflow tool node 的输入输出映射与条件表达式边（已完成）
4. API 与存储别名兼容：新增 `/api/prompt-units`，保留 `/api/prompt-blocks`（已完成）
5. 预设与模板同步：补齐 Agent 新字段并验证构建（已完成）
6. ToolSpec 统一定义（外层定义模型）后续单开任务推进（待执行）

## 本轮完成判据
- `packages/core`、`packages/runtime-node`、根工程构建通过。
- Agent 可通过 `promptBindings` 控制 PromptUnit 装配顺序与启用状态。
- Agent 可通过 `toolRoutePolicy` 控制内层路由（含 `shell_only` 仅暴露 shell bridge）。
- 兼容旧配置（PromptBlock/旧 API 路径）不被破坏。

---

## 任务名称（2026-03-24）
- 框架主干收口：统一图谱存储 + CodeMode 工具体系 + Shell/权限模型 + Node Runtime 补齐 + 全量测试

## 执行目标（本轮总计划）
- 不再只做“ToolSpec 小修小补”，而是一次性把框架主干收口路线写清楚，后续严格按此计划推进。
- 统一 `Prompt / Memory / Tool / Skill / MCP / Worldbook` 的上层编排模型，落到 SQLite 图谱式存储设计（统一节点主表 + 树父子字段 + 图关系表 + facet 载荷）。
- 明确“万物可投影为 PromptUnit，但工具末端节点仍保留结构化执行载荷”的边界，避免把工具本体退化为纯 prompt 文本。
- 采用 CodeMode 思路重整工具体系：
  - MCP 与 skills 优先走“prompt 暴露 + shell/exec 执行”路径；
  - 不以 function-style 作为默认主路线；
  - function-style 仅保留为兼容层/特殊直通能力。
- 明确 Shell 执行模型：
  - `shell_command` 负责一次性命令调用；
  - 预留持续进程/交互式 exec 能力（是否本轮全部落地，视实现复杂度拆分）；
  - 对齐权限、工作目录、超时、环境变量、审批与审计。
- 建立统一权限内核，默认 Zero Trust，至少覆盖：
  - `deny / ask / allow` 三层判定；
  - system / project / agent / node 多层覆写；
  - 命令、路径、网络、文件系统、额外权限申请等维度。
- 补齐 `packages/runtime-node` 作为主后端所缺失的基础能力，并确认 `packages/core`、`packages/runtime-worker`、`packages/runtime-tauri-bridge` 的边界。
- 建立覆盖核心子系统的详尽测试矩阵，要求不只“冒烟通过”，而是覆盖语法、功能、边界、异常与权限路径。

## 关键设计约束（本轮必须先定）
- 统一图谱是“上层内容/暴露/关系模型”，不是要求所有底层实体都只剩一张大 JSON 表。
- 第一阶段的“统一”，优先统一节点外形与目录组织方式，不追求一上来把 payload 拆成很多专表。
- PromptUnit 是统一暴露/装配单位，但 Tool 节点必须保留独立执行定义：
  - 名称、短描述、长描述；
  - 输入 schema；
  - 执行后端；
  - 权限与审批策略；
  - 可观测性与副作用记录。
- 树是图的特例：
  - 高层集合节点优先直接使用 `parent_node_id` 表达树结构；
  - 只有横向引用/归属/关联时再走关系表；
  - Tool 集、Memory 集、Prompt 集允许互相嵌套，不做类型隔离墙。
- MCP 默认按“工作集 -> 工具末节点”建模，不强制做多级层次；若后续发现某类 MCP 有天然层级，再通过集合节点补上。
- skills 视为“内容节点 + 可选执行载荷”的复合体：
  - 短描述先暴露；
  - 命中后展开正文；
  - 若携带执行能力，则走 shell/exec 权限链路。
- skill / MCP / memory / prompt 的差异，优先通过 facet 表达，而不是顶层节点表继续裂变。
- 统一图谱本轮只统一“定义层”；`runs / trace_events / tool_calls / side_effects / user_input_requests` 继续留在运行时表，不合并进 catalog。
- `packages/runtime-node` 是当前主实现真源；`backend` 兼容壳与重复实现后续要纳入收口计划，避免双份维护。

## 分阶段计划（总执行序列）
1. 统一图谱与类型契约设计
- 设计统一节点/关系/facet 模型，明确哪些是通用字段，哪些是可选 facet 载荷。
- 收敛节点模型：统一外形，节点差异优先靠 `prompt / memory / tool / integration` 这类 facet 表达。
- 明确短描述、长描述、展开策略、命中后暴露策略、末端执行定义的契约。
- 梳理现有 `PromptUnit / ToolSpec / BuiltinToolConfig / MemoryAdapter` 与新图谱模型的映射关系。
- 先产出正式设计文档，冻结 v0.1 基线：
  - `docs/统一图谱与统一Schema设计-v0.1.md`

2. SQLite Schema 与存储层改造
- 设计并落地图谱存储 schema：
  - 节点主表；
  - 图关系表；
  - facet 表；
  - 可选的版本表/审计表。
- 设计版本化、项目隔离、热更新与回滚策略。
- 提供最小迁移/seed 路径，保证现有 preset/config 能映射到新结构。

3. Prompt / Memory / Tool 统一装配层
- 让 PromptCompiler 能从图谱节点中抽取 PromptUnit 视图。
- 将 worldbook / memory / skills / tool exposure 统一为“图谱节点 -> PromptUnit 投影”的装配过程。
- 明确“初始只暴露短描述，命中后再展开长描述/明细”的运行规则。
- 设计并实现“工具集合选择 / 命中下钻 / 末端执行”所需的中间状态。

4. Shell / Exec 执行内核重构
- 将当前一次性 `shell_command` 从“硬编码白名单 + 直接 spawn”升级为统一执行内核。
- 明确两类执行能力：
  - 一次性命令执行；
  - 持续进程/交互式执行（预留或落地）。
- 统一工作目录、环境变量、超时、stdout/stderr、退出码、会话标识、审计与副作用记录。
- 将 `allowCommandPrefixes`、工作目录策略、风险分类真正接入运行时，而不是只停留在配置层。

5. 权限与审批模型落地
- 设计统一权限规则对象，至少支持：
  - 模式：`deny | ask | allow`
  - 匹配器：`exact | prefix | regex | schema`
  - 作用域：command / path / fs / network / tool
  - 层级：system / project / agent / node
- 默认策略采用 Zero Trust：未命中放行规则即拒绝或要求审批。
- 设计“额外权限申请”能力，为后续更细粒度审批保留口子。
- 审计侧完整记录：请求、命中规则、审批结果、实际执行内容。

6. MCP / skills / 外部工具适配
- MCP 默认主路线改为：
  - MCP 元信息 -> 图谱节点；
  - 短描述/长描述 -> PromptUnit 暴露；
  - 末端执行 -> shell/exec 或专用 client 适配。
- skills 默认主路线改为：
  - 文本正文直接进入 PromptUnit；
  - 若带执行载荷，则挂接到末端 Tool 节点并接入权限链路。
- function-style 仅保留为兼容层、内建工具或特殊高稳定直通工具，不再作为对外扩展的主设计。
- 评估 builtin tools 与图谱末端节点的统一方式，避免出现“双轨工具定义”。

7. Node Runtime 主干补齐与边界收口
- 逐项确认 `runtime-node` 还缺哪些主后端能力：
  - 图谱 CRUD；
  - 统一装配；
  - Shell/Exec 权限；
  - MCP/skills 适配；
  - 统一测试入口。
- 确认 `core` 的职责边界：
  - 契约、编译器、循环与抽象端口继续保留；
  - Node 专属实现继续放在 `runtime-node`。
- 确认 worker / tauri bridge 本轮只保持适配接口，不追求与 node 完全同构落地。

8. 全量测试体系建设
- 为以下模块建立专门测试：
  - 类型契约与 schema 序列化；
  - 图谱存储 CRUD、版本与项目隔离；
  - Prompt 装配与暴露策略；
  - shell/exec 权限判定；
  - MCP/skills 适配转换；
  - builtin tool 执行与 fallback；
  - runtime-node API / WS / trace / fork / patch / resume 主链路；
  - 权限拒绝、审批、异常路径与边界情况。
- 在根脚本层增加真正有意义的统一测试入口，避免 `test:workspaces` 继续空转。

9. 文档与收口
- 持续更新 `PLANS.md`、`PROGRESS.md`、`README.md`。
- 对“当前真实主实现”“兼容壳”“占位工程”的状态给出明确标识，避免后续继续混淆。
- 在进入 AI PPT 等上层业务功能前，以“Node runtime 主干齐套 + 测试通过”作为门槛。

## 本轮子任务进度（2026-03-25）
1. catalog -> PromptUnit 主链路接入（已完成）
2. MCP/skills CodeMode shell bridge（已完成）
3. MCP `stdio / streamable-http / sse` 三类 transport 适配（已完成）
4. catalog / bridge / skill 专项测试脚本（已完成）
5. 根级统一测试入口收口，避免 `test:workspaces` 空转（已完成）
6. Shell/Exec 权限规则细化、审批链路与 catalog HTTP CRUD（已完成）
7. 更细粒度 network / fs 规则与更大测试矩阵（后续增强）

## 本轮完成判据（计划层）
- `PLANS.md` 已完整记录本轮框架收口路线，不再停留在零散讨论。
- 统一图谱、Shell/权限、MCP/skills、测试补齐、runtime-node 收口都已纳入执行序列。
- 后续实现阶段将按本节序列推进，并在 `PROGRESS.md` 持续同步最新状态。

## 任务名称（2026-03-25）
- 统一图谱设计收敛：从“节点类型裂变 + 多 payload 表”收敛为“统一节点 + 树父子字段 + 图关系 + facet”

## 执行目标（本轮实现）
- 基于当前仓库真实现状，重新梳理统一图谱设计边界，避免 schema 继续复杂化。
- 明确统一图谱只覆盖定义层，不吞并运行态日志、trace、tool call、审批请求等表。
- 将旧版“所有关系都抽象成边 + Prompt/Memory/Tool/MCP 各拆 payload 表”的思路，收敛为更贴近目录系统的简化模型。
- 同步更新设计文档、计划与项目进度文档，作为后续落代码的唯一基线。

## 分阶段计划（本轮）
1. 读取 `packages/runtime-node` 当前 SQLite schema 与 memory/tool/prompt 现状，确认哪些属于定义层、哪些属于运行层（已完成）
2. 重写 `docs/统一图谱与统一Schema设计-v0.1.md`，冻结简化模型（已完成）
3. 更新 `PLANS.md` 与 `PROGRESS.md`，把新基线写回项目记忆（已完成）
4. 第一批实现：`contracts + catalog schema/db + catalog -> PromptUnit 接入 runtime`（已完成）
5. 第二批实现：`MCP/skills shell bridge + transport/client + 审计链路`（已完成）
6. 全量测试、文档同步与提交版本（已完成）

## 本轮完成判据
- 统一图谱正式收敛为三核心结构：
  - `catalog_nodes`
  - `catalog_relations`
  - `catalog_node_facets`
- 树结构主路径改为 `parent_node_id`，图关系只用于横向引用。
- skill / MCP / memory / prompt 不再继续平行发明存储体系。
- 文档、计划、进度记录三处保持一致。

## 任务名称（2026-03-25，补齐）
- 统一图谱上一轮收口补齐：根级测试入口接线 + 文档状态对齐

## 执行目标（本轮补齐）
- 不再让 `npm run test:workspaces` 继续空转，而是直接回归 `runtime-node` 的统一图谱与工具桥接测试。
- 将 `统一图谱 plan.md`、`PLANS.md`、`PROGRESS.md` 的状态修正为与仓库真实实现一致。
- 明确本轮只收口 `packages/core` 与 `packages/runtime-node` 这层 Agent 框架，不碰 `src/App.tsx` 等前端页面文件。

## 分阶段计划（本轮补齐）
1. 核对根级测试入口与 `runtime-node` 测试脚本的断点位置（已完成）
2. 为 `@simpagent/runtime-node` 增加统一 `test` 聚合脚本（已完成）
3. 回归执行 `build:workspaces`、`test:workspaces`、`runtime-node test:smoke`、`runtime-node test:catalog-bridge`（已完成）
4. 更新 `统一图谱 plan.md`、`PLANS.md`、`PROGRESS.md` 并提交版本（已完成）

## 本轮完成判据（补齐）
- `npm run test:workspaces` 不再空跑，而是实际执行统一图谱与工具桥接测试。
- 文档中的“已完成/进行中”状态与真实仓库行为一致。
- 本轮改动只集中在 package/framework 层与项目记忆文件，不触碰前端页面实现。

## 任务名称（2026-03-25，继续补齐）
- 统一图谱剩余收口：Shell/Exec 权限审批 + catalog API + 权限/HTTP 测试

## 执行目标（本轮继续补齐）
- 将 `shell_command` 从“前缀白名单”升级为统一权限内核，落地 `deny / ask / allow`。
- 为高风险命令增加 `approval_requests` 审批记录与恢复入口，而不是只返回一条字符串报错。
- 为统一图谱补齐最小 HTTP CRUD，让 catalog 不再只有 DB 层接口。
- 新增 package 级专项测试，覆盖权限拒绝、审批请求与 catalog HTTP 路由。

## 分阶段计划（本轮继续补齐）
1. 扩展 core 契约：权限规则、审批请求、副作用类型（已完成）
2. 落地 runtime-node 权限内核与审批存储（已完成）
3. 为 catalog 增加节点 / facet / relation HTTP CRUD（已完成）
4. 新增 `test:permissions-catalog` 并接入统一 `test` 聚合脚本（已完成）
5. 回归执行 `runtime-node build/test`、`test:workspaces`、`build:workspaces`、根 `build`（已完成）

## 本轮完成判据（继续补齐）
- `shell_command` 已具备 `deny / ask / allow` 决策和审批记录。
- `catalog` 已具备最小 HTTP CRUD，不再只剩 SQLite 调用口。
- `runtime-node test` 已覆盖 smoke / catalog bridge / permissions-catalog 三套测试。
- 根级 `test:workspaces`、`build:workspaces`、根 `build` 均通过。

---

## 任务名称（2026-03-29）
- 补写 Simple Agent 框架总览导览文档（仅 packages/framework 层，不含 apps 与前端）

## 执行目标（本轮）
- 只聚焦 `packages/core`、`packages/runtime-node`、`packages/runtime-worker`、`packages/runtime-tauri-bridge` 与 `backend` 兼容壳，系统梳理当前 Simple Agent 框架真实实现。
- 新增一份“框架总版导览”文档，明确：
  - 当前真实主实现边界；
  - 核心能力清单（Prompt 装配、统一图谱、工具体系、Agent/Workflow、LangGraph 状态流转、权限、桥接、API、测试）；
  - 关键目录与关键文件职责；
  - 哪些部分已完成、哪些仍是兼容层或轻量适配层。
- 同步更新 `PROGRESS.md`，把“新增框架导览文档”写入项目记忆，避免后续上下文变长后重复造轮子或重复实现。

## 分阶段计划（本轮）
1. 盘点 `packages/*` 与 `backend` 的目录、入口与关键实现，确认真实主干（已完成）
2. 将本次任务写入 `PLANS.md`，冻结执行边界（进行中）
3. 新增框架导览文档，按“能力地图 + 目录地图 + 文件职责 + 调用链”展开（待执行）
4. 更新 `PROGRESS.md`，记录文档产出与当前框架认知基线（待执行）
5. 回归执行文档相关校验并提交版本（待执行）

## 本轮完成判据
- 仓库内新增一份面向后续开发/AI 协作的框架导览文档。
- 文档明确说明 `packages/runtime-node` 是当前主实现，`backend` 是兼容壳，`apps` 不属于本次梳理范围。
- 文档能帮助定位 Prompt、catalog、tool、workflow、runtime、permissions、bridge、API、测试等关键模块对应文件。
- `PROGRESS.md` 已同步本轮文档成果与后续使用方式。

---

## 任务名称（2026-03-29，架构核查）
- 核查“统一图谱 / 三层工具架构 / MCP&skill bridge / Agent 角色与 handoff”是否真正接成一条可运行主链

## 执行目标（本轮）
- 不新增业务功能，直接基于当前仓库实现做一次“反文档化”的代码核查，判断哪些连接点已经真实打通，哪些只是概念上相邻但运行时仍然分离。
- 重点核查四条主线：
  - `catalog -> PromptUnit / Tool / MCP / skill` 的统一程度；
  - `ToolRegistry -> CanonicalTool -> exposure -> runtime -> shell bridge` 的真实执行链；
  - `Agent.role / promptBindings / toolRoutePolicy / handoffPolicy / routingPolicies / outputContract` 的实际生效程度；
  - “3 个 agent + MCP/skill + 总结/审查”的多节点通路能否按当前框架完整跑通。
- 将核查结论写回 `PROGRESS.md`，避免后续继续把“已定义类型”误当成“已接线功能”。

## 分阶段计划（本轮）
1. 对照 `docs/SimpleAgent框架总览与代码导览.md` 与 `packages/runtime-node` 核查关键连接点（已完成）
2. 核查 `handoff / routingPolicies / outputContract / role` 等字段是否只有配置声明没有运行时实现（已完成）
3. 回归执行现有 package 级测试，确认真实可运行链路边界（已完成）
4. 更新 `PROGRESS.md` 并提交本次架构核查结论（进行中）

## 测试回归结果（本轮）
- `npm run --workspace @simpagent/runtime-node test:smoke` 通过：
  - 默认 3 节点工作流可完成一次最小运行；
  - 结束状态为 `completed`，最终节点停在 `node.review`；
  - 但该测试使用 `mock provider`，不能证明真实工具调用、handoff 或 MCP 搜索闭环。
- `npm run --workspace @simpagent/runtime-node test:catalog-bridge` 通过：
  - 证明 `catalog PromptUnit 兼容读取`、`MCP/skill bridge`、`tool 节点 Prompt 投影` 已接通；
  - 但测试直接调用 `InternalShellBridge`，不是通过 `ToolRegistry -> CanonicalTool(mcp/skill)` 主链进入。
- `npm run --workspace @simpagent/runtime-node test:permissions-catalog` 通过：
  - 证明 `shell_command` 权限审批与 `catalog HTTP CRUD` 已接通。
- `npm run --workspace @simpagent/runtime-node build` 通过：
  - 说明当前 `runtime-node` 编译层面自洽。

## 本轮完成判据
- 明确指出哪些链路已经打通，哪些仍是“两条并行链”或“仅类型/配置占位”。
- 明确回答当前框架能否支撑“问题提出 -> 搜索 -> 总结/审查”的 3 agent 通路，以及限制条件。
- `PROGRESS.md` 与最终结论保持一致，避免文档继续过度乐观。

---

## 任务名称（2026-03-31）
- Catalog 单一工具真源收口 + MCP/Skill 直连执行落地 + Handoff 工具化编排

## 执行目标（本轮）
- 让 `catalog` 成为工具系统唯一真源，停止运行时继续从旧 `ToolSpec / builtin_tool_configs` 主链拼装工具。
- 落地 `CanonicalToolRouteTarget = builtin | mcp | skill_tool` 的真实执行器，不再让 `mcp / skill` 只能通过 shell bridge 间接工作。
- 将 `handoff` 做成一等 builtin tool，并让 workflow 以“合法拓扑包络”的形式承接动态路由。
- 把 run snapshot 从“假装只有版本号”改为“冻结 resolved prompt/tool payload”，避免热更新污染运行中的多 agent 通路。
- 用 deterministic 测试验证 `research -> summary -> review` 一类 handoff 主链能完整跑通。

## 分阶段计划（本轮）
1. `contracts / registry / canonical` 收口到 catalog 单一工具真源（已完成）
2. 抽出结构化 `McpToolExecutor / SkillToolExecutor`，让 runtime 直连 canonical route（已完成）
3. 落地 `handoff` builtin tool、`pendingHandoff` 路由优先级与 workflow 后继校验（已完成）
4. 清理旧 `/api/tools` 更新入口、模板旧字段、旧 route 分支与测试夹带物（已完成）
5. 回归执行 `core/runtime-node build` 与 package 级专项测试，更新 `PROGRESS.md` 并提交版本（进行中）

## 本轮完成判据
- `ToolRegistry` 运行时只从 catalog 产出 canonical tools。
- `engine.executeCanonicalToolIntent()` 能直接执行 `builtin / mcp / skill_tool`。
- `handoff` 能写出 packet，并让 `decideNextNode()` 优先消费 `pendingHandoff`。
- 默认 deterministic 测试可覆盖 handoff 三节点通路；旧 `smoke / catalog-bridge / permissions-catalog` 继续通过。

---

## 任务名称（2026-03-31，结构治理规划）
- 仓库目录结构收口：明确“框架真源 / 产品应用 / 应用运行配置 / 历史兼容层”的四层边界

## 执行目标（本轮规划）
- 先基于当前真实仓库状态，冻结一版目录治理方案，避免后续继续边开发边堆历史包袱。
- 不在本轮直接做大规模搬迁，而是先明确哪些目录继续演进、哪些目录降级为兼容层、哪些目录属于遗留噪音。
- 给出一条低风险、可回退、可分阶段实施的迁移顺序。

## 当前问题归纳（已确认）
1. 根目录仍保留早期单体前端遗留：
- `src/*`
- `index.html`
- `vite.config.ts`
- 根 `dist/*`
- 根 `package.json` 中的 React/Vite 依赖与脚本
- 但当前真实主线已经转到 `packages/*` 与 `apps/*`，这套根前端基本只会制造“假入口”。
2. `backend/src/*` 与 `packages/runtime-node/src/*` 并存：
- 文档已明确 `packages/runtime-node` 才是真源；
- `backend` 已退化为兼容壳；
- 但目录形态仍像“双主线”，会误导后续修改位置。
3. `apps/*/backend` 命名误导：
- 这些目录当前不是独立后端源码；
- 本质是针对同一份 `runtime-node` 的项目级启动包装；
- 主要承载 `projectId / dataDir / presetDir / port` 等运行配置；
- 用 `backend` 命名会让人误以为每个 app 都有自己的后端实现。
4. 仓库混入大量运行产物与依赖目录：
- 根 `dist/`
- `apps/*/dist/`
- `apps/*/node_modules/`
- SQLite 数据文件
- 这些内容会显著放大“目录很乱”的观感，也会干扰真正该读的源码路径。

## 推荐目标结构（冻结为后续实施基线）
1. 根目录只保留“仓库编排层”：
- workspace 配置
- 顶层脚本
- 文档
- 通用脚本
- 不再保留实际业务前端源码
2. `packages/` 只保留框架真源：
- `core`
- `runtime-node`
- `runtime-worker`
- `runtime-tauri-bridge`
3. `apps/` 只保留具体软件本身：
- 每个 app 内部按需要拆成 `web / desktop / runtime`
- 若某 app 目前只有运行配置，没有前端，也应显式命名为 `runtime`，而不是继续叫 `backend`
4. `backend/` 只保留精简兼容壳：
- 保留旧命令转发能力
- 不再保留第二份 `src/*` 真正实现副本
5. `legacy/` 或 `archive/` 用于临时承接根级遗留：
- 例如根 Vite 壳
- 确认无价值后再彻底删除，不再放在根目录伪装主线

## 建议迁移顺序（后续实施按此序列）
1. 第一阶段：消除“假主线”
- 删除或迁移根 `src/*`
- 删除或迁移根 `index.html`
- 删除或迁移根 `vite.config.ts`
- 删除根 `dist/*`
- 将根 `package.json` 收口为纯 workspace 编排器
2. 第二阶段：消除“假 backend”
- 将 `backend` 收口为纯兼容壳
- 删除 `backend/src/*` 旧副本
- 以后框架后端只在 `packages/runtime-node` 演进
3. 第三阶段：把 app 级 `backend` 正名
- 将 `apps/*/backend` 重命名为 `apps/*/runtime`（优先推荐）
- 其中只保留启动脚本、预设、项目数据目录与环境说明
- 不再暗示“这里有第二套后端源码”
4. 第四阶段：统一 app 模板
- 推荐统一为：
- `apps/<name>/web`
- `apps/<name>/desktop`
- `apps/<name>/runtime`
- 缺哪个层就不建哪个目录
5. 第五阶段：清理产物并对齐文档
- 完善 `.gitignore`
- 移出构建产物、SQLite、本地数据、嵌套 `node_modules`
- 更新 `README.md` 与 `docs/SimpleAgent框架总览与代码导览.md`

## 本轮完成判据
- 已给出明确的目标结构、命名规范与迁移顺序。
- 本轮先完成方案冻结与项目记忆更新，不做大规模物理搬迁。

---

## 任务名称（2026-04-01）
- `packages/core` 与 `packages/runtime-node` 框架注释补齐 + review 路线整理

## 执行目标（本轮）
- 只聚焦 `packages/core` 与 `packages/runtime-node`，不触碰 `apps/*`、根前端与其他占位包。
- 针对“只有文件头、函数体和关键控制流缺少教学向中文注释”的问题，优先补齐 review 最痛的主链文件。
- 输出一条适合人工 review 的阅读顺序，帮助后续排查“Vibe coding 越写越乱”的结构问题。

## 分阶段计划（本轮）
1. 盘点 `core/runtime-node` 中最影响 review 的缺注释文件，收敛修改范围（已完成）
2. 先补 core 主链：`ports`、`prompt compiler`、`agentRoundExecutor`、`toolLoopExecutor`、`toolCallAssembler`（进行中）
3. 再补 runtime-node 主链：`providers/capabilities`、`api/http`、必要的入口/转发文件（待执行）
4. 回归执行 `core/runtime-node build` 与 `runtime-node test`，确认注释改动未引入语法问题（待执行）
5. 更新 `PROGRESS.md` 并提交版本，同时整理 review 路线（待执行）

## 本轮完成判据
- 关键主链文件不再只有文件头注释，函数头与关键分支具备可 review 的中文说明。
- 至少覆盖 `Prompt / runtime loop / HTTP API / provider capabilities` 这几条理解成本最高的主线。
- `npm run --workspace @simpagent/core build`、`npm run --workspace @simpagent/runtime-node build`、`npm run --workspace @simpagent/runtime-node test` 通过。
- `PROGRESS.md` 已记录本轮补注释范围、验证结果与后续 review 使用方式。

---

## 任务名称（2026-04-01）
- `packages/core` + `packages/runtime-node` 注释治理与 review 路线收口

## 执行目标（本轮）
- 只关注 `packages/core` 与 `packages/runtime-node`，不处理 `apps/*`、根前端、以及其他占位包。
- 盘点“只有文件头、缺少函数头/关键分支/术语解释”的高复杂度文件，优先补齐教学向中文注释。
- 首批优先覆盖 review 阻力最大的核心链路文件：
  - `packages/core/src/ports/index.ts`
  - `packages/core/src/runtime/toolLoopExecutor.ts`
  - `packages/runtime-node/src/providers/capabilities.ts`
  - `packages/runtime-node/src/api/http.ts`
- 回归执行 package 级构建与测试，确认注释改动没有引入语法问题。
- 输出一份面向人工 review 的阅读顺序与检查重点，作为后续持续治理基线。

## 分阶段计划（本轮）
1. 扫描 `packages/core` 与 `packages/runtime-node`，确认最缺注释且最影响 review 的文件（已完成）
2. 更新 `PLANS.md` / `PROGRESS.md`，冻结本轮边界与优先级（已完成）
3. 为首批核心文件补充函数头、关键分支、术语解释与流程注释（已完成）
4. 执行 `core/runtime-node` 构建与测试回归（已完成）
5. 汇总“从哪里开始看、每段逻辑怎么看”的 review 路线图（已完成）

## 本轮完成判据
- 首批高复杂度文件的关键函数、核心分支、输入输出语义已具备教学向中文注释。
- 注释修改后 `@simpagent/core` 与 `@simpagent/runtime-node` 至少完成构建与现有测试回归。
- `PROGRESS.md` 已写入本轮结论与后续扩展方向。
- 最终交付包含可直接执行的框架 review 路线，而不是只给“补了哪些注释”的清单。
