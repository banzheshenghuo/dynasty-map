import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// 稳定取景框：所有朝代共用同一经纬范围，避免切换时视口跳动
const BOUNDS = [[70, 15], [138, 57]];
// 淡墨：现代轮廓参照线
const MODERN_BORDER_ON = 'rgba(96, 82, 60, 0.6)';
// 邻国底图：更淡的墨色，衬托而不抢疆域主体
const NEIGHBOR_BORDER_ON = 'rgba(96, 82, 60, 0.30)';
const NEIGHBOR_FILL_ON = 'rgba(120, 102, 70, 0.05)';
// 现代省界：淡墨实线，现行界线作底图参照，视觉上退后（墨=今）
const PROVINCE_BORDER_ON = 'rgba(96, 82, 60, 0.20)';
const PROVINCE_FILL_ON = 'rgba(120, 102, 70, 0.03)';
// 本朝政区界（郡/州/路/府）：朱砂虚线，与事件点/印章同源（朱=史），
// 虚线是制图学通行的历史界线符号，与现代实线形成古今双轨
const DIVISION_BORDER_ON = 'rgba(158, 61, 44, 0.55)';
const DIVISION_DASH = [3, 2];
// 政区悬浮/选中：悬浮边框朱砂提亮加粗，选中用更深的陈朱常驻
const DIVISION_HOVER_BORDER = 'rgba(158, 61, 44, 0.95)';
const DIVISION_SELECT_BORDER = '#7e2f22';
// 朱砂：事件圆点
const EVENT_DOT = '#9e3d2c';
const PAPER = '#f6eed9';

// 楷体注记字体栈：MapLibre v6 fontFaces（自托管 LXGW woff2 分片，见 tools/gen-fonts.mjs）
// 为唯一 text-font；CJK 加载失败逐级回落：下一分片 → glyphs（未设）→ localIdeographFontFamily
const KAITI_STACK = 'LXGW WenKai';
const LOCAL_KAITI = "'Kaiti SC','STKaiti','KaiTi','FangSong',serif";

let map = null;
let container = null;
let modernGeo = null;
let neighborGeo = null;
let provinceGeo = null;
let dotSize = 9;
let selSize = 13;
// 断面政区界（郡/州/路/府）：按断面懒加载；要素名即政区名（唯一），
// feature-state 高亮以 promoteId('name') 为要素 id
let divisionGeo = null;
let divisionsVisible = true;
const divCache = new Map();
// 断面据点层（都城/都邑/方国/遗址）：懒加载同政区层，失败静默降级
let placeGeoFeatures = [];
const placeCache = new Map();
// 断面路线层（迁都/征伐示意线）：懒加载同据点层，失败静默降级
let routeGeoFeatures = [];
const routeCache = new Map();
// 现代地名点位（省/市/县驻地）：随「现代地名」开关懒加载，按缩放分层显示
let modernPlacesGeo = null;
let modernPlacesVisible = false;
let currentSnap = null;
let currentEvents = [];
let selectedEvent = null;
let modernVisible = true;
let onEventClick = null;

const BASE = import.meta.env.BASE_URL;
const geoCache = new Map();

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const EMPTY = { type: 'FeatureCollection', features: [] };

async function fetchJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`加载失败 ${path}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchGeo(snap) {
  if (!geoCache.has(snap.id)) {
    geoCache.set(snap.id, fetchJson(snap.geoFile));
  }
  return geoCache.get(snap.id);
}

function fetchDivisions(snap) {
  if (!snap.divisionsFile) return Promise.resolve(null);
  if (!divCache.has(snap.id)) {
    divCache.set(
      snap.id,
      fetchJson(snap.divisionsFile).catch((e) => {
        console.warn(`政区图层加载失败，本断面不显示政区界: ${snap.divisionsFile}`, e);
        return null;
      })
    );
  }
  return divCache.get(snap.id);
}

function fetchPlaces(snap) {
  if (!snap.placesFile) return Promise.resolve(null);
  if (!placeCache.has(snap.id)) {
    placeCache.set(
      snap.id,
      fetchJson(snap.placesFile).catch((e) => {
        console.warn(`据点图层加载失败，本断面不显示据点: ${snap.placesFile}`, e);
        return null;
      })
    );
  }
  return placeCache.get(snap.id);
}

function fetchRoutes(snap) {
  if (!snap.routesFile) return Promise.resolve(null);
  if (!routeCache.has(snap.id)) {
    routeCache.set(
      snap.id,
      fetchJson(snap.routesFile).catch((e) => {
        console.warn(`路线图层加载失败，本断面不显示路线: ${snap.routesFile}`, e);
        return null;
      })
    );
  }
  return routeCache.get(snap.id);
}

// ── 政区名注记：形心定位 + symbol 碰撞避让 ──────────────────
const ringArea = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  return Math.abs(a / 2);
};

const ringCentroid = ring => {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    a += c; x += (ring[i][0] + ring[j][0]) * c; y += (ring[i][1] + ring[j][1]) * c;
  }
  a *= 0.5;
  return a ? [x / (6 * a), y / (6 * a)] : null;
};

// 形心落环外（狭长/凹多边形）时依次回退 bbox 中心、网格采样，取首个环内点
function labelPoint(polys) {
  let best = null, bestA = 0;
  for (const poly of polys) {
    const a = ringArea(poly[0]);
    if (a > bestA) { bestA = a; best = poly; }
  }
  if (!best) return null;
  const outer = best[0];
  const xs = outer.map(p => p[0]), ys = outer.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cands = [ringCentroid(outer), [(x0 + x1) / 2, (y0 + y1) / 2]];
  for (let gx = 1; gx <= 5; gx++)
    for (let gy = 1; gy <= 5; gy++)
      cands.push([x0 + (x1 - x0) * gx / 6, y0 + (y1 - y0) * gy / 6]);
  for (const [x, y] of cands) {
    if (x == null) continue;
    let inside = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const xi = outer[i][0], yi = outer[i][1], xj = outer[j][0], yj = outer[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (!inside) continue;
    let inHole = false;
    for (let h = 1; h < best.length; h++) {
      const ring = best[h];
      let hin = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hin = !hin;
      }
      if (hin) { inHole = true; break; }
    }
    if (!inHole) return [x, y];
  }
  return null;
}

// 注记数据：按政区面积降序生成点要素（symbol-sort-key 越小碰撞优先级越高）
let divLabelData = [];
let labelFontSize = 12;
const DIV_FONT_KEY = 'dm.divFontSize';
const clampFontSize = px => Math.min(20, Math.max(9, Math.round(px)));

// 断面主政权色（选中涟漪、事件卡、侧栏标题等强调用）
export const primaryColor = snap =>
  snap.regimes.find(r => !r.weak)?.color || snap.regimes[0]?.color || '#9e3d2c';

// ── 政区悬浮提示与高亮：feature-state（promoteId 要素名）──
let divTipEl = null;
let hoverDivName = null;
let selectedDivName = null;

function hideDivTip() {
  if (divTipEl) divTipEl.hidden = true;
}

function showDivTip(px, py, div) {
  if (!divTipEl) return;
  divTipEl.hidden = false;
  divTipEl.innerHTML = `<div class="tip-title">${div.name}</div>
    <div class="tip-loc">${currentSnap?.era || ''} · ${div.type || '政区'}</div>`;
  const w = container.clientWidth, h = container.clientHeight;
  divTipEl.style.left = Math.min(px + 14, w - 170) + 'px';
  divTipEl.style.top = Math.max(py - 52, 8) + 'px';
}

function showEventTip(px, py, e) {
  if (!divTipEl) return;
  divTipEl.hidden = false;
  divTipEl.innerHTML = `<div class="tip-year">${e.yearLabel}</div>
    <div class="tip-title">${e.title}</div>
    ${e.location.name ? `<div class="tip-loc">${e.location.name}</div>` : ''}
    <div class="tip-desc">${e.description}</div>`;
  const w = container.clientWidth;
  divTipEl.style.left = Math.min(px + 14, w - 200) + 'px';
  divTipEl.style.top = Math.max(py - 60, 8) + 'px';
}

function setDivisionState(name, state) {
  if (!map || !name) return;
  try {
    map.setFeatureState({ source: 'divisions', id: name }, state);
  } catch { /* 要素未加载完成时静默 */ }
}

function setHoverDivision(name) {
  if (hoverDivName === name) return;
  if (hoverDivName) setDivisionState(hoverDivName, { hover: false });
  hoverDivName = name;
  if (name) setDivisionState(name, { hover: true });
}

function clearSelectedDivision() {
  if (!selectedDivName) return;
  setDivisionState(selectedDivName, { selected: false });
  selectedDivName = null;
}

function toggleSelectedDivision(name) {
  clearSelectedDivision();
  if (name) {
    selectedDivName = name;
    setDivisionState(name, { selected: true });
  }
}

function resetDivisionHighlights() {
  setHoverDivision(null);
  clearSelectedDivision();
}

// 触屏设备不做悬浮跟随（手指拖动会连发 pointermove），政区高亮一律 tap 点选驱动
const isTouchLike = window.matchMedia('(pointer: coarse)').matches;

// 事件提示卡与据点提示卡共用 #div-tip 容器，位置随鼠标
const eventTipHtml = e => `<div class="tip-year">${e.yearLabel}</div>
  <div class="tip-title">${e.title}</div>
  ${e.location.name ? `<div class="tip-loc">${e.location.name}</div>` : ''}
  <div class="tip-desc">${e.description}</div>`;

const placeTipHtml = d => `<div class="tip-title">${d.name}</div>
  <div class="tip-loc">${d.kind}${d.stance ? `（${d.stance}）` : ''} · 今${d.today}</div>
  ${d.note ? `<div class="tip-desc">${d.note}</div>` : ''}`;

const routeTipHtml = d => `<div class="tip-title">${d.name}</div>
  <div class="tip-loc">${d.kind} · 示意路线</div>
  ${d.note ? `<div class="tip-desc">${d.note}</div>` : ''}`;

function bindHoverTips() {
  const show = (e, html) => {
    divTipEl.hidden = false;
    divTipEl.innerHTML = html;
    divTipEl.style.maxHeight = '40vh';
    divTipEl.style.overflowY = 'auto';
    const w = container.clientWidth;
    divTipEl.style.left = Math.min(e.point.x + 14, w - 200) + 'px';
    divTipEl.style.top = Math.max(e.point.y - 60, 8) + 'px';
  };
  const bindSeries = (layerId, getData, htmlFn) => {
    map.on('mouseenter', layerId, e => {
      const d = getData(e);
      if (!d) return;
      map.getCanvas().style.cursor = 'pointer';
      show(e, htmlFn(d));
    });
    map.on('mousemove', layerId, e => {
      if (divTipEl.hidden) return;
      const w = container.clientWidth;
      divTipEl.style.left = Math.min(e.point.x + 14, w - 200) + 'px';
      divTipEl.style.top = Math.max(e.point.y - 60, 8) + 'px';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      hideDivTip();
    });
  };
  // 事件点：GeoJSON 瓦片化会序列化 properties，事件对象以 JSON 字符串挂载
  bindSeries('events', e => {
    const raw = e.features?.[0]?.properties?.__event;
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }, eventTipHtml);
  // 据点层（属性全为扁平字符串，无序列化问题）
  bindSeries('places', e => e.features?.[0]?.properties || null, placeTipHtml);
  // 路线层（命中挂在透明加宽的 hit 线上）
  bindSeries('routes-hit', e => e.features?.[0]?.properties || null, routeTipHtml);
}

function bindDivisionHover() {
  if (!isTouchLike) {
    map.on('mousemove', 'divisions-fill', e => {
      const f = e.features?.[0];
      setHoverDivision(f?.properties?.name ?? null);
      if (f) {
        map.getCanvas().style.cursor = 'pointer';
        showDivTip(e.point.x, e.point.y, f.properties);
      } else {
        map.getCanvas().style.cursor = '';
        hideDivTip();
      }
    });
    map.on('mouseleave', 'divisions-fill', () => {
      setHoverDivision(null);
      hideDivTip();
    });
  } else {
    // 触屏：拖动时仅收起残留提示卡
    map.on('mousemove', hideDivTip);
  }
  // 桌面悬浮+点选、触屏点选共用：点击政区切换常驻高亮并弹提示卡，
  // 点击空白取消选中；再点已选中的政区视为取消，顺带收起提示卡
  map.on('click', 'divisions-fill', e => {
    const f = e.features?.[0];
    if (!f) return;
    const name = f.properties.name;
    const deselect = selectedDivName === name;
    toggleSelectedDivision(deselect ? null : name);
    deselect ? hideDivTip() : showDivTip(e.point.x, e.point.y, f.properties);
  });
  map.on('click', e => {
    const hits = map.queryRenderedFeatures(e.point, {
      layers: ['divisions-fill', 'events', 'places', 'routes-hit'].filter(id => map.getLayer(id)),
    });
    if (!hits.length) {
      setHoverDivision(null);
      clearSelectedDivision();
      hideDivTip();
    }
  });
}

// ── 据点层 icon：canvas 离屏预绘（符号分级），addImage 注册 ──
// icon 依赖断面主政权色，随断面重绘注册（同名覆盖需先 removeImage）
function makeIcon(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2; // 高分屏 2x
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  draw(ctx, size);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function diamondPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

function applyPlaceIcons(color) {
  const defs = {
    capital: { r: 4.5, fill: color, stroke: PAPER, sw: 1.2, shape: 'circle' },
    city: { r: 3.5, fill: rgba(color, 0.90), sw: 0, shape: 'circle' },
    state: { r: 3.5, fill: rgba(color, 0.75), sw: 0, shape: 'diamond' },
    // 部族三档：邻居淡空心（缺省）、敌国实心醒目、时叛时服浓描边空心
    tribe: { r: 2.75, fill: 'rgba(0,0,0,0)', stroke: rgba(color, 0.55), sw: 1.4, shape: 'diamond' },
    'tribe-foe': { r: 3.1, fill: rgba(color, 0.88), sw: 0, shape: 'diamond' },
    'tribe-rebel': { r: 3, fill: 'rgba(0,0,0,0)', stroke: rgba(color, 0.9), sw: 1.7, shape: 'diamond' },
    site: { r: 3, fill: 'rgba(0,0,0,0)', stroke: rgba(color, 0.85), sw: 1.6, shape: 'circle' },
    ring: { r: 8.5, fill: 'rgba(0,0,0,0)', stroke: rgba(color, 0.55), sw: 1.4, shape: 'circle' },
    // 路线沿线箭头：三角指向行进方向（symbol-placement:'line' 随切线旋转）
    arrow: { r: 4.5, fill: rgba(color, 0.85), stroke: PAPER, sw: 1, shape: 'arrow' },
  };
  for (const [key, d] of Object.entries(defs)) {
    const s = d.r + d.sw + 3;
    const img = makeIcon(ctx => {
      if (d.shape === 'diamond') diamondPath(ctx, s, s, d.r);
      else if (d.shape === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(s - d.r * 0.75, s - d.r * 0.85);
        ctx.lineTo(s + d.r, s);
        ctx.lineTo(s - d.r * 0.75, s + d.r * 0.85);
        ctx.closePath();
      } else ctx.arc(s, s, d.r, 0, Math.PI * 2);
      if (d.fill !== 'rgba(0,0,0,0)') { ctx.fillStyle = d.fill; ctx.fill(); }
      if (d.sw) { ctx.strokeStyle = d.stroke; ctx.lineWidth = d.sw; ctx.stroke(); }
    }, s * 2);
    const name = key === 'arrow' ? 'route-arrow' : `place-${key}`;
    if (map.hasImage(name)) map.removeImage(name);
    map.addImage(name, img);
  }
}

// 现代地名小墨点：省/市/县三级
function applyModernPlaceIcons() {
  const defs = { mp: [2, 'rgba(60,50,35,0.8)'], mc: [1.5, 'rgba(60,50,35,0.55)'], md: [1.1, 'rgba(60,50,35,0.4)'] };
  for (const [key, [r, color]] of Object.entries(defs)) {
    const s = r + 1;
    const img = makeIcon(ctx => {
      ctx.arc(s, s, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }, s * 2);
    const name = `modern-${key}`;
    if (map.hasImage(name)) map.removeImage(name);
    map.addImage(name, img);
  }
}

// ── 王朝名称大字：政权疆域形心定位，政权色楷体（weak 政权小一号）──
let regimeLabelData = [];
function buildRegimeLabels(snap, geo) {
  const byName = new Map(snap.regimes.map(r => [r.name, r]));
  regimeLabelData = (geo?.features || [])
    .map(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const pt = labelPoint(polys);
      return pt
        ? {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pt },
            properties: {
              name: f.properties.regime,
              weak: byName.get(f.properties.regime)?.weak ? true : undefined,
              color: byName.get(f.properties.regime)?.color || '#3b3226',
            },
          }
        : null;
    })
    .filter(Boolean);
}

// ── 现代地名点位：minzoom/maxzoom 声明式分层 + 各级开关（visibility）──
// 分层阈值按视野覆盖粗定：<2.2 全国看省名；2.2–4.8 数省看省市；≥4.8 放大看市县。
const MP_LAYERS = {
  province: { minzoom: 0, maxzoom: 4.8, icon: 'modern-mp', fontSize: 11, color: '#514634' },
  city: { minzoom: 2.2, maxzoom: 24, icon: 'modern-mc', fontSize: 10, color: '#6a5f4c' },
  district: { minzoom: 4.8, maxzoom: 24, icon: 'modern-md', fontSize: 9, color: '#6a5f4c' },
};
let modernLevelConfig = { province: true, city: true, district: true };

const source = (id, extra = {}) => ({
  [id]: { type: 'geojson', data: EMPTY, ...extra },
});

function buildLayers() {
  return [
    // 邻国：淡墨边界 + 极淡底色，随「现代界线」开关显隐
    {
      id: 'neighbors-fill', source: 'neighbors', type: 'fill',
      paint: { 'fill-color': NEIGHBOR_FILL_ON },
    },
    {
      id: 'neighbors-line', source: 'neighbors', type: 'line',
      paint: { 'line-color': NEIGHBOR_BORDER_ON, 'line-width': 0.6 },
    },
    // 多政权并立：一政权一 feature；weak（游牧/藩属）更淡退后
    {
      id: 'regime-fill', source: 'regime', type: 'fill',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['case', ['boolean', ['get', 'weak'], false], 0.20, 0.35],
      },
    },
    {
      id: 'regime-line', source: 'regime', type: 'line',
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': ['case', ['boolean', ['get', 'weak'], false], 0.60, 1],
        'line-width': ['case', ['boolean', ['get', 'weak'], false], 1, 1.4],
      },
    },
    // 现代省界：淡墨实线
    {
      id: 'provinces-fill', source: 'provinces', type: 'fill',
      paint: { 'fill-color': PROVINCE_FILL_ON },
    },
    {
      id: 'provinces-line', source: 'provinces', type: 'line',
      paint: { 'line-color': PROVINCE_BORDER_ON, 'line-width': 0.8 },
    },
    // 本朝政区界：朱砂虚线 + feature-state 悬浮/选中高亮（fill 常态透明，供命中检测）
    {
      id: 'divisions-fill', source: 'divisions', type: 'fill',
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 'rgba(158, 61, 44, 0.14)',
          ['boolean', ['feature-state', 'hover'], false], 'rgba(158, 61, 44, 0.10)',
          'rgba(0,0,0,0)',
        ],
      },
    },
    {
      id: 'divisions-line', source: 'divisions', type: 'line',
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], DIVISION_SELECT_BORDER,
          ['boolean', ['feature-state', 'hover'], false], DIVISION_HOVER_BORDER,
          DIVISION_BORDER_ON,
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 2.6,
          ['boolean', ['feature-state', 'hover'], false], 2.2,
          1.1,
        ],
        'line-dasharray': DIVISION_DASH,
      },
    },
    // 现代国界：实线参照
    {
      id: 'modern-line', source: 'modern', type: 'line',
      paint: { 'line-color': MODERN_BORDER_ON, 'line-width': 1 },
    },
    // 断面路线层（迁都/征伐示意线）：hit 层透明加宽供悬浮命中，虚线 + 沿线箭头
    {
      id: 'routes-hit', source: 'routes', type: 'line',
      paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 10 },
    },
    {
      id: 'routes-line', source: 'routes', type: 'line',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.6,
        'line-opacity': 0.8,
        'line-dasharray': [2.5, 2],
      },
    },
    {
      id: 'routes-arrow', source: 'routes', type: 'symbol',
      layout: {
        'symbol-placement': 'line',
        'icon-image': 'route-arrow',
        'symbol-spacing': 110,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // icon-rotation-alignment 只接受 map|viewport|auto，非法值会拒载整个 style；
        // 缺省 auto 在 symbol-placement:'line' 下即沿线旋转
      },
      paint: { 'icon-opacity': 0.9 },
    },
    // 现代地名三级（声明式分层 + 三级开关 visibility；初始隐藏随主开关开启）
    ...Object.entries(MP_LAYERS).map(([level, cfg]) => ({
      id: `modern-places-${level}`,
      source: 'modern-places',
      type: 'symbol',
      minzoom: cfg.minzoom,
      maxzoom: cfg.maxzoom,
      layout: {
        visibility: 'none',
        'icon-image': cfg.icon,
        'text-field': ['get', 'name'],
        'text-font': [KAITI_STACK],
        'text-size': cfg.fontSize,
        'text-anchor': 'left',
        'text-offset': [0.55, 0],
        'text-justify': 'left',
      },
      paint: {
        'text-color': cfg.color,
        'text-halo-color': 'rgba(246, 238, 217, 0.9)',
        'text-halo-width': 2,
      },
      filter: ['==', ['get', 'level'], level],
    })),
    // 政区名注记：楷体，字号可调；面积大者优先占位（symbol-sort-key 升序）
    {
      id: 'div-labels', source: 'div-labels', type: 'symbol',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [KAITI_STACK],
        'text-size': labelFontSize,
        'symbol-sort-key': ['get', 'sortKey'],
      },
      paint: {
        'text-color': '#3b3226',
        'text-halo-color': 'rgba(246, 238, 217, 0.85)',
        'text-halo-width': 2,
      },
    },
    // 王朝名称大字：政权色楷体（史图式朝代注记）
    {
      id: 'regime-labels', source: 'regime-labels', type: 'symbol',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [KAITI_STACK],
        'text-size': ['case', ['boolean', ['get', 'weak'], false], 15, 26],
        'text-letter-spacing': 0.15,
      },
      paint: {
        'text-color': ['case', ['boolean', ['get', 'weak'], false], '#6a5f4c', ['get', 'color']],
        'text-halo-color': 'rgba(246, 238, 217, 0.75)',
        'text-halo-width': ['case', ['boolean', ['get', 'weak'], false], 2, 3],
      },
    },
    // 都城光环：外圈空心大圆，衬王都级
    {
      id: 'places-ring', source: 'places', type: 'symbol',
      filter: ['==', ['get', 'kind'], '都城'],
      layout: { 'icon-image': 'place-ring', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    },
    // 断面据点层：符号分级 + 楷体标注，标注方位四向轮转错开密集区（都城恒取上方示尊）
    // 部族按敌友分档：敌国实心、时叛时服浓描边、邻居/缺省淡空心
    {
      id: 'places', source: 'places', type: 'symbol',
      layout: {
        'icon-image': [
          'match', ['get', 'kind'],
          '都城', 'place-capital', '都邑', 'place-city', '方国', 'place-state',
          '部族', [
            'match', ['get', 'stance'],
            '敌国', 'place-tribe-foe', '时叛时服', 'place-tribe-rebel', 'place-tribe',
          ],
          'place-site',
        ],
        'text-field': ['get', 'name'],
        'text-font': [KAITI_STACK],
        'text-size': labelFontSize,
        'text-anchor': ['get', 'anchor'],
        'text-offset': [
          'match', ['get', 'anchor'],
          'top', ['literal', [0, 0.5]],
          'bottom', ['literal', [0, -0.5]],
          'left', ['literal', [-0.55, 0]],
          ['literal', [0.55, 0]],
        ],
      },
      paint: {
        'text-color': '#3b3226',
        'text-halo-color': 'rgba(246, 238, 217, 0.85)',
        'text-halo-width': 2,
      },
    },
    // 事件圆点：朱砂
    {
      id: 'events', source: 'events', type: 'circle',
      paint: {
        'circle-radius': dotSize / 2,
        'circle-color': EVENT_DOT,
        'circle-stroke-color': PAPER,
        'circle-stroke-width': 1.6,
      },
    },
  ];
}

export async function initMap(el, handlers) {
  container = el;
  onEventClick = handlers.onEventClick;
  modernGeo = await fetchJson('geo/modern.json');
  neighborGeo = await fetchJson('geo/neighbors.json');
  provinceGeo = await fetchJson('geo/provinces.json');
  const fontFaces = await fetchJson('fonts/lxgw/faces.json').catch((e) => {
    console.warn('楷体字体声明加载失败，回落系统楷体:', e);
    return null;
  });
  // woff2 url 绝对化：相对路径在无尾斜杠 URL 下会丢子路径
  if (fontFaces) {
    for (const faces of Object.values(fontFaces)) {
      for (const f of faces) f.url = BASE + f.url;
    }
  }

  // 窄屏放大圆点便于点按
  const compact = window.matchMedia('(max-width: 900px)').matches;
  dotSize = compact ? 12 : 9;
  selSize = compact ? 15 : 13;
  labelFontSize = compact ? 11 : 12;
  const savedSize = Number(localStorage.getItem(DIV_FONT_KEY));
  if (savedSize >= 9 && savedSize <= 20) labelFontSize = clampFontSize(savedSize);
  window
    .matchMedia('(max-width: 900px)')
    .addEventListener('change', e => {
      if (localStorage.getItem(DIV_FONT_KEY)) return;
      applyDivisionFontSize(e.matches ? 11 : 12);
    });

  const style = {
    version: 8,
    // glyphs 不设：text-font 全部由 font-faces 的 LXGW 分片覆盖，
    // 分片缺字时逐级回落 localIdeographFontFamily（楷体系统栈）
    'font-faces': fontFaces || undefined,
    sources: {
      ...source('neighbors'),
      ...source('regime'),
      ...source('provinces'),
      ...source('divisions', { promoteId: 'name' }),
      ...source('modern'),
      ...source('modern-places'),
      ...source('div-labels'),
      ...source('regime-labels'),
      ...source('places'),
      ...source('routes'),
      ...source('events'),
    },
    layers: buildLayers(),
  };

  map = new MapLibreMap({
    container: el,
    style,
    // CJK 分片未覆盖/加载失败时的系统楷体兜底
    localIdeographFontFamily: LOCAL_KAITI,
    maxBounds: [[60, 5], [148, 65]],
    maxZoom: 14,
    doubleClickZoom: false,
    attributionControl: false,
    fadeDuration: 0,
  });
  // 取景框留 2% 边（原 ECharts layoutSize 96% 的等价），padding 需像素值
  const pad = Math.round(Math.min(el.clientWidth, el.clientHeight) * 0.02);
  map.fitBounds(BOUNDS, { animate: false, padding: { top: pad, bottom: pad, left: pad, right: pad } });
  map.setMinZoom(map.getZoom());

  divTipEl = document.getElementById('div-tip');
  bindDivisionHover();
  bindHoverTips();

  map.on('click', 'events', e => {
    const raw = e.features?.[0]?.properties?.__event;
    if (!raw) return;
    let event = null;
    try { event = JSON.parse(raw); } catch { return; }
    hideDivTip();
    onEventClick?.(event, { fromMap: true });
  });

  // 静态底图与 icon 一次注入（addImage 需待 style 加载完成）
  map.on('load', () => {
    applyPlaceIcons('#9e3d2c');
    applyModernPlaceIcons();
    map.getSource('modern').setData(modernGeo);
    map.getSource('neighbors').setData(neighborGeo);
    map.getSource('provinces').setData(provinceGeo);
  });

  // 用 ResizeObserver 而非 window resize：boot 后时间轴填充等布局重排
  // 不会触发 window resize，画布若不跟随会溢出盖住底栏
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(el);
}

export async function setModernPlacesVisible(visible) {
  if (modernPlacesVisible === visible) return;
  modernPlacesVisible = visible;
  if (visible && !modernPlacesGeo) {
    modernPlacesGeo = await fetchJson('geo/places-modern.json').catch((e) => {
      console.warn('现代地名点位加载失败:', e);
      return null;
    });
  }
  applyModernPlaces();
}

// 现代地名各级别开关（省/市/县 checkbox）
export function setModernPlaceLevels(levels) {
  modernLevelConfig = { ...modernLevelConfig, ...levels };
  applyModernPlaces();
}

function applyModernPlaces() {
  if (!map || !map.getSource('modern-places')) return;
  map.getSource('modern-places').setData(
    modernPlacesVisible && modernPlacesGeo ? modernPlacesGeo : EMPTY
  );
  for (const level of Object.keys(MP_LAYERS)) {
    if (!map.getLayer(`modern-places-${level}`)) continue;
    map.setLayoutProperty(
      `modern-places-${level}`,
      'visibility',
      modernPlacesVisible && modernLevelConfig[level] ? 'visible' : 'none'
    );
  }
}

// 事件 → GeoJSON 点要素；GeoJSON 瓦片化会序列化 properties，
// 事件对象（含嵌套结构）以 JSON 字符串挂载，点击/悬浮时解析
const toEventFeature = e => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [e.location.lng, e.location.lat] },
  properties: { __event: JSON.stringify(e) },
});

const LABEL_POS = ['right', 'bottom', 'left', 'top'];
function toPlaceFeatures(features) {
  return (features || []).map((f, i) => {
    const p = f.properties;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: f.geometry.coordinates },
      properties: {
        name: p.name, kind: p.kind, today: p.today, note: p.note || '',
        stance: p.stance || '',
        anchor: p.kind === '都城' ? 'top' : LABEL_POS[i % LABEL_POS.length],
      },
    };
  });
}

// 路线要素：政权色注入 properties（paint 读 color，换断面只换数据，同 regime 模式）
function toRouteFeatures(features, color) {
  return (features || []).map(f => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { name: f.properties.name, kind: f.properties.kind, note: f.properties.note || '', color },
  }));
}

export async function showSnapshot(snap, events, view = {}) {
  const geo = await fetchGeo(snap);
  const [divisions, places, routes] = await Promise.all([fetchDivisions(snap), fetchPlaces(snap), fetchRoutes(snap)]);
  divisionGeo = divisions;
  placeGeoFeatures = places?.features || [];
  routeGeoFeatures = routes?.features || [];
  const byName = new Map(snap.regimes.map(r => [r.name, r]));
  // 政权配色注入要素属性：paint 表达式恒定，换断面只换数据
  const regimeFc = {
    type: 'FeatureCollection',
    features: (geo?.features || []).map(f => ({
      ...f,
      properties: {
        ...f.properties,
        color: byName.get(f.properties.regime)?.color || '#9e3d2c',
        weak: byName.get(f.properties.regime)?.weak ? true : undefined,
      },
    })),
  };
  divLabelData = divisionsVisible
    ? (divisions?.features || [])
        .map(f => ({
          f,
          area: Math.max(
            ...((f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(
              p => ringArea(p[0])
            ))
          ),
        }))
        .sort((a, b) => b.area - a.area)
        .map(({ f, area }, i) => {
          const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
          const pt = labelPoint(polys);
          return pt
            ? {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: pt },
                properties: { name: f.properties.name, sortKey: i },
              }
            : null;
        })
        .filter(Boolean)
    : [];
  currentSnap = snap;
  currentEvents = events;
  selectedEvent = null;
  resetDivisionHighlights();
  buildRegimeLabels(snap, geo);

  // 转场：先淡出画布再换数据，规避数据切换的生硬感
  container.style.opacity = '0.35';
  setTimeout(() => {
    applyPlaceIcons(primaryColor(snap));
    map.getSource('regime').setData(regimeFc);
    map.getSource('divisions').setData(divisionsVisible && divisionGeo ? divisionGeo : EMPTY);
    map.getSource('div-labels').setData({ type: 'FeatureCollection', features: divLabelData });
    map.getSource('regime-labels').setData({ type: 'FeatureCollection', features: regimeLabelData });
    map.getSource('places').setData({ type: 'FeatureCollection', features: toPlaceFeatures(placeGeoFeatures) });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: toRouteFeatures(routeGeoFeatures, primaryColor(snap)) });
    map.getSource('events').setData({
      type: 'FeatureCollection',
      features: events.map(toEventFeature),
    });
    applyModernPlaces();
    // 保持视野：显式 view 优先；未指定时继承当前缩放/中心（切换断面不再跳回全国）
    if (view.center || view.zoom) {
      map.jumpTo({ center: view.center || map.getCenter(), zoom: view.zoom || map.getZoom() });
    }
    container.style.opacity = '1';
  }, 160);
}

// 「政区界」开关：图层显隐切换（无需重建数据），保持当前视野
export async function setDivisionsVisible(visible) {
  if (divisionsVisible === visible) return;
  divisionsVisible = visible;
  if (!visible) hideDivTip();
  resetDivisionHighlights();
  if (!currentSnap) return;
  const vis = visible ? 'visible' : 'none';
  for (const layer of ['divisions-fill', 'divisions-line', 'div-labels']) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', vis);
  }
  if (map.getSource('divisions')) {
    map.getSource('divisions').setData(visible && divisionGeo ? divisionGeo : EMPTY);
  }
}

export function setModernVisible(visible) {
  modernVisible = visible;
  if (!currentSnap) return;
  const vis = visible ? 'visible' : 'none';
  for (const layer of [
    'neighbors-fill', 'neighbors-line', 'provinces-fill', 'provinces-line', 'modern-line',
  ]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', vis);
  }
}

// ── 选中事件：飞行 + DOM 涟漪标记 + 落定弹卡 ──────────────────
let rippleMarker = null;
let showTipTimer = null;

export function selectEvent(event) {
  if (!currentSnap) return;
  selectedEvent = event;
  const lngLat = [event.location.lng, event.location.lat];
  const curZoom = map.getZoom();
  map.flyTo({ center: lngLat, zoom: Math.max(curZoom, 3.8), duration: 600 });
  // 涟漪标记：DOM 元素 + CSS 动画（替代 effectScatter）
  if (rippleMarker) rippleMarker.remove();
  const el = document.createElement('div');
  el.className = 'evt-ripple';
  el.style.setProperty('--ripple-color', primaryColor(currentSnap));
  rippleMarker = new Marker({ element: el })
    .setLngLat(lngLat)
    .setOffset([0, 0])
    .addTo(map);
  // 飞行落定后在事件点旁重新弹出提示卡，展示完整描述
  // （窄屏抽屉模式下描述已由抽屉展示，不再弹卡避免遮挡地图）
  clearTimeout(showTipTimer);
  if (!window.matchMedia('(max-width: 900px)').matches) {
    showTipTimer = setTimeout(() => {
      if (!selectedEvent) return;
      const pt = map.project(lngLat);
      divTipEl.hidden = false;
      divTipEl.innerHTML = eventTipHtml(event);
      const w = container.clientWidth;
      divTipEl.style.left = Math.min(pt.x + 18, w - 200) + 'px';
      divTipEl.style.top = Math.max(pt.y - 60, 8) + 'px';
    }, 620);
  }
}

export function preload(snap) {
  if (!snap) return; // 首断面向前预取越界（snapshots[-1]），无目标即跳过
  fetchGeo(snap).catch(() => {});
  fetchDivisions(snap);
  fetchPlaces(snap);
  fetchRoutes(snap);
}

// ── 政区注记字号：设置面板调节，localStorage 持久化 ──────────
export function getDivisionFontSize() {
  return labelFontSize;
}

function applyDivisionFontSize(px) {
  labelFontSize = clampFontSize(px);
  for (const layer of ['div-labels', 'places']) {
    if (map?.getLayer(layer)) map.setLayoutProperty(layer, 'text-size', labelFontSize);
  }
}

export function setDivisionFontSize(px) {
  applyDivisionFontSize(px);
  localStorage.setItem(DIV_FONT_KEY, String(labelFontSize));
}

// 恢复默认：清存储，回到窄屏 11 / 桌面 12 自适应
export function resetDivisionFontSize() {
  localStorage.removeItem(DIV_FONT_KEY);
  applyDivisionFontSize(window.matchMedia('(max-width: 900px)').matches ? 11 : 12);
}
