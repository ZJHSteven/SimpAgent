import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const simpAgentProxyTarget =
  process.env.SIMPAGENT_PROXY_TARGET ?? 'http://127.0.0.1:8787'

/*
 * ESM 路径说明：
 * 当前 package.json 设置了 "type": "module"，所以 vite.config.js 是 ES Module。
 * ES Module 里没有 CommonJS 的 __dirname，需要从 import.meta.url 还原当前文件目录。
 */
const configDir = path.dirname(fileURLToPath(import.meta.url))

/*
 * 文件作用：
 * 这个文件负责 Vite 开发服务器、Tailwind 4、React 插件和本地 API 代理配置。
 *
 * Tailwind 说明：
 * 当前 frontend 统一使用 Tailwind CSS 4.x。
 * Tailwind 4 的 Vite 官方推荐接入方式是 @tailwindcss/vite 插件；
 * 它不再依赖 Tailwind 3 的 tailwind.config.js + postcss.config.js 组合。
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(configDir, './src'),
    },
  },
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
