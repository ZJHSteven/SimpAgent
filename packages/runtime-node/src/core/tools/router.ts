/**
 * 本文件作用：
 * - 实现三层工具架构中的“路由层”：
 *   模型 ->（暴露适配层解析）-> CanonicalToolCallIntent -> 路由到 builtin/mcp/skill_tool。
 *
 * 教学说明：
 * - 路由层不直接决定暴露协议（那是 exposure adapter 的职责）。
 * - 路由层也不负责低层执行细节（那是 ToolRuntime / builtinExecutors 的职责）。
 */

import type {
  CanonicalToolCallIntent,
  CanonicalToolCallResult,
  CanonicalToolExecutionEnvelope,
  CanonicalToolSpec
} from "../../types/index.js";

export type ToolRouteResolved =
  | { kind: "builtin"; tool: CanonicalToolSpec }
  | { kind: "mcp"; tool: CanonicalToolSpec; server: string; remoteTool: string }
  | { kind: "skill_tool"; tool: CanonicalToolSpec; skillId: string; skillTool: string };

export interface CanonicalToolExecutor {
  execute(args: {
    intent: CanonicalToolCallIntent;
    tool: CanonicalToolSpec;
    envelope: CanonicalToolExecutionEnvelope;
  }): Promise<CanonicalToolCallResult>;
}

/**
 * Canonical 工具路由器：
 * - 输入是统一调用意图；
 * - 输出是路由目标（或直接委派给执行器）。
 */
export class CanonicalToolRouter {
  private byId = new Map<string, CanonicalToolSpec>();
  private byName = new Map<string, CanonicalToolSpec>();

  constructor(tools: CanonicalToolSpec[] = []) {
    this.setTools(tools);
  }

  setTools(tools: CanonicalToolSpec[]): void {
    this.byId.clear();
    this.byName.clear();
    for (const tool of tools) {
      this.byId.set(tool.id, tool);
      this.byName.set(tool.name, tool);
    }
  }

  resolve(intent: CanonicalToolCallIntent): ToolRouteResolved {
    const tool =
      this.byId.get(intent.canonicalToolId) ??
      this.byName.get(intent.toolName);
    if (!tool) {
      throw new Error(`Canonical 工具不存在：${intent.canonicalToolId}/${intent.toolName}`);
    }

    const target = tool.routeTarget;
    if (target.kind === "builtin") return { kind: "builtin", tool };
    if (target.kind === "mcp") return { kind: "mcp", tool, server: target.server, remoteTool: target.tool };
    return { kind: "skill_tool", tool, skillId: target.skillId, skillTool: target.tool };
  }
}
