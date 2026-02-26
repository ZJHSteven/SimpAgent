/**
 * 本文件作用：
 * - 实现 `view_image` 内置工具的首版元数据读取。
 *
 * 说明：
 * - 首版不做 OCR/视觉理解，只返回文件基础信息，便于跑通工具链路与调试 UI。
 */

import { statSync } from "node:fs";
import path from "node:path";
import type { JsonObject, JsonValue } from "../../../types/index.js";

function resolveSafe(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  const rel = path.relative(path.resolve(workspaceRoot), resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`路径越界：${relPath}`);
  return resolved;
}

export async function executeBuiltinViewImage(args: JsonObject, workspaceRoot: string): Promise<JsonValue> {
  const filePath = String(args.path ?? "");
  if (!filePath) return { ok: false, error: { code: "MISSING_PATH", message: "缺少 path" } };
  try {
    const resolved = resolveSafe(workspaceRoot, filePath);
    const stat = statSync(resolved);
    return {
      ok: true,
      path: filePath,
      absolutePath: resolved,
      detail: String(args.detail ?? "low"),
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "VIEW_IMAGE_FAILED",
        message: error instanceof Error ? error.message : "未知错误"
      }
    };
  }
}

