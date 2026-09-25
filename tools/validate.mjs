#!/usr/bin/env node
/** 数据自检：结构、字段、坐标范围、文件引用完整性 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0;
const fail = msg => { console.error('  ✗ ' + msg); errors++; };
const ok = msg => console.log('  ✓ ' + msg);

const dynasties = JSON.parse(readFileSync(join(ROOT, 'data/dynasties.json'), 'utf8'));
ok(`dynasties.json 载入 ${dynasties.length} 个朝代`);
if (dynasties.length !== 6) fail(`期望 6 个朝代，实际 ${dynasties.length}`);

const walk = (c, fn) => (typeof c[0] === 'number' ? fn(c) : c.forEach(x => walk(x, fn)));

for (const d of dynasties) {
  for (const key of ['id', 'name', 'period', 'snapshotLabel', 'color', 'summary', 'geoFile', 'eventsFile']) {
    if (!d[key]) fail(`${d.id || '?'} 缺少字段 ${key}`);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(d.color || '')) fail(`${d.id} 颜色格式错误: ${d.color}`);

  const geoPath = join(ROOT, 'data', d.geoFile);
  if (!existsSync(geoPath)) { fail(`${d.id} 疆域文件不存在: ${d.geoFile}`); continue; }
  const geo = JSON.parse(readFileSync(geoPath, 'utf8'));
  if (geo.type !== 'FeatureCollection' || !geo.features.length) fail(`${d.id} GeoJSON 结构错误`);
  const hasDyn = geo.features.some(f => f.properties?.name === '__dynasty__');
  if (!hasDyn) fail(`${d.id} 缺少 __dynasty__ 要素`);
  let bad = 0, n = 0;
  geo.features.forEach(f => walk(f.geometry.coordinates, ([x, y]) => {
    n++;
    if (!(x >= -180 && x <= 180 && y >= -90 && y <= 90)) bad++;
  }));
  if (bad) fail(`${d.id} 有 ${bad}/${n} 个坐标越界`); else ok(`${d.id} 疆域 ${n} 点坐标合法`);

  const evPath = join(ROOT, 'data', d.eventsFile);
  if (!existsSync(evPath)) { fail(`${d.id} 事件文件不存在: ${d.eventsFile}`); continue; }
  const events = JSON.parse(readFileSync(evPath, 'utf8'));
  const titles = new Set();
  let sorted = true, prev = -Infinity;
  for (const e of events) {
    for (const key of ['year', 'yearLabel', 'title', 'description', 'location']) {
      if (e[key] == null) fail(`${d.id} 事件「${e.title || '?'}」缺少 ${key}`);
    }
    const { lng, lat } = e.location || {};
    if (typeof lng !== 'number' || !(lng >= 70 && lng <= 140)) fail(`${d.id}「${e.title}」经度异常: ${lng}`);
    if (typeof lat !== 'number' || !(lat >= 15 && lat <= 58)) fail(`${d.id}「${e.title}」纬度异常: ${lat}`);
    if (titles.has(e.title)) fail(`${d.id} 事件标题重复: ${e.title}`);
    titles.add(e.title);
    if (e.year < prev) sorted = false;
    prev = e.year;
  }
  if (!sorted) fail(`${d.id} 事件未按年份排序`);
  ok(`${d.id} 事件 ${events.length} 条（${events[0]?.yearLabel} → ${events[events.length - 1]?.yearLabel}）`);
}

const modern = JSON.parse(readFileSync(join(ROOT, 'data/geo/modern.json'), 'utf8'));
if (!modern.features.some(f => f.properties?.name === '__modern__')) fail('modern.json 缺少 __modern__ 要素');
else ok('modern.json 现代轮廓就绪');

const neighbors = JSON.parse(readFileSync(join(ROOT, 'data/geo/neighbors.json'), 'utf8'));
if (!neighbors.features.some(f => f.properties?.name === '__neighbors__')) fail('neighbors.json 缺少 __neighbors__ 要素');
else if (neighbors.features.some(f => f.properties?.country === 'China')) fail('neighbors.json 不应包含中国本体');
else ok('neighbors.json 邻国底图就绪（' + neighbors.features.length + ' 国');

if (errors) { console.error(`\n共 ${errors} 个问题`); process.exit(1); }
console.log('\n数据自检全部通过');
