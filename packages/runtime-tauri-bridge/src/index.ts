/**
 * 本文件作用：
 * - 定义 Tauri 前端侧桥接契约（TypeScript）。
 * - 统一前端调用原生命令的入口，避免业务代码直接散落 `invoke` 字符串。
 *
 * 教学说明：
 * - 该包不承载服务器逻辑；
 * - 只负责“命令协议 + 调用封装 + mock 能力”。
 */

import { resolveThreeLayerConfig } from "@simpagent/core/config";

/**
 * Tauri invoke 函数签名。
 */
export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * 桥接层命令清单：
 * - 命令名与参数结构统一集中管理，避免硬编码分散在 UI 代码里。
 */
export interface TauriBridge {
  health(): Promise<{ ok: boolean; runtime: "tauri"; now: string }>;
  loadConfig(key: string): Promise<unknown>;
  saveConfig(key: string, value: unknown): Promise<void>;
  createRun(input: Record<string, unknown>): Promise<{ runId: string; status: string }>;
  getRun(runId: string): Promise<unknown>;
  resolveConfigLayers<T>(layers: {
    preset: T;
    userOverride?: Partial<T> | null;
    runtimePatch?: Partial<T> | null;
  }): T;
}

/**
 * 创建真实桥接实例（调用 Tauri 原生命令）。
 */
export function createTauriBridge(invoke: TauriInvoke): TauriBridge {
  return {
    health: () => invoke("simpagent_health"),
    loadConfig: (key) => invoke("simpagent_load_config", { key }),
    saveConfig: (key, value) => invoke("simpagent_save_config", { key, value }).then(() => undefined),
    createRun: (input) => invoke("simpagent_create_run", { input }),
    getRun: (runId) => invoke("simpagent_get_run", { runId }),
    resolveConfigLayers<T>(layers: { preset: T; userOverride?: Partial<T> | null; runtimePatch?: Partial<T> | null }): T {
      return resolveThreeLayerConfig({
        preset: layers.preset as any,
        userOverride: (layers.userOverride ?? null) as any,
        runtimePatch: (layers.runtimePatch ?? null) as any
      }) as T;
    }
  };
}

/**
 * 创建 mock 桥接实例（用于前端本地开发与测试）。
 */
export function createMockTauriBridge(): TauriBridge {
  const configStore = new Map<string, unknown>();
  const runStore = new Map<string, unknown>();
  return {
    async health() {
      return { ok: true, runtime: "tauri", now: new Date().toISOString() };
    },
    async loadConfig(key: string) {
      return configStore.get(key) ?? null;
    },
    async saveConfig(key: string, value: unknown) {
      configStore.set(key, value);
    },
    async createRun(input: Record<string, unknown>) {
      const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const row = { runId, status: "created", input, createdAt: new Date().toISOString() };
      runStore.set(runId, row);
      return { runId, status: "created" };
    },
    async getRun(runId: string) {
      return runStore.get(runId) ?? null;
    },
    resolveConfigLayers<T>(layers: { preset: T; userOverride?: Partial<T> | null; runtimePatch?: Partial<T> | null }): T {
      return resolveThreeLayerConfig({
        preset: layers.preset as any,
        userOverride: (layers.userOverride ?? null) as any,
        runtimePatch: (layers.runtimePatch ?? null) as any
      }) as T;
    }
  };
}
