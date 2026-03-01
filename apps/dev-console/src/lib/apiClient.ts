/**
 * 本文件作用：
 * - 提供统一 HTTP 客户端，封装 GET/POST/PUT 请求。
 * - 集中处理 baseURL 与错误格式，减少页面重复代码。
 */

import type { ApiResponse } from "../types";

const DEFAULT_HTTP_BASE = "http://localhost:3002";

function resolveBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_RUNTIME_NODE_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.replace(/\/$/, "");
  }
  return DEFAULT_HTTP_BASE;
}

const HTTP_BASE = resolveBaseUrl();

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${HTTP_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      },
      ...init
    });
    const json = (await response.json()) as ApiResponse<T>;
    if (!response.ok) {
      return {
        ok: false,
        message: json.message ?? `HTTP ${response.status}`,
        details: json.details
      };
    }
    return json;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "网络请求失败"
    };
  }
}

export const apiClient = {
  get<T>(path: string): Promise<ApiResponse<T>> {
    return request<T>(path, { method: "GET" });
  },
  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>(path, {
      method: "POST",
      body: JSON.stringify(body ?? {})
    });
  },
  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body ?? {})
    });
  },
  baseUrl: HTTP_BASE
};

