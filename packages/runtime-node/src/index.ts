/**
 * 本文件作用：
 * - 后端启动入口。
 * - 组装依赖：SQLite、Registry、PromptCompiler、ToolRuntime、Provider、TraceBus、Runtime、HTTP、WS。
 *
 * 教学说明：
 * - 这里相当于“应用装配层”（composition root）。
 * - 业务逻辑不要都塞在这里；这里只负责创建对象并连接模块。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import cors from "cors";
import express from "express";
import { AppDatabase, seedDefaultConfigs } from "./storage/index.js";
import { AgentRegistry } from "./core/agents/index.js";
import { WorkflowRegistry } from "./core/workflows/index.js";
import { ToolRegistry, ToolRuntime } from "./core/tools/index.js";
import { PromptCompiler } from "./core/prompt/index.js";
import { UnifiedProviderClient } from "./providers/index.js";
import { TraceEventBus } from "./core/trace/index.js";
import { createNodeBoundRuntimeEngine } from "./engineNodeBindings.js";
import { registerHttpRoutes } from "./api/index.js";
import { setupWsServer } from "./ws/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const projectId = process.env.SIMPAGENT_PROJECT_ID || "dev-console";
const dataDir = path.join(projectRoot, "data", projectId);
const dbPath = path.join(dataDir, "framework.sqlite");

// ===== 存储与种子数据 =====
const db = new AppDatabase(dbPath);
seedDefaultConfigs(db);

// ===== 配置注册表（支持热更新后 refresh）=====
const agentRegistry = new AgentRegistry(db);
const workflowRegistry = new WorkflowRegistry(db);
const toolRegistry = new ToolRegistry(db, projectId);
agentRegistry.refresh();
workflowRegistry.refresh();
toolRegistry.refresh();

// ===== 核心模块 =====
const promptCompiler = new PromptCompiler();
const providerClient = new UnifiedProviderClient();
const traceBus = new TraceEventBus(db);
const toolRuntime = new ToolRuntime({
  workspaceRoot: path.resolve(projectRoot, ".."),
  // 首版白名单保守一些，后续通过配置化权限策略替换。
  shellAllowPrefixes: ["echo ", "dir", "ls", "pwd", "cd ", "where ", "which ", "node -v", "npm -v"]
});

const { nodeEngine: engine } = createNodeBoundRuntimeEngine({
  projectId,
  db,
  agentRegistry,
  workflowRegistry,
  toolRegistry,
  promptCompiler,
  toolRuntime,
  providerClient,
  traceBus,
  workspaceRoot: path.resolve(projectRoot, ".."),
  dataDir
});

// ===== HTTP API =====
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
registerHttpRoutes(app, {
  projectId,
  db,
  agentRegistry,
  workflowRegistry,
  toolRegistry,
  promptCompiler,
  toolRuntime,
  providerClient,
  traceBus,
  workspaceRoot: path.resolve(projectRoot, ".."),
  dataDir,
  engine
});

// ===== HTTP + WS 共享同一服务器 =====
const server = http.createServer(app);
setupWsServer(server, {
  projectId,
  db,
  agentRegistry,
  workflowRegistry,
  toolRegistry,
  promptCompiler,
  toolRuntime,
  providerClient,
  traceBus,
  workspaceRoot: path.resolve(projectRoot, ".."),
  dataDir,
  engine
});

const port = Number(process.env.PORT || 3002);
server.listen(port, () => {
  console.log(`Observable Agent Backend listening on http://localhost:${port}`);
  console.log(`Project Scope: ${projectId}`);
  console.log(`WS endpoint: ws://localhost:${port}/ws`);
});
