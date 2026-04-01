// 文件作用：
// - 作为各个 `apps/*/backend` 运行包装的统一启动脚本。
// - 避免在 npm scripts 里继续依赖仓库当前并未安装的 `cross-env`。
//
// 使用方式：
// - `node ../../../scripts/run-runtime-node-app.mjs dev dev-console 3002 ./data`
// - 参数依次为：
//   1) runtime-node 要执行的脚本名（dev/start/build）
//   2) projectId
//   3) port
//   4) dataDir（相对当前 backend 目录）
//   5) presetDir（可选，相对当前 backend 目录）

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const [, , runtimeCommand = "dev", projectId = "dev-console", port = "3002", dataDir = "./data", presetDir = ""] =
  process.argv;

// backend 包装脚本的工作目录。
// 说明：
// - 这个目录才是 `./data`、`./presets` 等相对路径真正应该参照的位置；
// - 所以这里显式把它塞回 `INIT_CWD`，让 `runtime-node` 内部解析路径时保持一致。
const appBackendCwd = process.cwd();

// 合并运行时环境变量。
const childEnv = {
  ...process.env,
  SIMPAGENT_PROJECT_ID: projectId,
  SIMPAGENT_DATA_DIR: dataDir,
  PORT: port,
  INIT_CWD: appBackendCwd
};

if (presetDir.trim()) {
  childEnv.SIMPAGENT_PRESET_DIR = presetDir.trim();
}

const child = spawn(`npm run --workspace @simpagent/runtime-node ${runtimeCommand}`, {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
  shell: true
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("RUNTIME_NODE_APP_WRAPPER_FAILED", error);
  process.exit(1);
});
