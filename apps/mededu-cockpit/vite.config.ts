import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 说明：
 * - 这里保持最小配置，优先确保可快速启动与构建。
 * - `host: true` 便于局域网设备预览截图效果（可按需关闭）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174
  }
});
