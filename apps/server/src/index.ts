/**
 * HTTP Server 应用入口。
 *
 * 本文件的职责：
 * 1. 把 agent-core / runtime-node 组装成一个可被前端调用的 HTTP 服务。
 * 2. 提供 thread 管理、run 启动、SSE 事件订阅、工具审批回填等接口。
 * 3. 在 server 启动时扫描磁盘里的 thread 快照，旧数据直接跳过，新数据继续使用。
 *
 * 为什么不在这里引入 Express：
 * - 当前接口数量少，Node 原生 http 足够清楚。
 * - 少一层框架依赖，初学者可以直接看到 HTTP method、path、JSON、SSE 是如何工作的。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentPool,
  RuntimeToolExecutor,
  encodeSseEvent,
  UuidV7IdGenerator,
  createUuidV7Id,
  runAgentTurn,
  systemClock,
  listProviderModels,
  type AgentEvent,
  type FetchLike,
  type JsonObject,
  type SimpAgentId,
  type ThreadState
} from "@simpagent/agent-core";
import {
  DeferredApprovalRuntime,
  JsonFileTraceStore,
  NodeFileRuntime,
  NodeShellRuntime,
  configToProviderStrategy,
  loadNodeConfig,
  type SimpAgentNodeConfig
} from "@simpagent/runtime-node";

/**
 * 每个 run 对应一个事件通道。
 *
 * clients:
 * - 当前还保持连接的 SSE HTTP response。
 *
 * events:
 * - 已发生的历史事件；前端如果在 run 已开始后才连接，也能先收到补发事件。
 */
interface RunChannel {
  readonly clients: Set<ServerResponse>;
  readonly events: AgentEvent[];
}

/**
 * createSimpAgentHttpServer 的可选注入项。
 *
 * 设计目的：
 * - 正常运行时不传任何东西，直接读取 `simpagent.toml` 并使用真实 fetch。
 * - 测试时可以注入临时配置和 mock fetch，避免依赖真实模型服务。
 */
export interface CreateSimpAgentHttpServerOptions {
  readonly config?: SimpAgentNodeConfig;
  readonly fetchFn?: FetchLike;
}

/**
 * 读取并解析请求体 JSON。
 *
 * 输入：
 * - request: Node 原生 HTTP 请求对象。
 *
 * 输出：
 * - 按泛型 T 返回的 JSON 对象。
 *
 * 边界处理：
 * - 空 body 视为 `{}`，这样 `POST /threads` 不带 body 也能创建默认标题的 thread。
 * - JSON 语法错误会抛出异常，由外层路由转换为 500；后续如需更细粒度可改成 400。
 */
async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    // 统一转成 Buffer，兼容 Node 流里可能出现的 string 或 Buffer。
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

/**
 * 统一 JSON 响应发送函数。
 *
 * 这里集中设置 content-type，避免每个路由重复写响应头。
 */
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

/**
 * 404 统一响应。
 */
function notFound(response: ServerResponse, message = "接口不存在"): void {
  sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", message });
}

/**
 * 400 统一响应。
 */
function badRequest(response: ServerResponse, message: string): void {
  sendJson(response, 400, { ok: false, errorCode: "BAD_REQUEST", message });
}

/**
 * 判断一个持久化 JSON 是否像 ThreadState。
 *
 * 这里做的是 server 边界层的轻量校验：
 * - 真正的 TypeScript 类型在运行时不存在，所以必须检查关键字段。
 * - 如果历史文件损坏，跳过该条，不让 server 因单个坏文件无法启动。
 */
function isThreadState(value: JsonObject): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.agentId === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.messages)
  );
}

/**
 * 从用户输入生成 thread 标题。
 *
 * 输入：
 * - userText: 用户第一次发送给该 thread 的文本。
 *
 * 输出：
 * - 最多 30 个字符的短标题。
 *
 * 取舍：
 * - 首版只做本地字符串裁剪，不额外请求模型总结标题，避免多一次模型调用和新的失败点。
 */
export function createThreadTitleFromUserText(userText: string): string {
  const normalized = userText.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return "新的会话";
  }

  return normalized.length > 30 ? `${normalized.slice(0, 30)}...` : normalized;
}

/**
 * 安全读取 thread。
 *
 * AgentPool.getThread 找不到时会抛错；HTTP 层更适合返回 404 JSON。
 */
function tryGetThread(pool: AgentPool, threadId: SimpAgentId): ThreadState | undefined {
  try {
    return pool.getThread(threadId);
  } catch {
    return undefined;
  }
}

/**
 * 判断 SSE 事件是否代表一次 run 已经结束。
 */
function isTerminalRunEvent(event: AgentEvent): boolean {
  return event.type === "done" || event.type === "error";
}

/**
 * 创建 SimpAgent HTTP Server，但不自动 listen。
 *
 * 这样做的好处：
 * - 生产入口 `main()` 可以调用后监听端口。
 * - Vitest 可以拿到同一个 server 实例绑定随机端口，做真实 HTTP/SSE 测试。
 */
export async function createSimpAgentHttpServer(
  options: CreateSimpAgentHttpServerOptions = {}
): Promise<Server> {
  // 读取运行配置；测试可注入临时配置，避免读取真实 `simpagent.toml`。
  const config = options.config ?? (await loadNodeConfig());
  // ID 生成器（run/thread/turn/message 等）。
  const idGenerator = new UuidV7IdGenerator();
  // Node runtime 三件套。
  const fileRuntime = new NodeFileRuntime();
  const shellRuntime = new NodeShellRuntime();
  // server 场景下使用“延迟审批”，由 HTTP 接口异步回填。
  const approvalRuntime = new DeferredApprovalRuntime();
  // runtime 聚合对象，传给 core。
  const runtime = { fileRuntime, shellRuntime, approvalRuntime };
  // 本地 trace/thread 存储。
  const traceStore = new JsonFileTraceStore(config.storageDir);
  // 内存态 agent/thread 管理器。
  const pool = new AgentPool(systemClock, idGenerator);
  // runId -> channel 的事件通道映射。
  const channels = new Map<string, RunChannel>();
  // provider 策略快照。
  const strategy = configToProviderStrategy(config);
  // 真实运行时使用全局 fetch；测试时可注入 mock fetch。
  const fetchFn = options.fetchFn ?? fetch;
  // 默认 agent 也使用 UUID v7 作为主键，语义名字放在 name 里。
  const agentId = createUuidV7Id();

  /**
   * 向 run 通道广播事件。
   *
   * 终止事件到达后主动结束 SSE response：
   * - 浏览器 EventSource 会收到 close，前端不需要一直挂着连接。
   * - 测试也能等待响应自然结束，而不是靠超时中断。
   */
  function broadcastRunEvent(channel: RunChannel, event: AgentEvent): void {
    channel.events.push(event);

    for (const client of channel.clients) {
      client.write(encodeSseEvent(event));

      if (isTerminalRunEvent(event)) {
        client.end();
      }
    }

    if (isTerminalRunEvent(event)) {
      channel.clients.clear();
    }
  }

  // 注册默认 agent，首版先固定 1 个角色。
  pool.registerAgent({
    id: agentId,
    name: "SimpAgent",
    description: "默认后端 agent，用于首版纵向跑通。",
    instructions: "你是 SimpAgent 的默认编码助手。",
    toolNames: ["read_file", "edit_file", "shell_command"],
    providerStrategyId: strategy.id
  });

  // 启动时恢复已持久化 thread。恢复失败的坏数据会被跳过，避免单个文件阻断服务启动。
  for (const snapshot of await traceStore.listThreads()) {
    if (isThreadState(snapshot)) {
      try {
        pool.restoreThread(snapshot as unknown as ThreadState);
      } catch {
        // 历史数据不做兼容，旧快照直接跳过。
      }
    }
  }

  return createServer(async (request, response) => {
    try {
      // 方法与 URL 解析。
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");

      // POST /threads: 创建新会话。
      if (method === "POST" && url.pathname === "/threads") {
        const body = await readJson<{ title?: string }>(request);
        const thread = pool.createThread({
          agentId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as JsonObject);
        sendJson(response, 201, thread);
        return;
      }

      // GET /threads: 列出内存中的会话。
      if (method === "GET" && url.pathname === "/threads") {
        sendJson(response, 200, pool.listThreads());
        return;
      }

      // GET /models: 从 provider 拉取当前可用模型列表，便于前端下拉选择。
      if (method === "GET" && url.pathname === "/models") {
        const models = await listProviderModels({
          strategy,
          fetchFn
        });
        sendJson(response, 200, models);
        return;
      }

      const threadMatch = url.pathname.match(/^\/threads\/([^/]+)$/);

      // GET /threads/:id: 查询单个会话。
      if (method === "GET" && threadMatch?.[1] !== undefined) {
        const thread = tryGetThread(pool, threadMatch[1]);

        if (thread === undefined) {
          notFound(response, `thread 不存在：${threadMatch[1]}`);
          return;
        }

        sendJson(response, 200, thread);
        return;
      }

      const forkMatch = url.pathname.match(/^\/threads\/([^/]+)\/fork$/);

      // POST /threads/:id/fork: 从指定消息分叉新会话。
      if (method === "POST" && forkMatch?.[1] !== undefined) {
        if (tryGetThread(pool, forkMatch[1]) === undefined) {
          notFound(response, `thread 不存在：${forkMatch[1]}`);
          return;
        }

        const body = await readJson<{ fromMessageId: string; title?: string }>(request);

        if (typeof body.fromMessageId !== "string" || body.fromMessageId.length === 0) {
          badRequest(response, "fromMessageId 必须是非空字符串");
          return;
        }

        const thread = pool.forkThread({
          sourceThreadId: forkMatch[1],
          fromMessageId: body.fromMessageId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as JsonObject);
        sendJson(response, 201, thread);
        return;
      }

      const runMatch = url.pathname.match(/^\/threads\/([^/]+)\/runs$/);

      // POST /threads/:id/runs: 启动一次异步运行。
      if (method === "POST" && runMatch?.[1] !== undefined) {
        const body = await readJson<{ input: string }>(request);

        if (typeof body.input !== "string" || body.input.trim().length === 0) {
          badRequest(response, "input 必须是非空字符串");
          return;
        }

        const thread = tryGetThread(pool, runMatch[1]);

        if (thread === undefined) {
          notFound(response, `thread 不存在：${runMatch[1]}`);
          return;
        }

        // 默认标题在第一次发送后变成用户输入摘要，左侧栏即可显示有意义的历史记录。
        const runnableThread =
          thread.title === "新的会话" && thread.messages.length === 0
            ? pool.updateThreadTitle(thread.id, createThreadTitleFromUserText(body.input))
            : thread;
        await traceStore.saveThread(runnableThread.id, runnableThread as unknown as JsonObject);

        // 为本次运行分配 run/turn id。
        const runId = idGenerator.nextId();
        const turnId = idGenerator.nextId();
        // 初始化事件通道并登记。
        const channel: RunChannel = { clients: new Set(), events: [] };
        channels.set(runId, channel);

        // 后台执行 run，不阻塞当前 HTTP 请求。
        void runAgentTurn({
          runId,
          threadId: runnableThread.id,
          turnId,
          messages: runnableThread.messages,
          userText: body.input,
          strategy,
          toolExecutor: new RuntimeToolExecutor(runtime),
          runtime,
          traceStore,
          fetchFn,
          clock: systemClock,
          idGenerator,
          approvalPolicy: config.approvalPolicy,
          onEvent: async (event) => {
            broadcastRunEvent(channel, event);
          }
        })
          .then(async (result) => {
            // 运行完成后写回 thread 最新消息快照。
            const updated = pool.replaceThreadMessages(runnableThread.id, result.messages);
            await traceStore.saveThread(runnableThread.id, updated as unknown as JsonObject);
          })
          .catch((error: unknown) => {
            // 出错时转成标准 error 事件继续广播。
            const event: AgentEvent = {
              type: "error",
              threadId: runnableThread.id,
              turnId,
              errorCode: "RUN_FAILED",
              message: error instanceof Error ? error.message : String(error)
            };
            broadcastRunEvent(channel, event);
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
          notFound(response, `run 不存在：${eventsMatch[1]}`);
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

        if (channel.events.some(isTerminalRunEvent)) {
          response.end();
          channel.clients.delete(response);
          return;
        }

        request.on("close", () => {
          // 连接关闭时移除客户端，防止内存泄漏。
          channel.clients.delete(response);
        });
        return;
      }

      const approvalMatch = url.pathname.match(/^\/runs\/([^/]+)\/tool-approvals\/([^/]+)$/);

      // POST /runs/:runId/tool-approvals/:toolCallId: 提交审批结果。
      if (method === "POST" && approvalMatch?.[1] !== undefined && approvalMatch[2] !== undefined) {
        if (!channels.has(approvalMatch[1])) {
          notFound(response, `run 不存在：${approvalMatch[1]}`);
          return;
        }

        const body = await readJson<{ decision: "approve" | "deny"; reason?: string }>(request);

        if (body.decision !== "approve" && body.decision !== "deny") {
          badRequest(response, "decision 必须是 approve 或 deny");
          return;
        }

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
}

/**
 * Server 主流程。
 */
async function main(): Promise<void> {
  const server = await createSimpAgentHttpServer();
  // 默认端口 8787，可通过环境变量 PORT 覆盖。
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => {
    process.stdout.write(`SimpAgent server listening on http://localhost:${port}\n`);
  });
}

/**
 * 只有直接执行 `tsx apps/server/src/index.ts` 时才启动监听。
 *
 * Vitest import 本文件时不会触发 listen，避免测试进程被常驻 server 卡住。
 */
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
