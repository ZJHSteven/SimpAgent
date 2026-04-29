/**
 * 本文件实现内置工具定义与执行器。
 * 设计目标：
 * - 工具协议面向模型保持稳定
 * - 具体执行下沉到 runtime 注入能力
 */
import type { JsonObject } from "../types/common.js";
import type { RuntimeServices } from "../runtime/interfaces.js";
import type { ToolCallRequest, ToolDefinition, ToolExecutionResult, ToolExecutor } from "../types/tools.js";

export const BUILTIN_TOOL_READ_FILE_ID = "00000000-0000-7000-8000-000000000101";
export const BUILTIN_TOOL_EDIT_FILE_ID = "00000000-0000-7000-8000-000000000102";
export const BUILTIN_TOOL_SHELL_COMMAND_ID = "00000000-0000-7000-8000-000000000103";
export const BUILTIN_TOOL_HANDOFF_ID = "00000000-0000-7000-8000-000000000104";

const readFileSchema: JsonObject = {
  type: "object",
  properties: {
    path: { type: "string", description: "要读取的文本文件路径。" },
    startLine: { type: "number", description: "可选，起始行号，从 1 开始。" },
    endLine: { type: "number", description: "可选，结束行号，包含该行。" },
    includeMetadata: { type: "boolean", description: "是否返回行数等元数据。" }
  },
  required: ["path"],
  additionalProperties: false
};

const editFileSchema: JsonObject = {
  type: "object",
  properties: {
    path: { type: "string", description: "要编辑的文件路径。" },
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          oldText: { type: "string", description: "要精确匹配并替换的原文。" },
          newText: { type: "string", description: "替换后的新文本。" }
        },
        required: ["oldText", "newText"],
        additionalProperties: false
      }
    }
  },
  required: ["path", "edits"],
  additionalProperties: false
};

const shellCommandSchema: JsonObject = {
  type: "object",
  properties: {
    command: { type: "string", description: "要执行的 shell 命令。" },
    cwd: { type: "string", description: "可选，命令工作目录。" },
    timeoutMs: { type: "number", description: "可选，命令超时时间。" }
  },
  required: ["command"],
  additionalProperties: false
};

const handoffSchema: JsonObject = {
  type: "object",
  properties: {
    target_node_id: { type: "string", description: "要交接给的目标 agent/workflow node id。" },
    input_markdown: { type: "string", description: "交接给目标节点的任务说明，支持 Markdown。" },
    context_selector: {
      type: "object",
      description: "选择要附带的上下文，第一版避免直接暴露内部 message UUID。",
      properties: {
        mode: { type: "string", enum: ["none", "latest_n", "full_branch", "manual_markdown"] },
        count: { type: "number", description: "mode=latest_n 时附带最近多少条消息。" },
        markdown: { type: "string", description: "mode=manual_markdown 时由模型手写的上下文。" }
      },
      required: ["mode"],
      additionalProperties: false
    },
    return_mode: {
      type: "string",
      enum: ["return_to_caller", "transfer"],
      description: "return_to_caller 表示子 agent 完成后回到当前 agent；transfer 表示直接转交。"
    }
  },
  required: ["target_node_id", "input_markdown", "context_selector"],
  additionalProperties: false
};

/**
 * 对外暴露给模型的内置工具列表。
 *
 * 注意：
 * - `id` 只是内部主键，给程序做稳定标识用。
 * - `name` 才是模型真正看到并调用的名字。
 */
export const builtinToolDefinitions: readonly ToolDefinition[] = [
  {
    id: BUILTIN_TOOL_READ_FILE_ID,
    name: "read_file",
    description: "读取纯文本文件的指定行范围，并返回原文与基础元数据。",
    parameters: readFileSchema
  },
  {
    id: BUILTIN_TOOL_EDIT_FILE_ID,
    name: "edit_file",
    description: "对单个文本文件执行精确文本替换、新建或删除操作。",
    parameters: editFileSchema
  },
  {
    id: BUILTIN_TOOL_SHELL_COMMAND_ID,
    name: "shell_command",
    description: "在当前 runtime 中执行 shell 命令，并返回 stdout、stderr 与退出码。",
    parameters: shellCommandSchema
  },
  {
    id: BUILTIN_TOOL_HANDOFF_ID,
    name: "handoff",
    description: "将任务交接给当前图中可发现的另一个 agent 或 workflow。",
    parameters: handoffSchema
  }
];

/**
 * 解析模型传入的 argumentsText。
 * 约束：必须是 JSON object，避免传入数组/原始值导致后续歧义。
 */
function parseArguments(toolCall: ToolCallRequest): JsonObject {
  const parsed = JSON.parse(toolCall.argumentsText.length === 0 ? "{}" : toolCall.argumentsText) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`工具 ${toolCall.name} 的参数必须是 JSON object。`);
  }

  return parsed as JsonObject;
}

export class RuntimeToolExecutor implements ToolExecutor {
  constructor(private readonly runtime: RuntimeServices) {}

  listTools(): readonly ToolDefinition[] {
    return builtinToolDefinitions;
  }

  async executeTool(toolCall: ToolCallRequest): Promise<ToolExecutionResult> {
    // 先统一解析参数，再按 name 路由到对应 runtime 能力。
    const args = parseArguments(toolCall);

    if (toolCall.name === "read_file") {
      const result = await this.runtime.fileRuntime.readTextFile({
        path: String(args.path),
        ...(typeof args.startLine === "number" ? { startLine: args.startLine } : {}),
        ...(typeof args.endLine === "number" ? { endLine: args.endLine } : {}),
        ...(typeof args.includeMetadata === "boolean" ? { includeMetadata: args.includeMetadata } : {})
      });
      return { ok: true, content: result as unknown as JsonObject };
    }

    if (toolCall.name === "edit_file") {
      // edit_file 的 edits 需要做一次宽松清洗，避免模型漏字段导致运行时崩溃。
      const edits = Array.isArray(args.edits)
        ? args.edits.map((edit) => {
            const item = edit as { oldText?: unknown; newText?: unknown };
            return {
              oldText: String(item.oldText ?? ""),
              newText: String(item.newText ?? "")
            };
          })
        : [];
      const result = await this.runtime.fileRuntime.editTextFile({ path: String(args.path), edits });
      return { ok: true, content: result as unknown as JsonObject };
    }

    if (toolCall.name === "shell_command") {
      const result = await this.runtime.shellRuntime.runCommand({
        command: String(args.command),
        ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
        ...(typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {})
      });
      return { ok: result.exitCode === 0, content: result as unknown as JsonObject };
    }

    if (toolCall.name === "handoff") {
      const content: JsonObject = {
        ok: true,
        kind: "handoff_request",
        targetNodeId: String(args.target_node_id),
        inputMarkdown: String(args.input_markdown),
        contextSelector: args.context_selector ?? null,
        returnMode: typeof args.return_mode === "string" ? args.return_mode : "return_to_caller"
      };

      return {
        ok: true,
        content
      };
    }

    // 未知工具不抛异常，返回结构化错误，便于模型在下一轮自我修正。
    return {
      ok: false,
      content: {
        ok: false,
        errorCode: "UNKNOWN_TOOL",
        message: `未知工具：${toolCall.name}`
      }
    };
  }
}
