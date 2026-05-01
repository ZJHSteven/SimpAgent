/**
 * server 应用启动入口。
 *
 * 分层说明：
 * - HTTP 基础接口的契约定义在 `agent-core`。
 * - Node 版接口实现放在 `runtime-node`。
 * - 本文件只负责读取 server 应用自己的默认 preset，然后启动监听端口。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimpAgentHttpServer, loadNodeConfig } from "@simpagent/runtime-node";
import { loadServerDefaultPreset } from "./default-preset.js";

/**
 * Server 主流程。
 *
 * 核心逻辑：
 * - 先读取 `simpagent.toml`，拿到真实 provider/baseUrl/model。
 * - 用这些运行时配置加载 app 自己的 preset JSON。
 * - 再把 preset 交给 runtime-node 的 Node HTTP 实现。
 */
async function main(): Promise<void> {
  const config = await loadNodeConfig();
  const server = await createSimpAgentHttpServer({
    config,
    defaultPreset: loadServerDefaultPreset({
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model
    })
  });
  // 默认端口改成 8788，避开本机上已经被其他服务占用的 8787。
  // 仍然保留 PORT 环境变量覆盖，这样调试时可以临时切到任意空闲端口。
  const port = Number(process.env.PORT ?? 8788);

  server.listen(port, () => {
    process.stdout.write(`SimpAgent server listening on http://localhost:${port}\n`);
  });
}

/**
 * 只有直接执行 `tsx apps/server/src/index.ts` 时才启动监听。
 *
 * Vitest 或其他模块 import 本文件时不会触发 listen，避免测试进程被常驻 server 卡住。
 */
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
