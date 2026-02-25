/**
 * 本文件作用：
 * - 提供进程内 Trace 事件总线。
 * - 负责把运行时事件同时写入 SQLite，并分发给 WS 层订阅者。
 *
 * 教学说明：
 * - 这里使用简单订阅发布（pub/sub）模型，不引入消息队列，便于调试。
 * - 未来如果要多进程/多实例部署，再升级为 Redis/NATS 等外部总线。
 */

import { randomUUID } from "node:crypto";
import type { JsonValue, TraceEvent, TraceEventType } from "../../types/index.js";
import type { AppDatabase } from "../../storage/index.js";

type TraceSubscriber = (event: TraceEvent) => void;

function nowIso(): string {
  return new Date().toISOString();
}

export class TraceEventBus {
  private readonly subscribersByRunId = new Map<string, Set<TraceSubscriber>>();

  constructor(private readonly db: AppDatabase) {}

  /**
   * 订阅某个 run 的实时事件。
   * 返回取消订阅函数，避免 WS 断开后内存泄漏。
   */
  subscribe(runId: string, handler: TraceSubscriber): () => void {
    const set = this.subscribersByRunId.get(runId) ?? new Set<TraceSubscriber>();
    set.add(handler);
    this.subscribersByRunId.set(runId, set);
    return () => {
      const current = this.subscribersByRunId.get(runId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.subscribersByRunId.delete(runId);
      }
    };
  }

  /**
   * 发布 Trace 事件：
   * 1) 自动分配 seq
   * 2) 写入数据库
   * 3) 推送给订阅者
   */
  emit(input: {
    runId: string;
    threadId: string;
    type: TraceEventType;
    summary: string;
    nodeId?: string;
    agentId?: string;
    payload?: JsonValue;
  }): TraceEvent {
    const event: TraceEvent = {
      seq: this.db.nextTraceSeq(input.runId),
      eventId: `evt_${randomUUID().replace(/-/g, "")}`,
      runId: input.runId,
      threadId: input.threadId,
      type: input.type,
      timestamp: nowIso(),
      nodeId: input.nodeId,
      agentId: input.agentId,
      summary: input.summary,
      payload: input.payload
    };
    this.db.insertTraceEvent(event);

    const subscribers = this.subscribersByRunId.get(input.runId);
    if (subscribers) {
      for (const handler of subscribers) {
        try {
          handler(event);
        } catch {
          // 单个订阅者异常不能影响主流程与其他订阅者。
        }
      }
    }
    return event;
  }

  /**
   * 拉取历史 Trace（给 HTTP 分页与 WS 补发使用）。
   */
  replay(runId: string, afterSeq: number, limit: number): TraceEvent[] {
    return this.db.listTraceEvents(runId, afterSeq, limit);
  }
}

