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
  CatalogNode,
  CatalogNodeFacet,
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
  exposurePolicy: CanonicalToolExposurePolicy;
  permissionPolicy: CanonicalToolPermissionPolicy;
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
    exposurePolicy: defaultExposure("chat_function", "description"),
    permissionPolicy: {
      ...defaultPermission("perm.readonly"),
      allowCommandPrefixes: ["git ", "npm ", "pnpm ", "node ", "python ", "rg ", "ls ", "dir ", "type "]
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
    exposurePolicy: defaultExposure("chat_custom", "description"),
    permissionPolicy: {
      ...defaultPermission("perm.workspace_write"),
      shellPermissionLevel: "workspace_write"
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
    exposurePolicy: defaultExposure("chat_function", "full_schema"),
    permissionPolicy: defaultPermission("perm.readonly")
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
    exposurePolicy: defaultExposure("responses_native", "summary"),
    permissionPolicy: defaultPermission("perm.readonly")
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
    exposurePolicy: defaultExposure("chat_function", "description"),
    permissionPolicy: defaultPermission("perm.readonly")
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
    exposurePolicy: defaultExposure("responses_native", "summary"),
    permissionPolicy: {
      ...defaultPermission("perm.readonly"),
      requiresHumanApproval: true
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
    exposurePolicy: defaultExposure("chat_function", "summary"),
    permissionPolicy: defaultPermission("perm.readonly")
  },
  {
    toolId: "builtin.handoff",
    name: "handoff",
    description: "将当前任务显式交接给下一个 agent，由 runtime 校验并切换节点。",
    executorType: "function",
    inputSchema: {
      type: "object",
      properties: {
        targetAgentId: { type: "string", description: "目标 agentId，而不是 workflow nodeId" },
        taskSummary: { type: "string", description: "交接给下一个 agent 的任务摘要" },
        payload: { type: "object", description: "可选结构化补充载荷" },
        reason: { type: "string", description: "发起 handoff 的原因" },
        artifactRefs: {
          type: "array",
          items: { type: "string" },
          description: "可选的 artifact 引用列表"
        }
      },
      required: ["targetAgentId", "taskSummary"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        targetAgentId: { type: "string" },
        targetNodeId: { type: "string" },
        packetId: { type: "string" },
        errorCode: { type: "string" }
      },
      required: ["accepted", "targetAgentId"],
      additionalProperties: false
    },
    tags: ["builtin", "routing", "handoff"],
    exposurePolicy: defaultExposure("chat_function", "description"),
    permissionPolicy: defaultPermission("perm.readonly")
  }
];

export function getBuiltinToolDefinition(name: BuiltinToolName): BuiltinToolDefinition | null {
  return BUILTIN_TOOL_DEFINITIONS.find((item) => item.name === name) ?? null;
}

/**
 * 将 builtin 定义投影为 catalog node。
 * 说明：
 * - 这样 builtin 和 MCP / skill / 其他工具一样，都统一进入 catalog；
 * - 后续 ToolRegistry 不再需要单独拼 builtin config。
 */
export function buildBuiltinCatalogNode(input: { projectId: string; definition: BuiltinToolDefinition }): CatalogNode {
  const now = new Date().toISOString();
  return {
    nodeId: input.definition.toolId,
    projectId: input.projectId,
    nodeClass: "item",
    name: input.definition.name,
    title: input.definition.name,
    summaryText: input.definition.description,
    contentText: input.definition.description,
    contentFormat: "markdown",
    primaryKind: "tool",
    visibility: "visible",
    exposeMode: "summary_first",
    enabled: true,
    sortOrder: 0,
    tags: input.definition.tags,
    metadata: {
      builtinName: input.definition.name
    },
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 将 builtin 定义投影为 catalog tool facet。
 * 说明：
 * - route / exposure / permission 都直接落在 facet 里；
 * - runtime 后续只需要从 catalog 读取，不再额外依赖 builtin config 表。
 */
export function buildBuiltinCatalogFacet(definition: BuiltinToolDefinition): CatalogNodeFacet {
  return {
    facetId: `facet.tool.${definition.toolId}`,
    nodeId: definition.toolId,
    facetType: "tool",
    payload: {
      toolKind: "builtin",
      route: {
        kind: "builtin",
        builtin: definition.name
      },
      executorType: definition.executorType,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      exposurePolicy: definition.exposurePolicy,
      permissionPolicy: definition.permissionPolicy,
      executionConfig: {
        builtinName: definition.name
      }
    },
    updatedAt: new Date().toISOString()
  };
}
