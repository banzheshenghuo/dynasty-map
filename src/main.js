import './style.css';
import { initMap, showDynasty, selectEvent, setModernVisible, preload } from './map.js';
import { renderTimeline, bindKeyboard } from './timeline.js';
import { renderSidebar as renderSidebarInto } from './sidebar.js';

const BASE = import.meta.env.BASE_URL;
const $ = s => document.querySelector(s);
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

const state = {
  dynasties: [],
  currentIdx: 0,
  events: [],
  selected: null,
};

const eventsCache = new Map();

async function fetchJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`加载失败 ${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadEvents(dynasty) {
  if (!eventsCache.has(dynasty.id)) {
    eventsCache.set(dynasty.id, fetchJson(dynasty.eventsFile));
  }
  return eventsCache.get(dynasty.id);
}

function renderSidebar() {
  const d = state.dynasties[state.currentIdx];
  renderSidebarInto({
    infoEl: $('#dynasty-info'),
    listEl: $('#event-list'),
    dynasty: d,
    events: state.events,
    selected: state.selected,
    onEventClick: handleEventClick,
  });
}

function render() {
  const d = state.dynasties[state.currentIdx];
  renderTimeline($('#timeline'), state.dynasties, d.id, switchDynasty);
  renderSidebar();
}

async function switchDynasty(id) {
  const idx = state.dynasties.findIndex(d => d.id === id);
  if (idx < 0) return;
  state.currentIdx = idx;
  state.selected = null;
  hideEventCard();
  const d = state.dynasties[idx];
  state.events = await loadEvents(d);
  render();
  await showDynasty(d, state.events);

  const next = state.dynasties[idx + 1];
  if (next) preload(next);
}

// 移动端事件卡：点地图圆点后的轻量详情浮层（抽屉的替代展示，不挡地图与时间轴）
function showEventCard(evt) {
  const card = $('#event-card');
  const d = state.dynasties[state.currentIdx];
  card.querySelector('.card-year').textContent = evt.yearLabel;
  card.querySelector('.card-year').style.color = d.color;
  card.querySelector('.card-loc').textContent = evt.location.name || '';
  card.querySelector('.card-title').textContent = evt.title;
  card.querySelector('.card-desc').textContent = evt.description;
  card.classList.add('show');
}

function hideEventCard() {
  $('#event-card').classList.remove('show');
}

function handleEventClick(evt, opts = {}) {
  const mobile = isMobile();
  // 抽屉浏览态：再点同一事件收起描述，不飞图
  if (mobile && !opts.fromMap && state.selected && state.selected.title === evt.title) {
    state.selected = null;
    renderSidebar();
    hideEventCard();
    return;
  }
  state.selected = evt;
  const d = state.dynasties[state.currentIdx];
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
  const next = state.dynasties[state.currentIdx + delta];
  if (next) switchDynasty(next.id);
}

async function boot() {
  state.dynasties = await fetchJson('dynasties.json');

  await initMap($('#map'), { onEventClick: handleEventClick });

  $('#modern-toggle').addEventListener('change', e => setModernVisible(e.target.checked));
  bindKeyboard(() => step(-1), () => step(1));

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
  if (window.matchMedia('(max-width: 900px)').matches) {
    const hint = $('#map-hint');
    requestAnimationFrame(() => hint.classList.add('show'));
    setTimeout(() => hint.classList.remove('show'), 3600);
  }

  // 移动端抽屉打开后点地图关闭
  $('#map').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  await switchDynasty(state.dynasties[0].id);
}

boot().catch(err => {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div style="padding:20px;color:#6b2418;background:#f3ddd0">加载失败：${err.message}</div>`
  );
});
