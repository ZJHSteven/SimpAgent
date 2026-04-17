/**
 * Tauri runtime 占位入口。
 * 后续将通过前端 WebView 与 Rust 后端桥接实现文件、命令与审批能力。
 */
import type { RuntimeServices } from "@simpagent/agent-core";

/**
 * 创建 Tauri runtime。
 * 当前阶段先抛出明确错误，提醒调用方该 runtime 尚未落地。
 */
export function createTauriRuntime(): RuntimeServices {
  throw new Error("runtime-tauri 首版只保留接口占位，后续通过 Tauri 前端与 Rust 后端 bridge 实现。");
}

