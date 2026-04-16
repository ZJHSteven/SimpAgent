import type { RuntimeServices } from "@simpagent/agent-core";

export function createTauriRuntime(): RuntimeServices {
  throw new Error("runtime-tauri 首版只保留接口占位，后续通过 Tauri 前端与 Rust 后端 bridge 实现。");
}

