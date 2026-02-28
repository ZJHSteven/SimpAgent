/**
 * 本文件作用：
 * - 实现三层配置合并：Preset + User Override + Runtime Patch。
 *
 * 规则：
 * - 优先级固定为 Runtime Patch > User Override > Preset。
 * - 采用对象深合并（数组直接覆盖，避免语义歧义）。
 */

import type { JsonValue } from "../types/index.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch?: Partial<T> | null): T {
  if (!patch) return base;
  if (!isObject(base) || !isObject(patch)) return (patch as T) ?? base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, val] of Object.entries(patch as Record<string, unknown>)) {
    const prev = result[key];
    if (isObject(prev) && isObject(val)) {
      result[key] = deepMerge(prev, val);
      continue;
    }
    result[key] = val;
  }
  return result as T;
}

/**
 * 合并三层配置。
 */
export function resolveThreeLayerConfig<T extends JsonValue>(layers: {
  preset: T;
  userOverride?: Partial<T> | null;
  runtimePatch?: Partial<T> | null;
}): T {
  const withUser = deepMerge(layers.preset, layers.userOverride);
  return deepMerge(withUser, layers.runtimePatch);
}
