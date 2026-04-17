/**
 * 本文件定义 runtime 能力边界。
 * core 不直接依赖 Node/Tauri/Worker API，而是只依赖这些抽象接口。
 */
import type { JsonObject } from "../types/common.js";
import type { ToolApprovalRequest, ToolApprovalResult } from "../types/tools.js";

/**
 * read_file 工具输入。
 */
export interface ReadFileInput {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly includeMetadata?: boolean;
}

/**
 * read_file 工具输出，包含文本与行号元数据。
 */
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

/**
 * 文件能力运行时抽象。
 */
export interface FileRuntime {
  readTextFile(input: ReadFileInput): Promise<ReadFileOutput>;
  editTextFile(input: EditFileInput): Promise<EditFileOutput>;
}

/**
 * shell 能力运行时抽象。
 */
export interface ShellRuntime {
  runCommand(input: ShellCommandInput): Promise<ShellCommandOutput>;
}

/**
 * 人审能力运行时抽象。
 */
export interface ApprovalRuntime {
  requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult>;
}

/**
 * 组合后的 runtime 服务集合。
 */
export interface RuntimeServices {
  readonly fileRuntime: FileRuntime;
  readonly shellRuntime: ShellRuntime;
  readonly approvalRuntime: ApprovalRuntime;
  readonly extra?: JsonObject;
}

