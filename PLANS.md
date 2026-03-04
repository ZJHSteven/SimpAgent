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
