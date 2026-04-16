import type { JsonObject } from "../types/common.js";
import type { ToolApprovalRequest, ToolApprovalResult } from "../types/tools.js";

export interface ReadFileInput {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly includeMetadata?: boolean;
}

export interface ReadFileOutput {
  readonly text: string;
  readonly metadata: {
    readonly path: string;
    readonly totalLines: number;
    readonly startLine: number;
    readonly endLine: number;
  };
}

export interface EditOperation {
  readonly oldText: string;
  readonly newText: string;
}

export interface EditFileInput {
  readonly path: string;
  readonly edits: readonly EditOperation[];
}

export interface EditFileOutput {
  readonly path: string;
  readonly changed: boolean;
  readonly operations: number;
}

export interface ShellCommandInput {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface ShellCommandOutput {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface FileRuntime {
  readTextFile(input: ReadFileInput): Promise<ReadFileOutput>;
  editTextFile(input: EditFileInput): Promise<EditFileOutput>;
}

export interface ShellRuntime {
  runCommand(input: ShellCommandInput): Promise<ShellCommandOutput>;
}

export interface ApprovalRuntime {
  requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult>;
}

export interface RuntimeServices {
  readonly fileRuntime: FileRuntime;
  readonly shellRuntime: ShellRuntime;
  readonly approvalRuntime: ApprovalRuntime;
  readonly extra?: JsonObject;
}

