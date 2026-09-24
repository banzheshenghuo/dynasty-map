#!/usr/bin/env node
/**
 * 数据构建管线：从开放数据源生成 data/ 目录
 *  - 疆域轮廓：aourednik/historical-basemaps (GPL-3)，按断面提取中国政权多边形
 *  - 秦疆域：手绘示意（data/geo/qin.json 为静态文件，本脚本跳过）
 *  - 现代轮廓：阿里 DataV
 *  - 历史事件：筛选自 pessimistcamellia/china-history-map 的 EVENTS（公版史料整理）
 * 用法：node tools/build-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url).pathname;
const UP = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';

// 朝代配置：断面年份 + 政权 NAME + 呈现信息
const DYNASTIES = [
  { id: 'qin',    name: '秦',   en: 'Qin',          period: '前221–前207', snapshotLabel: '手绘示意（前214年前后）', color: '#6D5B8B',
    summary: '结束战国五百年分裂的首个大一统王朝。北逐匈奴取河套、修长城，南平百越设桂林与象郡，书同文、车同轨、行郡县，奠定此后两千年华夏政治的基本盘。' },
  { id: 'han_w',  name: '西汉', en: 'Western Han',  period: '前202–公元8',  snapshotLabel: '约公元前1年',           color: '#A6402F',
    summary: '开疆拓土的盛世。武帝北击匈奴、取河西四郡、凿空西域，宣帝设西域都护府将天山南北纳入版图，南并南越、西南置郡，疆域远超秦代。' },
  { id: 'tang',   name: '唐',   en: 'Tang',         period: '618–907',     snapshotLabel: '约800年（中唐）',        color: '#AE7C2A',
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
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
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
for (const [id, cfg] of Object.entries(GEO_SRC)) {
  const world = await fetchJson(cfg.file);
  const feats = world.features.filter(f => cfg.regime.test(f.properties.NAME || ''));
  if (!feats.length) throw new Error(`${id}: 断面中未找到政权 ${cfg.regime}`);
  feats.forEach(f => {
    f.properties = { name: '__dynasty__', layer: 'dynasty', source: 'historical-basemaps' };
    f.geometry.coordinates = roundCoords(f.geometry.coordinates, round2);
  });
  const out = { type: 'FeatureCollection', features: feats };
  writeFileSync(`${ROOT}data/geo/${id}.json`, JSON.stringify(out));
  const [mn, mx] = bbox(out);
  console.log(`geo/${id}.json  features=${feats.length}  lon[${mn[0]},${mx[0]}] lat[${mn[1]},${mx[1]}]`);
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

// ── 3. 历史事件 ────────────────────────────────────────────
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

// ── 4. 朝代索引 ────────────────────────────────────────────
const index = DYNASTIES.map(d => ({ ...d, geoFile: `geo/${d.id}.json`, eventsFile: `events/${d.id}.json` }));
writeFileSync(`${ROOT}data/dynasties.json`, JSON.stringify(index, null, 1));
console.log(`dynasties.json  ${index.length}个朝代`);
