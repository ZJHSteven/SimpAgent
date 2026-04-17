/*
 * 文件作用：
 * 这是 SimpChat React 前端的 Playwright 配置。
 *
 * 核心逻辑：
 * 1. webServer 会在测试前启动 Vite dev server。
 * 2. baseURL 让测试用 page.goto('/') 即可打开本地页面。
 * 3. trace/screenshot/video 只在失败时保留，避免正常测试产生太多临时文件。
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
