/**
 * 本文件作用：
 * - Cloudflare Workers 适配层入口（Workers + D1）。
 * - 提供最小可运行链路：health / run 创建与查询 / trace 查询 / 配置三层合并。
 *
 * 教学说明：
 * - 这是“适配层”而不是完整业务后端；
 * - core 的三层配置语义在这里直接复用，保证 Node 与 Worker 逻辑一致。
 */

import { resolveThreeLayerConfig } from "@simpagent/core/config";

interface D1Like {
  prepare(query: string): {
    bind(...args: unknown[]): {
      run(): Promise<unknown>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
  exec(query: string): Promise<unknown>;
}

interface WorkerEnv {
  DB?: D1Like;
}

interface RunRow {
  run_id: string;
  status: string;
  input_json: string;
  created_at: string;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

async function ensureSchema(db: D1Like): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function newRunId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) {
    return `run_${cryptoApi.randomUUID().replace(/-/g, "")}`;
  }
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return json({ ok: true, runtime: "worker", now: new Date().toISOString() });
    }

    if (url.pathname === "/api/config/resolve" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        preset?: unknown;
        userOverride?: unknown;
        runtimePatch?: unknown;
      };
      const resolved = resolveThreeLayerConfig({
        preset: (body.preset ?? {}) as any,
        userOverride: (body.userOverride ?? null) as any,
        runtimePatch: (body.runtimePatch ?? null) as any
      });
      return json({ ok: true, data: resolved });
    }

    if (!env.DB) {
      return json({ ok: false, message: "缺少 D1 绑定：请配置 env.DB" }, { status: 500 });
    }

    await ensureSchema(env.DB);

    if (url.pathname === "/api/runs" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const runId = newRunId();
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO runs (run_id, status, input_json, created_at) VALUES (?, ?, ?, ?)")
        .bind(runId, "created", JSON.stringify(body ?? {}), now)
        .run();
      return json({
        ok: true,
        data: {
          runId,
          status: "created"
        }
      });
    }

    if (url.pathname.startsWith("/api/runs/") && req.method === "GET") {
      const runId = url.pathname.split("/").pop() ?? "";
      const row = await env.DB.prepare("SELECT run_id, status, input_json, created_at FROM runs WHERE run_id = ?")
        .bind(runId)
        .first<RunRow>();
      if (!row) {
        return json({ ok: false, message: "run 不存在" }, { status: 404 });
      }
      return json({
        ok: true,
        data: {
          runId: row.run_id,
          status: row.status,
          input: JSON.parse(row.input_json),
          createdAt: row.created_at
        }
      });
    }

    if (url.pathname.startsWith("/api/trace/") && url.pathname.endsWith("/events") && req.method === "GET") {
      const parts = url.pathname.split("/");
      const runId = parts[3] ?? "";
      const rows = await env.DB.prepare("SELECT seq, payload_json, created_at FROM trace_events WHERE run_id = ? ORDER BY seq ASC LIMIT 200")
        .bind(runId)
        .all<{ seq: number; payload_json: string; created_at: string }>();
      return json({
        ok: true,
        data: rows.results.map((item) => ({
          seq: item.seq,
          payload: JSON.parse(item.payload_json),
          createdAt: item.created_at
        }))
      });
    }

    return json({ ok: false, message: "接口不存在" }, { status: 404 });
  }
};
