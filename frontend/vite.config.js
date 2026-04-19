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
    /*
     * 开发服务器监听地址说明：
     * - 之前如果只监听 ::1 或只监听 127.0.0.1，浏览器访问 localhost 时可能先尝试另一个地址族。
     * - Windows 上这种 IPv4/IPv6 回退常见表现就是首页 HTML 请求“连接”阶段卡 2 秒左右。
     * - 绑定到 :: 可以让 Vite 同时接受 IPv6 与 IPv4 连接，避免 localhost/127.0.0.1 表现不一致。
     */
    host: '::',
    proxy: {
      '/api': {
        target: simpAgentProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
