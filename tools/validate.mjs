#!/usr/bin/env node
/** 数据自检：结构、字段、坐标范围、文件引用完整性 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;
const fail = msg => { console.error('  ✗ ' + msg); errors++; };
const ok = msg => console.log('  ✓ ' + msg);

const walk = (c, fn) => (typeof c[0] === 'number' ? fn(c) : c.forEach(x => walk(x, fn)));
const coordCheck = fc => {
  let bad = 0, n = 0;
  fc.features.forEach(f => walk(f.geometry.coordinates, ([x, y]) => {
    n++;
    if (!(x >= -180 && x <= 180 && y >= -90 && y <= 90)) bad++;
  }));
  return { bad, n };
};

// ── timeline.json：唯一入口 ─────────────────────────────────
const tl = JSON.parse(readFileSync(join(ROOT, 'data/timeline.json'), 'utf8'));
const { range, eras, snapshots, events } = tl;
if (!(range?.from < range.to)) fail(`range 非法: ${JSON.stringify(range)}`);
else ok(`timeline.json range 前${-range.from}年 → ${range.to}年`);

// ── 时代分段：无缝衔接覆盖 range，与断面/事件的 era 对齐 ────
const eraNames = new Set(eras?.map(e => e.name) || []);
if (!eras?.length) fail('eras 为空');
else {
  if (eras[0].from !== range.from || eras[eras.length - 1].to !== range.to)
    fail('eras 首尾未覆盖 range');
  let seamless = true;
  for (let i = 1; i < eras.length; i++)
    if (eras[i].from !== eras[i - 1].to || eras[i].from >= eras[i].to) seamless = false;
  if (!seamless) fail('eras 分段未无缝升序衔接');
  for (const e of eras) {
    if (!/^#[0-9a-fA-F]{6}$/.test(e.color || '')) fail(`时代 ${e.name} 颜色格式错误: ${e.color}`);
    if (!e.summary) fail(`时代 ${e.name} 缺 summary`);
  }
  if (seamless) ok(`eras ${eras.length} 段无缝衔接（${eras[0].name} → ${eras[eras.length - 1].name}）`);
}
for (const s of snapshots || []) if (!eraNames.has(s.era)) fail(`断面 ${s.id} era "${s.era}" 不在 eras[] 中`);
for (const e of events || []) if (!eraNames.has(e.era)) fail(`事件「${e.title}」era "${e.era}" 不在 eras[] 中`);

// ── 断面 ────────────────────────────────────────────────────
let prevYear = -Infinity;
const allRegimeSpellings = new Map(); // 全局唯一拼写检查
for (const s of snapshots) {
  for (const key of ['id', 'year', 'era', 'label', 'note', 'geoFile']) {
    if (s[key] == null) fail(`断面缺少字段 ${key}: ${JSON.stringify(s.id ?? s)}`);
  }
  if (s.year <= prevYear) fail(`${s.id} 断面年份未严格升序（${s.year} ≤ ${prevYear}）`);
  if (s.year < range.from || s.year > range.to) fail(`${s.id} 年份 ${s.year} 越出 range`);
  prevYear = s.year;

  if (!Array.isArray(s.regimes) || !s.regimes.length) fail(`${s.id} regimes 为空`);
  const names = new Set();
  for (const r of s.regimes || []) {
    if (!r.name) fail(`${s.id} 政权缺 name`);
    if (names.has(r.name)) fail(`${s.id} 政权名重复: ${r.name}`);
    names.add(r.name);
    if (!/^#[0-9a-fA-F]{6}$/.test(r.color || '')) fail(`${s.id}·${r.name} 颜色格式错误: ${r.color}`);
    if (typeof r.weak !== 'boolean') fail(`${s.id}·${r.name} weak 须为布尔`);
    const prev = allRegimeSpellings.get(r.name);
    if (prev && prev !== r.color) fail(`政权 ${r.name} 跨断面颜色漂移: ${prev} vs ${r.color}`);
    allRegimeSpellings.set(r.name, r.color);
  }

  const geoPath = join(ROOT, 'data', s.geoFile);
  if (!existsSync(geoPath)) { fail(`${s.id} 疆域文件不存在: ${s.geoFile}`); continue; }
  const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
  if (geo.type !== 'FeatureCollection' || !geo.features.length) fail(`${s.id} 疆域 GeoJSON 结构错误`);
  else {
    const sentinels = new Set();
    for (const f of geo.features) {
      const m = /^__regime_(.+)$/.exec(f.properties?.name || '');
      if (!m) { fail(`${s.id} 疆域哨兵名非法: ${f.properties?.name}`); continue; }
      if (f.properties.regime !== m[1]) fail(`${s.id} regime 属性与哨兵后缀不一致: ${f.properties.name}`);
      if (!names.has(m[1])) fail(`${s.id} 疆域哨兵政权 ${m[1]} 不在 regimes[] 中`);
      sentinels.add(m[1]);
    }
    for (const n of names) if (!sentinels.has(n)) fail(`${s.id}·${n} 缺少疆域要素`);
    const { bad, n } = coordCheck(geo);
    if (bad) fail(`${s.id} 有 ${bad}/${n} 个坐标越界`);
    else ok(`${s.id} ${s.label}  政权${geo.features.length} 坐标${n}点合法`);
  }

  // placesFile 可选（据点层：都邑/方国/遗址点位，上古断面为主）
  if (s.placesFile != null) {
    const placesPath = join(ROOT, 'data', s.placesFile);
    if (!existsSync(placesPath)) fail(`${s.id} 据点文件不存在: ${s.placesFile}`);
    else {
      const places = JSON.parse(readFileSync(placesPath, 'utf8'));
      const KINDS = new Set(['都城', '都邑', '方国', '遗址']);
      let bad = 0;
      const seen = new Set();
      for (const f of places.features || []) {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates || [];
        if (!p.name || seen.has(p.name)) bad++, fail(`${s.id} 据点 name 缺失或重复: ${p.name}`);
        seen.add(p.name);
        if (!KINDS.has(p.kind)) fail(`${s.id}·${p.name} kind 非法: ${p.kind}`);
        if (p.layer !== 'place') fail(`${s.id}·${p.name} layer 应为 "place"`);
        if (f.geometry?.type !== 'Point') fail(`${s.id}·${p.name} 几何须为 Point`);
        if (typeof p.today !== 'string' || !p.today) fail(`${s.id}·${p.name} 缺 today 今地名`);
        if (!(lng >= 70 && lng <= 140 && lat >= 15 && lat <= 58)) fail(`${s.id}·${p.name} 坐标异常: ${lng},${lat}`);
      }
      if (!places.features?.length) fail(`${s.id} 据点文件为空`);
      else if (!bad) ok(`${s.id} 据点层 ${places.features.length} 个（kind 合法、今地名齐全）`);
    }
  }

  // divisionsFile 可选（夏商西周上古断面无政区层）
  if (s.divisionsFile == null) continue;
  const divPath = join(ROOT, 'data', s.divisionsFile);
  if (!existsSync(divPath)) { fail(`${s.id} 政区文件不存在: ${s.divisionsFile}`); continue; }
  const div = JSON.parse(readFileSync(divPath, 'utf8'));
  if (!div.features?.length) fail(`${s.id} 政区文件为空`);
  else {
    let badName = 0, badRegime = 0;
    for (const f of div.features) {
      if (!f.properties?.name) badName++;
      const r = f.properties?.regime;
      if (r !== '' && !names.has(r)) badRegime++;
    }
    if (badName) fail(`${s.id} 有 ${badName} 个政区要素缺 name`);
    if (badRegime) fail(`${s.id} 有 ${badRegime} 个政区 regime 不明: ${[...new Set(div.features.filter(f => f.properties?.regime && !names.has(f.properties.regime)).map(f => f.properties.regime))].join('/')}`);
    const { bad, n } = coordCheck(div);
    if (bad) fail(`${s.id} 政区有 ${bad}/${n} 个坐标越界`);
    else ok(`${s.id} 政区界 ${div.features.length} 个（regime 归属齐整）`);
  }
}
ok(`断面 ${snapshots.length} 个，政权拼写 ${allRegimeSpellings.size} 个（跨断面颜色稳定）`);

// ── 事件 ────────────────────────────────────────────────────
{
  let sorted = true, prev = -Infinity, dup = 0;
  const titles = new Set();
  let out = 0, badField = 0;
  for (const e of events) {
    for (const key of ['year', 'yearLabel', 'era', 'title', 'description', 'location']) {
      if (e[key] == null) { fail(`事件「${e.title || '?'}」缺少 ${key}`); badField++; }
    }
    const { lng, lat } = e.location || {};
    if (typeof lng !== 'number' || !(lng >= 70 && lng <= 140) || typeof lat !== 'number' || !(lat >= 15 && lat <= 58)) {
      fail(`事件「${e.title}」坐标异常: ${lng},${lat}`); badField++;
    }
    if (e.year < range.from || e.year > range.to) out++;
    if (titles.has(e.title)) dup++;
    titles.add(e.title);
    if (e.year < prev) sorted = false;
    prev = e.year;
  }
  if (!sorted) fail('事件未按年份排序');
  if (dup) fail(`事件标题重复 ${dup} 条`);
  if (out) fail(`有 ${out} 条事件年份越出 range`);
  if (!badField) ok(`事件 ${events.length} 条（${events[0]?.yearLabel} → ${events[events.length - 1]?.yearLabel}，升序无重复）`);
}

// ── 对照底图三件 ────────────────────────────────────────────
const modern = JSON.parse(readFileSync(join(ROOT, 'data/geo/modern.json'), 'utf8'));
if (!modern.features.some(f => f.properties?.name === '__modern__')) fail('modern.json 缺少 __modern__ 要素');
else ok('modern.json 现代轮廓就绪');

const neighbors = JSON.parse(readFileSync(join(ROOT, 'data/geo/neighbors.json'), 'utf8'));
if (!neighbors.features.some(f => f.properties?.name === '__neighbors__')) fail('neighbors.json 缺少 __neighbors__ 要素');
else if (neighbors.features.some(f => f.properties?.country === 'China')) fail('neighbors.json 不应包含中国本体');
else ok(`neighbors.json 邻国底图就绪（${neighbors.features.length} 国）`);

const provinces = JSON.parse(readFileSync(join(ROOT, 'data/geo/provinces.json'), 'utf8'));
if (!provinces.features.some(f => f.properties?.name === '__provinces__')) fail('provinces.json 缺少 __provinces__ 要素');
else ok(`provinces.json 省界就绪（${provinces.features.length} 个省级政区）`);

// ── 现代地名点位（省/市/县驻地，随「现代地名」开关懒加载）────
{
  const path = join(ROOT, 'data/geo/places-modern.json');
  if (!existsSync(path)) fail('places-modern.json 不存在');
  else {
    const mp = JSON.parse(readFileSync(path, 'utf8'));
    const LEVELS = new Set(['province', 'city', 'district']);
    let bad = 0;
    const byLevel = {};
    for (const f of mp.features || []) {
      const p = f.properties || {};
      const [lng, lat] = f.geometry?.coordinates || [];
      if (!p.name || !LEVELS.has(p.level) || typeof p.adcode !== 'number' || p.layer !== 'modern-place') { bad++; continue; }
      if (f.geometry?.type !== 'Point') { bad++; continue; }
      // 含三沙市南沙区（南沙群岛 ~9.5°N），纬度下界较事件范围更宽
      if (!(lng >= 70 && lng <= 140 && lat >= 9 && lat <= 58)) { bad++; fail(`现代地名「${p.name}」坐标异常: ${lng},${lat}`); }
      byLevel[p.level] = (byLevel[p.level] || 0) + 1;
    }
    if (bad) fail(`places-modern.json 有 ${bad} 个非法要素`);
    else if ((byLevel.province || 0) < 30 || (byLevel.city || 0) < 300 || (byLevel.district || 0) < 2500)
      fail(`places-modern.json 数量异常: ${JSON.stringify(byLevel)}`);
    else ok(`places-modern.json ${mp.features.length} 点（省${byLevel.province}/市${byLevel.city}/县${byLevel.district}）`);
  }
}

if (errors) { console.error(`\n共 ${errors} 个问题`); process.exit(1); }
console.log('\n数据自检全部通过');
