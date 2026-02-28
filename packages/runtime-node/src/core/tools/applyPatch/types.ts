/**
 * 本文件作用：
 * - 定义 `apply_patch` 工具所用的 patch DSL AST 类型。
 *
 * 教学说明：
 * - 我们借鉴 Codex 的 patch DSL 思路：模型描述“局部修改意图”，后端负责精确落盘。
 * - 这样可以避免模型重写整个文件，降低 token 成本与误改风险。
 */

export type ApplyPatchLine =
  | { kind: "context"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

export interface ApplyPatchChunk {
  header?: string;
  lines: ApplyPatchLine[];
}

export type ApplyPatchHunk =
  | {
      kind: "add_file";
      path: string;
      contents: string;
    }
  | {
      kind: "delete_file";
      path: string;
    }
  | {
      kind: "update_file";
      path: string;
      moveTo?: string;
      chunks: ApplyPatchChunk[];
    };

export interface ApplyPatchAst {
  hunks: ApplyPatchHunk[];
}

export interface ApplyPatchPreviewItem {
  path: string;
  action: "add" | "delete" | "update";
  ok: boolean;
  message?: string;
  diffPreview?: string;
}

export interface ApplyPatchApplyResult {
  ok: boolean;
  previews: ApplyPatchPreviewItem[];
  writtenPaths: string[];
  errors: Array<{ path?: string; message: string }>;
}

