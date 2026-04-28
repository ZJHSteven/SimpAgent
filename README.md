# SimpAgent

SimpAgent 是一个 TypeScript monorepo，用来验证“模型 + 工具 + 人审 + trace”的最小 agent 运行链路。

当前后端重点能力：

- CLI：从终端输入一句任务，实时打印模型流式输出，并在需要工具时发起审批。
- HTTP Server：提供 thread、run、SSE 事件流和工具审批接口，供前端真实调用。
- Frontend：React 聊天界面，通过 Vite `/api` 代理连接本地 HTTP Server。
- Agent Core：封装 agent loop、工具协议、Chat Completions 适配器、事件协议和 trace 结构。
- Runtime Node：提供本地文件、shell、审批、配置读取和 JSON trace 落盘能力。

## 项目结构

```text
apps/
  cli/                  # 终端入口：适合本地快速验证一次 agent turn
  server/               # HTTP + SSE 入口：适合前端或外部客户端接入
packages/
  agent-core/           # 跨运行时核心逻辑：agent loop、工具协议、模型适配器
  runtime-node/         # Node.js 本地运行时：文件、shell、审批、trace store
  runtime-cloudflare-worker/
  runtime-tauri/
frontend/               # React 聊天界面：真实调用 apps/server，并渲染 SSE/工具审批/思考面板
chatgpt-temp/           # 迁移参考素材，不是当前主应用入口
```

## 安装依赖

```bash
npm install
```

## 配置

复制示例配置：

```bash
cp simpagent.example.toml simpagent.toml
```

然后按你的模型服务填写：

```toml
provider = "deepseek"
baseUrl = "https://api.deepseek.com"
apiKey = "你的 API Key"
model = "deepseek-chat"
approvalPolicy = "ask"
storageDir = ".simpagent"
timeoutMs = 60000
```

`approvalPolicy` 的含义：

- `ask`：执行工具前询问用户，适合 CLI 手动验证。
- `always_approve`：自动允许工具执行，适合自动化测试或可信环境。
- `deny`：拒绝所有工具，但仍会把拒绝结果回填给模型，适合验证 human-in-loop 行为。

## 运行 CLI

```bash
npm run cli -- "请读取 README.md 并总结项目"
```

CLI 事件输出说明：

- 普通模型文本会直接按 token 增量打印，形成类似“打字”的效果。
- `[thinking]` 是模型推理增量，当前用于调试观察。
- `[tool approval]` 表示模型请求工具，CLI 正在等待用户审批。
- `[tool result]` 表示工具执行结果已经回填给 agent loop。
- `[error]` / `[fatal]` 表示不可恢复错误，需要检查配置、网络或模型服务响应。

## 运行 HTTP Server

```bash
npm run server
```

默认监听：

```text
http://localhost:8788
```

常用接口：

- `POST /threads`：创建会话。
- `GET /threads`：列出内存中的会话。
- `GET /threads/:id`：查询单个会话。
- `POST /threads/:id/fork`：从某条消息分叉会话。
- `POST /threads/:id/runs`：启动一次 agent turn。
- `GET /runs/:runId/events`：通过 SSE 订阅实时事件。
- `POST /runs/:runId/tool-approvals/:toolCallId`：回填工具审批结果。

最小调用示例：

```bash
curl -X POST http://localhost:8788/threads `
  -H "content-type: application/json" `
  -d "{\"title\":\"本地测试\"}"
```

Windows PowerShell 里可以继续用上一步返回的真实 `thread.id` 启动 run：

```bash
curl -X POST http://localhost:8788/threads/<thread-id>/runs `
  -H "content-type: application/json" `
  -d "{\"input\":\"请用一句话介绍当前项目\"}"
```

## 运行 React 前端

先启动后端：

```bash
npm run server
```

再启动前端开发服务器：

```bash
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

默认访问：

```text
http://127.0.0.1:5173
```

前端请求规则：

- 默认 API base 是 `/api`。
- `frontend/vite.config.js` 会把 `/api/*` 代理到 `http://127.0.0.1:8788/*`。
- 如果本机 `8788` 已被占用，可先用 `$env:PORT=8789; npm run server` 启动后端，再用 `$env:SIMPAGENT_PROXY_TARGET="http://127.0.0.1:8789"; npm.cmd --prefix frontend run dev -- --host 127.0.0.1 --port 5174` 启动前端。
- 如果部署到其它后端地址，可以设置 `VITE_SIMPAGENT_API_BASE` 覆盖。

前端当前已接入：

- thread 列表、创建新聊天、选择历史聊天。
- 本地搜索已加载的 thread 标题和消息文本。
- 发送消息后订阅 `GET /runs/:runId/events`，实时渲染 `message_delta`。
- `thinking_delta`、`tool_call`、`tool_result`、`trace_snapshot` 和错误会进入右侧“已思考”面板。
- `tool_approval_requested` 会显示审批按钮，点击允许/拒绝会调用工具审批接口。

## Agent Loop 如何工作

一次 `runAgentTurn` 的核心流程：

1. 把用户输入追加为 `user` 消息。
2. 调用 Chat Completions adapter，请求模型流式输出。
3. adapter 边解析 SSE 边触发 `message_delta` / `thinking_delta`，CLI 和 server 可以实时展示。
4. 如果模型没有工具调用，本轮结束。
5. 如果模型发起工具调用，core 先发出 `tool_approval_requested`。
6. 审批通过后执行工具；审批拒绝、参数错误、runtime 抛错都会变成结构化 `tool` 消息。
7. 把工具结果回填给模型，再请求下一轮，直到没有工具调用或达到最大工具轮数。
8. 保存 trace，并发出 `done`。

这也是为什么工具失败时不应该直接结束 CLI：工具错误本身是模型下一步推理需要的信息。

## 测试与检查

完整回归命令：

```bash
npm run typecheck
npm run build
npm run lint
npm test
npm run test:smoke
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run test:e2e
```

`npm run test:smoke` 是单独的真 LLM smoke test 层，默认只收集 `.smoke.test.ts` 文件。
它直接读取仓库根目录的 `simpagent.toml`，需要在这个文件里填写 smoke 专用字段：

- `smokeChatModel`
- `smokeReasoningModel`
- 可选：`smokeBaseUrl`
- 可选：`smokeApiKey`

如果这些字段没有设置，smoke test 会直接失败并提示缺少哪个配置，不会静默跳过。

后端还提供了一个 `GET /models` 接口，会去 provider 的 `/models` 拉取当前可用模型列表。
这个接口给前端模型下拉框和 smoke test 共用，后面想做“自动选 chat / reasoning 模型”时就不用再重复写一遍请求逻辑。

当前核心测试覆盖：

- Chat Completions 请求体组装。
- SSE 增量解析、工具调用分片拼装、实时事件回调。
- human-in-loop 拒绝工具后继续下一轮。
- 工具 runtime 抛错后回填 `TOOL_EXECUTION_ERROR` 并继续下一轮。
- Node runtime 的配置、文件、shell、trace store。
- HTTP Server 的 thread 恢复、标题生成、404/400 边界和 SSE 输出。
- HTTP Server 的模型列表代理 `/models`。
- React 前端的真实 API mock、SSE 流式输出、工具审批、移动端侧栏和中文输入法组合态。
- 真 LLM smoke test 会在 `simpagent.toml` 配好 smoke 字段后额外验证非思考模型和思考模型的真实 SSE 流式返回。

## 常见问题

### CLI 没有任何输出

先检查三件事：

- `simpagent.toml` 里的 `baseUrl`、`apiKey`、`model` 是否有效。
- 模型服务是否真的返回 SSE，且网络没有被代理或防火墙阻断。
- 如果模型第一步只发起工具调用，终端可能先看到 `[tool approval]`，需要输入审批结果。

### 工具失败后为什么还会继续请求模型

这是有意设计。工具失败会被写成类似下面的结构化结果：

```json
{
  "ok": false,
  "errorCode": "TOOL_EXECUTION_ERROR",
  "message": "ENOENT: missing.txt"
}
```

agent loop 会把它作为 `tool` 消息回填给模型，让模型决定改参数、换方法，或向用户解释失败。

### trace 在哪里

默认写入 `.simpagent/simpagent.sqlite`。SQLite schema 的人类可读真源是 `docs/SQLite表结构.md`。

第一版已经建立 `conversations`、`nodes`、`edges`、`events`、tag 关系表和 payload tables。当前 agent loop 仍通过 `TraceStore` 抽象写入，但底层会拆成 conversation、message、event、llm call、tool call 和 approval 记录。

SQLite 的 schema 和 trace 拆分逻辑位于 `agent-core`；`runtime-node` 只负责打开本地 `node:sqlite` 数据库文件。当前不迁移旧 `.simpagent/threads/*.json` 历史，也不会把完整 `threadSnapshot` 塞进 `metadata_json`。

注意：持久化层会脱敏 HTTP `Authorization` header，避免 API key 明文进入 SQLite。

## 开发建议

- 修改 core 行为时优先补 Vitest，因为 CLI 和 server 都复用 core。
- 修改 CLI/server 行为时同时观察事件协议，避免前端接入时出现语义不一致。
- 新增工具时先定义工具 schema，再在 runtime executor 中实现，并补异常回填测试。
