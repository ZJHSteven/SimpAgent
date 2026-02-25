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
