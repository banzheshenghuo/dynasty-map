import * as echarts from 'echarts';

// 稳定取景框：所有朝代共用同一经纬范围，避免切换时视口跳动
const BOUNDS = [[70, 15], [138, 57]];
// 淡墨：现代轮廓参照线
const MODERN_BORDER_ON = 'rgba(96, 82, 60, 0.6)';
// 邻国底图：更淡的墨色，衬托而不抢疆域主体
const NEIGHBOR_BORDER_ON = 'rgba(96, 82, 60, 0.30)';
const NEIGHBOR_FILL_ON = 'rgba(120, 102, 70, 0.05)';
// 现代省界：细墨线叠在疆域色块之上，疆域内外都清晰可见，作古今对照
const PROVINCE_BORDER_ON = 'rgba(96, 82, 60, 0.5)';
const PROVINCE_FILL_ON = 'rgba(120, 102, 70, 0.03)';
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

// 事件提示卡：全局与 series 级共用同一份配置
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
      // geo 组件的 tooltip 会管辖其上 series 的提示框：show:false 会连 scatter 的
      // 一起关掉。这里保持开启但恒返回空串——疆域/现代轮廓悬浮不弹占位名，
      // 事件圆点的提示由 series 级 tooltip 接管（优先级高于 geo）
      tooltip: { show: true, formatter: () => '' },
      itemStyle: {
        areaColor: 'rgba(120, 102, 70, 0.10)',
        borderColor: 'rgba(96, 82, 60, 0.30)',
        borderWidth: 0.5,
      },
      emphasis: { disabled: true },
      select: { disabled: true },
      regions: [
        {
          // 邻国画在最底层：淡墨边界 + 极淡底色，随「现代界线」开关显隐
          name: '__neighbors__',
          itemStyle: {
            areaColor: modernVisible ? NEIGHBOR_FILL_ON : 'transparent',
            borderColor: modernVisible ? NEIGHBOR_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 0.6,
          },
        },
        {
          name: '__provinces__',
          itemStyle: {
            areaColor: modernVisible ? PROVINCE_FILL_ON : 'transparent',
            borderColor: modernVisible ? PROVINCE_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
          },
        },
        {
          name: '__modern__',
          itemStyle: {
            areaColor: 'transparent',
            borderColor: modernVisible ? MODERN_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
          },
        },
        {
          name: '__dynasty__',
          itemStyle: {
            areaColor: rgba(dynasty.color, 0.40),
            borderColor: dynasty.color,
            borderWidth: 1.4,
          },
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

export async function showDynasty(dynasty, events) {
  const geo = await fetchGeo(dynasty);
  currentDynasty = dynasty;
  currentEvents = events;
  selectedEvent = null;

  const mapName = `map_${dynasty.id}_${Date.now() % 1e6}`;
  const combined = {
    type: 'FeatureCollection',
    features: [
      ...neighborGeo.features,
      ...geo.features,
      ...provinceGeo.features,
      ...modernGeo.features,
    ],
  };
  echarts.registerMap(mapName, combined);

  // 转场：先淡出画布再换图，规避 geo 换图无过渡的生硬感
  container.style.opacity = '0.35';
  setTimeout(() => {
    chart.setOption(baseOption(dynasty, mapName), { notMerge: true });
    container.style.opacity = '1';
  }, 160);
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
          },
        },
        {
          name: '__provinces__',
          itemStyle: {
            areaColor: visible ? PROVINCE_FILL_ON : 'transparent',
            borderColor: visible ? PROVINCE_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
          },
        },
        {
          name: '__modern__',
          itemStyle: {
            areaColor: 'transparent',
            borderColor: visible ? MODERN_BORDER_ON : 'rgba(0,0,0,0)',
            borderWidth: 1,
          },
        },
        {
          name: '__dynasty__',
          itemStyle: {
            areaColor: rgba(currentDynasty.color, 0.40),
            borderColor: currentDynasty.color,
            borderWidth: 1.4,
          },
        },
      ],
    },
  });
}

export function preload(dynasty) {
  fetchGeo(dynasty).catch(() => {});
}
