# ExecPlan：SimpAgent TS 后端首版纵向跑通

## 当前目标
- 新增 TypeScript npm monorepo 后端，不修改 `frontend/` 与 `chatgpt-temp/`。
- 建立根级 workspace：`apps/*` 放可运行产物，`packages/*` 放核心与 runtime 包。
- 首版跑通 CLI 与 HTTP/SSE 服务，支持 OpenAI-compatible Chat Completions、DeepSeek/OpenAI provider、Node runtime、trace 落盘与 human-in-loop 工具审批。

## 执行步骤
1. [x] **仓库级工程化**
   - 新增根级 `package.json`、`tsconfig.base.json`、`vitest.config.ts`。
   - 更新 `.gitignore`，忽略 `simpagent.toml`、`.simpagent/`、`dist/` 等本地运行产物。
   - 新增 `simpagent.example.toml`，真实密钥只放本地 `simpagent.toml`。
2. [x] **实现 `packages/agent-core`**
   - 定义 context message、tool、trace、thread、runtime 抽象、SSE 前端事件类型。
   - 实现 Chat Completions adapter、OpenAI/DeepSeek extra 映射、SSE chunk parser。
   - 实现 agent loop、agent pool、tool approval 暂停/继续/拒绝流程。
3. [x] **实现 runtime 包**
   - `runtime-node` 实现 TOML 配置读取、文件工具、shell 工具、JSON trace store。
   - `runtime-cloudflare-worker` 与 `runtime-tauri` 保留明确 unsupported 占位。
4. [x] **实现应用入口**
   - `apps/cli` 支持终端执行一次 agent turn，并在工具调用前询问用户。
   - `apps/server` 提供 REST + SSE：thread、run、tool approval、fork。
5. [x] **测试与验收**
   - 单元测试覆盖 adapter、stream parser、loop approval、tools、trace store。
   - 集成测试覆盖 mock CLI turn 与 HTTP/SSE approval 流程。
   - 已执行 `npm install`、`npm run typecheck`、`npm run build`、`npm run lint`、`npm test`。

## 验收标准
- 不需要真实前端即可通过 CLI 或 HTTP/SSE 跑通一次 mock agent 任务。
- 默认工具策略为 `ask`：工具调用会暂停，approve 后执行，deny 后回填 `TOOL_EXECUTION_DENIED_BY_HUMAN`。
- Node runtime 能落盘 `.simpagent/threads/{threadId}.json`，其中包含 turn、请求体、响应片段、工具审批、工具结果与错误。
- OpenAI/DeepSeek Chat Completions payload 与流式解析有测试覆盖。

## 当前结果
- 已完成根级 workspace、4 个 packages、2 个 apps、示例 TOML、Node runtime、占位 runtime、核心 loop、工具审批、trace store 与测试。
- 已通过：
  - `npm run typecheck`
  - `npm run build`
  - `npm run lint`
  - `npm test`
- 后续可在本地复制 `simpagent.example.toml` 为 `simpagent.toml`，填入真实 DeepSeek/OpenAI-compatible 配置后运行 `npm run cli -- "你的任务"` 或 `npm run server`。
