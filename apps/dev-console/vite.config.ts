import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 本文件作用：
 * - 提供框架调试台前端的 Vite 配置。
 * - 这里保持极简，只确保开发和构建链路稳定。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
});
