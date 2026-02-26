/**
 * 本文件作用：
 * - 解析 Codex 风格 patch DSL 文本，生成 AST（ApplyPatchAst）。
 *
 * 支持范围（v0.2 首版）：
 * - *** Begin Patch / *** End Patch
 * - *** Add File: path
 * - *** Update File: path
 * - *** Delete File: path
 * - Update 场景下的 @@ 块 + 行前缀（空格 / + / -）
 *
 * 教学说明：
 * - 解析器先做“语法切分”，不做文件系统校验；
 * - 路径安全与上下文匹配错误由 validator / applier 负责。
 */

import type { ApplyPatchAst, ApplyPatchChunk, ApplyPatchHunk, ApplyPatchLine } from "./types.js";

function stripPrefix(line: string, prefix: string): string {
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

export function parseApplyPatch(text: string): ApplyPatchAst {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  // 跳过前导空行，兼容模型输出前多一行空白。
  while (i < lines.length && lines[i].trim() === "") i++;
  if (lines[i] !== "*** Begin Patch") {
    throw new Error("patch 缺少 `*** Begin Patch`");
  }
  i += 1;

  const hunks: ApplyPatchHunk[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line === "*** End Patch") {
      return { hunks };
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = stripPrefix(line, "*** Add File: ").trim();
      i += 1;
      const addLines: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (cur.startsWith("*** ")) break;
        if (!cur.startsWith("+")) {
          throw new Error(`Add File 内容行必须以 '+' 开头，实际为：${cur}`);
        }
        addLines.push(cur.slice(1));
        i += 1;
      }
      hunks.push({
        kind: "add_file",
        path,
        contents: addLines.join("\n")
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = stripPrefix(line, "*** Delete File: ").trim();
      i += 1;
      hunks.push({
        kind: "delete_file",
        path
      });
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = stripPrefix(line, "*** Update File: ").trim();
      i += 1;

      let moveTo: string | undefined;
      if (i < lines.length && lines[i].startsWith("*** Move to: ")) {
        moveTo = stripPrefix(lines[i], "*** Move to: ").trim();
        i += 1;
      }

      const chunks: ApplyPatchChunk[] = [];
      let currentChunk: ApplyPatchChunk | null = null;

      while (i < lines.length) {
        const cur = lines[i];
        if (cur === "*** End Patch") break;
        if (cur.startsWith("*** ") && !cur.startsWith("*** Move to: ")) break;

        if (cur.startsWith("@@")) {
          currentChunk = {
            header: cur.length > 2 ? cur.slice(2).trim() : undefined,
            lines: []
          };
          chunks.push(currentChunk);
          i += 1;
          continue;
        }

        if (!currentChunk) {
          // 允许空的 update hunk（极少见），但遇到正文行仍应报错。
          if (cur.trim() === "") {
            i += 1;
            continue;
          }
          throw new Error(`Update File 在 @@ chunk 之前出现非法行：${cur}`);
        }

        let parsed: ApplyPatchLine;
        if (cur.startsWith("+")) parsed = { kind: "add", text: cur.slice(1) };
        else if (cur.startsWith("-")) parsed = { kind: "remove", text: cur.slice(1) };
        else if (cur.startsWith(" ")) parsed = { kind: "context", text: cur.slice(1) };
        else if (cur === "") parsed = { kind: "context", text: "" };
        else {
          throw new Error(`Update File chunk 行必须以空格/+/-开头，实际为：${cur}`);
        }

        currentChunk.lines.push(parsed);
        i += 1;
      }

      hunks.push({
        kind: "update_file",
        path,
        moveTo,
        chunks
      });
      continue;
    }

    throw new Error(`无法识别的 patch 指令：${line}`);
  }

  throw new Error("patch 缺少 `*** End Patch`");
}

