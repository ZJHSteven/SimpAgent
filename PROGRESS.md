# 项目状态快照（保持短小：建议 <= 200~400 行）

## 当前结论（必须最新）
- 现状：`packages/runtime-node` 仍是当前框架真源，`packages/core` 提供跨运行时抽象；现有 package 级构建、workspace 聚合构建、runtime-node 测试都已通过，说明 Node 主链可运行。
- 现状：`PLANS.md` 与 `PROGRESS.md` 已完成第一轮职责收口；`PLANS.md` 只保留当前计划，`PROGRESS.md` 负责最新状态快照。
- 现状：`apps/dev-console` 已恢复为最小框架调试台，并且已经能构建前端、构建后端包装、动态启动后端并打通基础库存接口。
- 现状：dev-console 的项目级数据库落盘问题已修正；SQLite 现在可以明确落到 `apps/dev-console/backend/data/`，不再依赖仓库根 `data/`。
- 已完成：
  - Monorepo/workspaces 已建立，主线目录为 `packages/*`、`apps/*`、`backend` 兼容壳。
  - `@simpagent/core` 已提供核心契约、PromptCompiler、ToolLoop、WorkflowRegistry、Ports 与统一运行时抽象。
  - `@simpagent/runtime-node` 已接通 SQLite、LangGraph、HTTP API、WebSocket、工具执行、PromptTrace、checkpoint/history/patch/fork、approval 等主链能力。
  - 工具主链已具备：
    - builtin tools（`shell_command`、`apply_patch`、`read_file`、`web_search`、`update_plan`、`request_user_input`、`view_image`、`handoff`）
    - canonical tool 抽象
    - provider 侧暴露适配
    - MCP / skill 结构化执行器
  - 统一图谱 `catalog` 已进入运行时主链，支持节点 / facet / relation CRUD，并能投影为 PromptUnit 与上下文块。
  - human-in-the-loop 已具备：
    - interrupt / resume
    - approval request
    - state patch
    - prompt override
    - fork
  - 现有验证已通过（2026-04-01 再次确认）：
    - `npm run --workspace @simpagent/runtime-node build`
    - `npm run --workspace @simpagent/runtime-node test`
  - 文档收口第一批已完成（2026-04-01）：
    - 根 `README.md` 已扩写为真正的仓库入口文档，而不再只是简短目录说明。
    - 新增 `docs/基于SimpleAgent框架开发App指南.md`，专门回答“如何基于当前框架开发一个新 App、哪些能力已经能直接复用、哪些接口不要重复造轮子”。
    - 开发指南已补上“接口速查表”，把 App backend 包装入口、真实 LLM 配置口、HTTP/WS 事件面收口，减少后续 AI 再次全仓阅读的需要。
  - workspace / 根脚本收口已完成（2026-04-01）：
    - 根 `package.json` 已把 `build/test/dev/preview` 收口到真实 workspace 入口，不再指向已经失效的根前端。
    - 根 workspace 已纳入 `apps/*/backend`，因此 app 级 backend 包名可以通过 `--workspace` 正常执行。
    - 新增 `scripts/run-runtime-node-app.mjs`，替代仓库中原本并不存在的 `cross-env` 依赖，让 app 级 backend 包装可以稳定复用 `@simpagent/runtime-node`。
  - 最小 `apps/dev-console` 调试台已恢复（2026-04-01）：
    - 新增独立前端 `@simpagent/app-dev-console`。
    - 新增独立后端包装 `@simpagent/dev-console-backend`。
    - 前端已直接对接现有 HTTP / WS，而不是另写后端。
    - 前端已暴露真实 LLM 配置入口：`vendor / apiMode / baseURL / apiKey / model / temperature`。
    - 当前面板已覆盖：
      - 框架库存查看（agents / workflows / prompt-units / builtin tools / catalog）
      - 真实 run 创建入口
      - trace / prompt compile
      - pause / resume / interrupt
      - approval 列表
      - checkpoint history
      - state patch / prompt-unit override / fork
      - state diff / side effect / tool exposure / system config
  - 本轮验证已完成（2026-04-01）：
    - `npm run --workspace @simpagent/app-dev-console build`
    - `npm run --workspace @simpagent/dev-console-backend build`
    - `npm run --workspace @simpagent/trpg-backend build`
    - `npm run build:workspaces`
    - `npm run build`
    - `npm run test`
    - `npm run --workspace @simpagent/runtime-node test`
    - 动态启动 `@simpagent/dev-console-backend` 后，已成功验证：
      - `GET /api/health`
      - `GET /api/workflows`
      - `GET /api/templates`
  - DeepSeek 真实链路验证已完成（2026-04-01）：
    - 以 `vendor=generic_openai_compat`、`apiMode=chat_completions`、`model=deepseek-chat`、`baseURL=https://api.deepseek.com` 发起真实 run。
    - 已确认 run 最终 `completed`，并结束于 `node.review`。
    - 已确认 DeepSeek 在当前框架里能走到真实工具调用，而不是只输出自然语言。
    - 已修复两类兼容问题：
      - 流式 tool-call 分片缺失 `id/name` 时，需要按槽位稳定累计，不能每片都生成新 callId。
      - 下一轮继续调用模型时，必须把上一轮 assistant 的 `tool_calls` 与对应 `role=tool` 消息一起回填。
    - 已新增回归测试 `test:chat-function-loop`，专门防止这条 chat/function 兼容链回退。
  - dev-console 项目级后端隔离第一步已完成（2026-04-01）：
    - `scripts/run-runtime-node-app.mjs` 已改为把 `dataDir / presetDir` 解析成 app backend 目录下的绝对路径，而不再依赖不稳定的 `INIT_CWD`。
    - `apps/dev-console/backend` 已默认加载 `presets/medical-training-bench-v1`。
    - 已新增医学训练测试预设：
      - 5 个 app 专属 agent
      - 9 个 app 专属 prompt units
      - 1 个 app 专属 workflow
    - 已验证：
      - `apps/dev-console/backend/data/framework.sqlite` 会真实生成
      - 以独立端口启动时，API 能读出 app 专属的 agent / workflow / prompt-unit
      - `npm run --workspace @simpagent/dev-console-backend build` 通过
      - `npm run test` 通过
- 正在做：
  - 已根据用户最新要求重写下一阶段 `PLANS.md`：
    - dev-console 要从“最小壳”继续升级成“项目级测试台”；
    - 重点改项目级 `data/` 落盘、专属 preset、结构化前端 UI、prompt unit 顺序/开关可视化。
  - 评估调试台是否还需要更强的图形化视图，而不只是当前“观察 + 控制 + JSON 面板”。
- 下一步：
  1. 先修正 dev-console 的 SQLite 与项目数据目录，确保落盘到 `apps/dev-console/backend/data/`。
  2. 为 dev-console 新建专属 preset，覆盖医学诊疗训练、多 agent、prompt units、handoff、评判与科研辅助。
  3. 重构调试台前端，减少纯 JSON 黑框，改成结构化展示，并加入 prompt unit 顺序/开关调节。

## 关键决策与理由（防止“吃书”）
- 决策A：框架真源继续以 `packages/runtime-node` 为准，而不是回退到 `backend` 或某个 app 内部后端副本。
  原因：运行时、HTTP、WS、SQLite、LangGraph、权限、测试都已集中在这里，继续分叉只会制造双主线。
- 决策B：`PLANS.md` 只记录“当前未完成执行计划”，不再保留已完成历史任务。
  原因：计划文件的作用是指导接下来怎么做，不是保存执行墓碑。
- 决策C：`PROGRESS.md` 只保留最新结论、关键决策、当前风险与下一步。
  原因：项目记忆需要短快，避免长上下文下继续失真。
- 决策D：新增一份面向 App 开发的框架文档，而不是继续把所有信息堆在总览文档里。
  原因：`docs/SimpleAgent框架总览与代码导览.md` 适合“找代码”，但不够直接回答“怎么基于框架造一个 app”。
- 决策E：调试台继续复用 `@simpagent/runtime-node`，通过 `projectId/dataDir/presetDir/port` 做隔离，不另写一套后端。
  原因：调试台的目标是验证框架，而不是复制框架。

## 常见坑 / 复现方法
- 坑1：Windows 下大补丁改文档或大文件时容易撞到命令长度限制；必要时应拆分 `apply_patch`。
- 坑2：当前测试已经能证明 package/framework 主链可运行，但真实 LLM 端到端仍必须等用户提供 `apiKey / baseURL`，不能伪造“真模型已跑通”的结论。
- 坑3：`projectId` 并没有覆盖所有版本化定义表的完整数据库隔离；当前更可靠的做法仍是每个 app 使用独立 `dataDir`。
- 坑4：Windows 下大补丁改文档容易一次过大，必要时拆分提交；否则后续 review 很难定位真正的结构变化。
- 坑5：当前测试已经能证明 package/framework 主链可运行，但还不能自动证明“调试台前端”这层也已经恢复并接通，因此本轮必须补一条 app 级验证链。
- 坑6：前端 `tsconfig` 开启了 `erasableSyntaxOnly` 时，不能偷懒使用 TypeScript 参数属性这类语法糖；需要改回朴素写法。
- 坑7：Windows 下 `spawn(npm.cmd, ...)` 在当前环境里可能直接报 `EINVAL`；统一运行包装脚本改为 `shell: true` 后才稳定。
- 坑8：当前 `apps/dev-console` 已接好真实 LLM 参数入口，但没有用户凭据时不能伪造“真实模型已跑通”的结论；目前只验证到了框架后端运行、库存接口和前端构建层。
- 坑9：OpenAI-compatible 厂商的流式 function call 经常不会在每个分片都重复返回 `id/name`；如果 parser 不按槽位累计，工具参数会被拆碎，最终导致错误 toolCallId 或空参数。
- 坑10：对 `chat_completions` 来说，只把 `role=tool` 消息喂回去是不够的；前一条 assistant 必须显式带上 `tool_calls`，否则 provider 可能直接拒绝请求。
