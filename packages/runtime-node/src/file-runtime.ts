import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EditFileInput, EditFileOutput, FileRuntime, ReadFileInput, ReadFileOutput } from "@simpagent/agent-core";

function assertTextBuffer(buffer: Buffer, path: string): void {
  if (buffer.includes(0)) {
    throw new Error(`拒绝读取非文本文件：${path}`);
  }
}

export class NodeFileRuntime implements FileRuntime {
  async readTextFile(input: ReadFileInput): Promise<ReadFileOutput> {
    const buffer = await readFile(input.path);
    assertTextBuffer(buffer, input.path);

    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    const startLine = Math.max(1, input.startLine ?? 1);
    const endLine = Math.min(totalLines, input.endLine ?? totalLines);

    if (startLine > endLine) {
      throw new Error(`行号范围无效：${startLine}-${endLine}`);
    }

    return {
      text: lines.slice(startLine - 1, endLine).join("\n"),
      metadata: {
        path: input.path,
        totalLines,
        startLine,
        endLine
      }
    };
  }

  async editTextFile(input: EditFileInput): Promise<EditFileOutput> {
    const deleteFile = input.edits.length === 1 && input.edits[0]?.oldText === "" && input.edits[0]?.newText === "";

    if (deleteFile) {
      await rm(input.path);
      return { path: input.path, changed: true, operations: 1 };
    }

    const exists = await stat(input.path).then(() => true, () => false);
    let text = exists ? await readFile(input.path, "utf8") : "";
    let operations = 0;

    for (const edit of input.edits) {
      if (edit.oldText === "") {
        text += edit.newText;
        operations += 1;
        continue;
      }

      if (!text.includes(edit.oldText)) {
        throw new Error(`找不到要替换的原文：${edit.oldText.slice(0, 80)}`);
      }

      text = text.replace(edit.oldText, edit.newText);
      operations += 1;
    }

    await mkdir(dirname(input.path), { recursive: true });
    await writeFile(input.path, text, "utf8");

    return {
      path: input.path,
      changed: operations > 0,
      operations
    };
  }
}

