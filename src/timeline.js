// 时间轴：连续拖动 + 释放/停顿 250ms 吸附最近断面；时代分段底色 + 事件打点。
// 位置 ↔ 年份线性映射（range.from..range.to），拖动中气泡实时读数
export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);

const DRAG_PAUSE_MS = 250; // 拖动停顿多久即提前换断面（ grilled 定值）

export function createTimeline(container, { range, eras, snapshots, events, onSnap, onEvent }) {
  const span = range.to - range.from;
  const pctOf = year => ((year - range.from) / span) * 100;
  const yearAtPct = pct => range.from + (pct / 100) * span;
  const eraOf = year => eras.find(e => year >= e.from && year < e.to) || eras[eras.length - 1];
  const nearestIdx = year => {
    let best = 0, bd = Infinity;
    snapshots.forEach((s, i) => {
      const d = Math.abs(s.year - year);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  // ── DOM：分段条 + 断面刻 + 事件点 + 手柄气泡 ────────────────
  container.innerHTML = `
    <div class="tl-axis">
      <div class="tl-segs"></div>
      <div class="tl-ticks"></div>
      <div class="tl-dots"></div>
      <div class="tl-handle"><div class="tl-bubble"></div></div>
    </div>`;

  const axis = container.querySelector('.tl-axis');
  const segsEl = container.querySelector('.tl-segs');
  const handle = container.querySelector('.tl-handle');
  const bubble = container.querySelector('.tl-bubble');

  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  segsEl.innerHTML = eras
    .map(e => {
      const w = pctOf(e.to) - pctOf(e.from);
      return `<div class="tl-seg" data-era="${e.name}" title="${e.name}（${yearLabel(e.from)}起）"
        style="flex:0 0 ${w}%; --seg-color:${hexA(e.color, 0.34)}">${e.name}</div>`;
    })
    .join('');
  segsEl.querySelectorAll('.tl-seg').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      // 点分段跳到该时代首个断面（拖拽已由 axis pointerdown 接管，这里是纯点击）
      const era = eras.find(e => e.name === el.dataset.era);
      if (era) snapTo(nearestIdx(era.from + (era.to - era.from) * 0.02), true);
    })
  );

  const ticksEl = container.querySelector('.tl-dots');
  ticksEl.innerHTML =
    snapshots.map(s => `<i class="tl-tick" style="left:${pctOf(s.year)}%"></i>`).join('') +
    events
      .map(
        (e, i) =>
          `<i class="tl-dot" data-i="${i}" style="left:${pctOf(e.year)}%" title="${e.yearLabel} ${e.title}"></i>`
      )
      .join('');
  const tickEls = Array.from(ticksEl.querySelectorAll('.tl-tick'));
  ticksEl.querySelectorAll('.tl-dot').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      onEvent(events[Number(el.dataset.i)]);
    })
  );

  // ── 指针交互：axis 级 pointerdown 捕获，拖动连续读数 ─────────
  let dragging = false;
  let pauseTimer = null;
  let lastTickOn = -1;

  function setHandle(year) {
    const p = Math.min(100, Math.max(0, pctOf(year)));
    handle.style.left = p + '%';
    // 气泡贴手柄但不出轴两端
    const w = axis.clientWidth;
    const px = Math.min(w - 46, Math.max(46, (p / 100) * w));
    bubble.style.left = px + 'px';
    bubble.textContent = `${yearLabel(Math.round(year))} · ${eraOf(year).name}`;
    segsEl.querySelectorAll('.tl-seg').forEach(el =>
      el.classList.toggle('cur', el.dataset.era === eraOf(year).name)
    );
  }

  function snapTo(idx) {
    const s = snapshots[idx];
    if (!s) return;
    clearTimeout(pauseTimer);
    setHandle(s.year);
    markSnap(idx);
    onSnap(s, idx);
  }

  // 断面刻度落点高亮
  function markSnap(idx) {
    if (lastTickOn >= 0) tickEls[lastTickOn]?.classList.remove('on');
    tickEls[idx]?.classList.add('on');
    lastTickOn = idx;
  }

  const yearFromEvent = e => {
    const r = axis.getBoundingClientRect();
    return yearAtPct(((e.clientX - r.left) / r.width) * 100);
  };

  axis.addEventListener('pointerdown', e => {
    if (e.target.closest('.tl-dot') || e.target.closest('.tl-seg')) return;
    dragging = true;
    // 指针已失活（如合成事件/极端时序）时捕获会抛错，防御后仍可拖动
    try { axis.setPointerCapture(e.pointerId); } catch { /* 无捕获，靠 window 级事件兜底 */ }
    moveTo(yearFromEvent(e));
  });
  axis.addEventListener('pointermove', e => {
    if (!dragging) return;
    moveTo(yearFromEvent(e));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    const cur = yearAtPct(Number(handle.style.left.slice(0, -1)));
    snapTo(nearestIdx(cur));
  };
  axis.addEventListener('pointerup', endDrag);
  axis.addEventListener('pointercancel', endDrag);

  function moveTo(year) {
    const y = Math.min(range.to, Math.max(range.from, year));
    setHandle(y);
    // 拖动停顿 DRAG_PAUSE_MS 即提前换最近断面；释放时立即吸附
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      const idx = nearestIdx(y);
      markSnap(idx);
      onSnap(snapshots[idx], idx);
    }, DRAG_PAUSE_MS);
  }

  return {
    setSnap: idx => snapTo(idx),
    setYear: year => setHandle(year),
  };
}

export function bindKeyboard(onPrev, onNext) {
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
  });
}
