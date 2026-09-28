#!/usr/bin/env node
/**
 * 数据构建管线 v2：时间断面制
 *  - 断面表 SNAPSHOTS 驱动：每断面 = 多政权疆域轮廓（手绘/historical-basemaps 锚点）
 *    + 政区（CHGIS V6 时序窗口：多边形 + 治所 Voronoi 兜底）+ 政权归属（轮廓空间划分）
 *  - 输出：data/timeline.json（断面索引+事件）+ data/geo/snap_*.json / snap_*-div.json
 *  - 现代轮廓：阿里 DataV；邻国：Natural Earth；省界：阿里 DataV（不变）
 *  - 事件：pessimistcamellia/china-history-map EVENTS 按时代归档，合并进 timeline.json
 *  - 旧 6 朝代断面（dynasties.json）保留为 legacy 输出，前端不再消费
 * 用法：node tools/build-data.mjs
 * 锚点/源数据获取：tools/fetch-sources.mjs；CHGIS 许可与引用见 tools/sources/README.md
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import polygonClipping from 'polygon-clipping';
import { Delaunay } from 'd3-delaunay';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = `${ROOT}tools/sources/`;
const RAW = `${SRC}raw/`;

const round2 = n => Math.round(n * 100) / 100;
const round3 = n => Math.round(n * 1000) / 1000;
const roundCoords = (c, r) => (typeof c[0] === 'number' ? [r(c[0]), r(c[1])] : c.map(x => roundCoords(x, r)));

async function fetchJson(url) {
  // raw.githubusercontent 间歇超时，用 jsdelivr gh 镜像兜底（同内容）
  const mirror = url.replace('https://raw.githubusercontent.com/', 'https://cdn.jsdelivr.net/gh/').replace('/master/', '@master/').replace('/main/', '@main/');
  const urls = mirror === url ? [url] : [url, mirror];
  let lastErr;
  for (const u of urls) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
    }
  }
  throw new Error(`fetch 失败 ${url}: ${lastErr.message}`);
}
const bbox = fc => {
  const mn = [999, 999], mx = [-999, -999];
  const walk = c => { if (typeof c[0] === 'number') {
    mn[0] = Math.min(mn[0], c[0]); mx[0] = Math.max(mx[0], c[0]);
    mn[1] = Math.min(mn[1], c[1]); mx[1] = Math.max(mx[1], c[1]);
  } else c.forEach(walk); };
  fc.features.forEach(f => walk(f.geometry.coordinates));
  return [mn, mx];
};

function unionAll(parts) {
  let u = null;
  for (const coords of parts) {
    try { u = u ? polygonClipping.union(u, coords) : coords; } catch { /* 脏多边形跳过 */ }
  }
  return u;
}
// 去掉环内连续重复点、非有限坐标（historical-basemaps 部分要素含 NaN 顶点，会毒化
// 整条 union/裁剪链）与退化环——这些脏数据会触发 polygon-clipping 崩溃或静默几何污染
function cleanGeom(coords) {
  const walk = c => (typeof c[0] === 'number' ? c : c.map(walk));
  const cleanRing = ring => {
    const out = [];
    for (const pt of ring) {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
      if (!out.length || pt[0] !== out[out.length - 1][0] || pt[1] !== out[out.length - 1][1]) out.push(pt);
    }
    return out.length >= 4 ? out : null;
  };
  const cleanPoly = poly => poly.map(cleanRing).filter(Boolean);
  return (typeof coords[0][0] === 'number' ? [cleanPoly(coords)] : coords.map(cleanPoly)).filter(p => p.length);
}

mkdirSync(`${ROOT}data/geo`, { recursive: true });
mkdirSync(`${ROOT}data/events`, { recursive: true });

// ── 政权配色：谭图式一政权一色，跨断面稳定（呈现参数，随 timeline.json 下发）──
const REGIME_COLORS = {
  '秦': '#6D5B8B', '汉': '#A6402F', '匈奴': '#8C8270', '南越': '#7A8A6A', '闽越': '#9A8A5A',
  '魏': '#46708F', '蜀汉': '#5F7D50', '吴': '#B07D2B',
  '西晋': '#96688F', '东晋': '#6B7FA3', '十六国': '#8C7A5E', '前秦': '#86748E',
  '北魏': '#5E7A6A', '南朝': '#A87A4A', '东魏': '#6A8A9A', '西魏': '#7A9A8A',
  '隋': '#8A5A7A', '唐': '#AE7C2A', '吐蕃': '#9A5A4A', '突厥': '#7A7A8A', '回鹘': '#8A8A6A',
  '南诏': '#6A9A8A', '渤海': '#5A7A9A', '五代十国': '#8C6D46', '契丹': '#7A5A6A',
  '辽': '#8A5A4A', '北宋': '#4E6E8E', '西夏': '#6A7A5A', '金': '#7A6A4A', '蒙古': '#9A7A5A',
  '元': '#46708F', '明': '#5F7D50', '南明': '#A87A4A', '清': '#3F7E76',
};

// ── 断面表：年份升序；weak=true 为边缘政权（渲染更淡、不参与政区归属）──────
// territories[].from: hand-*.json（手绘）| outline-three-k.json | world_YYYY.geojson 锚点
// divisions: {src:'qin'|'han_w'} 复用含谭图补点的既有窗口源；{window:Y} 从 CHGIS 全量按年切片
const HB = f => ({ kind: 'world', file: f });
const HAND = f => ({ kind: 'hand', file: f });
const SNAPSHOTS = [
  { id: 'sbc221', year: -221, era: '秦', label: '秦 · 统一六国',
    territories: [{ name: '秦', ...HAND('hand-qin.json') }],
    divisions: { src: 'qin' }, note: '约前221年（手绘轮廓+CHGIS V6 政区·谭图补点）' },
  { id: 'sbc202', year: -202, era: '西汉', label: '西汉 · 高帝分封',
    territories: [
      { name: '汉', ...HB('world_bc200.geojson'), match: /^Han( Empire)?$/ },
      { name: '南越', ...HB('world_bc200.geojson'), match: /^Nan-Yue$/, weak: true },
      { name: '闽越', ...HB('world_bc200.geojson'), match: /^Min-Yue$/, weak: true },
      { name: '匈奴', ...HB('world_bc200.geojson'), match: /^Xiongnu$/, weak: true },
    ],
    divisions: { window: -202 }, note: '约前202年（historical-basemaps 轮廓+CHGIS V6 政区）' },
  { id: 'sbc87', year: -87, era: '西汉', label: '西汉 · 武帝末',
    territories: [
      { name: '汉', ...HB('world_bc100.geojson'), match: /^Han( Empire)?$/ },
      { name: '匈奴', ...HB('world_bc100.geojson'), match: /^Xiongnu$/, weak: true },
    ],
    divisions: { window: -87 }, note: '约前87年（同上）' },
  { id: 'sbc1', year: -1, era: '西汉', label: '西汉 · 末年',
    territories: [{ name: '汉', ...HAND('hand-han_w.json') }],
    divisions: { src: 'han_w' }, note: '约公元1年（手绘轮廓+CHGIS V6 政区·谭图补点）' },
  { id: 's100', year: 100, era: '东汉', label: '东汉 · 和帝后',
    territories: [
      { name: '汉', ...HB('world_100.geojson'), match: /^Han( Empire)?$/ },
      { name: '匈奴', ...HB('world_100.geojson'), match: /Xiongnu$/, weak: true },
    ],
    divisions: { window: 100 }, note: '约100年（同上）' },
  { id: 's184', year: 184, era: '东汉', label: '东汉 · 黄巾之前',
    territories: [{ name: '汉', ...HB('world_200.geojson'), match: /^Han( Empire)?$/ }],
    divisions: { window: 184 }, note: '约184年（同上）' },
  { id: 's223', year: 223, era: '三国', label: '三国 · 夷陵之后',
    territories: [
      { name: '魏', ...HAND('outline-three-k.json'), match: /^魏$/ },
      { name: '蜀汉', ...HAND('outline-three-k.json'), match: /^蜀汉$/ },
      { name: '吴', ...HAND('outline-three-k.json'), match: /^吴$/ },
    ],
    divisions: { window: 223, attribute: true }, note: '约223年（魏蜀吴轮廓为手绘示意+CHGIS V6 政区）' },
  { id: 's280', year: 280, era: '西晋', label: '西晋 · 统一',
    territories: [{ name: '西晋', ...HB('world_300.geojson'), match: /^Jin$/ }],
    divisions: { window: 280 }, note: '约280年（同上）' },
  { id: 's340', year: 340, era: '东晋十六国', label: '东晋 · 十六国并立',
    territories: [
      { name: '东晋', ...HB('world_400.geojson'), match: /^Jin$/ },
      { name: '十六国', ...HB('world_400.geojson'), match: /^(Sixteen Kingdoms|Northern Liang|Han Zhao)$/, weak: true },
    ],
    divisions: { window: 340, attribute: true }, note: '约340年（同上）' },
  { id: 's385', year: 385, era: '东晋十六国', label: '前秦 · 淝水前夕',
    territories: [
      { name: '东晋', ...HB('world_400.geojson'), match: /^Jin$/ },
      { name: '前秦', ...HB('world_400.geojson'), match: /^(Sixteen Kingdoms|Northern Liang|Han Zhao)$/ },
    ],
    divisions: { window: 385, attribute: true }, note: '约385年（同上）' },
  { id: 's450', year: 450, era: '南北朝', label: '南北朝 · 宋魏对峙',
    territories: [
      { name: '北魏', ...HB('world_500.geojson'), match: /^Toba Wei$/ },
      { name: '南朝', ...HB('world_500.geojson'), match: /^Jin Empire$/ },
    ],
    divisions: { window: 450, attribute: true }, note: '约450年（同上）' },
  { id: 's540', year: 540, era: '南北朝', label: '南北朝 · 梁与东西魏',
    territories: [
      { name: '东魏', ...HB('world_500.geojson'), match: /^Toba Wei$/ },
      { name: '南朝', ...HB('world_500.geojson'), match: /^Jin Empire$/ },
    ],
    divisions: { window: 540, attribute: true }, note: '约540年（东魏/西魏未分，以北方统一示意）' },
  { id: 's589', year: 589, era: '隋', label: '隋 · 统一',
    territories: [{ name: '隋', ...HB('world_600.geojson'), match: /^Sui Empire$/ }],
    divisions: { window: 589 }, note: '约589年（同上）' },
  { id: 's617', year: 617, era: '隋', label: '隋 · 末年',
    territories: [{ name: '隋', ...HB('world_600.geojson'), match: /^Sui Empire$/ }],
    divisions: { window: 617 }, note: '约617年（群雄并立未分，以隋名义版图示意）' },
  { id: 's669', year: 669, era: '唐', label: '唐 · 高宗朝',
    territories: [
      { name: '唐', ...HAND('hand-tang.json') },
      { name: '吐蕃', ...HB('world_700.geojson'), match: /^Tufan Empire$/, weak: true },
      { name: '突厥', ...HB('world_700.geojson'), match: /Gokturk/i, weak: true },
    ],
    divisions: { window: 669 }, note: '约669年（手绘轮廓+CHGIS V6 政区）' },
  { id: 's741', year: 741, era: '唐', label: '唐 · 开元盛世',
    territories: [
      { name: '唐', ...HAND('hand-tang.json') },
      { name: '吐蕃', ...HB('world_700.geojson'), match: /^Tufan Empire$/, weak: true },
    ],
    divisions: { window: 741 }, note: '约741年（同上）' },
  { id: 's780', year: 780, era: '唐', label: '唐 · 安史之后',
    territories: [
      { name: '唐', ...HB('world_800.geojson'), match: /^Tang Empire$/ },
      { name: '吐蕃', ...HB('world_800.geojson'), match: /^Tibetan Empire$/, weak: true },
      { name: '回鹘', ...HB('world_800.geojson'), match: /^Uyghurs$/, weak: true },
      { name: '南诏', ...HB('world_800.geojson'), match: /^Nan Chao$/, weak: true },
      { name: '渤海', ...HB('world_800.geojson'), match: /^Parhae$/, weak: true },
    ],
    divisions: { window: 780, attribute: true }, note: '约780年（historical-basemaps 轮廓+CHGIS V6 政区）' },
  { id: 's850', year: 850, era: '唐', label: '唐 · 晚唐',
    territories: [
      { name: '唐', ...HB('world_800.geojson'), match: /^Tang Empire$/ },
      { name: '吐蕃', ...HB('world_800.geojson'), match: /^Tibetan Empire$/, weak: true },
      { name: '回鹘', ...HB('world_800.geojson'), match: /^Uyghurs$/, weak: true },
      { name: '南诏', ...HB('world_800.geojson'), match: /^Nan Chao$/, weak: true },
    ],
    divisions: { window: 850, attribute: true }, note: '约850年（同上）' },
  { id: 's908', year: 908, era: '五代十国', label: '五代十国 · 后梁',
    territories: [
      { name: '五代十国', ...HB('world_900.geojson'), match: /^Tang Empire$/ },
      { name: '契丹', ...HB('world_900.geojson'), match: /^Khitans$/, weak: true },
    ],
    divisions: { window: 908 }, note: '约908年（十国并立未分，以中原王朝名义版图示意）' },
  { id: 's943', year: 943, era: '五代十国', label: '五代十国 · 后晋',
    territories: [
      { name: '五代十国', ...HB('world_900.geojson'), match: /^Tang Empire$/ },
      { name: '契丹', ...HB('world_900.geojson'), match: /^Khitans$/, weak: true },
    ],
    divisions: { window: 943 }, note: '约943年（同上）' },
  { id: 's979', year: 979, era: '辽北宋', label: '北宋 · 统一',
    territories: [
      { name: '北宋', ...HB('world_1000.geojson'), match: /^Song Empire$/ },
      { name: '辽', ...HB('world_1000.geojson'), match: /^Liao$/, weak: true },
    ],
    divisions: { window: 979, attribute: true }, note: '约979年（同上）' },
  { id: 's1004', year: 1004, era: '辽北宋', label: '辽北宋 · 澶渊之盟',
    territories: [
      { name: '北宋', ...HB('world_1000.geojson'), match: /^Song Empire$/ },
      { name: '辽', ...HB('world_1000.geojson'), match: /^Liao$/, weak: true },
      { name: '西夏', ...HB('world_1000.geojson'), match: /^Xixia$/, weak: true },
    ],
    divisions: { window: 1004, attribute: true }, note: '约1004年（同上）' },
  { id: 's1110', year: 1110, era: '辽北宋', label: '北宋 · 末年',
    territories: [
      { name: '北宋', ...HB('world_1100.geojson'), match: /^Song Empire$/ },
      { name: '辽', ...HB('world_1100.geojson'), match: /^Liao$/, weak: true },
      { name: '西夏', ...HB('world_1100.geojson'), match: /^Xixia$/, weak: true },
    ],
    divisions: { window: 1110, attribute: true }, note: '约1110年（同上）' },
  { id: 's1141', year: 1141, era: '金南宋', label: '金南宋 · 绍兴和议',
    territories: [
      { name: '南宋', ...HB('world_1200.geojson'), match: /^Song Empire$/ },
      { name: '金', ...HB('world_1200.geojson'), match: /^Liao$/ },
      { name: '西夏', ...HB('world_1200.geojson'), match: /^Xixia$/, weak: true },
      { name: '蒙古', ...HB('world_1200.geojson'), match: /^Mongol Empire$/, weak: true },
    ],
    divisions: { window: 1141, attribute: true }, note: '约1141年（historical-basemaps 将金误标 Liao，已归位）' },
  { id: 's1206', year: 1206, era: '金南宋', label: '金南宋 · 蒙古崛起',
    territories: [
      { name: '南宋', ...HB('world_1200.geojson'), match: /^Song Empire$/ },
      { name: '金', ...HB('world_1200.geojson'), match: /^Liao$/ },
      { name: '西夏', ...HB('world_1200.geojson'), match: /^Xixia$/, weak: true },
      { name: '蒙古', ...HB('world_1200.geojson'), match: /^Mongol Empire$/, weak: true },
    ],
    divisions: { window: 1206, attribute: true }, note: '约1206年（同上）' },
  { id: 's1279', year: 1279, era: '元', label: '元 · 灭南宋',
    territories: [
      { name: '元', ...HAND('hand-yuan.json') },
      { name: '察合台汗国', ...HB('world_1279.geojson'), match: /^Chagatai Khanate$/, weak: true },
    ],
    divisions: { window: 1279 }, note: '约1279年（手绘轮廓+CHGIS V6 政区）' },
  { id: 's1350', year: 1350, era: '元', label: '元 · 末年',
    territories: [
      { name: '元', ...HB('world_1300.geojson'), match: /^Great Khanate$/ },
      { name: '察合台汗国', ...HB('world_1300.geojson'), match: /^Chagatai Khanate$/, weak: true },
    ],
    divisions: { window: 1350 }, note: '约1350年（同上）' },
  { id: 's1368', year: 1368, era: '明', label: '明 · 开国',
    territories: [{ name: '明', ...HB('world_1492.geojson'), match: /^Ming Empire$/ }],
    divisions: { window: 1368 }, note: '约1368年（historical-basemaps 轮廓+CHGIS V6 政区）' },
  { id: 's1433', year: 1433, era: '明', label: '明 · 前期',
    territories: [{ name: '明', ...HB('world_1492.geojson'), match: /^Ming Empire$/ }],
    divisions: { window: 1433 }, note: '约1433年（同上）' },
  { id: 's1550', year: 1550, era: '明', label: '明 · 中期',
    territories: [{ name: '明', ...HB('world_1530.geojson'), match: /^Ming Chinese Empire$/ }],
    divisions: { window: 1550 }, note: '约1550年（同上）' },
  { id: 's1600', year: 1600, era: '明', label: '明 · 晚明',
    territories: [{ name: '明', ...HB('world_1600.geojson'), match: /^Ming Chinese Empire$/ }],
    divisions: { window: 1600 }, note: '约1600年（同上）' },
  { id: 's1644', year: 1644, era: '清', label: '清 · 入关',
    territories: [
      { name: '清', ...HB('world_1650.geojson'), match: /^Manchu Empire$/ },
      { name: '南明', ...HB('world_1650.geojson'), match: /^Post-Ming Warlords$/, weak: true },
    ],
    divisions: { window: 1644, attribute: true }, note: '约1644年（同上）' },
  { id: 's1684', year: 1684, era: '清', label: '清 · 收台湾',
    territories: [{ name: '清', ...HB('world_1700.geojson'), match: /^Manchu Empire$/ }],
    divisions: { window: 1684 }, note: '约1684年（同上）' },
  { id: 's1759', year: 1759, era: '清', label: '清 · 极盛',
    territories: [{ name: '清', ...HB('world_1783.geojson'), match: /^Qing Empire$/ }],
    divisions: { window: 1759 }, note: '约1759年（同上）' },
  { id: 's1820', year: 1820, era: '清', label: '清 · 极盛期',
    territories: [{ name: '清', ...HB('world_1800.geojson'), match: /^(Qing|Manchu)( Empire)?$/ }],
    divisions: { window: 1820 }, note: '约1820年（同上）' },
  { id: 's1860', year: 1860, era: '清', label: '清 · 二次鸦片之后',
    territories: [{ name: '清', ...HB('world_1878.geojson'), match: /^Manchu Empire$/ }],
    divisions: { window: 1860 }, note: '约1860年（同上）' },
  { id: 's1894', year: 1894, era: '清', label: '清 · 甲午前夕',
    territories: [{ name: '清', ...HB('world_1900.geojson'), match: /^Manchu Empire$/ }],
    divisions: { window: 1894 }, note: '约1894年（同上）' },
  { id: 's1911', year: 1911, era: '清', label: '清 · 末年',
    territories: [{ name: '清', ...HB('world_1900.geojson'), match: /^Manchu Empire$/ }],
    divisions: { window: 1911 }, note: '约1911年（同上）' },
];

// ── 源载入：CHGIS 全量时序 + 锚点断面 + 手绘轮廓 ──────────────
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const chgisPgn = readJson(`${SRC}chgis-v6-time-pgn.json`);
const chgisPts = readJson(`${SRC}chgis-v6-time-pts.json`);
const anchorCache = new Map();
const loadAnchor = file => {
  if (!anchorCache.has(file)) {
    const p = RAW + file;
    if (!existsSync(p)) throw new Error(`锚点文件缺失：${file}（先运行 tools/fetch-sources.mjs）`);
    anchorCache.set(file, readJson(p));
  }
  return anchorCache.get(file);
};

// ── 政区：CHGIS 窗口切片（多边形 + 治所 Voronoi 兜底）+ 政权归属 ──
const normUnit = f => ({
  name: f.properties.NAME_CH || f.properties.name,
  type: f.properties.TYPE_CH || f.properties.type_ch || '',
  geometry: f.geometry,
});
const windowUnits = (src, year) =>
  src.features
    .filter(f => f.properties.BEG_YR <= year && (f.properties.END_YR >= year || !f.properties.END_YR))
    .map(normUnit);
const LEGACY_DIV_SRC = {
  qin: { pgn: 'chgis-v6-qin-pgn.json', pts: 'chgis-v6-qin-pts.json' },
  han_w: { pgn: 'chgis-v6-han_w-pgn.json', pts: 'chgis-v6-han_w-pts.json' },
};
const legacyUnits = id => {
  const s = LEGACY_DIV_SRC[id];
  return {
    pgn: readJson(`${SRC}${s.pgn}`).features.map(f => ({
      name: f.properties.name, type: f.properties.type_ch || '', geometry: f.geometry,
    })),
    pts: readJson(`${SRC}${s.pts}`).features.map(f => ({
      name: f.properties.name, type: f.properties.type_ch || '', geometry: f.geometry,
    })),
  };
};

const toMulti = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const pointInRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const centroid = coords => {
  let sx = 0, sy = 0, n = 0;
  const walk = c => { if (typeof c[0] === 'number') { sx += c[0]; sy += c[1]; n++; return; } c.forEach(walk); };
  walk(coords);
  return n ? [sx / n, sy / n] : null;
};

// 单元 → 政权归属：质心落入哪个政权轮廓即归属；都不落则取质心最近者
function makeAttributor(adminTerritories) {
  if (adminTerritories.length <= 1) return () => adminTerritories[0]?.name || '';
  const tests = adminTerritories.map(t => ({
    name: t.name,
    polys: toMulti(t.geometry),
    center: centroid(t.geometry.coordinates),
  }));
  return (x, y) => {
    for (const t of tests) {
      for (const poly of t.polys) {
        if (!pointInRing(x, y, poly[0])) continue;
        let hole = false;
        for (let h = 1; h < poly.length; h++) if (pointInRing(x, y, poly[h])) { hole = true; break; }
        if (!hole) return t.name;
      }
    }
    let best = null, bd = Infinity;
    for (const t of tests) {
      if (!t.center) continue;
      const d = (t.center[0] - x) ** 2 + (t.center[1] - y) ** 2;
      if (d < bd) { bd = d; best = t.name; }
    }
    return best || '';
  };
}

function buildDivisions(cfg, adminTerritories, snapId) {
  const units = cfg.src ? legacyUnits(cfg.src) : {
    pgn: windowUnits(chgisPgn, cfg.window),
    pts: windowUnits(chgisPts, cfg.window),
  };
  const attribute = cfg.attribute ? makeAttributor(adminTerritories) : () => adminTerritories[0]?.name || '';
  const regimeOf = adminTerritories[0]?.name || '';
  const q2 = c => (typeof c[0] === 'number' ? [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100] : c.map(q2));
  // 疆域（归属域）= 各归属政权轮廓并集，量化 round2 避免近重合边触发裁剪崩溃
  const territory = unionAll(adminTerritories.map(t => cleanGeom(q2(toMulti(t.geometry)))));
  const feats = [];
  // 多边形单元：CHGIS 有数字化界线者直接采用并归属
  for (const u of units.pgn) {
    const multi = cleanGeom(q2(toMulti(u.geometry)));
    if (!multi.length) continue;
    const c = centroid(u.geometry.coordinates);
    feats.push({
      type: 'Feature',
      properties: { name: u.name, layer: 'division', type: u.type, regime: cfg.attribute ? attribute(c[0], c[1]) : regimeOf },
      geometry: { type: 'MultiPolygon', coordinates: multi },
    });
  }
  // 点位单元：治所 Voronoi 胞元 ∩（疆域 − 多边形单元）。
  // 粗锚点轮廓常缺边区（如河西走廊）：裁剪域并入 CHGIS 多边形单元与治所凸包兜底
  if (units.pts.length) {
    const seGeoms = feats.map(f => f.geometry.coordinates);
    const seats = units.pts.map(f => f.geometry.coordinates);
    const delaunay = Delaunay.from(seats);
    let clipDomain = territory;
    try {
      // delaunay.hull 是属性（Uint32Array 逆时针顶点索引）；须 Array.from 解包，Uint32Array.map 会强转回调返回值
      const hullRing = Array.from(delaunay.hull, i => seats[i]);
      if (hullRing.length >= 3) {
        hullRing.push([...hullRing[0]]);
        // 多面嵌套为 [多面[多边形[环]]]，凸包是单环单面 → [[hullRing]]；多包一层会被 polygon-clipping 拒收并静默退化为锚点轮廓
        clipDomain = polygonClipping.union(territory, [[hullRing]]) ?? territory;
      }
    } catch { /* 凸包兜底失败则仅用锚点轮廓 */ }
    let remainder = null;
    try { remainder = polygonClipping.difference(clipDomain, unionAll(seGeoms)); }
    catch { console.warn(`  ${snapId}: 整体 difference 失败，退化为逐胞元裁剪`); }
    const [mn, mx] = bbox({ type: 'FeatureCollection', features: [{ geometry: { type: 'MultiPolygon', coordinates: clipDomain } }] });
    const vor = delaunay.voronoi([mn[0] - 2, mn[1] - 2, mx[0] + 2, mx[1] + 2]);
    // 州与治所郡常同城（坐标重复致 Delaunay 胞元为 null）：同坐标组共享首个非空胞元
    const rawCells = units.pts.map((_, i) => vor.cellPolygon(i));
    const byCoord = new Map();
    units.pts.forEach((u, i) => {
      const key = u.geometry.coordinates.map(v => Math.round(v * 100)).join(',');
      if (!byCoord.has(key)) byCoord.set(key, []);
      byCoord.get(key).push(i);
    });
    const cells = units.pts.map((_, i) => rawCells[i]);
    for (const group of byCoord.values()) {
      const shared = group.map(i => rawCells[i]).find(Boolean);
      if (shared) for (const i of group) cells[i] = shared;
    }
    units.pts.forEach((u, i) => {
      const cell = cells[i];
      if (!cell) return console.warn(`  ${snapId}·${u.name}: 无胞元，跳过`);
      const ring = cell.slice(0, cell.length - 1);
      let clipped;
      try {
        clipped = polygonClipping.intersection([ring], remainder ?? clipDomain);
        if (!remainder && clipped?.length) {
          for (const g of seGeoms) {
            if (!clipped.length) break;
            try { clipped = polygonClipping.difference(clipped, g); } catch {
              console.warn(`  ${snapId}·${u.name}: 减去既有政区失败，保留重叠`);
            }
          }
        }
      } catch (e) {
        return console.warn(`  ${snapId}·${u.name}: 胞元裁剪失败，跳过 ${e.message}`);
      }
      if (!clipped?.length) return;
      const c = u.geometry.coordinates;
      feats.push({
        type: 'Feature',
        properties: { name: u.name, layer: 'division', type: u.type, regime: cfg.attribute ? attribute(c[0], c[1]) : regimeOf },
        geometry: { type: 'MultiPolygon', coordinates: clipped },
      });
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

// ── 断面主循环 ──────────────────────────────────────────────
const timelineSnapshots = [];
for (const snap of SNAPSHOTS) {
  const territoryFeats = [];
  const adminTerritories = [];
  for (const t of snap.territories) {
    let geoms = [];
    if (t.kind === 'world') {
      const fc = loadAnchor(t.file);
      geoms = fc.features
        .filter(f => f.geometry && t.match.test((f.properties && (f.properties.NAME || f.properties.name)) || ''))
        .map(f => cleanGeom(roundCoords(toMulti(f.geometry), round2)));
      if (!geoms.length) console.warn(`  ${snap.id}·${t.name}: 锚点 ${t.file} 未匹配到政权，跳过`);
    } else {
      const fc = readJson(`${SRC}${t.file}`);
      const feats = t.match ? fc.features.filter(f => t.match.test(f.properties.name || '')) : fc.features;
      geoms = feats.map(f => cleanGeom(roundCoords(toMulti(f.geometry), round2)));
      if (!geoms.length) console.warn(`  ${snap.id}·${t.name}: 手绘源 ${t.file} 无要素，跳过`);
    }
    const union = unionAll(geoms);
    if (!union?.length) continue;
    const geometry = { type: 'MultiPolygon', coordinates: roundCoords(union, round2) };
    territoryFeats.push({
      type: 'Feature',
      properties: { name: `__regime_${t.name}`, layer: 'dynasty', regime: t.name, source: snap.note },
      geometry,
    });
    if (!t.weak) adminTerritories.push({ name: t.name, geometry });
  }
  if (!territoryFeats.length) throw new Error(`${snap.id}: 疆域轮廓为空`);
  const div = buildDivisions(snap.divisions, adminTerritories, snap.id);
  writeFileSync(`${ROOT}data/geo/${snap.id}.json`, JSON.stringify({ type: 'FeatureCollection', features: territoryFeats }));
  writeFileSync(`${ROOT}data/geo/${snap.id}-div.json`, JSON.stringify(div));
  const nDiv = div.features.length;
  const size = (JSON.stringify(territoryFeats).length / 1024).toFixed(0);
  console.log(`geo/${snap.id}.json  ${snap.label}  政权${territoryFeats.length}+政区${nDiv}  轮廓${size}KB`);
  timelineSnapshots.push({
    id: snap.id, year: snap.year, era: snap.era, label: snap.label, note: snap.note,
    regimes: snap.territories.map(t => ({
      name: t.name, color: REGIME_COLORS[t.name] || '#8C8270', weak: !!t.weak,
    })),
    geoFile: `geo/${snap.id}.json`, divisionsFile: `geo/${snap.id}-div.json`,
  });
}

// ── 时间轴索引 + 事件合并 ───────────────────────────────────
const EVENTS_SRC = 'https://raw.githubusercontent.com/pessimistcamellia/china-history-map/main/data.js';
const dataJs = await (await fetch(EVENTS_SRC)).text();
const EVENTS = vm.runInNewContext(dataJs + '\nmodule.exports = EVENTS;', { module: { exports: {} } });
const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);
const inChina = e =>
  typeof e.lng === 'number' && typeof e.lat === 'number' &&
  e.lng >= 70 && e.lng <= 136 && e.lat >= 17 && e.lat <= 55;
// 时代 → 上游 data.js 的 dynasty 标签（已核实存在；东晋十六国暂无事件，二期补上古）
const ERA_EVENT_SRC = {
  '秦': ['qin'], '西汉': ['han_w'], '东汉': ['han_e'], '三国': ['three_k'], '西晋': ['jin_w'],
  '南北朝': ['south_n'], '隋': ['sui'], '唐': ['tang'],
  '五代十国': ['five_d'], '辽北宋': ['song_liao'], '金南宋': ['song_jin'],
  '元': ['yuan'], '明': ['ming'], '清': ['qing'],
};
const eraOfEvent = new Map(SNAPSHOTS.map(s => [s.era, ERA_EVENT_SRC[s.era] || []]));
const seenTitles = new Set();
const events = [];
for (const [era, ids] of eraOfEvent) {
  for (const id of ids) {
    for (const e of EVENTS.filter(e => e.dynasty === id && inChina(e))) {
      if (seenTitles.has(e.title)) continue;
      seenTitles.add(e.title);
      events.push({
        year: e.year, yearLabel: yearLabel(e.year), era, title: e.title, description: e.desc,
        location: { name: e.unit || '', lng: e.lng, lat: e.lat }, tag: e.type, sig: e.sig,
      });
    }
  }
}
events.sort((a, b) => a.year - b.year);
writeFileSync(`${ROOT}data/timeline.json`, JSON.stringify({
  range: { from: SNAPSHOTS[0].year, to: SNAPSHOTS[SNAPSHOTS.length - 1].year },
  snapshots: timelineSnapshots,
  events,
}));
console.log(`timeline.json  ${timelineSnapshots.length}断面  ${events.length}事件`);

// ── 现代轮廓（阿里 DataV，不变）────────────────────────────
const MODERN_SRC = 'https://geo.datav.aliyun.com/areas_v3/bound/100000.json';
const modern = await fetchJson(MODERN_SRC);
modern.features.forEach(f => {
  f.properties = { name: '__modern__', layer: 'modern', source: '阿里DataV' };
  f.geometry.coordinates = roundCoords(f.geometry.coordinates, round3);
});
writeFileSync(`${ROOT}data/geo/modern.json`, JSON.stringify(modern));
console.log(`geo/modern.json  lon[${bbox(modern)[0][0]},${bbox(modern)[1][0]}]`);

// ── 周边国家国界（Natural Earth，公有领域，不变）────────────
const NEIGHBORS_SRC =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson';
const ne = await fetchJson(NEIGHBORS_SRC);
const VIEW = [55, 5, 150, 65];
const featureBbox = f => bbox({ type: 'FeatureCollection', features: [f] });
const neighbors = {
  type: 'FeatureCollection',
  features: ne.features
    .filter(f => f.geometry && (f.properties.NAME || '') !== 'China')
    .filter(f => {
      const [[mnLon, mnLat], [mxLon, mxLat]] = featureBbox(f);
      return mxLon >= VIEW[0] && mnLon <= VIEW[2] && mxLat >= VIEW[1] && mnLat <= VIEW[3];
    })
    .map(f => ({
      ...f,
      properties: { name: '__neighbors__', layer: 'neighbors', source: 'Natural Earth', country: f.properties.NAME },
      geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, round2) },
    })),
};
writeFileSync(`${ROOT}data/geo/neighbors.json`, JSON.stringify(neighbors));
console.log(`geo/neighbors.json  ${neighbors.features.length}国`);

// ── 省级行政区界（阿里 DataV，不变）────────────────────────
const PROVINCES_SRC = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';
const provFull = await fetchJson(PROVINCES_SRC);
const provinces = {
  type: 'FeatureCollection',
  features: provFull.features.map(f => ({
    ...f,
    properties: { name: '__provinces__', layer: 'provinces', source: '阿里DataV', province: f.properties.name },
    geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates, round2) },
  })),
};
writeFileSync(`${ROOT}data/geo/provinces.json`, JSON.stringify(provinces));
console.log(`geo/provinces.json  ${provinces.features.length}个省级政区`);
