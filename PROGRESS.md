# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：当前目录已完成一版可编译的 `backend/` 后端骨架，包含 LangGraph.js 运行时、HTTP API、WS 调试通道与 SQLite 配置/Trace 存储。
- 已完成：`backend` 工程配置与依赖安装；核心类型契约；SQLite schema + 数据访问层；默认种子配置；Agent/Workflow/Tool Registry；PromptCompiler；ToolRuntime（function/shell）；Provider 兼容层（OpenAI Chat / Responses / Gemini-compatible Chat + mock）；TraceEventBus；LangGraph Runtime（run/create、pause/resume、history、state patch、prompt override patch、fork）；HTTP API 路由；WS 心跳/订阅/事件补发；`npm run build` 通过；`npm run test:smoke` 通过（mock run 完成且 trace 有事件）。
- 正在做：暂无阻塞；后续可开始接最小调试前端与更细化测试。
- 下一步：增加端到端测试用例（中断恢复、fork 分叉、工具权限、WS 重连补发）；补 API 示例请求；实现更完整的 Responses 流式工具循环。

## 关键决策与理由（防止“吃书”）
- 决策A：执行内核采用 LangGraph.js（原因：直接获得 checkpoint / interrupt / replay / history / updateState，避免自研运行时黑洞）。
- 决策B：配置与 Trace 基线使用 SQLite（原因：单机迭代快、结构清晰、便于调试与查询）。
- 决策C：Provider 层不依赖 SDK，统一 `fetch + REST/SSE`（原因：兼容 OpenAI 与 Gemini/OpenAI-compatible，更可控）。
- 决策D：工具系统采用统一抽象（function/shell/http/mcp_proxy），而非全量 shell 化（原因：兼容性和安全性更稳）。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
- 坑4：LangGraph `StateGraph` 在动态节点 ID 的 TypeScript 泛型约束比较严格，动态构图时容易报类型错误；首版可在构图处使用 `any` 包裹 builder，后续再做更强类型化封装。
