/**
 * 本文件作用：
 * - 提供 Shell/工作目录权限判定的统一内核。
 * - 让 ToolRuntime、RuntimeEngine 与系统配置共享同一套权限语义。
 *
 * 教学说明：
 * - “统一图谱”解决的是定义层统一，“权限内核”解决的是执行层可控。
 * - 首版先把最核心的四件事做扎实：
 *   1) `deny / ask / allow`
 *   2) 命令规则
 *   3) 工作目录规则
 *   4) 命中原因记录
 */

import path from "node:path";
import type {
  CanonicalToolPermissionPolicy,
  JsonObject,
  JsonValue,
  PermissionConfig,
  PermissionMatchDetail,
  PermissionMode,
  PermissionRule,
  PermissionScope,
  ToolSpec
} from "../types/index.js";

/**
 * 默认权限配置。
 * 说明：
 * - 默认值就是框架的“系统层”策略；
 * - 项目层可以在 `system_config.permissionPolicy` 里覆盖。
 */
export function createDefaultPermissionConfig(): PermissionConfig {
  return {
    defaultMode: "deny",
    rules: [
      {
        ruleId: "perm.system.deny.destructive",
        layer: "system",
        scope: "command",
        action: "deny",
        matcher: {
          type: "regex",
          value: String.raw`(^|\s)(rm\s+-rf|del\s+/s|format\s|shutdown\s|reboot\s|mkfs\s|diskpart\s)(\s|$)`
        },
        description: "显式拦截高破坏性命令"
      },
      {
        ruleId: "perm.system.allow.echo",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "echo " },
        description: "允许基础输出命令"
      },
      {
        ruleId: "perm.system.allow.rg",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "rg " },
        description: "允许快速代码搜索"
      },
      {
        ruleId: "perm.system.allow.dir",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "exact", value: "dir" },
        description: "允许目录列表命令 dir"
      },
      {
        ruleId: "perm.system.allow.dir_with_args",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "dir " },
        description: "允许目录列表命令 dir + 参数"
      },
      {
        ruleId: "perm.system.allow.ls",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "ls" },
        description: "允许目录列表命令 ls"
      },
      {
        ruleId: "perm.system.allow.pwd",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "exact", value: "pwd" },
        description: "允许查看当前目录"
      },
      {
        ruleId: "perm.system.allow.where",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "where " },
        description: "允许查询命令位置"
      },
      {
        ruleId: "perm.system.allow.which",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "which " },
        description: "允许查询命令位置"
      },
      {
        ruleId: "perm.system.allow.type",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "type " },
        description: "允许 type 读取文本"
      },
      {
        ruleId: "perm.system.allow.git.status",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "git status" },
        description: "允许 git status"
      },
      {
        ruleId: "perm.system.allow.git.diff",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "git diff" },
        description: "允许 git diff"
      },
      {
        ruleId: "perm.system.allow.git.log",
        layer: "system",
        scope: "command",
        action: "allow",
        matcher: { type: "prefix", value: "git log" },
        description: "允许 git log"
      },
      {
        ruleId: "perm.system.ask.git.write",
        layer: "system",
        scope: "command",
        action: "ask",
        matcher: { type: "regex", value: String.raw`^git\s+(add|commit|push|pull|merge|rebase|tag)\b` },
        description: "git 写操作默认要求审批"
      },
      {
        ruleId: "perm.system.ask.package_manager",
        layer: "system",
        scope: "command",
        action: "ask",
        matcher: { type: "regex", value: String.raw`^(npm|pnpm|yarn)\s+` },
        description: "包管理器命令默认要求审批"
      },
      {
        ruleId: "perm.system.ask.runtime",
        layer: "system",
        scope: "command",
        action: "ask",
        matcher: { type: "regex", value: String.raw`^(node|python|py)\s+` },
        description: "脚本运行时默认要求审批"
      }
    ]
  };
}

/**
 * 归一化系统/项目权限配置。
 */
export function normalizePermissionConfig(input: Partial<PermissionConfig> | undefined): PermissionConfig {
  const fallback = createDefaultPermissionConfig();
  return {
    defaultMode:
      input?.defaultMode === "allow" || input?.defaultMode === "ask" || input?.defaultMode === "deny"
        ? input.defaultMode
        : fallback.defaultMode,
    rules: Array.isArray(input?.rules) ? input.rules.filter(Boolean) : fallback.rules
  };
}

export interface ShellPermissionEvaluationInput {
  command: string;
  requestedWorkdir?: string;
  workspaceRoot: string;
  workingDirPolicy?: ToolSpec["workingDirPolicy"];
  projectPermissionConfig?: Partial<PermissionConfig>;
  toolPermissionPolicy?: CanonicalToolPermissionPolicy;
}

export interface ShellPermissionEvaluationResult {
  decision: PermissionMode;
  reason: string;
  resolvedWorkdir: string;
  matches: PermissionMatchDetail[];
  commandCheck: {
    decision: PermissionMode;
    reason: string;
  };
  pathCheck: {
    decision: PermissionMode;
    reason: string;
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCommand(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function buildMatch(rule: PermissionRule, reason: string): PermissionMatchDetail {
  return {
    ruleId: rule.ruleId,
    layer: rule.layer,
    scope: rule.scope,
    action: rule.action,
    matcherType: rule.matcher.type,
    matcherValue: rule.matcher.value,
    reason
  };
}

function matchRule(rule: PermissionRule, target: string | JsonValue): boolean {
  if (rule.matcher.type === "exact") {
    return typeof target === "string" && target === rule.matcher.value;
  }
  if (rule.matcher.type === "prefix") {
    return typeof target === "string" && target.startsWith(rule.matcher.value);
  }
  if (rule.matcher.type === "regex") {
    if (typeof target !== "string") return false;
    try {
      return new RegExp(rule.matcher.value, "i").test(target);
    } catch {
      return false;
    }
  }
  if (rule.matcher.type === "schema") {
    if (!isJsonObject(target)) return false;
    try {
      const parsed = JSON.parse(rule.matcher.value);
      if (!isJsonObject(parsed)) return false;
      return Object.entries(parsed).every(([key, value]) => JSON.stringify(target[key]) === JSON.stringify(value));
    } catch {
      return false;
    }
  }
  return false;
}

function evaluateByScope(args: {
  scope: PermissionScope;
  target: string | JsonValue;
  rules: PermissionRule[];
  defaultMode: PermissionMode;
}): { decision: PermissionMode; match?: PermissionMatchDetail } {
  const layerOrder: Array<PermissionRule["layer"]> = ["node", "agent", "project", "system"];
  for (const layer of layerOrder) {
    const rulesInLayer = args.rules.filter((rule) => rule.scope === args.scope && rule.layer === layer);
    for (const rule of rulesInLayer) {
      if (matchRule(rule, args.target)) {
        return {
          decision: rule.action,
          match: buildMatch(rule, `命中 ${args.scope} 规则：${rule.description ?? rule.ruleId}`)
        };
      }
    }
  }
  return {
    decision: args.defaultMode
  };
}

function resolveWorkingDirectory(input: {
  workspaceRoot: string;
  requestedWorkdir?: string;
  workingDirPolicy?: ToolSpec["workingDirPolicy"];
}): { ok: true; resolvedWorkdir: string } | { ok: false; reason: string } {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const requested = input.requestedWorkdir?.trim()
    ? path.resolve(workspaceRoot, input.requestedWorkdir.trim())
    : workspaceRoot;
  const policy = input.workingDirPolicy;

  if (!policy || policy.mode === "workspace") {
    if (!isPathInside(workspaceRoot, requested)) {
      return {
        ok: false,
        reason: `工作目录超出 workspaceRoot：${requested}`
      };
    }
    return { ok: true, resolvedWorkdir: requested };
  }

  if (policy.mode === "fixed") {
    const fixedPath = path.resolve(workspaceRoot, policy.fixedPath ?? ".");
    if (requested !== fixedPath) {
      return {
        ok: false,
        reason: `工作目录必须固定为 ${fixedPath}`
      };
    }
    return { ok: true, resolvedWorkdir: fixedPath };
  }

  if (policy.mode === "allowlist") {
    const allowlist = (policy.allowlist ?? []).map((item) => path.resolve(workspaceRoot, item));
    const matched = allowlist.some((item) => isPathInside(item, requested));
    if (!matched) {
      return {
        ok: false,
        reason: `工作目录未命中 allowlist：${requested}`
      };
    }
    return { ok: true, resolvedWorkdir: requested };
  }

  return { ok: true, resolvedWorkdir: requested };
}

/**
 * 评估 shell 命令权限。
 * 说明：
 * - 命令规则和工作目录规则分别判定，再合并成最终结果；
 * - `deny` 优先级最高，其次是 `ask`，最后才是 `allow`。
 */
export function evaluateShellPermission(input: ShellPermissionEvaluationInput): ShellPermissionEvaluationResult {
  const normalizedCommand = normalizeCommand(String(input.command ?? ""));
  const permissionConfig = normalizePermissionConfig(input.projectPermissionConfig);
  const matches: PermissionMatchDetail[] = [];
  const nodeRules: PermissionRule[] = [];

  if (Array.isArray(input.toolPermissionPolicy?.extraRules)) {
    nodeRules.push(...input.toolPermissionPolicy.extraRules.map((rule) => ({ ...rule, layer: "node" as const })));
  }

  if (Array.isArray(input.toolPermissionPolicy?.allowCommandPrefixes) && input.toolPermissionPolicy.allowCommandPrefixes.length > 0) {
    const hitAllowPrefix = input.toolPermissionPolicy.allowCommandPrefixes.some((prefix) =>
      normalizedCommand.toLowerCase().startsWith(prefix.toLowerCase())
    );
    if (!hitAllowPrefix) {
      return {
        decision: "deny",
        reason: "命令未命中节点级 allowCommandPrefixes 白名单",
        resolvedWorkdir: path.resolve(input.workspaceRoot),
        matches: [
          {
            ruleId: "perm.node.allow_prefixes",
            layer: "node",
            scope: "command",
            action: "deny",
            matcherType: "prefix",
            matcherValue: input.toolPermissionPolicy.allowCommandPrefixes.join(" | "),
            reason: "命令未命中节点级 allowCommandPrefixes 白名单"
          }
        ],
        commandCheck: {
          decision: "deny",
          reason: "命令未命中节点级 allowCommandPrefixes 白名单"
        },
        pathCheck: {
          decision: "allow",
          reason: "工作目录尚未触发拒绝"
        }
      };
    }
  }

  const workdirResolution = resolveWorkingDirectory({
    workspaceRoot: input.workspaceRoot,
    requestedWorkdir: input.requestedWorkdir,
    workingDirPolicy: input.workingDirPolicy
  });
  if (!workdirResolution.ok) {
    return {
      decision: "deny",
      reason: workdirResolution.reason,
      resolvedWorkdir: path.resolve(input.workspaceRoot),
      matches: [
        {
          ruleId: "perm.node.workdir_policy",
          layer: "node",
          scope: "path",
          action: "deny",
          matcherType: "prefix",
          matcherValue: String(input.workingDirPolicy?.mode ?? "workspace"),
          reason: workdirResolution.reason
        }
      ],
      commandCheck: {
        decision: "allow",
        reason: "命令本身尚未触发拒绝"
      },
      pathCheck: {
        decision: "deny",
        reason: workdirResolution.reason
      }
    };
  }

  const mergedRules = [...nodeRules, ...permissionConfig.rules];
  const commandDecision = evaluateByScope({
    scope: "command",
    target: normalizedCommand,
    rules: mergedRules,
    defaultMode: permissionConfig.defaultMode
  });
  if (commandDecision.match) matches.push(commandDecision.match);

  const pathDecision = evaluateByScope({
    scope: "path",
    target: workdirResolution.resolvedWorkdir,
    rules: mergedRules,
    defaultMode: "allow"
  });
  if (pathDecision.match) matches.push(pathDecision.match);

  if (input.toolPermissionPolicy?.requiresHumanApproval) {
    matches.push({
      ruleId: "perm.node.requires_human_approval",
      layer: "node",
      scope: "tool",
      action: "ask",
      matcherType: "exact",
      matcherValue: "requiresHumanApproval=true",
      reason: "节点级策略要求人工审批"
    });
  }

  const decisions: PermissionMode[] = [commandDecision.decision, pathDecision.decision];
  if (input.toolPermissionPolicy?.requiresHumanApproval) {
    decisions.push("ask");
  }
  const finalDecision = decisions.includes("deny") ? "deny" : decisions.includes("ask") ? "ask" : "allow";
  const reason =
    finalDecision === "deny"
      ? matches.find((item) => item.action === "deny")?.reason ?? "命令或工作目录未通过权限校验"
      : finalDecision === "ask"
        ? matches.find((item) => item.action === "ask")?.reason ?? "命令需要人工审批"
        : "命令与工作目录均通过权限校验";

  return {
    decision: finalDecision,
    reason,
    resolvedWorkdir: workdirResolution.resolvedWorkdir,
    matches,
    commandCheck: {
      decision: commandDecision.decision,
      reason: commandDecision.match?.reason ?? "未命中特定命令规则，使用默认决策"
    },
    pathCheck: {
      decision: pathDecision.decision,
      reason: pathDecision.match?.reason ?? "工作目录通过基础范围校验"
    }
  };
}

/**
 * 解析审批回复。
 * 说明：
 * - 支持布尔、字符串、对象三种常见格式；
 * - 这样 HTTP 调试器、CLI、未来桌面端都能复用同一协议。
 */
export function parseApprovalAnswer(answer: JsonValue | undefined): {
  approved: boolean;
  action: "allow" | "deny";
  justification?: string;
} {
  if (typeof answer === "boolean") {
    return {
      approved: answer,
      action: answer ? "allow" : "deny"
    };
  }
  if (typeof answer === "string") {
    const normalized = answer.trim().toLowerCase();
    if (["allow", "approve", "approved", "yes", "y", "true", "继续"].includes(normalized)) {
      return { approved: true, action: "allow", justification: answer };
    }
    return { approved: false, action: "deny", justification: answer };
  }
  if (isJsonObject(answer)) {
    const rawAction = typeof answer.action === "string" ? answer.action.toLowerCase() : "";
    const approved = rawAction === "allow" || rawAction === "approve" || rawAction === "approved" || answer.approved === true;
    return {
      approved,
      action: approved ? "allow" : "deny",
      justification: typeof answer.justification === "string" ? answer.justification : undefined
    };
  }
  return {
    approved: false,
    action: "deny"
  };
}
