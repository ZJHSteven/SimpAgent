/**
 * server HTTP 集成测试。
 *
 * 测试目标：
 * 1. 不启动真实端口 8788，而是用随机端口跑同一套 HTTP server。
 * 2. 验证 conversation 持久化恢复、404/400 边界、首次发送自动标题、SSE 事件输出。
 * 3. 用 mock fetch 模拟模型流式响应，避免测试依赖真实 API key 或外部网络。
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7Id } from "@simpagent/agent-core";
import { SqliteTraceStore, type SimpAgentNodeConfig } from "@simpagent/runtime-node";
import { createSimpAgentHttpServer, createThreadTitleFromUserText } from "./index.js";
import { DEFAULT_AGENT_A_ID, DEFAULT_AGENT_B_ID, DEFAULT_AGENT_C_ID } from "./default-preset.js";
import type { Server } from "node:http";

const servers: Server[] = [];
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  it("启动时会导入默认 preset，并跳过无法匹配 agent 的旧快照", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const store = new SqliteTraceStore(storageDir);
    const oldThreadId = createUuidV7Id();
    const oldAgentId = createUuidV7Id();

    await store.saveThread(oldThreadId, {
      id: oldThreadId,
      agentId: oldAgentId,
      title: "历史会话",
      createdAt: 1,
      updatedAt: 1,
      messages: []
    });
    store.close();

    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn: vi.fn()
    });
    const baseUrl = await listenOnRandomPort(server);

    const restored = await fetchJson(`${baseUrl}/conversations`);
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual([]);

    const preset = await fetchJson(`${baseUrl}/preset/export`);
    expect(preset.status).toBe(200);
    expect(preset.body.agent_nodes).toHaveLength(3);
    const discoverableEdges = preset.body.edges.filter((edge: any) => edge.edge_type === "discoverable");
    expect(discoverableEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_node_id: DEFAULT_AGENT_A_ID, target_node_id: DEFAULT_AGENT_B_ID }),
        expect.objectContaining({ source_node_id: DEFAULT_AGENT_A_ID, target_node_id: DEFAULT_AGENT_C_ID }),
        expect.objectContaining({ source_node_id: DEFAULT_AGENT_B_ID, target_node_id: DEFAULT_AGENT_A_ID }),
        expect.objectContaining({ source_node_id: DEFAULT_AGENT_C_ID, target_node_id: DEFAULT_AGENT_B_ID })
      ])
    );

    const created = await fetchJson(`${baseUrl}/conversations`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(uuidV7Pattern);
    expect(created.body.agentId).toBe(DEFAULT_AGENT_A_ID);
  });

  it("首次发送会生成标题，并通过 SSE 输出 run 事件", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const fetchFn = vi.fn(async () => createModelStream("你好"));
    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn
    });
    const baseUrl = await listenOnRandomPort(server);

    const created = await fetchJson(`${baseUrl}/conversations`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    const threadId = String(created.body.id);
    expect(threadId).toMatch(uuidV7Pattern);

    const run = await fetchJson(`${baseUrl}/conversations/${threadId}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: "  这是第一次真实发送的消息  " }),
      headers: { "content-type": "application/json" }
    });
    expect(run.status).toBe(202);
    expect(run.body.runId).toMatch(uuidV7Pattern);
    expect(run.body.turnId).toMatch(uuidV7Pattern);

    const eventsResponse = await fetch(`${baseUrl}/runs/${run.body.runId}/events`);
    const eventsText = await eventsResponse.text();

    expect(eventsResponse.status).toBe(200);
    expect(eventsText).toContain("event: run_started");
    expect(eventsText).toContain("event: message_delta");
    expect(eventsText).toContain("event: done");

    const updated = await fetchJson(`${baseUrl}/conversations/${threadId}`);
    expect(updated.body.title).toBe("这是第一次真实发送的消息");
    expect(updated.body.messages.map((message: any) => message.role)).toEqual(["user", "assistant"]);
    const eventRows = await fetchJson(`${baseUrl}/conversations/${threadId}/events`);
    expect(eventRows.status).toBe(200);
    expect(eventRows.body.map((event: any) => event.eventType)).toEqual(
      expect.arrayContaining(["user_message", "agent_invocation", "prompt_compile", "llm_call", "assistant_message"])
    );
    const promptCompileEvent = eventRows.body.find((event: any) => event.eventType === "prompt_compile");
    const eventDetail = await fetchJson(`${baseUrl}/events/${promptCompileEvent.id}`);
    expect(eventDetail.status).toBe(200);
    expect(eventDetail.body.eventType).toBe("prompt_compile");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("GET /models 会把 provider 的模型列表原样返回", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
            { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" }
          ]
        }),
        { status: 200 }
      )
    );
    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn
    });
    const baseUrl = await listenOnRandomPort(server);

    const response = await fetchJson(`${baseUrl}/models`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      object: "list",
      data: [
        { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
        { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" }
      ]
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("对不存在资源和非法输入返回稳定 JSON 错误", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "simpagent-server-"));
    const server = await createSimpAgentHttpServer({
      config: createTestConfig(storageDir),
      fetchFn: vi.fn()
    });
    const baseUrl = await listenOnRandomPort(server);

    await expect(fetchJson(`${baseUrl}/conversations/thread_missing`)).resolves.toMatchObject({
      status: 404,
      body: { ok: false, errorCode: "NOT_FOUND" }
    });
    await expect(
      fetchJson(`${baseUrl}/conversations/thread_missing/runs`, {
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

    const created = await fetchJson(`${baseUrl}/conversations`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" }
    });
    await expect(
      fetchJson(`${baseUrl}/conversations/${created.body.id}/runs`, {
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
