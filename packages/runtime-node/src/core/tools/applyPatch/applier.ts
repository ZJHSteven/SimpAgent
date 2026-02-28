/**
 * 本文件作用：
 * - 将 apply_patch AST 应用到文件系统（支持 dry-run）。
 *
 * 教学说明：
 * - 这里是“语义执行器”：根据 @@ chunk + 上下文行去定位并修改文件；
 * - 为了首版稳定与易读，我们采用“顺序匹配 + 上下文搜索”的直观实现；
 * - 若后续需要更强鲁棒性，可引入 fuzzy match。
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ApplyPatchApplyResult, ApplyPatchAst, ApplyPatchChunk, ApplyPatchPreviewItem } from "./types.js";
import { validateApplyPatchAst } from "./validator.js";

export interface ApplyPatchApplierOptions {
  workspaceRoot: string;
  dryRun?: boolean;
  allowAbsolutePath?: boolean;
  allowedRoots?: string[];
}

function resolveInWorkspace(workspaceRoot: string, relPath: string): string {
  return path.resolve(workspaceRoot, relPath);
}

function splitLinesKeepLF(text: string): string[] {
  // 统一按 LF 处理，写回时使用 join("\n")。
  return text.replace(/\r\n/g, "\n").split("\n");
}

function chunkToReplacement(chunk: ApplyPatchChunk): {
  contextLines: string[];
  removeLines: string[];
  newLines: string[];
} {
  const contextLines: string[] = [];
  const removeLines: string[] = [];
  const newLines: string[] = [];

  for (const line of chunk.lines) {
    if (line.kind === "context") {
      contextLines.push(line.text);
      newLines.push(line.text);
    } else if (line.kind === "remove") {
      removeLines.push(line.text);
    } else if (line.kind === "add") {
      newLines.push(line.text);
    }
  }
  return { contextLines, removeLines, newLines };
}

function findChunkStart(fileLines: string[], chunk: ApplyPatchChunk): number {
  const contextOnly = chunk.lines.filter((line) => line.kind === "context").map((line) => line.text);
  const matchProbe =
    contextOnly.length > 0
      ? contextOnly
      : chunk.lines.filter((line) => line.kind !== "add").map((line) => line.text);

  if (matchProbe.length === 0) return 0;

  outer: for (let i = 0; i <= fileLines.length - matchProbe.length; i++) {
    for (let j = 0; j < matchProbe.length; j++) {
      if (fileLines[i + j] !== matchProbe[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function applyUpdateChunk(fileLines: string[], chunk: ApplyPatchChunk): { ok: true; nextLines: string[] } | { ok: false; message: string } {
  const start = findChunkStart(fileLines, chunk);
  if (start < 0) {
    return {
      ok: false,
      message: `无法根据上下文定位 @@ chunk${chunk.header ? ` (${chunk.header})` : ""}`
    };
  }

  // 顺序扫描：要求 context/remove 行按顺序匹配；add 行只插入。
  let cursor = start;
  const output: string[] = [];
  output.push(...fileLines.slice(0, start));

  for (const line of chunk.lines) {
    if (line.kind === "context") {
      if (fileLines[cursor] !== line.text) {
        return {
          ok: false,
          message: `上下文不匹配：期望 "${line.text}"，实际 "${String(fileLines[cursor] ?? "")}"`
        };
      }
      output.push(fileLines[cursor]);
      cursor += 1;
      continue;
    }
    if (line.kind === "remove") {
      if (fileLines[cursor] !== line.text) {
        return {
          ok: false,
          message: `删除行不匹配：期望 "${line.text}"，实际 "${String(fileLines[cursor] ?? "")}"`
        };
      }
      cursor += 1;
      continue;
    }
    // add 行直接写入输出，不推进 cursor。
    output.push(line.text);
  }

  output.push(...fileLines.slice(cursor));
  return { ok: true, nextLines: output };
}

function previewFromTexts(beforeText: string | null, afterText: string | null): string {
  const before = (beforeText ?? "").split("\n").slice(0, 20).join("\n");
  const after = (afterText ?? "").split("\n").slice(0, 20).join("\n");
  return `--- before (preview)\n${before}\n+++ after (preview)\n${after}`;
}

export function applyPatchAstToWorkspace(ast: ApplyPatchAst, options: ApplyPatchApplierOptions): ApplyPatchApplyResult {
  const validation = validateApplyPatchAst(ast, {
    workspaceRoot: options.workspaceRoot,
    allowAbsolutePath: options.allowAbsolutePath,
    allowedRoots: options.allowedRoots
  });
  if (!validation.ok) {
    return {
      ok: false,
      previews: [],
      writtenPaths: [],
      errors: validation.errors.map((message) => ({ message }))
    };
  }

  const previews: ApplyPatchPreviewItem[] = [];
  const writtenPaths: string[] = [];
  const errors: Array<{ path?: string; message: string }> = [];

  for (const hunk of ast.hunks) {
    const targetPath = resolveInWorkspace(options.workspaceRoot, hunk.path);
    try {
      if (hunk.kind === "add_file") {
        if (existsSync(targetPath)) {
          throw new Error("目标文件已存在，无法 Add File");
        }
        previews.push({
          path: hunk.path,
          action: "add",
          ok: true,
          diffPreview: previewFromTexts(null, hunk.contents)
        });
        if (!options.dryRun) {
          writeFileSync(targetPath, hunk.contents, "utf8");
          writtenPaths.push(targetPath);
        }
        continue;
      }

      if (hunk.kind === "delete_file") {
        if (!existsSync(targetPath)) {
          throw new Error("目标文件不存在，无法 Delete File");
        }
        const before = readFileSync(targetPath, "utf8");
        previews.push({
          path: hunk.path,
          action: "delete",
          ok: true,
          diffPreview: previewFromTexts(before, null)
        });
        if (!options.dryRun) {
          rmSync(targetPath);
          writtenPaths.push(targetPath);
        }
        continue;
      }

      // update_file
      if (!existsSync(targetPath)) {
        throw new Error("目标文件不存在，无法 Update File");
      }
      const beforeText = readFileSync(targetPath, "utf8");
      let lines = splitLinesKeepLF(beforeText);
      for (const chunk of hunk.chunks) {
        const applied = applyUpdateChunk(lines, chunk);
        if (!applied.ok) {
          throw new Error(applied.message);
        }
        lines = applied.nextLines;
      }
      const afterText = lines.join("\n");
      previews.push({
        path: hunk.path,
        action: "update",
        ok: true,
        diffPreview: previewFromTexts(beforeText, afterText)
      });
      if (!options.dryRun) {
        writeFileSync(targetPath, afterText, "utf8");
        writtenPaths.push(targetPath);
        if (hunk.moveTo) {
          const moveTarget = resolveInWorkspace(options.workspaceRoot, hunk.moveTo);
          renameSync(targetPath, moveTarget);
          writtenPaths.push(moveTarget);
        }
      }
    } catch (error) {
      previews.push({
        path: hunk.path,
        action: hunk.kind === "add_file" ? "add" : hunk.kind === "delete_file" ? "delete" : "update",
        ok: false,
        message: error instanceof Error ? error.message : "未知错误"
      });
      errors.push({
        path: hunk.path,
        message: error instanceof Error ? error.message : "未知错误"
      });
    }
  }

  return {
    ok: errors.length === 0,
    previews,
    writtenPaths,
    errors
  };
}

