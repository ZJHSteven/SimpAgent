# dev-console

`apps/dev-console` 是 SimpAgent 的框架能力调试台（7 页路由）：

1. `Agent Studio`：Agent / PromptBlock / Tool 配置入口  
2. `Workflow Canvas`：Workflow JSON 编辑与节点摘要  
3. `Memory & Worldbook`：state-diffs / side-effects / plan 观察  
4. `Run Fusion Cockpit`：对话 + 时间线 + 节点详情 + 日志融合页  
5. `Trace Inspector`：trace + prompt compile 审计页  
6. `Replay & Fork`：checkpoint 历史、补丁、分叉  
7. `System Settings`：系统配置、builtin tools、模板应用

## 运行方式

在仓库根目录执行：

```bash
npm run --workspace @simpagent/app-dev-console dev
```

默认连接：

- HTTP：`http://localhost:3002`
- WS：`ws://localhost:3002/ws`

可通过环境变量覆盖：

- `VITE_RUNTIME_NODE_BASE_URL`
- `VITE_RUNTIME_NODE_WS_URL`
