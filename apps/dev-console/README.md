# dev-console

`apps/dev-console` 是当前仓库里的“框架调试台”。

它的目标不是展示某个业务场景，而是把 `packages/runtime-node` 已经具备的框架能力直接暴露出来做观察与烟雾测试，例如：

- 创建真实 run
- 观察 trace / prompt compile / state diff / side effect
- 观察 agent / workflow / prompt-unit / catalog / builtin tools
- 进行 pause / resume / interrupt / approval / fork / patch
- 直接填写真实 LLM 的 `baseURL / apiKey / model / apiMode`

当前默认已经接入一套项目级测试预设：

- `apps/dev-console/backend/presets/medical-training-bench-v1/`

这套预设会额外提供：

- 医学训练编排器
- 低配合度患者模拟
- 临床导师
- 科研助手
- 评分评判者

因此这个调试台现在不只是“空壳”，而是已经有一套专门用来验证 PromptUnit、handoff、tool calling、catalog 与可观测性的测试定义。

前端启动：

```bash
npm run --workspace @simpagent/app-dev-console dev
```

后端启动：

```bash
npm run --workspace @simpagent/dev-console-backend dev
```
