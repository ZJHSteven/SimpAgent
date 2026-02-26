/**
 * 本文件作用：
 * - 定义首批内置工具（builtin tools）的默认配置、输入输出 schema。
 * - 为“三层工具架构”的外层来源层提供稳定入口。
 *
 * 教学说明：
 * - 这里定义的是“工具规格”和默认策略，不是具体执行逻辑。
 * - 具体执行逻辑在 builtinExecutors / ToolRuntime / router 中。
 */

import type {
  BuiltinToolConfig,
  BuiltinToolName,
  CanonicalToolExposurePolicy,
  CanonicalToolPermissionPolicy,
  JsonObject
} from "../../types/index.js";

export interface BuiltinToolDefinition {
  toolId: string;
  name: BuiltinToolName;
  description: string;
  executorType: "function" | "shell" | "http";
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  tags?: string[];
  defaultConfig: BuiltinToolConfig;
}

function defaultExposure(
  preferred: CanonicalToolExposurePolicy["preferredAdapter"],
  level: CanonicalToolExposurePolicy["exposureLevel"] = "summary"
): CanonicalToolExposurePolicy {
  return {
    preferredAdapter: preferred,
    fallbackAdapters: ["chat_function", "structured_output_tool_call", "prompt_protocol_fallback"],
    exposureLevel: level,
    exposeByDefault: true,
    catalogPath: ["builtin"]
  };
}

function defaultPermission(profileId: string): CanonicalToolPermissionPolicy {
  return {
    permissionProfileId: profileId,
    shellPermissionLevel: profileId.includes("danger")
      ? "dangerous"
      : profileId.includes("write")
        ? "workspace_write"
        : "readonly",
    requiresHumanApproval: false,
    timeoutMs: 15_000
  };
}

/**
 * 首批内置工具定义（借鉴 Codex 思路，但保持本框架独立的中间统一抽象）。
 */
export const BUILTIN_TOOL_DEFINITIONS: BuiltinToolDefinition[] = [
  {
    toolId: "builtin.shell_command",
    name: "shell_command",
    description: "执行受控命令行命令（带白名单、超时与工作目录限制）。",
    executorType: "shell",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令文本" },
        workdir: { type: "string", description: "可选工作目录（需通过后端策略校验）" },
        timeout_ms: { type: "number", minimum: 1, maximum: 120000 },
        justification: { type: "string" }
      },
      required: ["command"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        stdout: { type: "string" },
        stderr: { type: "string" },
        exitCode: { type: ["number", "null"] }
      },
      additionalProperties: true
    } as unknown as JsonObject,
    tags: ["builtin", "shell"],
    defaultConfig: {
      name: "shell_command",
      enabled: true,
      description: "执行受控 shell 命令",
      exposurePolicy: defaultExposure("chat_function", "description"),
      permissionPolicy: {
        ...defaultPermission("perm.readonly"),
        allowCommandPrefixes: ["git ", "npm ", "pnpm ", "node ", "python ", "rg ", "ls ", "dir ", "type "]
      }
    }
  },
  {
    toolId: "builtin.apply_patch",
    name: "apply_patch",
    description: "使用 patch DSL 对文本文件做局部修改（Add/Update/Delete）。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        patch: { type: "string", description: "Codex 风格 patch DSL 文本" },
        dry_run: { type: "boolean", description: "仅预览，不落盘" }
      },
      required: ["patch"],
      additionalProperties: false
    },
    tags: ["builtin", "edit", "patch"],
    defaultConfig: {
      name: "apply_patch",
      enabled: true,
      description: "局部文件编辑工具（patch DSL）",
      exposurePolicy: defaultExposure("chat_custom", "description"),
      permissionPolicy: {
        ...defaultPermission("perm.workspace_write"),
        shellPermissionLevel: "workspace_write"
      }
    }
  },
  {
    toolId: "builtin.read_file",
    name: "read_file",
    description: "受控读取文本文件，可按行范围截取。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number", minimum: 1 },
        end_line: { type: "number", minimum: 1 },
        max_chars: { type: "number", minimum: 1 }
      },
      required: ["path"],
      additionalProperties: false
    },
    tags: ["builtin", "read"],
    defaultConfig: {
      name: "read_file",
      enabled: true,
      description: "读取文本文件片段",
      exposurePolicy: defaultExposure("chat_function", "full_schema"),
      permissionPolicy: defaultPermission("perm.readonly")
    }
  },
  {
    toolId: "builtin.web_search",
    name: "web_search",
    description: "执行网络搜索并返回结构化结果（首版可用 mock provider）。",
    executorType: "http",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", minimum: 1, maximum: 20 },
        recency_days: { type: "number", minimum: 0 },
        domains_allowlist: { type: "array", items: { type: "string" } }
      },
      required: ["query"],
      additionalProperties: false
    },
    tags: ["builtin", "web"],
    defaultConfig: {
      name: "web_search",
      enabled: true,
      description: "网络搜索工具",
      exposurePolicy: defaultExposure("responses_native", "summary"),
      permissionPolicy: defaultPermission("perm.readonly")
    }
  },
  {
    toolId: "builtin.update_plan",
    name: "update_plan",
    description: "更新 run 内部计划状态（pending/in_progress/completed）。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        explanation: { type: "string" },
        plan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] }
            },
            required: ["step", "status"],
            additionalProperties: false
          }
        }
      },
      required: ["plan"],
      additionalProperties: false
    },
    tags: ["builtin", "plan"],
    defaultConfig: {
      name: "update_plan",
      enabled: true,
      description: "更新运行计划",
      exposurePolicy: defaultExposure("chat_function", "description"),
      permissionPolicy: defaultPermission("perm.readonly")
    }
  },
  {
    toolId: "builtin.request_user_input",
    name: "request_user_input",
    description: "向用户提问并触发人工中断，等待前端回复后恢复运行。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["single", "multi", "freeform"] },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" }
                  },
                  required: ["label"],
                  additionalProperties: false
                }
              }
            },
            required: ["id", "question"],
            additionalProperties: false
          }
        }
      },
      required: ["questions"],
      additionalProperties: false
    },
    tags: ["builtin", "hitl"],
    defaultConfig: {
      name: "request_user_input",
      enabled: true,
      description: "人工提问/等待回复工具",
      exposurePolicy: defaultExposure("responses_native", "summary"),
      permissionPolicy: {
        ...defaultPermission("perm.readonly"),
        requiresHumanApproval: true
      }
    }
  },
  {
    toolId: "builtin.view_image",
    name: "view_image",
    description: "读取图片基础元数据与预览引用（首版不做 OCR）。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        detail: { type: "string", enum: ["low", "high"] }
      },
      required: ["path"],
      additionalProperties: false
    },
    tags: ["builtin", "image"],
    defaultConfig: {
      name: "view_image",
      enabled: true,
      description: "查看图片元数据",
      exposurePolicy: defaultExposure("chat_function", "summary"),
      permissionPolicy: defaultPermission("perm.readonly")
    }
  }
];

export function getBuiltinToolDefinition(name: BuiltinToolName): BuiltinToolDefinition | null {
  return BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === name) ?? null;
}

