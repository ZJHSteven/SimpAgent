/**
 * 本测试聚焦“human-in-loop 拒绝工具”路径：
 * - 验证 deny 策略下不会触发工具执行
 * - 验证会回填固定拒绝错误给模型
 * - 验证模型可继续产生最终文本回复
 */
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
    // 第一轮：模型只返回 tool_call；第二轮：模型读取 tool_result 后返回最终答复。
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

  it("工具执行抛错时会回填结构化错误并继续下一轮模型请求", async () => {
    // 第一轮：模型要求读取一个不存在的文件；工具 runtime 抛错。
    // 第二轮：模型应该能看到 tool role 里的 TOOL_EXECUTION_ERROR，并生成最终解释，而不是整个 turn fatal。
    const toolStream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_missing","function":{"name":"read_file","arguments":"{\\"path\\":\\"missing.txt\\"}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");
    const finalStream = [
      'data: {"choices":[{"delta":{"content":"文件读取失败，我会改用其它方式总结。"}}]}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(toolStream, { status: 200 }))
      .mockResolvedValueOnce(new Response(finalStream, { status: 200 }));
    const fileRuntime: FileRuntime = {
      readTextFile: vi.fn(async () => {
        throw new Error("ENOENT: missing.txt");
      }),
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
      userText: "读取缺失文件后继续处理",
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
      approvalPolicy: "always_approve",
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(fileRuntime.readTextFile).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.messages.some((message) => String(message.content).includes("TOOL_EXECUTION_ERROR"))).toBe(true);
    expect(result.messages.at(-1)?.content).toBe("文件读取失败，我会改用其它方式总结。");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        result: expect.objectContaining({
          ok: false,
          content: expect.objectContaining({
            errorCode: "TOOL_EXECUTION_ERROR"
          })
        })
      })
    );
  });
});
