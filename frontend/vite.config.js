import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const simpAgentProxyTarget =
  process.env.SIMPAGENT_PROXY_TARGET ?? 'http://127.0.0.1:8787'

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
