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

// ── 政权配色：跨断面稳定（呈现参数，随 timeline.json 下发）──────────────
// 主朝代色相尽量贴合五德终始/尚色的大众口径：秦水德尚黑（玄）、汉火德尚赤、
// 唐土德尚黄、宋（炎宋）与明尚赤；商金德尚白在纸底上不可见，取出土青铜之褐；
// 元清德运争议大、多政权并立朝代以区分度优先，均按视觉协调取色
const REGIME_COLORS = {
  '商': '#8A6B3F',
  '秦': '#3E3D4A', '汉': '#A6402F', '匈奴': '#8C8270', '南越': '#7A8A6A', '闽越': '#9A8A5A',
  '魏': '#46708F', '蜀汉': '#5F7D50', '吴': '#B07D2B',
  '西晋': '#96688F', '东晋': '#6B7FA3', '十六国': '#8C7A5E', '前秦': '#86748E',
  '北魏': '#5E7A6A', '南朝': '#A87A4A', '东魏': '#6A8A9A', '西魏': '#7A9A8A',
  '隋': '#8A5A7A', '唐': '#AE7C2A', '吐蕃': '#9A5A4A', '突厥': '#7A7A8A', '回鹘': '#8A8A6A',
  '南诏': '#6A9A8A', '渤海': '#5A7A9A', '五代十国': '#8C6D46', '契丹': '#7A5A6A',
  '辽': '#8A5A4A', '北宋': '#A64838', '南宋': '#B25842', '西夏': '#6A7A5A', '金': '#7A6A4A',
  '蒙古': '#9A7A5A', '察合台汗国': '#9A8A6A',
  '元': '#46708F', '明': '#A6503C', '南明': '#A6503C', '清': '#3F7E76',
};

// ── 断面表：年份升序；weak=true 为边缘政权（渲染更淡、不参与政区归属）──────
// territories[].from: hand-*.json（手绘）| outline-three-k.json | world_YYYY.geojson 锚点
// divisions: {src:'qin'|'han_w'} 复用含谭图补点的既有窗口源；{window:Y} 从 CHGIS 全量按年切片
const HB = f => ({ kind: 'world', file: f });
const HAND = f => ({ kind: 'hand', file: f });
const SNAPSHOTS = [
  { id: 'sbc1600', year: -1600, era: '商', label: '商 · 成汤居亳',
    territories: [{ name: '商', ...HAND('hand-shang-early.json') }],
    places: 'hand-shang-early-places.json',
    note: '约前1600年（早商二里岗期势力范围推定示意·考古学界共识，无政区层）' },
  { id: 'sbc1200', year: -1200, era: '商', label: '商 · 殷墟时期',
    territories: [{ name: '商', ...HAND('hand-shang.json') }],
    places: 'hand-shang-places.json',
    note: '约前1200年（谭图第一册网格配准读图·商据点群推定示意，无政区层）' },
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

// ── 时代分段：时间轴底色 + 侧栏时代简介（era 聚合，颜色取首个断面主政权）──
const ERA_SUMMARY = {
  '商': '甲骨文与青铜器见证的王朝。成汤都亳而立国，前期以郑洛为中心经略四方；盘庚迁殷后王都稳定于安阳一带，以据点式方式控制四土：西抵岐周、北至冀中、南达江汉。本图色块为据点群推定示意。',
  '秦': '结束战国五百年分裂的首个大一统王朝。北逐匈奴取河套、修长城，南平百越设桂林与象郡，书同文、车同轨、行郡县，奠定此后两千年华夏政治的基本盘。',
  '西汉': '开疆拓土的盛世。武帝北击匈奴、取河西四郡、凿空西域，宣帝设西域都护府将天山南北纳入版图，疆域远超秦代。',
  '东汉': '光武中兴重建汉室，西域三绝三通；后期羌乱迭起，西北疆域渐次收缩。',
  '三国': '魏蜀吴三分天下，州制从监察区变为实级政区，为后世州郡县三级制张本。',
  '西晋': '短暂统一后又陷分裂，永嘉之乱衣冠南渡，北方进入十六国时代。',
  '东晋十六国': '东晋偏安江左；北方匈奴、羯、氐、羌迭起建国，淝水之战前秦一度统一北方。',
  '南北朝': '北魏汉化改革定鼎中原，南朝宋齐梁陈更迭；后期分为东西魏，鼎峙之势延续至隋初。',
  '隋': '结束近三百年分裂再造大一统，创科举、通运河，为大唐盛世奠基。',
  '唐': '开放恢弘的黄金时代。前期灭东西突厥，设安西、北庭都护府经略西域；安史之乱后国势转衰，河西渐为吐蕃所隔。',
  '五代十国': '唐亡后中原五朝迭嬗、南方十国并立，契丹崛起北方建辽。',
  '辽北宋': '澶渊之盟后宋辽百年和平，西夏立国西北，三方鼎峙共处。',
  '金南宋': '靖康之变宋室南渡，金据淮河—秦岭以北；十三世纪蒙古崛起漠北，格局重洗。',
  '元': '大一统王朝中疆域最辽阔者。兼并吐蕃故地置宣政院，岭北行省直抵漠北；行省制度为明清所沿用。',
  '明': '重建汉族大一统。前期设奴儿干都司经略东北、辖乌斯藏都司，郑和七下西洋；中后期边疆收缩，北界退至长城一线。',
  '清': '最后一个大一统王朝。康雍乾百年开疆：收台湾、定漠北、平准噶尔，将新疆、西藏稳固纳入治理，奠定近代中国版图的基础。',
};
const eras = [];
{
  let cur = null;
  for (const s of SNAPSHOTS) {
    if (cur && cur.name === s.era) continue;
    if (cur) cur.to = s.year;
    const main = s.territories.find(t => !t.weak);
    cur = {
      name: s.era, from: s.year, to: null,
      color: REGIME_COLORS[main?.name] || '#8C8270',
      summary: ERA_SUMMARY[s.era] || '',
    };
    eras.push(cur);
  }
  cur.to = SNAPSHOTS[SNAPSHOTS.length - 1].year;
}

// ── 断面主循环 ──────────────────────────────────────────────
const timelineSnapshots = [];
// 路线层静态源（迁都/征伐，snapshot 键控；本期商代两断面，后续朝代在此增补）
const ROUTES_SRC = readJson(`${SRC}hand-shang-routes.json`).routes;

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
  // 上古断面（夏商西周）无政区层：divisions 缺省即不产出政区文件
  const div = snap.divisions
    ? buildDivisions(snap.divisions, adminTerritories, snap.id)
    : null;
  // 据点层（都邑/方国/遗址点位）：静态源 → 断面文件，懒加载同政区层
  let placesFc = null;
  if (snap.places) {
    const src = readJson(`${SRC}${snap.places}`);
    placesFc = {
      type: 'FeatureCollection',
      features: src.features.map(f => ({
        type: 'Feature',
        properties: { ...f.properties, layer: 'place' },
        geometry: {
          type: 'Point',
          coordinates: [round2(f.geometry.coordinates[0]), round2(f.geometry.coordinates[1])],
        },
      })),
    };
    writeFileSync(`${ROOT}data/geo/${snap.id}-places.json`, JSON.stringify(placesFc));
  }
  // 路线层（迁都/征伐，通用契约）：静态源按 snapshot 键控，有则产出断面文件
  const snapRoutes = ROUTES_SRC.filter(r => r.snapshot === snap.id);
  let routesFc = null;
  if (snapRoutes.length) {
    routesFc = {
      type: 'FeatureCollection',
      features: snapRoutes.map(r => ({
        type: 'Feature',
        properties: { name: r.name, kind: r.kind, note: r.note, layer: 'route' },
        geometry: { type: 'LineString', coordinates: r.coordinates.map(([x, y]) => [round2(x), round2(y)]) },
      })),
    };
    writeFileSync(`${ROOT}data/geo/${snap.id}-routes.json`, JSON.stringify(routesFc));
  }
  writeFileSync(`${ROOT}data/geo/${snap.id}.json`, JSON.stringify({ type: 'FeatureCollection', features: territoryFeats }));
  if (div) writeFileSync(`${ROOT}data/geo/${snap.id}-div.json`, JSON.stringify(div));
  const nDiv = div ? div.features.length : 0;
  const size = (JSON.stringify(territoryFeats).length / 1024).toFixed(0);
  console.log(`geo/${snap.id}.json  ${snap.label}  政权${territoryFeats.length}+政区${nDiv}+据点${placesFc ? placesFc.features.length : 0}+路线${routesFc ? routesFc.features.length : 0}  轮廓${size}KB`);
  timelineSnapshots.push({
    id: snap.id, year: snap.year, era: snap.era, label: snap.label, note: snap.note,
    regimes: snap.territories.map(t => ({
      name: t.name, color: REGIME_COLORS[t.name] || '#8C8270', weak: !!t.weak,
    })),
    geoFile: `geo/${snap.id}.json`,
    ...(div ? { divisionsFile: `geo/${snap.id}-div.json` } : {}),
    ...(placesFc ? { placesFile: `geo/${snap.id}-places.json` } : {}),
    ...(routesFc ? { routesFile: `geo/${snap.id}-routes.json` } : {}),
  });
}

// ── 时间轴索引 + 事件合并 ───────────────────────────────────
const EVENTS_SRC = 'https://raw.githubusercontent.com/pessimistcamellia/china-history-map/main/data.js';
// 事件源裸 fetch 网络抖动即崩（且崩点在写 timeline.json 之前，geo 已落盘会造成
// 「半新半旧」产物）——复用镜像+重试的 fetchJson 通道以 text 取回
const fetchTextWithRetry = async url => {
  const mirror = url.replace('https://raw.githubusercontent.com/', 'https://cdn.jsdelivr.net/gh/').replace('/master/', '@master/').replace('/main/', '@main/');
  const urls = mirror === url ? [url] : [url, mirror];
  let lastErr;
  for (const u of urls) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
    }
  }
  throw new Error(`fetch 事件源失败 ${url}: ${lastErr.message}`);
};
const dataJs = await fetchTextWithRetry(EVENTS_SRC);
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
// 上古本地事件源（上游无夏商周 dynasty 标签；era 直书断面 era，
// 二期夏/西周/春秋/战国事件在此增补，不再改管线）
for (const e of readJson(`${SRC}events-ancient.json`).events) {
  if (seenTitles.has(e.title)) continue;
  seenTitles.add(e.title);
  events.push({
    year: e.year, yearLabel: yearLabel(e.year), era: e.era, title: e.title,
    description: e.description, location: e.location, tag: e.tag, sig: e.sig,
  });
}
events.sort((a, b) => a.year - b.year);
writeFileSync(`${ROOT}data/timeline.json`, JSON.stringify({
  range: { from: SNAPSHOTS[0].year, to: SNAPSHOTS[SNAPSHOTS.length - 1].year },
  eras,
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

// ── 现代行政地名点位（省/市/县驻地，阿里 DataV 递归提取，几何即弃）──
// 静态源 tools/sources/modern-places.json 由 fetch-modern-places.mjs 生成，此处不再联网
const modernPlacesSrc = readJson(`${SRC}modern-places.json`);
const placesModern = {
  type: 'FeatureCollection',
  features: modernPlacesSrc.features.map(f => ({
    type: 'Feature',
    properties: { ...f.properties, layer: 'modern-place' },
    geometry: {
      type: 'Point',
      coordinates: [round2(f.geometry.coordinates[0]), round2(f.geometry.coordinates[1])],
    },
  })),
};
writeFileSync(`${ROOT}data/geo/places-modern.json`, JSON.stringify(placesModern));
const nByLevel = placesModern.features.reduce((m, f) => ((m[f.properties.level] = (m[f.properties.level] || 0) + 1), m), {});
console.log(`geo/places-modern.json  ${placesModern.features.length}点`, JSON.stringify(nByLevel));
