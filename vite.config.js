import { defineConfig } from 'vite';

export default defineConfig({
  // 部署在 GitHub Pages 子路径 /dynasty-map/
  base: '/dynasty-map/',
  // data/ 整体作为静态目录：开发与构建后均以根路径直接 fetch
  publicDir: 'data',
});
