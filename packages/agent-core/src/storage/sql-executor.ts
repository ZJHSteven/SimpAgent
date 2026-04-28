/**
 * 本文件定义跨 runtime 的 SQLite 执行接口。
 *
 * 设计目的：
 * - `agent-core` 应该拥有表结构、事件拆分、trace 映射这些框架语义。
 * - `agent-core` 不应该直接 import `node:sqlite`，否则 Cloudflare Worker、Tauri 等 runtime 无法复用。
 * - 因此这里抽象出一个极薄的 SQL 执行层：core 只知道可以执行 SQL、准备 statement、传入基础参数。
 */

/**
 * SQLite 绑定参数的最小公共集合。
 *
 * 说明：
 * - 当前 schema 只写入 string / number / null。
 * - 暂不把 Buffer、Uint8Array 放进公共接口，避免把 Node 专属类型泄漏到 core。
 */
export type SqlParameter = string | number | null;

/**
 * 已准备好的 SQL statement。
 *
 * 输入：
 * - parameters: SQLite 占位符参数，顺序对应 SQL 中的 `?`。
 *
 * 输出：
 * - `run()` 用于 INSERT/UPDATE/DELETE，不关心返回结构。
 * - `get()` 用于读取单行。
 * - `all()` 用于读取多行。
 *
 * 核心逻辑：
 * - 这是 runtime driver 的最小能力合集。
 * - Node、Cloudflare D1、Tauri SQLite 都可以各自适配到这个形状。
 */
export interface SqlStatement {
  run(...parameters: readonly SqlParameter[]): unknown;
  get(...parameters: readonly SqlParameter[]): unknown;
  all(...parameters: readonly SqlParameter[]): readonly unknown[];
}

/**
 * SQLite 数据库执行器。
 *
 * 输入：
 * - sql: 原始 SQL 字符串。
 *
 * 输出：
 * - `exec()` 直接执行一段 SQL，适合 schema 初始化和事务命令。
 * - `prepare()` 返回可重复执行的 statement。
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}
