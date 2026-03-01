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

## 任务名称（2026-03-01）
- 交付 `apps/dev-console` 七页调试台 + runtime-node 配置/模板补齐

## 执行目标（本轮实现）
- 将 `apps/dev-console` 从占位目录升级为可运行 Vite + React + TypeScript 工程。
- 落地七个可操作页面：`/agents`、`/workflow`、`/memory`、`/run`、`/trace`、`/replay`、`/settings`。
- 在 `runtime-node` 框架层补齐缺口接口：
  - `GET /api/runs/:runId/tool-exposure-plans`
  - `GET /api/runs/:runId/user-input-requests`
  - `GET/PUT /api/config/system`
  - `GET /api/templates`
  - `POST /api/templates/:templateId/apply`
- 将 builtin tool 配置从内存态迁移到 SQLite 持久化。
- 引入 `SIMPAGENT_PROJECT_ID` 项目隔离目录（默认 `dev-console`）。
- 对接 Stitch 设计项目（改造 Run Fusion + 新增 System Settings 设计屏）。

## 分阶段计划（本轮）
1. 盘点现有 monorepo 与 API 缺口（已完成）
2. 先补框架层后端能力与持久化（已完成）
3. 搭建 dev-console 工程并实现七页路由（已完成）
4. 运行构建与冒烟回归测试（已完成）
5. 同步 README / PLANS / PROGRESS 文档（进行中）

## 本轮完成判据
- `npm run --workspace @simpagent/app-dev-console build` 通过。
- `npm run --workspace @simpagent/runtime-node build` 通过。
- `npm run --workspace @simpagent/runtime-node test:smoke` 通过。
- `npm run build:workspaces` 通过。
- Stitch 项目内已生成 Run Fusion 改造稿与 System Settings 页面稿。
