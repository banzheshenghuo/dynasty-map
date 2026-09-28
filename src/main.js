import './style.css';
import {
  initMap,
  showSnapshot,
  selectEvent,
  setModernVisible,
  setDivisionsVisible,
  preload,
  getDivisionFontSize,
  setDivisionFontSize,
  resetDivisionFontSize,
  primaryColor,
} from './map.js';
import { createTimeline, bindKeyboard } from './timeline.js';
import { renderSidebar as renderSidebarInto } from './sidebar.js';

const BASE = import.meta.env.BASE_URL;
const $ = s => document.querySelector(s);
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

const state = {
  tl: null, // 时间轴组件
  snapshots: [],
  eras: [],
  events: [],
  snapIdx: -1,
  selected: null,
};

async function fetchJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`加载失败 ${path}: HTTP ${res.status}`);
  return res.json();
}

const eraOf = snap => state.eras.find(e => e.name === snap.era) || { name: snap.era, summary: '' };
const eventsOfEra = era => state.events.filter(e => e.era === era);
const nearestIdx = year => {
  let best = 0, bd = Infinity;
  state.snapshots.forEach((s, i) => {
    const d = Math.abs(s.year - year);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
};

function renderSidebar() {
  const snap = state.snapshots[state.snapIdx];
  if (!snap) return;
  renderSidebarInto({
    infoEl: $('#dynasty-info'),
    listEl: $('#event-list'),
    era: eraOf(snap),
    snap,
    events: eventsOfEra(snap.era),
    selected: state.selected,
    onEventClick: handleEventClick,
  });
}

// URL 年份：?y=-221（吸附断面年份写入，可任意值进入后取最近断面）
function writeUrl(snap) {
  const url = new URL(location.href);
  url.searchParams.set('y', String(snap.year));
  history.replaceState(null, '', url);
}

let switching = null;
async function switchSnapshot(idx) {
  if (idx === state.snapIdx) return;
  const snap = state.snapshots[idx];
  if (!snap) return;
  state.snapIdx = idx;
  state.selected = null;
  hideEventCard();
  writeUrl(snap);
  renderSidebar();
  // 相邻断面预取，拖动时间轴时换图无网络等待
  preload(state.snapshots[idx - 1]);
  preload(state.snapshots[idx + 1]);
  const run = showSnapshot(snap, eventsOfEra(snap.era));
  switching = run;
  await run;
}

// 移动端事件卡：点地图圆点后的轻量详情浮层（抽屉的替代展示，不挡地图与时间轴）
function showEventCard(evt) {
  const card = $('#event-card');
  const snap = state.snapshots[state.snapIdx];
  card.querySelector('.card-year').textContent = evt.yearLabel;
  card.querySelector('.card-year').style.color = primaryColor(snap);
  card.querySelector('.card-loc').textContent = evt.location.name || '';
  card.querySelector('.card-title').textContent = evt.title;
  card.querySelector('.card-desc').textContent = evt.description;
  card.classList.add('show');
}

function hideEventCard() {
  $('#event-card').classList.remove('show');
}

async function handleEventClick(evt, opts = {}) {
  if (!evt) return;
  const mobile = isMobile();
  // 抽屉浏览态：再点同一事件收起描述，不飞图
  if (mobile && !opts.fromMap && state.selected && state.selected.title === evt.title) {
    state.selected = null;
    renderSidebar();
    hideEventCard();
    return;
  }
  state.selected = evt;
  // 事件点可能在别的时代（时间轴打点跨时代跳转）：先切到最近断面并移动手柄
  const idx = nearestIdx(evt.year);
  if (idx !== state.snapIdx) state.tl.setSnap(idx); // 同步触发 onSnap → switchSnapshot
  // switchSnapshot 会重置 selected，待其落定后再恢复选中并飞图
  await (switching ?? Promise.resolve());
  state.selected = evt;
  renderSidebar();
  selectEvent(evt);
  if (mobile) {
    if (opts.fromMap) {
      // 地图圆点：收抽屉、弹事件卡——地图与时间轴保持可用
      $('#sidebar').classList.remove('open');
      showEventCard(evt);
    } else {
      hideEventCard();
    }
  }
}

function step(delta) {
  const next = state.snapIdx + delta;
  if (next >= 0 && next < state.snapshots.length) state.tl.setSnap(next);
}

async function boot() {
  const tl = await fetchJson('timeline.json');
  state.snapshots = tl.snapshots;
  state.eras = tl.eras;
  state.events = tl.events;

  await initMap($('#map'), { onEventClick: handleEventClick });

  // URL 年份 → 初始断面（无参数取首个断面；注意 Number(null)===0 不可作判据）
  const yRaw = new URLSearchParams(location.search).get('y');
  const yParam = yRaw === null || yRaw.trim() === '' ? NaN : Number(yRaw);
  const initIdx =
    Number.isFinite(yParam) && yParam >= tl.range.from && yParam <= tl.range.to
      ? nearestIdx(yParam)
      : 0;

  state.tl = createTimeline($('#timeline'), {
    range: tl.range,
    eras: tl.eras,
    snapshots: tl.snapshots,
    events: tl.events,
    onSnap: snap => switchSnapshot(state.snapshots.indexOf(snap)),
    onEvent: evt => handleEventClick(evt, { fromMap: true }),
  });

  $('#modern-toggle').addEventListener('change', e => setModernVisible(e.target.checked));
  $('#division-toggle').addEventListener('change', e => setDivisionsVisible(e.target.checked));
  bindKeyboard(() => step(-1), () => step(1));

  // 设置面板：政区字号滑杆实时生效并写入 localStorage，重置清存储回自适应默认
  const settingsBtn = $('#settings-btn');
  const settingsPanel = $('#settings-panel');
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = settingsPanel.hidden;
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!settingsPanel.hidden && !e.target.closest('.settings')) {
      settingsPanel.hidden = true;
      settingsBtn.setAttribute('aria-expanded', 'false');
    }
  });
  const fontRange = $('#div-font-range');
  const fontVal = $('#div-font-val');
  fontRange.value = getDivisionFontSize();
  fontVal.textContent = `${getDivisionFontSize()}px`;
  fontRange.addEventListener('input', () => {
    setDivisionFontSize(Number(fontRange.value));
    fontVal.textContent = `${fontRange.value}px`;
  });
  $('#div-font-reset').addEventListener('click', () => {
    resetDivisionFontSize();
    fontRange.value = getDivisionFontSize();
    fontVal.textContent = `${getDivisionFontSize()}px`;
  });

  // 抽屉把手：点按收起
  $('#drawer-grip').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
  });

  // 事件卡关闭；打开抽屉时收起事件卡（二者互斥）
  $('#card-close').addEventListener('click', hideEventCard);
  $('#drawer-btn').addEventListener('click', () => {
    hideEventCard();
    $('#sidebar').classList.toggle('open');
  });

  // 移动端首屏操作提示，几秒后淡出
  if (isMobile()) {
    const hint = $('#map-hint');
    requestAnimationFrame(() => hint.classList.add('show'));
    setTimeout(() => hint.classList.remove('show'), 3600);
  }

  // 移动端抽屉打开后点地图关闭
  $('#map').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  state.tl.setSnap(initIdx);
}

boot().catch(err => {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div style="padding:20px;color:#6b2418;background:#f3ddd0">加载失败：${err.message}</div>`
  );
});
