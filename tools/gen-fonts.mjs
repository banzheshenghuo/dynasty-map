// 楷体字体资源管线：lxgw-wenkai-webfont（npm, OFL）→ MapLibre v6 style.fontFaces 声明
// 产物（均在 data/，渲染资源目录，validate 豁免，见 data/SCHEMA.md）：
//   data/fonts/lxgw/*.woff2       —— regular 全部 97 个 unicode-range 分片（~5MB，浏览器按需懒加载）
//   data/fonts/lxgw/faces.json    —— { "LXGW WenKai": [{url, unicode-range}...] }，map.js fetch 后并入 style
// 说明：MapLibre v6 的 fontFaces 机制走浏览器 FontFace API（同 CSS @font-face），
//   按声明的 unicode-range 懒加载分片；加载失败的码位逐级回落：下一分片 → glyphs URL → localIdeographFontFamily（楷体栈兜底）
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('lxgw-wenkai-webfont/package.json');
const cssPath = require.resolve('lxgw-wenkai-webfont/lxgwwenkai-regular.css');
const filesDir = new URL('../node_modules/lxgw-wenkai-webfont/files/', import.meta.url).pathname;
const OUT_DIR = new URL('../data/fonts/lxgw/', import.meta.url);

// 解析 regular CSS 的 @font-face：url + unicode-range 列表
const css = readFileSync(cssPath, 'utf8');
const faces = [...css.matchAll(/url\('\.\/(files\/[^']+)'\)[^}]*unicode-range:\s*([^}]+)}/g)].map(([, file, ranges]) => ({
  url: `fonts/lxgw/${file.split('/').pop()}`,
  'unicode-range': ranges.trim().split(/,\s*/),
}));

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// 仅拷 regular 分片（bold/light/mono 不用）
const regular = readdirSync(filesDir).filter(f => f.startsWith('lxgwwenkai-regular-'));
for (const f of regular) cpSync(`${filesDir}/${f}`, `${OUT_DIR.pathname}/${f}`);

writeFileSync(
  `${OUT_DIR.pathname}faces.json`,
  JSON.stringify({ 'LXGW WenKai': faces }, null, 0)
);

console.log(`lxgw-wenkai-webfont v${pkg.version}：${faces.length} 个分片（${regular.length} 个 woff2）→ ${OUT_DIR.pathname}`);
