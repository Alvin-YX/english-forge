import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 手动编写 service-worker.ts，由 Vite 构建为 /service-worker.js
      strategies: 'injectManifest',
      registerType: 'autoUpdate',
      srcDir: 'src',
      filename: 'service-worker.ts',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: false, // 使用 public/manifest.json
      devOptions: {
        enabled: false,
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB 单资源上限
      },
    }),
  ],
  // 显式禁用 postcss 配置文件加载（Tailwind v4 通过 @tailwindcss/vite 插件处理，
  // 无需独立的 postcss.config.* 文件；避免 Vite 尝试用 ts-node 加载遗留的 .ts 配置）。
  css: {
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1024,
    // SW 需要 target es2020+ 以支持缓存 API 与可选链
    target: 'es2020',
  },
});
