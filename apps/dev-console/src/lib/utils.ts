/**
 * 本文件作用：
 * - 放置页面通用的小工具函数（格式化、数组去重等）。
 */

import type { JsonValue, TraceEventDTO } from "../types";

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function mergeTraceEvents(existing: TraceEventDTO[], incoming: TraceEventDTO[]): TraceEventDTO[] {
  const map = new Map<number, TraceEventDTO>();
  for (const item of existing) map.set(item.seq, item);
  for (const item of incoming) map.set(item.seq, item);
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

export function safeParseJson(input: string): JsonValue | string {
  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return input;
  }
}

