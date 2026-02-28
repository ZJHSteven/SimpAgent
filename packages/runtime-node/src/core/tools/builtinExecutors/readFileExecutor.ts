/**
 * 本文件作用：
 * - 实现 `read_file` 内置工具执行器（文本文件读取 + 行范围截取）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { JsonObject, JsonValue } from "../../../types/index.js";

function resolveSafe(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  const rel = path.relative(path.resolve(workspaceRoot), resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径越界：${relPath}`);
  }
  return resolved;
}

export async function executeBuiltinReadFile(args: JsonObject, workspaceRoot: string): Promise<JsonValue> {
  const filePath = String(args.path ?? "");
  if (!filePath) {
    return { ok: false, error: { code: "MISSING_PATH", message: "缺少 path" } };
  }
  try {
    const resolved = resolveSafe(workspaceRoot, filePath);
    const text = readFileSync(resolved, "utf8").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const startLine = Math.max(1, Number(args.start_line ?? 1));
    const endLine = Math.max(startLine, Number(args.end_line ?? lines.length));
    const maxChars = Math.max(1, Number(args.max_chars ?? 20_000));
    const slice = lines.slice(startLine - 1, endLine);
    let content = slice.join("\n");
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }
    return {
      ok: true,
      path: filePath,
      startLine,
      endLine,
      truncated,
      content,
      lineCount: slice.length,
      charCount: content.length
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "READ_FILE_FAILED",
        message: error instanceof Error ? error.message : "未知错误"
      }
    };
  }
}

