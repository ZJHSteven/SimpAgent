/**
 * 本文件作用：
 * - 对 apply_patch 的路径与基本结构做安全校验。
 *
 * 教学说明：
 * - parser 解决“语法像不像 patch”；
 * - validator 解决“这个 patch 能不能安全地对当前工作区执行”。
 */

import path from "node:path";
import type { ApplyPatchAst, ApplyPatchHunk } from "./types.js";

export interface ApplyPatchValidationOptions {
  workspaceRoot: string;
  allowAbsolutePath?: boolean;
  allowedRoots?: string[];
}

export interface ApplyPatchValidationResult {
  ok: boolean;
  errors: string[];
  resolvedPaths: string[];
}

function normalizeWithinWorkspace(workspaceRoot: string, filePath: string, allowAbsolutePath = false): string {
  if (!allowAbsolutePath && path.isAbsolute(filePath)) {
    throw new Error(`禁止绝对路径：${filePath}`);
  }
  const resolved = path.resolve(workspaceRoot, filePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  const relative = path.relative(normalizedRoot, resolved);
  // 路径穿越检测：以 .. 开头或仍为绝对路径都视为越界。
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径越界（超出工作区）：${filePath}`);
  }
  return resolved;
}

function checkUpdateHunk(hunk: Extract<ApplyPatchHunk, { kind: "update_file" }>): void {
  if (hunk.chunks.length === 0) {
    throw new Error(`Update File 缺少 @@ chunk：${hunk.path}`);
  }
  for (const [idx, chunk] of hunk.chunks.entries()) {
    if (chunk.lines.length === 0) {
      throw new Error(`Update File 的第 ${idx + 1} 个 chunk 为空：${hunk.path}`);
    }
  }
}

export function validateApplyPatchAst(ast: ApplyPatchAst, options: ApplyPatchValidationOptions): ApplyPatchValidationResult {
  const errors: string[] = [];
  const resolvedPaths: string[] = [];

  for (const hunk of ast.hunks) {
    try {
      if (hunk.kind === "update_file") checkUpdateHunk(hunk);

      const targetPaths =
        hunk.kind === "update_file" && hunk.moveTo
          ? [hunk.path, hunk.moveTo]
          : [hunk.path];

      for (const p of targetPaths) {
        const resolved = normalizeWithinWorkspace(options.workspaceRoot, p, options.allowAbsolutePath);
        if (options.allowedRoots && options.allowedRoots.length > 0) {
          const inAllowRoots = options.allowedRoots.some((allowed) => {
            const allowedResolved = path.resolve(options.workspaceRoot, allowed);
            const rel = path.relative(allowedResolved, resolved);
            return !(rel.startsWith("..") || path.isAbsolute(rel));
          });
          if (!inAllowRoots) {
            throw new Error(`路径不在允许目录列表中：${p}`);
          }
        }
        resolvedPaths.push(resolved);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `未知校验错误：${String(error)}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    resolvedPaths
  };
}

