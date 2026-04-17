/**
 * 本文件实现 Node 的 shell 命令执行运行时。
 * 约束：
 * - 使用 shell=true 兼容常见命令拼接场景
 * - 提供 timeout，避免命令无界阻塞
 */
import { spawn } from "node:child_process";
import { cwd as processCwd } from "node:process";
import type { ShellCommandInput, ShellCommandOutput, ShellRuntime } from "@simpagent/agent-core";

export class NodeShellRuntime implements ShellRuntime {
  /**
   * 执行 shell 命令并收集 stdout/stderr/退出码/耗时。
   */
  runCommand(input: ShellCommandInput): Promise<ShellCommandOutput> {
    const startedAt = Date.now();
    const cwd = input.cwd ?? processCwd();
    const child = spawn(input.command, {
      cwd,
      shell: true,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // 超时后主动 kill 子进程，并在返回值中标记 timedOut。
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs ?? 60000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    return new Promise((resolve) => {
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve({
          command: input.command,
          cwd,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut
        });
      });
    });
  }
}

