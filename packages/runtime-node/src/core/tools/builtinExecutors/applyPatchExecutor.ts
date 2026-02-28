/**
 * 本文件作用：
 * - 实现 `apply_patch` 内置工具执行器（支持 dry-run）。
 *
 * 教学说明：
 * - 本执行器只负责“patch 字符串 -> parser/validator/applier”这条链路；
 * - 它不负责模型工具循环（那是 runtime + exposure adapter 的职责）。
 */

import type { JsonObject, JsonValue } from "../../../types/index.js";
import { applyPatchAstToWorkspace, parseApplyPatch } from "../applyPatch/index.js";

export interface ApplyPatchExecutorOptions {
  workspaceRoot: string;
  allowedRoots?: string[];
}

export async function executeBuiltinApplyPatch(
  args: JsonObject,
  options: ApplyPatchExecutorOptions
): Promise<JsonValue> {
  const patch = String(args.patch ?? "");
  const dryRun = Boolean(args.dry_run ?? false);
  if (!patch.trim()) {
    return {
      ok: false,
      error: {
        code: "EMPTY_PATCH",
        message: "patch 不能为空"
      }
    };
  }

  try {
    const ast = parseApplyPatch(patch);
    const result = applyPatchAstToWorkspace(ast, {
      workspaceRoot: options.workspaceRoot,
      dryRun,
      allowedRoots: options.allowedRoots
    });
    return {
      ok: result.ok,
      dryRun,
      previews: result.previews,
      writtenPaths: result.writtenPaths,
      errors: result.errors
    } as unknown as JsonValue;
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PATCH_PARSE_OR_APPLY_FAILED",
        message: error instanceof Error ? error.message : "未知错误"
      }
    } as JsonValue;
  }
}
