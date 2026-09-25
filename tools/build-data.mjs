#!/usr/bin/env node
/**
 * 数据构建管线：从开放数据源生成 data/ 目录
 *  - 疆域轮廓：aourednik/historical-basemaps (GPL-3) 边疆断面 ∪ CHGIS V6/Hartwell
 *    本部政区并集（海岸线精确贴合，经 china-history-map 导出）
 *  - 秦疆域：手绘示意 + CHGIS 秦郡并集（无 aourednik 断面）
 *  - 现代轮廓：阿里 DataV
 *  - 历史事件：筛选自 pessimistcamellia/china-history-map 的 EVENTS（公版史料整理）
 * 用法：node tools/build-data.mjs
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import polygonClipping from 'polygon-clipping';

const ROOT = new URL('..', import.meta.url).pathname;
const UP = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';

// 朝代配置：断面年份 + 政权 NAME + 呈现信息
const DYNASTIES = [
  { id: 'qin',    name: '秦',   en: 'Qin',          period: '前221–前207', snapshotLabel: '约前214年（手绘+CHGIS秦郡）', color: '#6D5B8B',
    summary: '结束战国五百年分裂的首个大一统王朝。北逐匈奴取河套、修长城，南平百越设桂林与象郡，书同文、车同轨、行郡县，奠定此后两千年华夏政治的基本盘。' },
  { id: 'han_w',  name: '西汉', en: 'Western Han',  period: '前202–公元8',  snapshotLabel: '约公元前1年',           color: '#A6402F',
    summary: '开疆拓土的盛世。武帝北击匈奴、取河西四郡、凿空西域，宣帝设西域都护府将天山南北纳入版图，南并南越、西南置郡，疆域远超秦代。' },
  { id: 'tang',   name: '唐',   en: 'Tang',         period: '618–907',     snapshotLabel: '开元政区并中唐边疆（约741–800）',        color: '#AE7C2A',
    summary: '开放恢弘的黄金时代。前期灭东西突厥，设安西、北庭都护府经略西域，势力深入中亚；安史之乱后国势转衰，河西渐为吐蕃所隔（本图取中唐断面）。' },
  { id: 'yuan',   name: '元',   en: 'Yuan',         period: '1271–1368',   snapshotLabel: '1279年（灭南宋）',       color: '#46708F',
    summary: '大一统王朝中疆域最辽阔者。蒙古铁骑先后灭西夏、金、大理与南宋，兼并吐蕃故地置宣政院，岭北行省直抵漠北；行省制度为明清所沿用。' },
  { id: 'ming',   name: '明',   en: 'Ming',         period: '1368–1644',   snapshotLabel: '约1492年（中明）',       color: '#5F7D50',
    summary: '重建汉族大一统。前期设奴儿干都司经略东北、辖乌斯藏都司囊括青藏，郑和七下西洋扬威海外；中后期边疆收缩，北界退至长城一线。' },
  { id: 'qing',   name: '清',   en: 'Qing',         period: '1636–1912',   snapshotLabel: '约1800年（极盛）',       color: '#3F7E76',
    summary: '最后一个大一统王朝。康雍乾百年开疆：收台湾、定漠北、平准噶尔，将新疆、西藏稳固纳入治理，奠定近代中国版图的基础。' },
];

// 朝代 → 断面文件 + 政权名（注意精确匹配，/Han/i 会误中 Satavahanihara 等）
const GEO_SRC = {
  han_w: { file: `${UP}/world_bc1.geojson`,   regime: /^Han( Empire)?$/ },
  tang:  { file: `${UP}/world_800.geojson`,   regime: /^Tang( Empire)?$/ },
  yuan:  { file: `${UP}/world_1279.geojson`,  regime: /^(Great Khanate|Yuan( Empire)?)$/ },
  ming:  { file: `${UP}/world_1492.geojson`,  regime: /^Ming( Empire)?$/ },
  qing:  { file: `${UP}/world_1800.geojson`,  regime: /^(Qing|Manchu)( Empire)?$/ },
};

const EVENTS_SRC = 'https://raw.githubusercontent.com/pessimistcamellia/china-history-map/main/data.js';
const MODERN_SRC = 'https://geo.datav.aliyun.com/areas_v3/bound/100000.json';
const MAX_EVENTS = 12;

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

mkdirSync(`${ROOT}data/geo`, { recursive: true });
mkdirSync(`${ROOT}data/events`, { recursive: true });

// ── 1. 疆域轮廓 ────────────────────────────────────────────
// 疆域 = 边疆轮廓 ∪ 本部政区并集：
//  - 边疆轮廓（西域都护府/漠北/藩部等）：aourednik/historical-basemaps 世界断面
//  - 本部政区（郡/州/路/府，海岸线精确贴合）：CHGIS V6 + Hartwell 政区快照，
//    经 pessimistcamellia/china-history-map 导出为 GeoJSON；数据偏东南（方志数字化进度），
//    缺失区域由边疆轮廓兜底，几何并集后无痕
//  - 秦无 aourednik 断面，以仓库手绘轮廓为底
const POLY_SRC = id =>
  `https://raw.githubusercontent.com/pessimistcamellia/china-history-map/main/v2/data/geo/${id}.json`;
const toMulti = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function unionAll(parts) {
  let u = null;
  for (const coords of parts) {
    try { u = u ? polygonClipping.union(u, coords) : coords; } catch { /* 脏多边形跳过 */ }
  }
  return u;
}

for (const d of DYNASTIES) {
  const id = d.id;
  const parts = [];
  let srcNote = [];
  if (GEO_SRC[id]) {
    const world = await fetchJson(GEO_SRC[id].file);
    const feats = world.features.filter(f => GEO_SRC[id].regime.test(f.properties.NAME || ''));
    if (!feats.length) throw new Error(`${id}: 断面中未找到政权 ${GEO_SRC[id].regime}`);
    feats.forEach(f => parts.push(roundCoords(toMulti(f.geometry), round2)));
    srcNote.push('historical-basemaps');
  } else {
    // 秦：手绘示意轮廓（静态文件）
    const hand = JSON.parse(readFileSync(`${ROOT}data/geo/${id}.json`, 'utf8'));
    hand.features.forEach(f => parts.push(roundCoords(toMulti(f.geometry), round2)));
    srcNote.push('手绘示意');
  }
  const polys = await fetchJson(POLY_SRC(id)).catch(() => null);
  let nPref = 0;
  if (polys?.features?.length) {
    polys.features.forEach(f => { parts.push(roundCoords(toMulti(f.geometry), round2)); nPref++; });
    srcNote.push('CHGIS/Hartwell');
    // 本朝政区界图层：保留郡/州/路/府名与类型，供前端单独渲染与悬浮展示
    const divisions = {
      type: 'FeatureCollection',
      features: polys.features.map(f => ({
        type: 'Feature',
        properties: { name: f.properties.name, layer: 'division', type: f.properties.type_ch || '' },
        geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, round2) },
      })),
    };
    writeFileSync(`${ROOT}data/geo/${id}-div.json`, JSON.stringify(divisions));
    var nDiv = divisions.features.length;
  }
  const union = unionAll(parts);
  if (!union) throw new Error(`${id}: 并集结果为空`);
  const out = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name: '__dynasty__', layer: 'dynasty', source: srcNote.join(' + ') },
      geometry: { type: 'MultiPolygon', coordinates: roundCoords(union, round2) },
    }],
  };
  writeFileSync(`${ROOT}data/geo/${id}.json`, JSON.stringify(out));
  const [mn, mx] = bbox(out);
  console.log(`geo/${id}.json  本部政区${nPref}+政区界${nDiv ?? 0} + 轮廓 → 并集  lon[${mn[0]},${mx[0]}] lat[${mn[1]},${mx[1]}]`);
}

// ── 2. 现代轮廓 ────────────────────────────────────────────
const modern = await fetchJson(MODERN_SRC);
modern.features.forEach(f => {
  f.properties = { name: '__modern__', layer: 'modern', source: '阿里DataV' };
  f.geometry.coordinates = roundCoords(f.geometry.coordinates, round3);
});
writeFileSync(`${ROOT}data/geo/modern.json`, JSON.stringify(modern));
const [mmn, mmx] = bbox(modern);
console.log(`geo/modern.json  lon[${mmn[0]},${mmx[0]}] lat[${mmn[1]},${mmx[1]}]`);

// ── 3. 周边国家国界（Natural Earth，公有领域）──────────────
// 取景框周边的现代国界做古今对照底图；中国本体用更精细的 DataV 轮廓，此处排除
const NEIGHBORS_SRC =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson';
const ne = await fetchJson(NEIGHBORS_SRC);
const VIEW = [55, 5, 150, 65]; // 稍宽于地图取景框，保证视口边缘有底图上下文
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
console.log(
  `geo/neighbors.json  ${neighbors.features.length}国  ${(JSON.stringify(neighbors).length / 1024).toFixed(0)}KB`
);

// ── 4. 省级行政区界（阿里 DataV）─────────────────────────
// 现代省界叠在疆域色块之下，作古今对照的细部参照
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
console.log(
  `geo/provinces.json  ${provinces.features.length}个省级政区  ${(JSON.stringify(provinces).length / 1024).toFixed(0)}KB`
);

// ── 5. 历史事件 ────────────────────────────────────────────
const dataJs = await (await fetch(EVENTS_SRC)).text();
const EVENTS = vm.runInNewContext(dataJs + '\nmodule.exports = EVENTS;', { module: { exports: {} } });
const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);
// 源数据混有世界史事件（罗马、大航海等），按中国地理范围过滤
const inChina = e =>
  typeof e.lng === 'number' && typeof e.lat === 'number' &&
  e.lng >= 70 && e.lng <= 136 && e.lat >= 17 && e.lat <= 55;
for (const d of DYNASTIES) {
  const list = EVENTS
    .filter(e => e.dynasty === d.id && inChina(e))
    .sort((a, b) => b.sig - a.sig || Math.abs(a.year) - Math.abs(b.year))
    .slice(0, MAX_EVENTS)
    .map(e => ({
      year: e.year,
      yearLabel: yearLabel(e.year),
      title: e.title,
      description: e.desc,
      location: { name: e.unit || '', lng: e.lng, lat: e.lat },
      tag: e.type,
      sig: e.sig,
    }))
    .sort((a, b) => a.year - b.year); // 展示按时间正序
  writeFileSync(`${ROOT}data/events/${d.id}.json`, JSON.stringify(list, null, 1));
  console.log(`events/${d.id}.json  ${list.length}条`);
}

// ── 6. 朝代索引 ────────────────────────────────────────────
const index = DYNASTIES.map(d => ({ ...d, geoFile: `geo/${d.id}.json`, divisionsFile: `geo/${d.id}-div.json`, eventsFile: `events/${d.id}.json` }));
writeFileSync(`${ROOT}data/dynasties.json`, JSON.stringify(index, null, 1));
console.log(`dynasties.json  ${index.length}个朝代`);
