# dev-console backend

这是 `apps/dev-console` 的独立后端入口。

实现方式：
- 运行时复用 `@simpagent/runtime-node`（框架包）；
- 通过环境变量实现 app 级隔离：
  - `SIMPAGENT_PROJECT_ID=dev-console`
  - `SIMPAGENT_DATA_DIR=./data`（SQLite 落在本目录）
  - `SIMPAGENT_PRESET_DIR=./presets/mededu-default-v1`（JSON 预设层）
  - `PORT=3002`

启动：

```bash
npm run --workspace @simpagent/dev-console-backend dev
```

