import { defineConfig } from "vitest/config";

/**
 * 真 LLM smoke test 专用配置。
 *
 * 设计目标：
 * 1) 只收集以 `.smoke.test.ts` 结尾的测试文件，避免污染日常单元测试。
 * 2) 允许把真实厂商 API 测试单独放大超时时间，防止网络抖动导致误报。
 * 3) 保留 node 环境，直接使用原生 fetch 调真实 API。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.smoke.test.ts",
      "apps/**/*.smoke.test.ts"
    ],
    exclude: [
      "**/dist/**",
      "**/node_modules/**"
    ],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 120000
  }
});
