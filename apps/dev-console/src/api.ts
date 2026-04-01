/**
 * 文件作用：
 * - 提供调试台前端统一的 HTTP 请求辅助。
 * - 尽量把错误格式统一成可展示的文本，避免界面层到处重复 try/catch 细节。
 */

import type { ApiEnvelope } from "./types";

export class RuntimeHttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message);
    this.name = "RuntimeHttpError";
    this.status = status;
    this.details = details;
  }
}

/** 根据 HTTP 基地址推导默认 WS 地址。 */
export function deriveWsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.startsWith("https://")) {
    return `${normalized.replace("https://", "wss://")}/ws`;
  }
  if (normalized.startsWith("http://")) {
    return `${normalized.replace("http://", "ws://")}/ws`;
  }
  return `${normalized}/ws`;
}

/** 统一把未知错误转成易读字符串。 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof RuntimeHttpError) {
    return `${error.message}（HTTP ${error.status}）`;
  }
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}

/**
 * 发起 JSON 请求并解析统一响应结构。
 * 说明：
 * - 后端大多数接口返回 `{ ok: true, data }`；
 * - 若 `ok: false` 或 HTTP 非 2xx，这里统一抛错给界面层处理。
 */
export async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new RuntimeHttpError(payload?.message ?? `请求失败：${path}`, response.status, payload?.details);
  }
  if (payload && payload.ok === true && "data" in payload) {
    return payload.data;
  }
  if (payload && payload.ok === true && !("data" in payload)) {
    return payload as unknown as T;
  }
  if (!payload?.ok) {
    throw new RuntimeHttpError(payload?.message ?? `接口返回 ok=false：${path}`, response.status, payload?.details);
  }
  return payload.data;
}

/** 发送 POST JSON body 的便捷方法。 */
export function withJsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body)
  };
}
