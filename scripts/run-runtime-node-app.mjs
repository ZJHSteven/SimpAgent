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

/**
 * backend 包装脚本的真实目录。
 * 说明：
 * - 在 npm workspace 脚本里，`process.cwd()` 与 `INIT_CWD` 往往都会指向仓库根目录；
 * - 但 `./data`、`./presets` 这种相对路径，语义上应该参照“当前 backend 包自己的目录”；
 * - npm 已经把当前 workspace 包的 `package.json` 路径放在 `npm_package_json` 环境变量里，
 *   因此这里优先用它反推 backend 目录。
 */
const packageJsonPath = process.env.npm_package_json;
const appBackendCwd =
  typeof packageJsonPath === "string" && packageJsonPath.trim()
    ? path.dirname(packageJsonPath)
    : process.cwd();
const resolvedDataDir = path.isAbsolute(dataDir) ? dataDir : path.resolve(appBackendCwd, dataDir);
const resolvedPresetDir =
  typeof presetDir === "string" && presetDir.trim()
    ? path.isAbsolute(presetDir)
      ? presetDir
      : path.resolve(appBackendCwd, presetDir)
    : "";

// 合并运行时环境变量。
const childEnv = {
  ...process.env,
  SIMPAGENT_PROJECT_ID: projectId,
  SIMPAGENT_DATA_DIR: resolvedDataDir,
  PORT: port,
  INIT_CWD: appBackendCwd
};

if (resolvedPresetDir) {
  childEnv.SIMPAGENT_PRESET_DIR = resolvedPresetDir;
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
