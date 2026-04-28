/**
 * 本文件是 Node runtime 的 SQLite 薄适配层。
 *
 * 分层边界：
 * - `agent-core` 负责 SQLite schema、trace 拆分、tag 关系表和脱敏规则。
 * - `runtime-node` 只负责 Node 本地能力：创建目录、打开 `node:sqlite`、关闭句柄。
 * - 这样未来 Cloudflare Worker / Tauri 可以实现自己的 SQL executor，复用同一套 core 存储语义。
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  DEFAULT_SQLITE_FILE_NAME,
  SqliteTraceStore as CoreSqliteTraceStore,
  type SqlDatabase,
  type SqlParameter,
  type SqlStatement
} from "@simpagent/agent-core";

/**
 * 将 Node 内置 `StatementSync` 包成 core 所需的最小 statement 接口。
 *
 * 输入：
 * - statement: `node:sqlite` 返回的同步 statement。
 *
 * 输出：
 * - `SqlStatement`，只暴露 run/get/all 三种能力。
 *
 * 核心逻辑：
 * - 类型转换只发生在 runtime-node，避免 `agent-core` 引入 Node 专属类型。
 */
class NodeSqliteStatement implements SqlStatement {
  constructor(private readonly statement: StatementSync) {}

  run(...parameters: readonly SqlParameter[]): unknown {
    return this.statement.run(...parameters);
  }

  get(...parameters: readonly SqlParameter[]): unknown {
    return this.statement.get(...parameters);
  }

  all(...parameters: readonly SqlParameter[]): readonly unknown[] {
    return this.statement.all(...parameters) as readonly unknown[];
  }
}

/**
 * 将 Node 内置 `DatabaseSync` 包成 core 所需的最小 database 接口。
 */
class NodeSqliteDatabase implements SqlDatabase {
  constructor(private readonly db: DatabaseSync) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    return new NodeSqliteStatement(this.db.prepare(sql));
  }
}

/**
 * Node 版 SQLite TraceStore。
 *
 * 输入：
 * - storageDir: 存储目录，通常来自 `simpagent.toml`。
 *
 * 输出：
 * - 一个可直接给 CLI/server 使用的 TraceStore。
 *
 * 核心逻辑：
 * - 本类只打开本地 SQLite 文件，然后把执行器交给 `agent-core` 的 `CoreSqliteTraceStore`。
 */
export class SqliteTraceStore extends CoreSqliteTraceStore {
  readonly databasePath: string;
  private readonly nativeDb: DatabaseSync;

  constructor(storageDir: string) {
    mkdirSync(storageDir, { recursive: true });
    const databasePath = join(storageDir, DEFAULT_SQLITE_FILE_NAME);
    const db = new DatabaseSync(databasePath);

    super(new NodeSqliteDatabase(db));

    this.databasePath = databasePath;
    this.nativeDb = db;
  }

  /**
   * 关闭 SQLite 句柄。
   *
   * 测试里显式关闭可以避免 Windows 临时目录清理时遇到文件占用。
   */
  close(): void {
    this.nativeDb.close();
  }
}
