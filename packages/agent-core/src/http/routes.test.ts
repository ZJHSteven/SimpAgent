/**
 * HTTP route contract 测试。
 *
 * 测试目标：
 * - `agent-core` 只定义接口契约，不实现具体 HTTP server。
 * - runtime-node / app 后续都应该复用这里的路径模板，避免 `/threads`、`/conversations` 这类命名再次漂移。
 */
import { describe, expect, it } from "vitest";
import { SIMPAGENT_HTTP_ROUTES, matchSimpAgentRoute } from "./routes.js";

describe("SIMPAGENT_HTTP_ROUTES", () => {
  it("能从 conversation run 路径中提取 conversationId", () => {
    expect(matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationRuns, "/conversations/c_1/runs")).toEqual(["c_1"]);
  });

  it("能从工具审批路径中按顺序提取 runId 和 toolCallId", () => {
    expect(matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.toolApproval, "/runs/r_1/tool-approvals/t_1")).toEqual([
      "r_1",
      "t_1"
    ]);
  });

  it("不匹配多余层级路径", () => {
    expect(matchSimpAgentRoute(SIMPAGENT_HTTP_ROUTES.conversationById, "/conversations/c_1/extra")).toBeUndefined();
  });
});
