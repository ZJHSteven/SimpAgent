import { spawn } from "node:child_process";
import { cwd as processCwd } from "node:process";
import type { ShellCommandInput, ShellCommandOutput, ShellRuntime } from "@simpagent/agent-core";

export class NodeShellRuntime implements ShellRuntime {
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

