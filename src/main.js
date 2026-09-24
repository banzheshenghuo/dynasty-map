import './style.css';
import { initMap, showDynasty, selectEvent, setModernVisible, preload } from './map.js';
import { renderTimeline, bindKeyboard } from './timeline.js';
import { renderSidebar } from './sidebar.js';

const BASE = import.meta.env.BASE_URL;
const $ = s => document.querySelector(s);

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

function render() {
  const d = state.dynasties[state.currentIdx];
  renderTimeline($('#timeline'), state.dynasties, d.id, switchDynasty);
  renderSidebar({
    infoEl: $('#dynasty-info'),
    listEl: $('#event-list'),
    dynasty: d,
    events: state.events,
    selected: state.selected,
    onEventClick: handleEventClick,
  });
}

async function switchDynasty(id) {
  const idx = state.dynasties.findIndex(d => d.id === id);
  if (idx < 0) return;
  state.currentIdx = idx;
  state.selected = null;
  const d = state.dynasties[idx];
  state.events = await loadEvents(d);
  render();
  await showDynasty(d, state.events);

  const next = state.dynasties[idx + 1];
  if (next) preload(next);
}

function handleEventClick(evt) {
  state.selected = evt;
  const d = state.dynasties[state.currentIdx];
  renderSidebar({
    infoEl: $('#dynasty-info'),
    listEl: $('#event-list'),
    dynasty: d,
    events: state.events,
    selected: state.selected,
    onEventClick: handleEventClick,
  });
  selectEvent(evt);
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

  $('#drawer-btn').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });

  // 移动端抽屉打开后点地图关闭
  $('#map').addEventListener('click', () => $('#sidebar').classList.remove('open'));

  await switchDynasty(state.dynasties[0].id);
}

boot().catch(err => {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div style="padding:20px;color:#e2b3b3;background:#2a1520">加载失败：${err.message}</div>`
  );
});
