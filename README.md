# SimpAgent Monorepo

本仓库已完成一次性结构重构，目标是把 Agent 框架拆成“可复用内核 + 多运行时适配层 + 业务应用”。

## 目录结构

```text
simpagent/
  packages/
    core/                  # 纯 TypeScript 内核（类型、Prompt、工具循环、Ports、三层配置合并）
    runtime-node/          # Node 适配层（Express/WS/SQLite/LangGraph）
    runtime-worker/        # Cloudflare Workers + D1 适配层（最小可运行链路）
    runtime-tauri-bridge/  # Tauri 前端桥接层（invoke 协议与 mock）
  apps/
    trpg-desktop/          # 跑团桌面端占位
    learning-desktop/      # 学习桌面端占位
    dev-console/           # 调试控制台（7页可运行）
  backend/                 # 兼容壳：旧命令转发到 runtime-node
```

## 关键设计

1. 内核与适配层分离：`core` 不依赖 Node 专属 API。  
2. 三层配置模型：`Runtime Patch > User Override > Preset`。  
3. Node/Worker/Tauri 路线并行：同一内核，不同平台实现。  
4. 旧 `backend` 路径保留：避免历史脚本与习惯命令立即失效。

## 快速开始

在仓库根目录执行：

```bash
npm install
npm run build:workspaces
```

运行 Node 后端（新的主实现）：

```bash
npm run dev:runtime-node

运行 dev-console（7 页调试台）：

```bash
npm run dev:dev-console
```

一条命令同时启动 dev-console 独立后端 + 前端：

```bash
npm run dev:dev-console:full
```

按 App 独立后端启动（project_id + 端口隔离）：

```bash
npm run dev:backend:dev-console   # project_id=dev-console, port=3002
npm run dev:backend:learning      # project_id=learning-desktop, port=3012
npm run dev:backend:trpg          # project_id=trpg-desktop, port=3022
```
```

运行 Node 冒烟测试：

```bash
npm run --workspace @simpagent/runtime-node test:smoke
```

## 兼容说明

`backend/` 现在是兼容壳，`npm run dev/build/start/test:smoke` 会转发到 `@simpagent/runtime-node`。
