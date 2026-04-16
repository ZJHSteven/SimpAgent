import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts"
    ],
    exclude: [
      "**/dist/**",
      "**/node_modules/**"
    ],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: [
        "packages/**/src/**/*.ts",
        "apps/**/src/**/*.ts"
      ],
      exclude: [
        "**/dist/**",
        "**/*.test.ts"
      ]
    }
  }
});
