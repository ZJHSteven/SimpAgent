# dev-console

`apps/dev-console` 是 SimpAgent 的框架能力调试台（7 页路由）。

它的定位不是“另写一套后端逻辑”，而是：
- 前端负责把框架能力可视化成可操作 UI（表单、开关、按钮）；
- 后端仍复用 `@simpagent/runtime-node`，但以独立 `project_id` 与端口运行；
- 数据库按 App 隔离，不互串。

1. `Agent Studio`：Agent / PromptBlock / Tool 配置入口  
2. `Workflow Canvas`：Workflow JSON 编辑与节点摘要  
3. `Memory & Worldbook`：state-diffs / side-effects / plan 观察  
4. `Run Fusion Cockpit`：对话 + 时间线 + 节点详情 + 日志融合页  
5. `Trace Inspector`：trace + prompt compile 审计页  
6. `Replay & Fork`：checkpoint 历史、补丁、分叉  
7. `System Settings`：系统配置、builtin tools、模板应用

## 运行方式

在仓库根目录执行（当前推荐分别启动）：

```bash
# 终端1：dev-console 独立后端
npm run dev:backend:dev-console

# 终端2：dev-console 前端
npm run dev:dev-console
```

构建前端：

```bash
npm run build:dev-console
```

默认连接（dev-console）：

- HTTP：`http://localhost:3002`
- WS：`ws://localhost:3002/ws`

独立后端目录：

- `apps/dev-console/backend/`

预设 JSON（Preset 层）目录：

- `apps/dev-console/backend/presets/mededu-default-v1/`
  - `agents.json`
  - `prompt_blocks.json`
  - `workflows.json`
  - `tools.json`

独立数据库目录（由后端自动创建）：

- `apps/dev-console/backend/data/`

Stitch 设计资产下载目录：

- `apps/dev-console/stitch-assets/`

可通过环境变量覆盖：

- `VITE_RUNTIME_NODE_BASE_URL`
- `VITE_RUNTIME_NODE_WS_URL`
