/**
 * 本文件作用：
 * - 实现统一 ToolRuntime（function + shell 两种执行器）。
 * - 负责权限检查、超时、审计用 Trace 数据构造。
 *
 * 教学说明：
 * - shell 不是唯一工具，仅是一个执行器。
 * - 真正统一性来自 ToolSpec / ToolCall / ToolResult / ToolTrace 这些契约。
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  JsonObject,
  JsonValue,
  PermissionConfig,
  ShellPermissionLevel,
  ToolCall,
  ToolResult,
  ToolSpec,
  ToolTrace
} from "../../types/index.js";
import { createDefaultPermissionConfig, evaluateShellPermission } from "../../security/permissions.js";

interface FunctionToolHandler {
  name: string;
  handler: (args: JsonObject) => Promise<JsonValue> | JsonValue;
}

function nowIso(): string {
  return new Date().toISOString();
}

function permissionLevelFromProfile(permissionProfileId: string): ShellPermissionLevel {
  if (permissionProfileId.includes("danger")) return "dangerous";
  if (permissionProfileId.includes("write")) return "workspace_write";
  return "readonly";
}

/**
 * ToolRuntime 执行环境：
 * - workspaceRoot 用于 shell 工具工作目录限制。
 * - shellAllowPrefixes 实现简单白名单（首版）。
 */
export class ToolRuntime {
  private readonly functionTools = new Map<string, FunctionToolHandler>();

  constructor(
    private readonly options: {
      workspaceRoot: string;
      shellAllowPrefixes: string[];
      getPermissionConfig?: () => PermissionConfig;
    }
  ) {
    // 注册首批内置函数工具（教学用简单实现）。
    this.registerFunctionTool({
      name: "echo",
      handler: (args) => ({
        echoed: String(args.text ?? "")
      })
    });
  }

  registerFunctionTool(tool: FunctionToolHandler): void {
    this.functionTools.set(tool.name, tool);
  }

  /**
   * 统一执行入口。
   * 返回：
   * - ToolResult（业务结果）
   * - ToolTrace（调试器详情）
   */
  async execute(
    spec: ToolSpec,
    args: JsonObject,
    agentId?: string,
    runtimeHints?: {
      shellApprovalGranted?: boolean;
    }
  ): Promise<{ result: ToolResult; trace: ToolTrace }> {
    const toolCallId = `toolcall_${randomUUID().replace(/-/g, "")}`;
    const issuedAt = nowIso();
    const call: ToolCall = {
      toolCallId,
      toolId: spec.id,
      toolName: spec.name,
      arguments: args,
      issuedByAgentId: agentId,
      issuedAt
    };

    if (spec.executorType === "function") {
      return this.executeFunctionTool(spec, call);
    }
    if (spec.executorType === "shell") {
      return this.executeShellTool(spec, call, runtimeHints);
    }

    const startedAt = nowIso();
    const finishedAt = nowIso();
    const result: ToolResult = {
      toolCallId,
      toolId: spec.id,
      ok: false,
      error: {
        code: "UNSUPPORTED_EXECUTOR",
        message: `首版暂未实现执行器：${spec.executorType}`
      },
      startedAt,
      finishedAt,
      durationMs: 0
    };
    return {
      result,
      trace: {
        toolCallId,
        toolId: spec.id,
        toolName: spec.name,
        executorType: spec.executorType,
        arguments: args,
        result
      }
    };
  }

  private async executeFunctionTool(
    spec: ToolSpec,
    call: ToolCall
  ): Promise<{ result: ToolResult; trace: ToolTrace }> {
    const start = Date.now();
    const startedAt = nowIso();
    const handler = this.functionTools.get(spec.name);
    if (!handler) {
      const finishedAt = nowIso();
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        ok: false,
        error: {
          code: "FUNCTION_TOOL_NOT_REGISTERED",
          message: `未注册函数工具：${spec.name}`
        },
        startedAt,
        finishedAt,
        durationMs: Date.now() - start
      };
      return {
        result,
        trace: {
          toolCallId: call.toolCallId,
          toolId: spec.id,
          toolName: spec.name,
          executorType: spec.executorType,
          arguments: call.arguments,
          result
        }
      };
    }

    try {
      const output = await handler.handler(call.arguments);
      const finishedAt = nowIso();
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        ok: true,
        output,
        startedAt,
        finishedAt,
        durationMs: Date.now() - start
      };
      return {
        result,
        trace: {
          toolCallId: call.toolCallId,
          toolId: spec.id,
          toolName: spec.name,
          executorType: spec.executorType,
          arguments: call.arguments,
          result
        }
      };
    } catch (error) {
      const finishedAt = nowIso();
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        ok: false,
        error: {
          code: "FUNCTION_TOOL_FAILED",
          message: error instanceof Error ? error.message : "未知错误"
        },
        startedAt,
        finishedAt,
        durationMs: Date.now() - start
      };
      return {
        result,
        trace: {
          toolCallId: call.toolCallId,
          toolId: spec.id,
          toolName: spec.name,
          executorType: spec.executorType,
          arguments: call.arguments,
          result
        }
      };
    }
  }

  private async executeShellTool(
    spec: ToolSpec,
    call: ToolCall,
    runtimeHints?: {
      shellApprovalGranted?: boolean;
    }
  ): Promise<{ result: ToolResult; trace: ToolTrace }> {
    const start = Date.now();
    const startedAt = nowIso();
    const permissionLevel = permissionLevelFromProfile(spec.permissionProfileId);
    const command = String(call.arguments.command ?? "");
    const permissionConfig = this.options.getPermissionConfig?.() ?? createDefaultPermissionConfig();
    const evaluation = evaluateShellPermission({
      command,
      requestedWorkdir: typeof call.arguments.workdir === "string" ? String(call.arguments.workdir) : undefined,
      workspaceRoot: this.options.workspaceRoot,
      workingDirPolicy: spec.workingDirPolicy,
      projectPermissionConfig: permissionConfig,
      toolPermissionPolicy:
        (extractPermissionPolicy(spec.executorConfig) as any) ??
        ({
          permissionProfileId: spec.permissionProfileId,
          allowCommandPrefixes: this.options.shellAllowPrefixes
        } as any)
    });

    if (evaluation.decision === "deny") {
      const finishedAt = nowIso();
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        ok: false,
        error: {
          code: "SHELL_PERMISSION_DENIED",
          message: evaluation.reason,
          details: evaluation as unknown as JsonValue
        },
        startedAt,
        finishedAt,
        durationMs: Date.now() - start
      };
      return {
        result,
        trace: {
          toolCallId: call.toolCallId,
          toolId: spec.id,
          toolName: spec.name,
          executorType: "shell",
          arguments: call.arguments,
          permissionLevel,
          workingDir: evaluation.resolvedWorkdir,
          result
        }
      };
    }

    if (evaluation.decision === "ask" && !runtimeHints?.shellApprovalGranted) {
      const finishedAt = nowIso();
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        ok: false,
        error: {
          code: "SHELL_APPROVAL_REQUIRED",
          message: evaluation.reason,
          details: evaluation as unknown as JsonValue
        },
        startedAt,
        finishedAt,
        durationMs: Date.now() - start
      };
      return {
        result,
        trace: {
          toolCallId: call.toolCallId,
          toolId: spec.id,
          toolName: spec.name,
          executorType: "shell",
          arguments: call.arguments,
          permissionLevel,
          workingDir: evaluation.resolvedWorkdir,
          result
        }
      };
    }

    const timeoutMs = typeof call.arguments.timeout_ms === "number" ? Number(call.arguments.timeout_ms) : spec.timeoutMs || 15_000;
    const shellExe =
      process.platform === "win32"
        ? pathToWindowsPowerShell()
        : "bash";
    const shellArgs =
      process.platform === "win32"
        ? ["-NoProfile", "-Command", command]
        : ["-lc", command];

    const child = spawn(shellExe, shellArgs, {
      cwd: evaluation.resolvedWorkdir,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20_000) stdout = stdout.slice(-20_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    const finishedAt = nowIso();
    const ok = !timedOut && exitCode === 0;
    const result: ToolResult = {
      toolCallId: call.toolCallId,
      toolId: spec.id,
      ok,
      output: ok ? { stdout, stderr, exitCode } : undefined,
      error: ok
        ? undefined
        : {
            code: timedOut ? "SHELL_TIMEOUT" : "SHELL_FAILED",
            message: timedOut ? `命令执行超时（${timeoutMs}ms）` : `命令执行失败，exitCode=${String(exitCode)}`,
            details: { stderr: stderr.slice(0, 1000) }
          },
      startedAt,
      finishedAt,
      durationMs: Date.now() - start
    };

    return {
      result,
      trace: {
        toolCallId: call.toolCallId,
        toolId: spec.id,
        toolName: spec.name,
        executorType: "shell",
        arguments: call.arguments,
        permissionLevel,
        workingDir: evaluation.resolvedWorkdir,
        stdoutPreview: stdout.slice(-1000),
        stderrPreview: stderr.slice(-1000),
        result
      }
    };
  }
}

function extractPermissionPolicy(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!record.permissionPolicy || typeof record.permissionPolicy !== "object" || Array.isArray(record.permissionPolicy)) {
    return null;
  }
  return record.permissionPolicy as JsonObject;
}

function pathToWindowsPowerShell(): string {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
