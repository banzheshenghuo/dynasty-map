#!/usr/bin/env node
// 递归阿里 DataV GeoAtlas，提取省/市/县三级行政区驻地点位 → tools/sources/modern-places.json
// 只取 properties（name/adcode/center/level），几何即弃不落盘。产物为静态源（入库），
// build-data.mjs 从其产出 data/geo/places-modern.json，此后 build 不再联网。
// 用法: node tools/sources/fetch-modern-places.mjs
import { writeFileSync } from 'node:fs';

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound/';
const CONCURRENCY = 8;

async function fetchJson(url, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retry - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try { out[i] = await fn(items[i], i); }
        catch (e) { console.warn(`  ${items[i]?.name ?? items[i]} 失败: ${e.message}`); out[i] = null; }
      }
    })
  );
  return out;
}

const feat = (p, province, city) => ({
  type: 'Feature',
  properties: {
    name: p.name, adcode: p.adcode, level: p.level,
    ...(province ? { province } : {}),
    ...(city ? { city } : {}),
  },
  geometry: { type: 'Point', coordinates: [p.center[0], p.center[1]] },
});

const out = { type: 'FeatureCollection', features: [] };

console.log('拉取省级行政区…');
const top = await fetchJson(`${BASE}100000_full.json`);
const provs = top.features.map(f => f.properties).filter(p => p.center && p.level === 'province');
for (const p of provs) out.features.push(feat(p));
console.log(`  ${provs.length} 省级`);

// 省级 full：普通省返回市级；直辖市/省直辖县级市返回区县级（挂省名）
console.log('拉取地市级…');
const cityLists = await mapLimit(provs, CONCURRENCY, async p => {
  const j = await fetchJson(`${BASE}${p.adcode}_full.json`);
  const cities = [];
  for (const f of j.features) {
    const x = f.properties;
    if (!x.center) continue;
    if (x.level === 'city') {
      out.features.push(feat(x, p.name));
      cities.push({ ...x, province: p.name });
    } else if (x.level === 'district') {
      // 直辖市辖区与省直辖县级市（济源/仙桃/潜江/天门/兵团市等）
      out.features.push(feat(x, p.name, p.name));
    }
  }
  return cities;
});
const cities = cityLists.filter(Boolean).flat();
console.log(`  ${cities.length} 地市级`);

console.log('拉取区县级…');
let nDist = 0;
await mapLimit(cities, CONCURRENCY, async c => {
  const j = await fetchJson(`${BASE}${c.adcode}_full.json`);
  for (const f of j.features) {
    const x = f.properties;
    if (!x.center || x.level !== 'district') continue;
    out.features.push(feat(x, c.province, c.name));
    nDist++;
  }
});
console.log(`  ${nDist} 区县级`);

const byLevel = out.features.reduce((m, f) => ((m[f.properties.level] = (m[f.properties.level] || 0) + 1), m), {});
console.log(`合计 ${out.features.length} 点：`, JSON.stringify(byLevel));
writeFileSync(new URL('./modern-places.json', import.meta.url), JSON.stringify(out));
console.log('已写 tools/sources/modern-places.json');
