import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// maplibre-gl v6 的 worker 以 new URL('./maplibre-gl-worker.mjs', import.meta.url)
// 动态构造，rollup 不跟随该引用发射产物（dist 缺文件 → 运行时 404 → 地图空白）。
// 这里把 worker 及其依赖的 shared 包以原名发射到 assets/，与运行时 URL 对齐
const maplibreWorkerAssets = () => ({
  name: 'maplibre-worker-assets',
  generateBundle() {
    for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
      this.emitFile({
        type: 'asset',
        fileName: `assets/${f}`,
        source: readFileSync(resolve('node_modules/maplibre-gl/dist', f)),
      });
    }
  },
});

export default defineConfig({
  // 部署在 GitHub Pages 子路径 /dynasty-map/
  base: '/dynasty-map/',
  // data/ 整体作为静态目录：开发与构建后均以根路径直接 fetch
  publicDir: 'data',
  // maplibre-gl 的 worker 以相对 import.meta.url 构造 URL，预打包会丢失
  // worker 文件（.vite/deps 下 404）；排除后浏览器直取 dist 原始 ESM
  optimizeDeps: { exclude: ['maplibre-gl'] },
  plugins: [maplibreWorkerAssets()],
});
