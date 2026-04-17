/**
 * 本文件实现 Node 环境下的人审运行时：
 * - CliApprovalRuntime: 终端同步询问用户
 * - DeferredApprovalRuntime: 由外部系统异步回填审批结果（常用于 Web/SSE）
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ApprovalRuntime, ToolApprovalRequest, ToolApprovalResult } from "@simpagent/agent-core";

export class CliApprovalRuntime implements ApprovalRuntime {
  /**
   * 在终端中询问用户是否执行工具。
   * 输入 y 视为同意，其它输入均拒绝（保守安全策略）。
   */
  async requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
    const rl = createInterface({ input: stdin, output: stdout });

    try {
      const answer = await rl.question(
        `是否执行工具 ${request.toolCall.name}(${request.toolCall.id})？输入 y 执行，其它内容拒绝：`
      );
      return answer.trim().toLowerCase() === "y"
        ? { decision: "approve", reason: "CLI 用户确认执行。" }
        : { decision: "deny", reason: "CLI 用户拒绝执行。" };
    } finally {
      rl.close();
    }
  }
}

export class DeferredApprovalRuntime implements ApprovalRuntime {
  // key=toolCallId, value=当前等待该调用审批结果的 Promise resolver。
  private readonly waiters = new Map<string, (result: ToolApprovalResult) => void>();

  /**
   * 返回一个待决 Promise，直到外部调用 resolve() 才完成。
   */
  async requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
    return new Promise((resolve) => {
      this.waiters.set(request.toolCall.id, resolve);
    });
  }

  resolve(toolCallId: string, result: ToolApprovalResult): boolean {
    const waiter = this.waiters.get(toolCallId);

    if (waiter === undefined) {
      return false;
    }

    this.waiters.delete(toolCallId);
    waiter(result);
    return true;
  }
}

