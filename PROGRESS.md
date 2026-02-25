# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：已在当前目录初始化 Git 仓库，并开始从零搭建 `backend/` 独立后端工程（不再复用旧 demo）。
- 已完成：`backend` 工程配置、依赖安装、核心类型契约（AgentSpec / PromptBlock / RunState / TraceEvent / Provider 抽象等）、SQLite schema 与数据库封装、默认种子配置、Registry、PromptCompiler、ToolRuntime（function/shell）、Provider 兼容层（OpenAI Chat / Responses / Gemini-compatible Chat 基础实现）、TraceEventBus。
- 正在做：LangGraph Runtime 封装（图构建、节点执行包装、中断恢复、history / patch / fork）、HTTP API 与 WS 调试通道。
- 下一步：完成 `runtime/engine.ts` + API/WS 接入，补 `src/index.ts` 启动入口与 README，执行构建与冒烟测试。

## 关键决策与理由（防止“吃书”）
- 决策A：执行内核采用 LangGraph.js（原因：直接获得 checkpoint / interrupt / replay / history / updateState，避免自研运行时黑洞）。
- 决策B：配置与 Trace 基线使用 SQLite（原因：单机迭代快、结构清晰、便于调试与查询）。
- 决策C：Provider 层不依赖 SDK，统一 `fetch + REST/SSE`（原因：兼容 OpenAI 与 Gemini/OpenAI-compatible，更可控）。
- 决策D：工具系统采用统一抽象（function/shell/http/mcp_proxy），而非全量 shell 化（原因：兼容性和安全性更稳）。

## 常见坑 / 复现方法
- 坑1：PowerShell 命令语法与 bash 花括号展开不同，批量创建目录时容易写错；需使用数组循环创建。
- 坑2：首次并行执行 `git init` 与 `git status` 会有时序问题，可能出现“不是 git 仓库”的假错误；重新执行即可。
- 坑3：`apply_patch` 单次补丁过大时在 Windows 可能报“文件名或扩展名太长”；需拆分为多次补丁提交。
