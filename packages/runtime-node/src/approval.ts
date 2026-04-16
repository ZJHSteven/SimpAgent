import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ApprovalRuntime, ToolApprovalRequest, ToolApprovalResult } from "@simpagent/agent-core";

export class CliApprovalRuntime implements ApprovalRuntime {
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
  private readonly waiters = new Map<string, (result: ToolApprovalResult) => void>();

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

