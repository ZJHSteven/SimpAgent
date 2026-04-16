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

interface RunChannel {
  readonly clients: Set<ServerResponse>;
  readonly events: AgentEvent[];
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", message: "接口不存在" });
}

async function main(): Promise<void> {
  const config = await loadNodeConfig();
  const idGenerator = new IncrementalIdGenerator();
  const fileRuntime = new NodeFileRuntime();
  const shellRuntime = new NodeShellRuntime();
  const approvalRuntime = new DeferredApprovalRuntime();
  const runtime = { fileRuntime, shellRuntime, approvalRuntime };
  const traceStore = new JsonFileTraceStore(config.storageDir);
  const pool = new AgentPool(systemClock, idGenerator);
  const channels = new Map<string, RunChannel>();
  const strategy = configToProviderStrategy(config);

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
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");

      if (method === "POST" && url.pathname === "/threads") {
        const body = await readJson<{ title?: string }>(request);
        const thread = pool.createThread({ agentId: "agent_default", title: body.title });
        await traceStore.saveThread(thread.id, thread as unknown as never);
        sendJson(response, 201, thread);
        return;
      }

      if (method === "GET" && url.pathname === "/threads") {
        sendJson(response, 200, pool.listThreads());
        return;
      }

      const threadMatch = url.pathname.match(/^\/threads\/([^/]+)$/);

      if (method === "GET" && threadMatch?.[1] !== undefined) {
        sendJson(response, 200, pool.getThread(threadMatch[1]));
        return;
      }

      const forkMatch = url.pathname.match(/^\/threads\/([^/]+)\/fork$/);

      if (method === "POST" && forkMatch?.[1] !== undefined) {
        const body = await readJson<{ fromMessageId: string; title?: string }>(request);
        const thread = pool.forkThread({
          sourceThreadId: forkMatch[1],
          fromMessageId: body.fromMessageId,
          title: body.title
        });
        await traceStore.saveThread(thread.id, thread as unknown as never);
        sendJson(response, 201, thread);
        return;
      }

      const runMatch = url.pathname.match(/^\/threads\/([^/]+)\/runs$/);

      if (method === "POST" && runMatch?.[1] !== undefined) {
        const body = await readJson<{ input: string }>(request);
        const thread = pool.getThread(runMatch[1]);
        const runId = idGenerator.nextId("run");
        const turnId = idGenerator.nextId("turn");
        const channel: RunChannel = { clients: new Set(), events: [] };
        channels.set(runId, channel);

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
            channel.events.push(event);
            for (const client of channel.clients) {
              client.write(encodeSseEvent(event));
            }
          }
        })
          .then(async (result) => {
            const updated = pool.replaceThreadMessages(thread.id, result.messages);
            await traceStore.saveThread(thread.id, updated as unknown as never);
          })
          .catch((error: unknown) => {
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

        sendJson(response, 202, { runId, turnId });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/runs\/([^/]+)\/events$/);

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

        for (const event of channel.events) {
          response.write(encodeSseEvent(event));
        }

        request.on("close", () => {
          channel.clients.delete(response);
        });
        return;
      }

      const approvalMatch = url.pathname.match(/^\/runs\/([^/]+)\/tool-approvals\/([^/]+)$/);

      if (method === "POST" && approvalMatch?.[2] !== undefined) {
        const body = await readJson<{ decision: "approve" | "deny"; reason?: string }>(request);
        const ok = approvalRuntime.resolve(approvalMatch[2], {
          decision: body.decision,
          reason: body.reason
        });
        sendJson(response, ok ? 200 : 404, { ok });
        return;
      }

      notFound(response);
    } catch (error: unknown) {
      sendJson(response, 500, {
        ok: false,
        errorCode: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => {
    process.stdout.write(`SimpAgent server listening on http://localhost:${port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

