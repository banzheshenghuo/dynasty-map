#!/usr/bin/env node
/**
 * 一次性提取：CHGIS V6 西汉（约前1年断面）政区多边形与郡治点位 → tools/sources/
 *
 * 上游与提取命令同 tools/extract-chgis-qin.mjs 头注（同两个 shapefile，仅筛选窗口不同）：
 *  npx mapshaper v6_time_pref_pgn_utf_wgs84.shp \
 *    -filter 'BEG_YR <= -1 && (END_YR >= -1 || !END_YR)' \
 *    -filter-fields NAME_CH,BEG_YR,END_YR -o format=geojson precision=0.001 han-src-pgn.json
 *  （点位同理）
 *
 * 用法：node tools/extract-chgis-han.mjs <han-src-pgn.json> <han-src-pts.json>
 *
 * 许可：CC BY-NC-SA 3.0。强制引用：'CHGIS Version 6.' (c) Fairbank Center for Chinese
 * Studies and the Institute for Chinese Historical Geography at Fudan University.
 * 本仓库仅取西汉子集、坐标取整并注明修改，符合其学术使用条款。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';

const [, , pgnPath, ptsPath] = process.argv;
const ROOT = new URL('..', import.meta.url).pathname;
const round3 = n => Math.round(n * 1000) / 1000;
const roundCoords = c => (typeof c[0] === 'number' ? [round3(c[0]), round3(c[1])] : c.map(roundCoords));
const unitType = name => (name.endsWith('国') ? '国' : name.endsWith('都尉') ? '都尉' : '郡');

const pgn = JSON.parse(readFileSync(pgnPath, 'utf8'));
const pts = JSON.parse(readFileSync(ptsPath, 'utf8'));

// ── 多边形：CHGIS 有数字化界线的郡国（东南部），同名多时段并集 ──
const byName = new Map();
for (const f of pgn.features) {
  const name = f.properties.NAME_CH;
  const coords = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  byName.set(name, byName.has(name) ? polygonClipping.union(byName.get(name), coords) : coords);
}
const pgnOut = [...byName.entries()].map(([name, geom]) => ({
  type: 'Feature',
  properties: { name, type_ch: unitType(name) },
  geometry: { type: 'MultiPolygon', coordinates: roundCoords(geom) },
}));

// ── 点位：CHGIS 郡治。并州为刺史部监察区非郡国，剔除 ──
const pgnNames = new Set(pgnOut.map(f => f.properties.name));
const seen = new Set();
const ptsOut = [];
for (const f of pts.features) {
  const name = f.properties.NAME_CH;
  if (pgnNames.has(name) || name === '并州') continue;
  const key = f.geometry.coordinates.map(x => x.toFixed(2)).join(',');
  if (seen.has(key)) continue;
  seen.add(key);
  ptsOut.push({
    type: 'Feature',
    properties: { name, type_ch: unitType(name) },
    geometry: { type: 'Point', coordinates: roundCoords(f.geometry.coordinates) },
  });
}

// ── 补点：CHGIS 西汉时段缺失（或全库缺位）而郡治坐标史有明文的郡国 ──
// 北方边郡与交趾三郡在 CHGIS 时序库无西汉记录；中原各郡国存在时段断档
const SUPPLEMENT = [
  { name: '朔方郡', xy: [107.0, 40.4], basis: '治朔方（今内蒙古磴口北一带）' },
  { name: '五原郡', xy: [109.9, 40.6], basis: '治九原（今包头西南），即秦九原郡' },
  { name: '云中郡', xy: [111.3, 40.6], basis: '治云中（今托克托东北）' },
  { name: '定襄郡', xy: [111.7, 40.5], basis: '治成乐（今和林格尔西北）' },
  { name: '西河郡', xy: [108.8, 39.6], basis: '治平定（今鄂尔多斯东部，一说富昌），治所无定说取示意' },
  { name: '右北平郡', xy: [118.5, 41.4], basis: '治平刚（今内蒙古宁城甸子一带）' },
  { name: '辽西郡', xy: [120.9, 41.4], basis: '治阳乐（今辽宁义县西）' },
  { name: '辽东郡', xy: [123.17, 41.27], basis: '治襄平（今辽阳）' },
  { name: '玄菟郡', xy: [125.0, 41.7], basis: '治高句骊（今辽宁新宾西南，二迁后）' },
  { name: '乐浪郡', xy: [125.75, 39.05], basis: '治朝鲜（今平壤乐浪土城）' },
  { name: '交趾郡', xy: [105.85, 21.15], basis: '治羸𨻻（今河内西北）' },
  { name: '九真郡', xy: [105.35, 19.85], basis: '治胥浦（今清化西北）' },
  { name: '日南郡', xy: [107.15, 17.1], basis: '治西捲（今广治附近）' },
  { name: '鲁国', xy: [116.99, 35.58], basis: '治鲁县（今曲阜）' },
  { name: '沛郡', xy: [116.79, 33.97], basis: '治相县（今淮北一带）' },
  { name: '梁国', xy: [115.6, 34.4], basis: '治睢阳（今商丘南）' },
  { name: '六安国', xy: [116.55, 31.78], basis: '治六县（今六安东北）' },
  { name: '九江郡', xy: [116.79, 32.57], basis: '治寿春（今寿县）' },
  { name: '庐江郡', xy: [117.1, 31.1], basis: '治舒（今庐江西南）' },
  { name: '江夏郡', xy: [114.55, 30.9], basis: '治西陵（今武汉新洲西）' },
  { name: '千乘郡', xy: [117.8, 37.2], basis: '治千乘（今高青东）' },
  { name: '高密国', xy: [119.7, 36.3], basis: '治高密（今高密西南）' },
  { name: '城阳国', xy: [118.84, 35.58], basis: '治莒（今莒县）' },
  { name: '甾川国', xy: [118.6, 36.6], basis: '治剧（今寿光东南）' },
];
for (const s of SUPPLEMENT) {
  ptsOut.push({ type: 'Feature', properties: { name: s.name, type_ch: unitType(s.name), note: '补点', basis: s.basis }, geometry: { type: 'Point', coordinates: s.xy } });
}

writeFileSync(`${ROOT}tools/sources/chgis-v6-han_w-pgn.json`, JSON.stringify({ type: 'FeatureCollection', features: pgnOut }));
writeFileSync(`${ROOT}tools/sources/chgis-v6-han_w-pts.json`, JSON.stringify({ type: 'FeatureCollection', features: ptsOut }));
console.log(`chgis-v6-han_w-pgn.json  ${pgnOut.length} 郡国（CHGIS 界线）: ${pgnOut.map(f => f.properties.name).join('、')}`);
console.log(`chgis-v6-han_w-pts.json  ${ptsOut.length} 郡国（治所点位，其中补点 ${SUPPLEMENT.length}）`);
