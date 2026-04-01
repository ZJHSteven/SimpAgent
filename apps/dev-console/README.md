# dev-console

`apps/dev-console` 是当前仓库里的“框架调试台”。

它的目标不是展示某个业务场景，而是把 `packages/runtime-node` 已经具备的框架能力直接暴露出来做观察与烟雾测试，例如：

- 创建真实 run
- 观察 trace / prompt compile / state diff / side effect
- 观察 agent / workflow / prompt-unit / catalog / builtin tools
- 进行 pause / resume / interrupt / approval / fork / patch
- 直接填写真实 LLM 的 `baseURL / apiKey / model / apiMode`

前端启动：

```bash
npm run --workspace @simpagent/app-dev-console dev
```

后端启动：

```bash
npm run --workspace @simpagent/dev-console-backend dev
```
