/**
 * 本文件作用：
 * - 提供调试台 WS 客户端封装（连接、心跳、订阅、自动重连）。
 * - 统一处理 run 订阅相关消息，页面只关心回调事件。
 */

import type { TraceEventDTO } from "../types";

const DEFAULT_WS_URL = "ws://localhost:3002/ws";

function resolveWsUrl(): string {
  const fromEnv = import.meta.env.VITE_RUNTIME_NODE_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv;
  }
  return DEFAULT_WS_URL;
}

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface WsCallbacks {
  onStatus?: (status: WsStatus) => void;
  onLog?: (line: string) => void;
  onTraceEvent?: (event: TraceEventDTO) => void;
  onReplayEvents?: (events: TraceEventDTO[]) => void;
  onRunSnapshot?: (snapshot: Record<string, unknown>) => void;
  onWarning?: (code: string, message: string) => void;
  onError?: (code: string, message: string) => void;
}

export class RuntimeWsClient {
  private ws: WebSocket | null = null;
  private status: WsStatus = "idle";
  private reconnectTimer: number | null = null;
  private readonly url: string;
  private subscribedRunId: string | null = null;
  private lastEventSeqByRun = new Map<string, number>();

  constructor(private readonly callbacks: WsCallbacks, wsUrl = resolveWsUrl()) {
    this.url = wsUrl;
  }

  get currentStatus(): WsStatus {
    return this.status;
  }

  private setStatus(next: WsStatus): void {
    this.status = next;
    this.callbacks.onStatus?.(next);
  }

  private log(message: string): void {
    this.callbacks.onLog?.(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus("connecting");
    this.log("开始连接 WS");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.setStatus("open");
      this.log("WS 已连接");
      ws.send(JSON.stringify({ type: "hello" }));
      if (this.subscribedRunId) {
        this.subscribeRun(this.subscribedRunId);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "trace_event" && msg.event) {
          const trace = msg.event as TraceEventDTO;
          const prev = this.lastEventSeqByRun.get(trace.runId) ?? 0;
          this.lastEventSeqByRun.set(trace.runId, Math.max(prev, trace.seq));
          this.callbacks.onTraceEvent?.(trace);
          return;
        }
        if (type === "replay_events_batch" && Array.isArray(msg.events)) {
          const events = msg.events as TraceEventDTO[];
          for (const item of events) {
            const prev = this.lastEventSeqByRun.get(item.runId) ?? 0;
            this.lastEventSeqByRun.set(item.runId, Math.max(prev, item.seq));
          }
          this.callbacks.onReplayEvents?.(events);
          return;
        }
        if (type === "run_snapshot" && msg.snapshot && typeof msg.snapshot === "object") {
          this.callbacks.onRunSnapshot?.(msg.snapshot as Record<string, unknown>);
          return;
        }
        if (type === "warning") {
          this.callbacks.onWarning?.(String(msg.code ?? "WS_WARNING"), String(msg.message ?? ""));
          return;
        }
        if (type === "error") {
          this.callbacks.onError?.(String(msg.code ?? "WS_ERROR"), String(msg.message ?? ""));
        }
      } catch (error) {
        this.log(`WS 消息解析失败：${error instanceof Error ? error.message : String(error)}`);
      }
    };

    ws.onerror = () => {
      this.setStatus("error");
      this.log("WS onerror");
    };

    ws.onclose = () => {
      this.setStatus("closed");
      this.log("WS 已关闭，准备重连");
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1500);
    };
  }

  subscribeRun(runId: string): void {
    this.subscribedRunId = runId;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const lastEventSeq = this.lastEventSeqByRun.get(runId) ?? 0;
    this.ws.send(
      JSON.stringify({
        type: "subscribe_run",
        runId,
        lastEventSeq
      })
    );
    this.log(`已订阅 run=${runId}（lastEventSeq=${lastEventSeq}）`);
  }

  requestReplay(runId: string, afterSeq: number, limit = 200): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "request_replay_events", runId, afterSeq, limit }));
  }

  close(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribedRunId = null;
    this.ws?.close();
    this.ws = null;
  }
}

