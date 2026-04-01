# dev-console backend

这里不是第二份框架实现，而只是 `@simpagent/runtime-node` 的运行包装。

它当前只负责四件事：

1. 固定 `projectId = dev-console`
2. 固定 `dataDir = ./data`
3. 固定 `port = 3002`
4. 启动 `@simpagent/runtime-node`

启动方式：

```bash
npm run --workspace @simpagent/dev-console-backend dev
```

如果你后续要给调试台增加专属 preset，可以继续在这个目录下加 `presets/`，再把路径作为第 5 个参数传给 `scripts/run-runtime-node-app.mjs`。
