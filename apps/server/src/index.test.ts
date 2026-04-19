/**
 * server HTTP 集成测试。
 *
 * 测试目标：
 * 1. 不启动真实端口 8787，而是用随机端口跑同一套 HTTP server。
 * 2. 验证 thread 持久化恢复、404/400 边界、首次发送自动标题、SSE 事件输出。
 * 3. 用 mock fetch 模拟模型流式响应，避免测试依赖真实 API key 或外部网络。
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonFileTraceStore, type SimpAgentNodeConfig } from "@simpagent/runtime-node";
import { createSimpAgentHttpServer, createThreadTitleFromUserText } from "./index.js";
import type { Server } from "node:http";

const servers: Server[] = [];

/**
 * 生成测试专用配置。
 *
 * apiKey/baseUrl/model 只需要通过基础校验；真实请求由 mock fetch 接管。
 */
function createTestConfig(storageDir: string): SimpAgentNodeConfig {
  return {
    provider: "deepseek-chat-completions",
    baseUrl: "https://example.test",
    apiKey: "test-key",
    model: "test-model",
    approvalPolicy: "deny",
    storageDir,
    timeoutMs: 5000
  };
}

/**
 * 启动一个绑定随机端口的测试 server。
 */
async function listenOnRandomPort(server: Server): Promise<string> {
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("测试 server 没有拿到 TCP 端口");
  }

  return `http://127.0.0.1:${address.port}`;
}

/**
 * 读取 JSON 响应并保留 HTTP status，方便断言错误边界。
 */
async function fetchJson(input: string, init?: RequestInit): Promise<{ readonly status: number; readonly body: any }> {
  const response = await fetch(input, init);
  return { status: response.status, body: await response.json() };
}

/**
 * 模拟厂商 SSE 响应体。
 */
function createModelStream(text: string): Response {
  return new Response([`data: {"choices":[{"delta":{"content":"${text}"}}]}`, "", "data: [DONE]", "", ""].join("\n"), {
    status: 200
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) {
              resolve();
              return;
            }

            reject(error);
          });
        })
    )
  );
});

describe("SimpAgent server", () => {
  it("启动时会恢复已持久化 thread，并避免新建 thread id 覆盖历史会话", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const store = new JsonFileTraceStore(storageDir);

    await store.saveThread("thread_1", {
      id: "thread_1",
      agentId: "agent_default",
      title: "历史会话",
      createdAt: 1,
      updatedAt: 1,
      messages: []
    });

    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn: vi.fn()
    });
    const baseUrl = await listenOnRandomPort(server);

    const restored = await fetchJson(`${baseUrl}/threads`);
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual([expect.objectContaining({ id: "thread_1", title: "历史会话" })]);

    const created = await fetchJson(`${baseUrl}/threads`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    expect(created.status).toBe(201);
    expect(created.body.id).not.toBe("thread_1");
  });

  it("首次发送会生成标题，并通过 SSE 输出 run 事件", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const fetchFn = vi.fn(async () => createModelStream("你好"));
    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn
    });
    const baseUrl = await listenOnRandomPort(server);

    const created = await fetchJson(`${baseUrl}/threads`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    const threadId = String(created.body.id);

    const run = await fetchJson(`${baseUrl}/threads/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: "  这是第一次真实发送的消息  " }),
      headers: { "content-type": "application/json" }
    });
    expect(run.status).toBe(202);

    const eventsResponse = await fetch(`${baseUrl}/runs/${run.body.runId}/events`);
    const eventsText = await eventsResponse.text();

    expect(eventsResponse.status).toBe(200);
    expect(eventsText).toContain("event: run_started");
    expect(eventsText).toContain("event: message_delta");
    expect(eventsText).toContain("event: done");

    const updated = await fetchJson(`${baseUrl}/threads/${threadId}`);
    expect(updated.body.title).toBe("这是第一次真实发送的消息");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("对不存在资源和非法输入返回稳定 JSON 错误", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn: vi.fn()
    });
    const baseUrl = await listenOnRandomPort(server);

    await expect(fetchJson(`${baseUrl}/threads/thread_missing`)).resolves.toMatchObject({
      status: 404,
      body: { ok: false, errorCode: "NOT_FOUND" }
    });
    await expect(
      fetchJson(`${baseUrl}/threads/thread_missing/runs`, {
        method: "POST",
        body: JSON.stringify({ input: "hi" }),
        headers: { "content-type": "application/json" }
      })
    ).resolves.toMatchObject({
      status: 404,
      body: { ok: false, errorCode: "NOT_FOUND" }
    });
    await expect(fetchJson(`${baseUrl}/runs/run_missing/events`)).resolves.toMatchObject({
      status: 404,
      body: { ok: false, errorCode: "NOT_FOUND" }
    });

    const created = await fetchJson(`${baseUrl}/threads`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    await expect(
      fetchJson(`${baseUrl}/threads/${created.body.id}/runs`, {
        method: "POST",
        body: JSON.stringify({ input: "   " }),
        headers: { "content-type": "application/json" }
      })
    ).resolves.toMatchObject({
      status: 400,
      body: { ok: false, errorCode: "BAD_REQUEST" }
    });
  });

  it("标题生成会压缩空白并限制长度", () => {
    expect(createThreadTitleFromUserText("  A\nB\tC  ")).toBe("A B C");
    expect(createThreadTitleFromUserText("")).toBe("新的会话");
    expect(createThreadTitleFromUserText("123456789012345678901234567890x")).toBe("123456789012345678901234567890...");
  });
});
