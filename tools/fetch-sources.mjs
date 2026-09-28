#!/usr/bin/env node
/**
 * 源数据获取：下载构建管线所需的外部源到 tools/sources/raw/（.gitignore，不入库）。
 *  - CHGIS V6 时序政区（CC BY-NC-SA 3.0，学术用途；禁止整包再分发——本目录不入库）
 *  - historical-basemaps 世界断面（疆域轮廓锚点；GPL-3）
 * 下载后用 mapshaper 将 shapefile 转为管线读取的 GeoJSON 子集。
 * 用法：node tools/fetch-sources.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const RAW = new URL('./sources/raw/', import.meta.url).pathname;
mkdirSync(RAW, { recursive: true });

const downloads = [
  // CHGIS V6 时序政区面/点（Harvard Dataverse）
  ['v6_time_pref_pgn_utf_wgs84.zip', 'https://dataverse.harvard.edu/api/access/datafile/2966510'],
  ['v6_time_pref_pts_utf_wgs84.zip', 'https://dataverse.harvard.edu/api/access/datafile/2970286'],
  // 疆域轮廓锚点（historical-basemaps）
  ...['bc200', 'bc100', 'bc1', 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1279,
    1300, 1400, 1492, 1530, 1600, 1650, 1700, 1783, 1800, 1878, 1900]
    .map(y => [`world_${y}.geojson`, `https://cdn.jsdelivr.net/gh/aourednik/historical-basemaps@master/geojson/world_${y}.geojson`]),
];

for (const [file, url] of downloads) {
  if (existsSync(`${RAW}${file}`)) { console.log(`已有 ${file}`); continue; }
  console.log(`下载 ${file} ...`);
  execSync(`curl -sL --retry 3 --max-time 300 -o "${RAW}${file}" "${url}"`, { stdio: 'inherit' });
}

// shapefile → GeoJSON（字段裁剪 + 12% 简化 + 0.001° 精度；约 74MB → 11MB）
execSync(
  `npx mapshaper ${RAW}v6_time_pref_pgn_utf_wgs84.shp -filter-fields NAME_CH,BEG_YR,END_YR,TYPE_CH,LEV_RANK ` +
  `-simplify 12% visvalingam -o precision=0.001 format=geojson ${RAW}../chgis-v6-time-pgn.json`,
  { stdio: 'inherit' },
);
execSync(
  `npx mapshaper ${RAW}v6_time_pref_pts_utf_wgs84.shp -filter-fields NAME_CH,BEG_YR,END_YR,TYPE_CH,LEV_RANK ` +
  `-o precision=0.001 format=geojson ${RAW}../chgis-v6-time-pts.json`,
  { stdio: 'inherit' },
);
console.log('源数据就绪：tools/sources/chgis-v6-time-{pgn,pts}.json + raw/ 锚点断面');
