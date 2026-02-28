/**
 * 本文件作用：
 * - 运行时 Node 适配层直接复用 core 的公共类型契约。
 * - 避免 Node 层复制一份 contracts，防止类型漂移。
 */

export * from "@simpagent/core/types/contracts";
