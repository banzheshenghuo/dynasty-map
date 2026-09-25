import * as echarts from 'echarts';

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
// 朱砂：事件圆点
const EVENT_DOT = '#9e3d2c';
const PAPER = '#f6eed9';

let chart = null;
let container = null;
let modernGeo = null;
let neighborGeo = null;
let provinceGeo = null;
let dotSize = 9;
let selSize = 13;
// 本朝政区界（郡/州/路/府）：按朝代懒加载；要素名即政区名（唯一），
// 走 geo 默认样式渲染，悬浮由 geo 级 tooltip 显示政区名
let divisionGeo = null;
let divisionsVisible = true;
const divCache = new Map();
let currentDynasty = null;
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

async function fetchJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`加载失败 ${path}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchGeo(dynasty) {
  if (!geoCache.has(dynasty.id)) {
    geoCache.set(dynasty.id, fetchJson(dynasty.geoFile));
  }
  return geoCache.get(dynasty.id);
}

function fetchDivisions(dynasty) {
  if (!dynasty.divisionsFile) return Promise.resolve(null);
  if (!divCache.has(dynasty.id)) {
    divCache.set(dynasty.id, fetchJson(dynasty.divisionsFile).catch(() => null));
  }
  return divCache.get(dynasty.id);
}

// ── 政区悬浮提示：自实现（zr mousemove + 射线法点在多边形）──────
let divTipEl = null;
let divisionRings = [];

const pointInRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

function findDivision(lon, lat) {
  for (const d of divisionRings) {
    for (const poly of d.polys) {
      if (!pointInRing(lon, lat, poly[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) { inHole = true; break; }
      }
      if (!inHole) return d;
    }
  }
  return null;
}

function hideDivTip() {
  if (divTipEl) divTipEl.hidden = true;
}

function showDivTip(px, py, div) {
  if (!divTipEl) return;
  divTipEl.hidden = false;
  divTipEl.innerHTML = `<div class="tip-title">${div.name}</div>
    <div class="tip-loc">${currentDynasty?.name || ''} · ${div.type || '政区'}</div>`;
  const w = container.clientWidth, h = container.clientHeight;
  divTipEl.style.left = Math.min(px + 14, w - 170) + 'px';
  divTipEl.style.top = Math.max(py - 52, 8) + 'px';
}

function bindDivisionHover() {
  const zr = chart.getZr();
  const locate = e => {
    if (!divisionsVisible || !divisionRings.length || !currentDynasty) { hideDivTip(); return; }
    const pt = chart.convertFromPixel({ geoIndex: 0 }, [e.offsetX, e.offsetY]);
    if (!pt) { hideDivTip(); return; }
    const div = findDivision(pt[0], pt[1]);
    div ? showDivTip(e.offsetX, e.offsetY, div) : hideDivTip();
  };
  zr.on('mousemove', locate);
  zr.on('globalout', hideDivTip);
  // 触屏：tap 政区查看名称，tap 空白或地图外消失
  zr.on('click', locate);
}

export async function initMap(el, handlers) {
  container = el;
  onEventClick = handlers.onEventClick;
  modernGeo = await fetchJson('geo/modern.json');
  neighborGeo = await fetchJson('geo/neighbors.json');
  provinceGeo = await fetchJson('geo/provinces.json');

  chart = echarts.init(el);
  // 窄屏放大圆点便于点按
  const compact = window.matchMedia('(max-width: 900px)').matches;
  dotSize = compact ? 12 : 9;
  selSize = compact ? 15 : 13;
  divTipEl = document.getElementById('div-tip');
  bindDivisionHover();
  chart.on('click', params => {
    if (params.seriesType === 'scatter' || params.seriesType === 'effectScatter') {
      // 点击后地图会飞行缩放到事件点，原位置的 tooltip 会悬空失真，先收起
      chart.dispatchAction({ type: 'hideTip' });
      onEventClick?.(params.data.event, { fromMap: true });
    }
  });
  // 用 ResizeObserver 而非 window resize：boot 后时间轴填充等布局重排
  // 不会触发 window resize，画布若不跟随会溢出盖住底栏
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
}

// 事件提示卡：全局与 series 级共用同一份配置。
// 全局 formatter 同时兜底 geo 政区区域悬浮（geo.tooltip 并不总能接管区域 hover）
const eventTooltip = () => ({
  backgroundColor: 'rgba(252, 247, 234, 0.97)',
  borderColor: '#c5b48c',
  textStyle: { color: '#3b3226' },
  confine: true,
  padding: [10, 14],
  // 兜底限高，防止长描述把 tooltip 顶出画布
  extraCssText:
    'max-height:40vh;overflow-y:auto;box-shadow:0 4px 18px rgba(80, 66, 40, 0.25);',
  formatter: p => {
    if (!p.data?.event) return '';
    const e = p.data.event;
    return `<div class="tip-year">${e.yearLabel}</div>
            <div class="tip-title">${e.title}</div>
            ${e.location.name ? `<div class="tip-loc">${e.location.name}</div>` : ''}
            <div class="tip-desc">${e.description}</div>`;
  },
});

function baseOption(dynasty, mapName) {
  return {
    animationDurationUpdate: 550,
    geo: {
      map: mapName,
      roam: true,
      zoom: 1.05,
      scaleLimit: { min: 1, max: 14 },
      boundingCoords: BOUNDS,
      layoutCenter: ['50%', '50%'],
      layoutSize: '96%',
      // geo 的 region tooltip 机制不可靠（曾出现占位名泄漏/不触发），
      // 政区悬浮提示由自定义 div-tip 实现（zr mousemove + 点在多边形检测），
      // 这里恒返回空串避免双弹；事件圆点提示仍走 series 级 tooltip
      tooltip: { show: true, formatter: () => '' },
      itemStyle: {
        areaColor: 'transparent',
        borderColor: divisionsVisible ? DIVISION_BORDER_ON : 'rgba(0,0,0,0)',
        borderWidth: 1.1,
        borderType: DIVISION_DASH,
      },
      emphasis: { disabled: false, itemStyle: { areaColor: 'rgba(158, 61, 44, 0.08)' } },
      select: { disabled: true },
      regions: [
        {
          // 邻国画在最底层：淡墨边界 + 极淡底色，随「现代界线」开关显隐
          // 注意：region 不声明 borderType 会继承默认 itemStyle 的虚线，须显式 solid
          name: '__neighbors__',
          itemStyle: {
            areaColor: modernVisible ? NEIGHBOR_FILL_ON : 'transparent',
            borderColor: modernVisible ? NEIGHBOR_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 0.6,
            borderType: 'solid',
          },
          emphasis: { disabled: true },
        },
        {
          name: '__provinces__',
          itemStyle: {
            areaColor: modernVisible ? PROVINCE_FILL_ON : 'transparent',
            borderColor: modernVisible ? PROVINCE_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 0.8,
            borderType: 'solid',
          },
          emphasis: { disabled: true },
        },
        {
          name: '__modern__',
          itemStyle: {
            areaColor: 'transparent',
            borderColor: modernVisible ? MODERN_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
            borderType: 'solid',
          },
          emphasis: { disabled: true },
        },
        {
          name: '__dynasty__',
          itemStyle: {
            areaColor: rgba(dynasty.color, 0.40),
            borderColor: dynasty.color,
            borderWidth: 1.4,
            borderType: 'solid',
          },
          emphasis: { disabled: true },
        },
      ],
    },
    tooltip: {
      trigger: 'item',
      ...eventTooltip(),
    },
    series: [
      {
        id: 'evt',
        type: 'scatter',
        coordinateSystem: 'geo',
        symbolSize: dotSize,
        itemStyle: { color: EVENT_DOT, borderColor: PAPER, borderWidth: 1.6 },
        emphasis: { scale: 1.4, itemStyle: { color: '#7e2f22' } },
        tooltip: eventTooltip(),
        data: currentEvents.map(toPoint),
      },
      {
        id: 'sel',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        symbolSize: selSize,
        rippleEffect: { scale: 2.8, brushType: 'stroke' },
        itemStyle: { color: dynasty.color, borderColor: PAPER, borderWidth: 1.5 },
        zlevel: 2,
        tooltip: eventTooltip(),
        data: selectedEvent ? [toPoint(selectedEvent)] : [],
      },
    ],
  };
}

const toPoint = e => ({ name: e.title, value: [e.location.lng, e.location.lat], event: e });

export async function showDynasty(dynasty, events, view = {}) {
  const geo = await fetchGeo(dynasty);
  const divisions = await fetchDivisions(dynasty);
  divisionGeo = divisions;
  // 射线法检索结构：每政区保留多边形环组
  divisionRings = (divisions?.features || []).map(f => ({
    name: f.properties.name,
    type: f.properties.type,
    polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
  currentDynasty = dynasty;
  currentEvents = events;
  selectedEvent = null;

  const mapName = `map_${dynasty.id}_${Date.now() % 1e6}`;
  // 图层自底向上：邻国 → 疆域 → 现代省界 → 本朝政区界 → 现代轮廓
  const combined = {
    type: 'FeatureCollection',
    features: [
      ...neighborGeo.features,
      ...geo.features,
      ...provinceGeo.features,
      ...(divisionsVisible && divisionGeo ? divisionGeo.features : []),
      ...modernGeo.features,
    ],
  };
  echarts.registerMap(mapName, combined);

  // 转场：先淡出画布再换图，规避 geo 换图无过渡的生硬感
  container.style.opacity = '0.35';
  setTimeout(() => {
    const opt = baseOption(dynasty, mapName);
    // 开关政区层时保持当前视野（中心/缩放）
    if (view.center) opt.geo.center = view.center;
    if (view.zoom) opt.geo.zoom = view.zoom;
    chart.setOption(opt, { notMerge: true });
    container.style.opacity = '1';
  }, 160);
}

// 「政区界」开关：重建注册地图（含/不含政区要素），保持当前视野
export async function setDivisionsVisible(visible) {
  if (divisionsVisible === visible) return;
  divisionsVisible = visible;
  if (!visible) hideDivTip();
  if (!currentDynasty) return;
  const opt = chart.getOption();
  const g = opt.geo?.[0] || {};
  await showDynasty(currentDynasty, currentEvents, { center: g.center, zoom: g.zoom });
}

let showTipTimer = null;

export function selectEvent(event) {
  if (!currentDynasty) return;
  selectedEvent = event;
  const opt = chart.getOption();
  const curZoom = opt.geo?.[0]?.zoom ?? 1;
  chart.setOption({
    geo: { center: [event.location.lng, event.location.lat], zoom: Math.max(curZoom, 3.8) },
    series: [
      { id: 'evt', data: currentEvents.map(toPoint) },
      { id: 'sel', data: [toPoint(event)] },
    ],
  });
  // 飞行落定后在事件点旁重新弹出提示卡，展示完整描述
  // （窄屏抽屉模式下描述已由抽屉展示，不再弹卡避免遮挡地图）
  clearTimeout(showTipTimer);
  if (!window.matchMedia('(max-width: 900px)').matches) {
    showTipTimer = setTimeout(() => {
      const idx = currentEvents.findIndex(e => e.title === event.title);
      if (idx >= 0) chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
    }, 620);
  }
}

export function setModernVisible(visible) {
  modernVisible = visible;
  if (!currentDynasty) return;
  chart.setOption({
    geo: {
      regions: [
        {
          name: '__neighbors__',
          itemStyle: {
            areaColor: visible ? NEIGHBOR_FILL_ON : 'transparent',
            borderColor: visible ? NEIGHBOR_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 0.6,
            borderType: 'solid',
          },
        },
        {
          name: '__provinces__',
          itemStyle: {
            areaColor: visible ? PROVINCE_FILL_ON : 'transparent',
            borderColor: visible ? PROVINCE_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 0.8,
            borderType: 'solid',
          },
        },
        {
          name: '__modern__',
          itemStyle: {
            areaColor: 'transparent',
            borderColor: visible ? MODERN_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
            borderType: 'solid',
          },
        },
        {
          name: '__dynasty__',
          itemStyle: {
            areaColor: rgba(currentDynasty.color, 0.40),
            borderColor: currentDynasty.color,
            borderWidth: 1.4,
            borderType: 'solid',
          },
        },
      ],
    },
  });
}

export function preload(dynasty) {
  fetchGeo(dynasty).catch(() => {});
  fetchDivisions(dynasty);
}
