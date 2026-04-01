# dev-console backend

这里不是第二份框架实现，而只是 `@simpagent/runtime-node` 的运行包装。

它当前只负责四件事：

1. 固定 `projectId = dev-console`
2. 固定 `dataDir = ./data`
3. 固定 `presetDir = ./presets/medical-training-bench-v1`
4. 固定 `port = 3002`
5. 启动 `@simpagent/runtime-node`

启动方式：

```bash
npm run --workspace @simpagent/dev-console-backend dev
```

当前这个 backend 目录现在应该被理解为“项目级后端目录”，它自己承载：

- `data/framework.sqlite`
- `presets/medical-training-bench-v1/*`

也就是说：

- 框架实现仍然复用 `packages/runtime-node`
- 但这个 App 自己的数据库、测试预设、后续日志与可观测数据，应该继续落在它自己的 backend 目录下

如果你后续要继续给调试台增加专属 preset，可以在这个目录下继续加新的 `presets/` 子目录，再把路径作为第 5 个参数传给 `scripts/run-runtime-node-app.mjs`。
