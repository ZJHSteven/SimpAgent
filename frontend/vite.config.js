import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const simpAgentProxyTarget =
  // 前端默认直接代理到 SimpAgent 后端的新默认端口 8788。
  // 如果本机需要改端口，仍然可以通过 SIMPAGENT_PROXY_TARGET 覆盖。
  process.env.SIMPAGENT_PROXY_TARGET ?? 'http://127.0.0.1:8788'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: simpAgentProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
