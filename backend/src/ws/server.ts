/**
 * 本文件作用：
 * - 提供 WebSocket 实时调试通道。
 * - 支持订阅 run 的 Trace 事件、心跳、断线后按 seq 补发事件。
 *
 * 教学说明：
 * - 这里使用 WS 而不是 SSE，是因为你明确提出要更强的心跳与重连控制。
 * - 但是命令操作仍然优先走 HTTP，WS 主要负责“实时观察”。
 */

import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { WsClientMessage, WsServerMessage } from "../types/index.js";
import type { RuntimeDeps } from "../runtime/index.js";
import { FrameworkRuntimeEngine } from "../runtime/index.js";

interface WsDeps extends RuntimeDeps {
  engine: FrameworkRuntimeEngine;
}

interface ClientSession {
  id: string;
  socket: WebSocket;
  subscriptions: Map<string, () => void>;
  lastSeenAt: number;
}

function sendJson(ws: WebSocket, message: WsServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

export function setupWsServer(server: HttpServer, deps: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/ws"
  });

  const sessions = new Map<WebSocket, ClientSession>();

  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.socket.readyState !== session.socket.OPEN) continue;

      // 20 秒没消息就视为断联（客户端应自动重连）。
      if (now - session.lastSeenAt > 20_000) {
        try {
          session.socket.close(4000, "heartbeat timeout");
        } catch {
          // 忽略关闭异常。
        }
        continue;
      }

      sendJson(session.socket, {
        type: "heartbeat",
        serverTime: new Date().toISOString()
      });
    }
  }, 5_000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (socket) => {
    const session: ClientSession = {
      id: `ws_${randomUUID().replace(/-/g, "")}`,
      socket,
      subscriptions: new Map(),
      lastSeenAt: Date.now()
    };
    sessions.set(socket, session);

    sendJson(socket, {
      type: "hello_ack",
      connectionId: session.id,
      serverTime: new Date().toISOString()
    });

    socket.on("message", (raw) => {
      session.lastSeenAt = Date.now();

      let msg: WsClientMessage;
      try {
        msg = JSON.parse(String(raw)) as WsClientMessage;
      } catch {
        sendJson(socket, { type: "error", code: "BAD_JSON", message: "消息不是合法 JSON" });
        return;
      }

      try {
        if (msg.type === "hello") {
          if (msg.lastEventSeq && msg.lastEventSeq > 0) {
            // hello 阶段不自动补发（不知道 runId），这里仅确认连接。
          }
          sendJson(socket, {
            type: "hello_ack",
            connectionId: session.id,
            serverTime: new Date().toISOString()
          });
          return;
        }

        if (msg.type === "ping") {
          sendJson(socket, {
            type: "heartbeat",
            serverTime: new Date().toISOString()
          });
          return;
        }

        if (msg.type === "subscribe_run") {
          const oldUnsub = session.subscriptions.get(msg.runId);
          if (oldUnsub) oldUnsub();

          const unsub = deps.traceBus.subscribe(msg.runId, (event) => {
            sendJson(socket, {
              type: "trace_event",
              runId: msg.runId,
              event
            });
          });
          session.subscriptions.set(msg.runId, unsub);

          sendJson(socket, { type: "subscribed", runId: msg.runId });

          const summary = deps.engine.getRunSummary(msg.runId);
          if (summary) {
            sendJson(socket, {
              type: "run_snapshot",
              runId: msg.runId,
              snapshot: {
                status: summary.status,
                currentNodeId: summary.current_node_id ?? undefined,
                threadId: summary.thread_id,
                traceEventSeqLast: deps.traceBus.replay(msg.runId, 0, 1_000_000).slice(-1)[0]?.seq ?? 0
              }
            });
          }

          if (typeof msg.lastEventSeq === "number" && msg.lastEventSeq >= 0) {
            const replay = deps.traceBus.replay(msg.runId, msg.lastEventSeq, 500);
            if (replay.length > 0) {
              sendJson(socket, {
                type: "replay_events_batch",
                runId: msg.runId,
                events: replay
              });
            }
          }
          return;
        }

        if (msg.type === "unsubscribe_run") {
          const unsub = session.subscriptions.get(msg.runId);
          if (unsub) {
            unsub();
            session.subscriptions.delete(msg.runId);
          }
          return;
        }

        if (msg.type === "request_replay_events") {
          const events = deps.traceBus.replay(msg.runId, msg.afterSeq, msg.limit ?? 200);
          sendJson(socket, {
            type: "replay_events_batch",
            runId: msg.runId,
            events
          });
          return;
        }

        if (msg.type === "ack") {
          // 首版不做服务端 ack 窗口管理；保留协议位。
          return;
        }

        sendJson(socket, {
          type: "warning",
          code: "UNKNOWN_MESSAGE",
          message: `未知消息类型：${(msg as { type?: string }).type ?? "unknown"}`
        });
      } catch (error) {
        sendJson(socket, {
          type: "error",
          code: "WS_HANDLER_ERROR",
          message: error instanceof Error ? error.message : "WS 处理失败"
        });
      }
    });

    socket.on("close", () => {
      for (const unsub of session.subscriptions.values()) {
        try {
          unsub();
        } catch {
          // 忽略取消订阅异常。
        }
      }
      session.subscriptions.clear();
      sessions.delete(socket);
    });

    socket.on("error", () => {
      // 错误会触发 close，这里无需额外处理。
    });
  });

  return wss;
}

