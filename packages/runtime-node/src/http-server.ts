/**
 * Node HTTP Server 实现。
 *
 * 本文件的职责：
 * 1. 按 `agent-core` 定义的 HTTP route contract 实现 Node 版后端 API。
 * 2. 把 runtime-node 的文件系统、shell、审批、SQLite 适配能力接到 core agent loop。
 * 3. 在启动时导入默认 preset，再恢复磁盘里的 conversation 快照。
 *
 * 为什么不在这里引入 Express：
 * - 当前接口数量少，Node 原生 http 足够清楚。
 * - 少一层框架依赖，初学者可以直接看到 HTTP method、path、JSON、SSE 是如何工作的。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AgentPool,
  DEFAULT_AGENT_A_ID,
  RuntimeToolExecutor,
  SIMPAGENT_HTTP_ROUTES,
  compileAgentPrompt,
  encodeSseEvent,
  loadCoreDefaultPreset,
  matchSimpAgentRoute,
  UuidV7IdGenerator,
  runAgentTurn,
  systemClock,
  listProviderModels,
  type AgentEvent,
  type ContextRole,
  type FetchLike,
  type JsonObject,
  type PresetBundle,
  type SimpAgentId,
  type ThreadState,
  type ToolCallRequest,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolExecutor
} from "@simpagent/agent-core";
import { DeferredApprovalRuntime } from "./approval.js";
import { configToProviderStrategy, loadNodeConfig, type SimpAgentNodeConfig } from "./config.js";
import { NodeFileRuntime } from "./file-runtime.js";
import { NodeShellRuntime } from "./shell-runtime.js";
import { SqliteTraceStore } from "./trace-store.js";

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
  readonly defaultPreset?: PresetBundle;
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
 * - 空 body 视为 `{}`，这样 `POST /conversations` 不带 body 也能创建默认标题的会话。
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
 * server 侧工具执行器。
 *
 * 为什么需要这一层：
 * - RuntimeToolExecutor 知道“工具怎么执行”。
 * - SQLite 图谱知道“当前 agent 能看见哪些工具”。
 * - 这里把二者合在一起，让 listTools() 只暴露 tool_access 允许的工具。
 */
class ServerToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly visibleTools: readonly ToolDefinition[]
  ) {}

  listTools(): readonly ToolDefinition[] {
    return this.visibleTools;
  }

  executeTool(toolCall: ToolCallRequest): Promise<ToolExecutionResult> {
    return this.inner.executeTool(toolCall);
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
  // 本地 SQLite 存储。
  const traceStore = new SqliteTraceStore(config.storageDir);
  const defaultPreset = options.defaultPreset ?? loadCoreDefaultPreset({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model
  });

  if (!traceStore.hasPresetAgents()) {
    traceStore.importPreset(defaultPreset);
  }

  // 内存态 agent/conversation 管理器。
  const pool = new AgentPool(systemClock, idGenerator);
  // runId -> channel 的事件通道映射。
  const channels = new Map<string, RunChannel>();
  // provider 策略快照。
  const strategy = configToProviderStrategy(config);
  // 真实运行时使用全局 fetch；测试时可注入 mock fetch。
  const fetchFn = options.fetchFn ?? fetch;
  const agentDefinitions = traceStore.listAgentDefinitions();
  const agentDefinitionById = new Map(agentDefinitions.map((agent) => [agent.id, agent]));
  const defaultAgentId = agentDefinitionById.has(DEFAULT_AGENT_A_ID)
    ? DEFAULT_AGENT_A_ID
    : (agentDefinitions[0]?.id ?? DEFAULT_AGENT_A_ID);

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

  for (const agent of agentDefinitions) {
    pool.registerAgent(agent);
  }

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

      // POST /conversations: 创建新会话。
      if (method === "POST" && url.pathname === SIMPAGENT_HTTP_ROUTES.conversations) {
        const body = await readJson<{ title?: string; entryNodeId?: string }>(request);
        const entryNodeId = body.entryNodeId ?? defaultAgentId;
        try {
          pool.getAgent(entryNodeId);
        } catch {
          badRequest(response, `entryNodeId 不存在：${entryNodeId}`);
          return;
        }
        const thread = pool.createThread({
          agentId: entryNodeId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as JsonObject);
        sendJson(response, 201, thread);
        return;
      }

      // GET /conversations: 列出轻量会话目录。
      if (method === "GET" && url.pathname === SIMPAGENT_HTTP_ROUTES.conversations) {
        sendJson(
          response,
          200,
          pool.listThreads().map((thread) => ({
            id: thread.id,
            title: thread.title,
            entryNodeId: thread.agentId,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            messageCount: thread.messages.length
          }))
        );
        return;
      }

      // GET /models: 从 provider 拉取当前可用模型列表，便于前端下拉选择。
      if (method === "GET" && url.pathname === SIMPAGENT_HTTP_ROUTES.models) {
        const models = await listProviderModels({
          strategy,
          fetchFn
        });
        sendJson(response, 200, models);
        return;
      }

      const threadMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationById, url.pathname);

      // GET /conversations/:id: 查询前端默认聊天视图。
      if (method === "GET" && threadMatch?.[0] !== undefined) {
        const conversationId = threadMatch[0];
        const thread = tryGetThread(pool, conversationId);

        if (thread === undefined) {
          notFound(response, `thread 不存在：${conversationId}`);
          return;
        }

        sendJson(response, 200, {
          ...thread,
          entryNodeId: thread.agentId,
          messages: thread.messages.filter(
            (message) => message.role === "user" || message.role === "assistant" || message.role === "tool"
          )
        });
        return;
      }

      const forkMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationFork, url.pathname);

      // POST /conversations/:id/fork: 从指定消息分叉新会话。
      if (method === "POST" && forkMatch?.[0] !== undefined) {
        const conversationId = forkMatch[0];

        if (tryGetThread(pool, conversationId) === undefined) {
          notFound(response, `thread 不存在：${conversationId}`);
          return;
        }

        const body = await readJson<{ fromMessageId: string; title?: string }>(request);

        if (typeof body.fromMessageId !== "string" || body.fromMessageId.length === 0) {
          badRequest(response, "fromMessageId 必须是非空字符串");
          return;
        }

        const thread = pool.forkThread({
          sourceThreadId: conversationId,
          fromMessageId: body.fromMessageId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        await traceStore.saveThread(thread.id, thread as unknown as JsonObject);
        sendJson(response, 201, thread);
        return;
      }

      const messagePatchMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.messageById, url.pathname);

      // PATCH /messages/:id: 修改历史消息，并从该消息创建新的 conversation 分支。
      if (method === "PATCH" && messagePatchMatch?.[0] !== undefined) {
        const messageId = messagePatchMatch[0];
        const body = await readJson<{ content: string; title?: string }>(request);

        if (typeof body.content !== "string") {
          badRequest(response, "content 必须是字符串");
          return;
        }

        const sourceThread = pool
          .listThreads()
          .find((thread) => thread.messages.some((message) => message.id === messageId));

        if (sourceThread === undefined) {
          notFound(response, `message 不存在：${messageId}`);
          return;
        }

        const forked = pool.forkThread({
          sourceThreadId: sourceThread.id,
          fromMessageId: messageId,
          ...(body.title === undefined ? {} : { title: body.title })
        });
        const patchedMessages = forked.messages.map((message) =>
          message.id === messageId ? { ...message, content: body.content } : message
        );
        const patchedThread = pool.replaceThreadMessages(forked.id, patchedMessages);

        await traceStore.saveThread(patchedThread.id, patchedThread as unknown as JsonObject);
        traceStore.recordEvent({
          conversationId: patchedThread.id,
          actorNodeId: patchedThread.agentId,
          eventType: "message_patch",
          input: {
            sourceConversationId: sourceThread.id,
            messageId,
            content: body.content
          },
          output: {
            conversationId: patchedThread.id
          }
        });
        sendJson(response, 201, patchedThread);
        return;
      }

      const runMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationRuns, url.pathname);

      // POST /conversations/:id/runs: 启动一次异步运行。
      if (method === "POST" && runMatch?.[0] !== undefined) {
        const conversationId = runMatch[0];
        const body = await readJson<{ input: string }>(request);

        if (typeof body.input !== "string" || body.input.trim().length === 0) {
          badRequest(response, "input 必须是非空字符串");
          return;
        }

        const thread = tryGetThread(pool, conversationId);

        if (thread === undefined) {
          notFound(response, `thread 不存在：${conversationId}`);
          return;
        }

        // 默认标题在第一次发送后变成用户输入摘要，左侧栏即可显示有意义的历史记录。
        const runnableThread =
          thread.title === "新的会话" && thread.messages.length === 0
            ? pool.updateThreadTitle(thread.id, createThreadTitleFromUserText(body.input))
            : thread;
        await traceStore.saveThread(runnableThread.id, runnableThread as unknown as JsonObject);
        traceStore.recordEvent({
          conversationId: runnableThread.id,
          actorNodeId: runnableThread.agentId,
          eventType: "user_message",
          input: { text: body.input }
        });

        // 为本次运行分配 run/turn id。
        const runId = idGenerator.nextId();
        const turnId = idGenerator.nextId();
        // 初始化事件通道并登记。
        const channel: RunChannel = { clients: new Set(), events: [] };
        channels.set(runId, channel);
        const agent = pool.getAgent(runnableThread.agentId);
        const agentDefinition = agentDefinitionById.get(agent.id);

        if (agentDefinition === undefined) {
          throw new Error(`找不到 agent 定义：${agent.id}`);
        }

        const promptUnits = traceStore.listPromptUnitsForAgent(agent.id).map((unit) => ({
          ...unit,
          role: unit.role as ContextRole
        }));
        const promptCompileResult = compileAgentPrompt({
          agentNodeId: agent.id,
          promptBindingJson: agentDefinition.promptBindingJson,
          promptUnits,
          history: [],
          currentUserInput: body.input,
          idGenerator
        });
        const visibleTools = traceStore.listToolDefinitionsForAgent(agent.id);

        // 后台执行 run，不阻塞当前 HTTP 请求。
        void runAgentTurn({
          runId,
          threadId: runnableThread.id,
          turnId,
          messages: runnableThread.messages,
          userText: body.input,
          agentNodeId: agent.id,
          promptPrefixMessages: promptCompileResult.messages,
          promptCompilation: {
            input: {
              agentNodeId: agent.id,
              currentUserInput: body.input
            },
            assemblyPlan: promptCompileResult.assemblyPlan,
            renderedMessages: promptCompileResult.messages as unknown as never,
            trace: promptCompileResult.trace
          },
          strategy,
          toolExecutor: new ServerToolExecutor(new RuntimeToolExecutor(runtime), visibleTools),
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
            traceStore.recordEvent({
              conversationId: runnableThread.id,
              actorNodeId: agent.id,
              eventType: "assistant_message",
              output: { messageCount: result.messages.length }
            });
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

      const eventsMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.runEvents, url.pathname);

      // GET /runs/:runId/events: 订阅 SSE 事件流。
      if (method === "GET" && eventsMatch?.[0] !== undefined) {
        const runId = eventsMatch[0];
        const channel = channels.get(runId);

        if (channel === undefined) {
          notFound(response, `run 不存在：${runId}`);
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

      const approvalMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.toolApproval, url.pathname);

      // POST /runs/:runId/tool-approvals/:toolCallId: 提交审批结果。
      if (method === "POST" && approvalMatch?.[0] !== undefined && approvalMatch[1] !== undefined) {
        const runId = approvalMatch[0];
        const toolCallId = approvalMatch[1];

        if (!channels.has(runId)) {
          notFound(response, `run 不存在：${runId}`);
          return;
        }

        const body = await readJson<{ decision: "approve" | "deny"; reason?: string }>(request);

        if (body.decision !== "approve" && body.decision !== "deny") {
          badRequest(response, "decision 必须是 approve 或 deny");
          return;
        }

        const ok = approvalRuntime.resolve(toolCallId, {
          decision: body.decision,
          ...(body.reason === undefined ? {} : { reason: body.reason })
        });
        sendJson(response, ok ? 200 : 404, { ok });
        return;
      }

      const conversationEventsMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationEvents, url.pathname);

      // GET /conversations/:id/events: 开发调试接口，读取完整事件流。
      if (method === "GET" && conversationEventsMatch?.[0] !== undefined) {
        sendJson(response, 200, traceStore.listConversationEvents(conversationEventsMatch[0]));
        return;
      }

      const eventMatch = matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.eventById, url.pathname);

      // GET /events/:id: 开发调试接口，读取任意 event payload。
      if (method === "GET" && eventMatch?.[0] !== undefined) {
        const eventId = eventMatch[0];
        const event = traceStore.getEventDetail(eventId);

        if (event === undefined) {
          notFound(response, `event 不存在：${eventId}`);
          return;
        }

        sendJson(response, 200, event);
        return;
      }

      // GET /preset/export: 导出当前定义层 preset。
      if (method === "GET" && url.pathname === SIMPAGENT_HTTP_ROUTES.presetExport) {
        sendJson(response, 200, traceStore.exportPreset());
        return;
      }

      // POST /preset/reset: 清空 SQLite 后按 server 默认 preset 重建。
      if (method === "POST" && url.pathname === SIMPAGENT_HTTP_ROUTES.presetReset) {
        traceStore.resetAndImportPreset(defaultPreset);
        sendJson(response, 200, { ok: true });
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
