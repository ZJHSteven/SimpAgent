/**
 * 本文件作用：
 * - `shell_command` 内置工具执行器封装（首版复用 ToolRuntime 的 shell 执行能力）。
 *
 * 教学说明：
 * - 这里先提供一个统一入口，方便 CanonicalToolRouter 在 v0.2 接入时调用；
 * - 真正的命令执行、白名单、超时控制仍由 ToolRuntime 负责。
 */

import type { JsonObject, ToolSpec } from "../../../types/index.js";
import type { ToolRuntime } from "../runtime.js";

export async function executeBuiltinShellCommand(args: {
  toolRuntime: ToolRuntime;
  spec: ToolSpec;
  input: JsonObject;
  agentId?: string;
}) {
  return args.toolRuntime.execute(args.spec, args.input, args.agentId);
}

