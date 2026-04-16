# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：已切换到 TS 后端首版纵向跑通任务；前端暂不处理。
- 已完成：
    - [x] 明确后端采用 npm workspace：`apps/*` + `packages/*`。
    - [x] 明确 `agent-core` 为大核心包，API adapter、loop、pool、trace、前端事件类型都放在 core 内。
    - [x] 明确 3 个 runtime 包：Node 真实实现，Cloudflare Worker/Tauri 首版占位。
    - [x] 明确首版默认 human-in-loop 工具审批，策略支持 `ask | deny | always_approve`。
- 正在做：
    - [/] 新增后端 monorepo 工程、核心包、runtime 包、CLI、HTTP/SSE 服务与测试。
- 下一步：完成后端代码实现后执行 typecheck、build、lint、test 全量验证。

## 关键决策与理由（防止“吃书”）
- 决策A：首版不修改 `frontend/` 与 `chatgpt-temp/`。（原因：用户明确要求前端先不管，避免和前端未完成改动互相干扰。）
- 决策B：`agent-core` 是大核心包。（原因：API adapter、agent loop、pool、trace、前端事件协议都属于 agent 内存态核心；runtime 只负责环境能力注入。）
- 决策C：真实运行配置使用 `simpagent.toml`，示例配置使用 `simpagent.example.toml`。（原因：用户希望 TOML，真实 API key 不进 git。）
- 决策D：HTTP 流式输出首版使用 SSE。（原因：比 WebSocket 更简单，足以支持 token、thinking、tool approval、tool result、trace 与 done 事件。）
- 决策E：工具权限首版默认 `ask`。（原因：每次工具调用前暂停并让 CLI/前端确认，拒绝时把特定错误回填给模型。）

## 常见坑 / 复现方法
- 坑1：根目录已有前端与临时实验的未提交文件；后端提交应只 add 本次涉及文件，避免误提交无关前端临时文件。
- 坑2：`agent-core` 不能直接依赖 Node 文件、shell、数据库 API；这些能力必须通过 runtime 接口注入。
- 坑3：DeepSeek thinking 流里 `reasoning_content` 和普通 `content` 需要分开转成 `thinking_delta` 与 `message_delta`。
- 坑4：工具审批 deny 不是本地异常结束，而是要回填 tool result，让模型看到 `TOOL_EXECUTION_DENIED_BY_HUMAN`。
