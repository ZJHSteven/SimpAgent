import { describe, expect, it, vi } from "vitest";
import {
  IncrementalIdGenerator,
  RuntimeToolExecutor,
  runAgentTurn,
  type ApprovalRuntime,
  type FileRuntime,
  type ShellRuntime,
  type TraceRecord,
  type TraceStore
} from "../index.js";

function createMockTraceStore(): TraceStore & { traces: TraceRecord[] } {
  const traces: TraceRecord[] = [];
  return {
    traces,
    async saveTrace(trace) {
      traces.push(trace);
    },
    async loadThread() {
      return undefined;
    },
    async saveThread() {},
    async listThreads() {
      return [];
    }
  };
}

describe("agent loop human-in-loop", () => {
  it("approvalPolicy=deny 时不会执行工具，并回填固定拒绝错误", async () => {
    const toolStream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(toolStream, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(['data: {"choices":[{"delta":{"content":"已拒绝执行工具。"}}]}', "", "data: [DONE]", "", ""].join("\n"), {
          status: 200
        })
      );
    const fileRuntime: FileRuntime = {
      readTextFile: vi.fn(),
      editTextFile: vi.fn()
    };
    const shellRuntime: ShellRuntime = {
      runCommand: vi.fn()
    };
    const approvalRuntime: ApprovalRuntime = {
      requestApproval: vi.fn()
    };
    const traceStore = createMockTraceStore();
    const events: unknown[] = [];

    const result = await runAgentTurn({
      runId: "run_1",
      threadId: "thread_1",
      turnId: "turn_1",
      messages: [],
      userText: "读文件",
      strategy: {
        id: "provider_1",
        name: "mock",
        provider: "deepseek-chat-completions",
        baseUrl: "https://example.test",
        apiKey: "key",
        model: "model"
      },
      toolExecutor: new RuntimeToolExecutor({ fileRuntime, shellRuntime, approvalRuntime }),
      runtime: { fileRuntime, shellRuntime, approvalRuntime },
      traceStore,
      fetchFn,
      clock: { now: () => 1 },
      idGenerator: new IncrementalIdGenerator(),
      approvalPolicy: "deny",
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(fileRuntime.readTextFile).not.toHaveBeenCalled();
    expect(result.messages.some((message) => String(message.content).includes("TOOL_EXECUTION_DENIED_BY_HUMAN"))).toBe(true);
    expect(result.messages.at(-1)?.content).toBe("已拒绝执行工具。");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_approval_requested"
      })
    );
    expect(traceStore.traces).toHaveLength(1);
  });
});
