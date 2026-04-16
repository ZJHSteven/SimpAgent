import type { JsonObject } from "../types/common.js";
import type { RuntimeServices } from "../runtime/interfaces.js";
import type { ToolCallRequest, ToolDefinition, ToolExecutionResult, ToolExecutor } from "../types/tools.js";

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

export const builtinToolDefinitions: readonly ToolDefinition[] = [
  {
    id: "tool_read_file",
    name: "read_file",
    description: "读取纯文本文件的指定行范围，并返回原文与基础元数据。",
    parameters: readFileSchema
  },
  {
    id: "tool_edit_file",
    name: "edit_file",
    description: "对单个文本文件执行精确文本替换、新建或删除操作。",
    parameters: editFileSchema
  },
  {
    id: "tool_shell_command",
    name: "shell_command",
    description: "在当前 runtime 中执行 shell 命令，并返回 stdout、stderr 与退出码。",
    parameters: shellCommandSchema
  }
];

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

