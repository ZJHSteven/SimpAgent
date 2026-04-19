/**
 * HTTP Server 应用入口。
 *
 * 对外提供：
 * 1) Thread 管理接口（创建、查询、fork）
 * 2) Run 启动接口（触发一次 agent turn）
 * 3) SSE 事件流接口（实时订阅 run 事件）
 * 4) 工具审批接口（外部系统回填 approve/deny）
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  AgentPool,
  IncrementalIdGenerator,
  RuntimeToolExecutor,
  encodeSseEvent,
  runAgentTurn,
  systemClock,
  type AgentEvent
} from "@simpagent/agent-core";
import {
  DeferredApprovalRuntime,
  JsonFileTraceStore,
  NodeFileRuntime,
  NodeShellRuntime,
  configToProviderStrategy,
  loadNodeConfig
} from "@simpagent/runtime-node";

/**
 * 每个 run 对应一个事件通道：
 * - clients: 当前正在订阅该 run 的 SSE 客户端集合
 * - events: 历史事件缓存（新连接可补发）
 */
interface RunChannel {
  readonly clients: Set<ServerResponse>;
  readonly events: AgentEvent[];
}

/**
 * 读取并解析请求体 JSON。
 * 说明：为空体时回退为 {}，避免 JSON.parse("") 抛错。
 */
async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    // 统一转 Buffer，兼容 string/buffer 两种 chunk 形态。
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

/**
 * 统一 JSON 响应发送函数。
 */
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

/**
 * 404 统一响应。
 */
function notFound(response: ServerResponse): void {
  sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", message: "接口不存在" });
}

/**
 * Server 主流程：
 * 1) 初始化配置与 runtime
 * 2) 注册默认 agent
 * 3) 启动 HTTP 服务并分发路由
 */
async function main(): Promise<void> {
  // 读取运行配置。
  const config = await loadNodeConfig();
  // ID 生成器（run/thread/turn 等）。
  const idGenerator = new IncrementalIdGenerator();
  // Node runtime 三件套。
  const fileRuntime = new NodeFileRuntime();
  const shellRuntime = new NodeShellRuntime();
  // server 场景下使用“延迟审批”，由 HTTP 接口异步回填。
  const approvalRuntime = new DeferredApprovalRuntime();
  // runtime 聚合对象，传给 core。
  const runtime = { fileRuntime, shellRuntime, approvalRuntime };
  // 本地 trace 存储。
  const traceStore = new JsonFileTraceStore(config.storageDir);
  // 内存态 agent/thread 管理器。
  const pool = new AgentPool(systemClock, idGenerator);
  // runId -> channel 的事件通道映射。
  const channels = new Map<string, RunChannel>();
  // provider 策略快照。
  const strategy = configToProviderStrategy(config);

  // 注册默认 agent，首版先固定 1 个角色。
  pool.registerAgent({
    id: "agent_default",
    name: "SimpAgent",
    description: "默认后端 agent，用于首版纵向跑通。",
    instructions: "你是 SimpAgent 的默认编码助手。",
    toolNames: ["read_file", "edit_file", "shell_command"],
    providerStrategyId: strategy.id
  });

  const server = createServer(async (request, response) => {
    try {
      // 方法与 URL 解析。
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");

      // POST /threads: 创建新会话。
      if (method === "POST" && url.pathname === "/threads") {
        const body = await readJson<{ title?: string }>(request);
        const thread = pool.createThread({
          agentId: "agent_default",
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as never);
        sendJson(response, 201, thread);
        return;
      }

      // GET /threads: 列出内存中的会话。
      if (method === "GET" && url.pathname === "/threads") {
        sendJson(response, 200, pool.listThreads());
        return;
      }

      const threadMatch = url.pathname.match(/^\/threads\/([^/]+)$/);

      // GET /threads/:id: 查询单个会话。
      if (method === "GET" && threadMatch?.[1] !== undefined) {
        sendJson(response, 200, pool.getThread(threadMatch[1]));
        return;
      }

      const forkMatch = url.pathname.match(/^\/threads\/([^/]+)\/fork$/);

      // POST /threads/:id/fork: 从指定消息分叉新会话。
      if (method === "POST" && forkMatch?.[1] !== undefined) {
        const body = await readJson<{ fromMessageId: string; title?: string }>(request);
        const thread = pool.forkThread({
          sourceThreadId: forkMatch[1],
          fromMessageId: body.fromMessageId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as never);
        sendJson(response, 201, thread);
        return;
      }

      const runMatch = url.pathname.match(/^\/threads\/([^/]+)\/runs$/);

      // POST /threads/:id/runs: 启动一次异步运行。
      if (method === "POST" && runMatch?.[1] !== undefined) {
        const body = await readJson<{ input: string }>(request);
        const thread = pool.getThread(runMatch[1]);
        // 为本次运行分配 run/turn id。
        const runId = idGenerator.nextId("run");
        const turnId = idGenerator.nextId("turn");
        // 初始化事件通道并登记。
        const channel: RunChannel = { clients: new Set(), events: [] };
        channels.set(runId, channel);

        // 后台执行 run，不阻塞当前 HTTP 请求。
        void runAgentTurn({
          runId,
          threadId: thread.id,
          turnId,
          messages: thread.messages,
          userText: body.input,
          strategy,
          toolExecutor: new RuntimeToolExecutor(runtime),
          runtime,
          traceStore,
          fetchFn: fetch,
          clock: systemClock,
          idGenerator,
          approvalPolicy: config.approvalPolicy,
          onEvent: async (event) => {
            // 保存历史事件，便于后续 SSE 客户端补发。
            channel.events.push(event);
            // 广播给所有在线订阅者。
            for (const client of channel.clients) {
              client.write(encodeSseEvent(event));
            }
          }
        })
          .then(async (result) => {
            // 运行完成后写回 thread 最新消息快照。
            const updated = pool.replaceThreadMessages(thread.id, result.messages);
            await traceStore.saveThread(thread.id, updated as unknown as never);
          })
          .catch((error: unknown) => {
            // 出错时转成标准 error 事件继续广播。
            const event: AgentEvent = {
              type: "error",
              threadId: thread.id,
              turnId,
              errorCode: "RUN_FAILED",
              message: error instanceof Error ? error.message : String(error)
            };
            channel.events.push(event);
            for (const client of channel.clients) {
              client.write(encodeSseEvent(event));
            }
          });

        // 立即返回 runId，客户端可据此去订阅事件流。
        sendJson(response, 202, { runId, turnId });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/runs\/([^/]+)\/events$/);

      // GET /runs/:runId/events: 订阅 SSE 事件流。
      if (method === "GET" && eventsMatch?.[1] !== undefined) {
        const channel = channels.get(eventsMatch[1]);

        if (channel === undefined) {
          sendJson(response, 404, { ok: false, errorCode: "RUN_NOT_FOUND", message: "run 不存在" });
          return;
        }

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });

        channel.clients.add(response);

        // 新客户端先补发历史事件，再继续接收实时事件。
        for (const event of channel.events) {
          response.write(encodeSseEvent(event));
        }

        request.on("close", () => {
          // 连接关闭时移除客户端，防止内存泄漏。
          channel.clients.delete(response);
        });
        return;
      }

      const approvalMatch = url.pathname.match(/^\/runs\/([^/]+)\/tool-approvals\/([^/]+)$/);

      // POST /runs/:runId/tool-approvals/:toolCallId: 提交审批结果。
      if (method === "POST" && approvalMatch?.[2] !== undefined) {
        const body = await readJson<{ decision: "approve" | "deny"; reason?: string }>(request);
        const ok = approvalRuntime.resolve(approvalMatch[2], {
          decision: body.decision,
          ...(body.reason === undefined ? {} : { reason: body.reason })
        });
        sendJson(response, ok ? 200 : 404, { ok });
        return;
      }

      // 其余路径统一 404。
      notFound(response);
    } catch (error: unknown) {
      // 路由处理异常统一返回 500 JSON。
      sendJson(response, 500, {
        ok: false,
        errorCode: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 默认端口 8787，可通过环境变量 PORT 覆盖。
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => {
    process.stdout.write(`SimpAgent server listening on http://localhost:${port}\n`);
  });
}

/**
 * 进程级兜底错误处理。
 */
main().catch((error: unknown) => {
  process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
