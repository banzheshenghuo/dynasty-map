#!/usr/bin/env node
/**
 * 一次性提取：CHGIS V6 秦代（约前214年断面）政区多边形与郡治点位 → tools/sources/
 *
 * 上游数据（Harvard Dataverse，免费下载）：
 *  - 时序政区多边形 doi:10.7910/DVN/I0Q7SM，文件 v6_time_pref_pgn_utf_wgs84.zip (id=2966510)
 *  - 时序政区点位   doi:10.7910/DVN/WW1PD6，文件 v6_time_pref_pts_utf_wgs84.zip (id=2970286)
 * 下载后经 mapshaper 筛「前207–前214 年窗口有效」并转 GeoJSON：
 *  npx mapshaper v6_time_pref_pgn_utf_wgs84.shp \
 *    -filter 'BEG_YR <= -207 && (END_YR >= -214 || !END_YR)' \
 *    -filter-fields NAME_CH,BEG_YR,END_YR -o format=geojson precision=0.001 qin-src-pgn.json
 *  （点位同理）
 *
 * 用法：node tools/extract-chgis-qin.mjs <qin-src-pgn.json> <qin-src-pts.json>
 *
 * 许可：CC BY-NC-SA 3.0。强制引用：'CHGIS Version 6.' (c) Fairbank Center for Chinese
 * Studies and the Institute for Chinese Historical Geography at Fudan University.
 * 本仓库仅取秦代子集、坐标取整并注明修改，符合其学术使用条款。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import polygonClipping from 'polygon-clipping';

const [, , pgnPath, ptsPath] = process.argv;
const ROOT = new URL('..', import.meta.url).pathname;
const round3 = n => Math.round(n * 1000) / 1000;
const roundCoords = c => (typeof c[0] === 'number' ? [round3(c[0]), round3(c[1])] : c.map(roundCoords));

const pgn = JSON.parse(readFileSync(pgnPath, 'utf8'));
const pts = JSON.parse(readFileSync(ptsPath, 'utf8'));

// ── 多边形：CHGIS 有数字化界线的郡（东南部），同名多时段并集 ──
const byName = new Map();
for (const f of pgn.features) {
  const name = f.properties.NAME_CH;
  const coords = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  byName.set(name, byName.has(name) ? polygonClipping.union(byName.get(name), coords) : coords);
}
const pgnOut = [...byName.entries()].map(([name, geom]) => ({
  type: 'Feature',
  properties: { name, type_ch: '郡' },
  geometry: { type: 'MultiPolygon', coordinates: roundCoords(geom) },
}));

// ── 点位：CHGIS 郡治（西北/北部无界线数据，只取治所）────────
// 已有多边形界线的郡不再取点位；郯郡与东海郡同治（郯县），去重保留东海
const pgnNames = new Set(pgnOut.map(f => f.properties.name));
const seen = new Set();
const ptsOut = [];
for (const f of pts.features) {
  const name = f.properties.NAME_CH === '京兆尹' ? '内史' : f.properties.NAME_CH; // CHGIS 以京兆尹通贯秦汉内史
  if (pgnNames.has(name) || name === '郯郡') continue;
  const key = f.geometry.coordinates.map(x => x.toFixed(2)).join(',');
  if (seen.has(key)) continue;
  seen.add(key);
  ptsOut.push({
    type: 'Feature',
    properties: { name, type_ch: '郡' },
    geometry: { type: 'Point', coordinates: roundCoords(f.geometry.coordinates) },
  });
}

// ── 补点：CHGIS 缺失而郡治坐标史有明文的郡（界线仍由 Voronoi 生成）──
const SUPPLEMENT = [
  { name: '九原郡', xy: [109.9, 40.6], basis: '治九原（今包头西南），蒙恬取河南地后置' },
  { name: '渔阳郡', xy: [116.73, 40.33], basis: '治渔阳（今北京怀柔一带），沿用 CHGIS 汉渔阳治' },
  { name: '右北平郡', xy: [118.5, 41.4], basis: '治平刚（今内蒙古宁城甸子一带）' },
  { name: '辽西郡', xy: [120.9, 41.4], basis: '治阳乐（今辽宁义县西），秦治无定说取汉治' },
  { name: '辽东郡', xy: [123.17, 41.27], basis: '治襄平（今辽阳）' },
  { name: '薛郡', xy: [116.99, 35.58], basis: '治鲁县（今曲阜）' },
];
for (const s of SUPPLEMENT) {
  ptsOut.push({ type: 'Feature', properties: { name: s.name, type_ch: '郡', note: '补点', basis: s.basis }, geometry: { type: 'Point', coordinates: s.xy } });
}

writeFileSync(`${ROOT}tools/sources/chgis-v6-qin-pgn.json`, JSON.stringify({ type: 'FeatureCollection', features: pgnOut }));
writeFileSync(`${ROOT}tools/sources/chgis-v6-qin-pts.json`, JSON.stringify({ type: 'FeatureCollection', features: ptsOut }));
console.log(`chgis-v6-qin-pgn.json  ${pgnOut.length} 郡（CHGIS 界线）: ${pgnOut.map(f => f.properties.name).join('、')}`);
console.log(`chgis-v6-qin-pts.json  ${ptsOut.length} 郡（治所点位，Voronoi 成界）`);
