import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject, TraceRecord, TraceStore } from "@simpagent/agent-core";

interface ThreadFile {
  readonly thread?: JsonObject;
  readonly traces: readonly TraceRecord[];
}

export class JsonFileTraceStore implements TraceStore {
  constructor(private readonly storageDir: string) {}

  private threadPath(threadId: string): string {
    return join(this.storageDir, "threads", `${threadId}.json`);
  }

  private async readThreadFile(threadId: string): Promise<ThreadFile> {
    const path = this.threadPath(threadId);
    const raw = await readFile(path, "utf8").catch(() => undefined);

    if (raw === undefined) {
      return { traces: [] };
    }

    const parsed = JSON.parse(raw) as ThreadFile;
    return {
      ...(parsed.thread === undefined ? {} : { thread: parsed.thread }),
      traces: parsed.traces ?? []
    };
  }

  private async writeThreadFile(threadId: string, data: ThreadFile): Promise<void> {
    const path = this.threadPath(threadId);
    await mkdir(join(this.storageDir, "threads"), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), "utf8");
  }

  async saveTrace(trace: TraceRecord): Promise<void> {
    const current = await this.readThreadFile(trace.threadId);
    await this.writeThreadFile(trace.threadId, {
      ...(current.thread === undefined ? {} : { thread: current.thread }),
      traces: [...current.traces, trace]
    });
  }

  async loadThread(threadId: string): Promise<JsonObject | undefined> {
    return (await this.readThreadFile(threadId)).thread;
  }

  async saveThread(threadId: string, snapshot: JsonObject): Promise<void> {
    const current = await this.readThreadFile(threadId);
    await this.writeThreadFile(threadId, {
      thread: snapshot,
      traces: current.traces
    });
  }

  async listThreads(): Promise<readonly JsonObject[]> {
    const dir = join(this.storageDir, "threads");
    const files = await readdir(dir).catch(() => []);
    const threads: JsonObject[] = [];

    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const raw = await readFile(join(dir, file), "utf8");
      const parsed = JSON.parse(raw) as ThreadFile;

      if (parsed.thread !== undefined) {
        threads.push(parsed.thread);
      }
    }

    return threads;
  }
}
