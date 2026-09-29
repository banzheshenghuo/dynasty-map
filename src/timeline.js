// 时间轴：点击/拖动锚定所指年份 + 滚轮微调，释放或停顿 250ms 吸附最近断面；
// 时代分段底色 + 断面刻度 + 事件打点。位置↔年份线性映射（range.from..range.to），
// 拖动中气泡实时读数，桌面端悬浮另有虚线年份预览
export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);

const DRAG_PAUSE_MS = 250; // 拖动停顿多久即提前换断面（grilled 定值）

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function createTimeline(container, { range, eras, snapshots, events, onSnap, onEvent }) {
  const span = range.to - range.from;
  const pctOf = year => ((year - range.from) / span) * 100;
  const yearAtPct = pct => range.from + (pct / 100) * span;
  const clampYear = y => Math.min(range.to, Math.max(range.from, y));
  const eraOf = year => eras.find(e => year >= e.from && year < e.to) || eras[eras.length - 1];
  const nearestIdx = year => {
    let best = 0, bd = Infinity;
    snapshots.forEach((s, i) => {
      const d = Math.abs(s.year - year);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  // 年份标尺：挑步长使标签 ≤10 个（公元 0 年不存在，跳过）
  const yearTicks = (() => {
    for (const step of [100, 200, 500, 1000]) {
      const list = [];
      for (let k = Math.ceil(range.from / step); k * step <= range.to; k++) {
        if (k * step !== 0) list.push(k * step);
      }
      if (list.length <= 10) return list;
    }
    return [];
  })();

  container.innerHTML = `
    <div class="tl-axis" role="slider" tabindex="0"
      aria-label="历史时间轴：点击或拖动选择年份，滚轮微调"
      aria-valuemin="${range.from}" aria-valuemax="${range.to}" aria-valuenow="${range.from}">
      <div class="tl-segs">${eras
        .map(e => {
          const w = pctOf(e.to) - pctOf(e.from);
          return `<div class="tl-seg" data-era="${e.name}" title="${e.name}（${yearLabel(e.from)}—${yearLabel(e.to)}）"
            style="flex:0 0 ${w}%; --seg-color:${hexA(e.color, 0.42)}"><span>${e.name}</span></div>`;
        })
        .join('')}</div>
      <div class="tl-layer">
        <div class="tl-ticks">${snapshots
          .map(s => `<i class="tl-tick" style="left:${pctOf(s.year)}%"></i>`)
          .join('')}</div>
        <div class="tl-dots">${events
          .map(
            (e, i) =>
              `<i class="tl-dot" data-i="${i}" style="left:${pctOf(e.year)}%" title="${e.yearLabel} ${e.title}"></i>`
          )
          .join('')}</div>
      </div>
      <div class="tl-ghost" hidden><span class="tl-ghost-year"></span></div>
      <div class="tl-handle"><div class="tl-bubble"></div></div>
    </div>
    <div class="tl-years">${yearTicks
      .map(y => `<i style="left:${pctOf(y)}%">${y < 0 ? '前' + -y : y}</i>`)
      .join('')}</div>`;

  const axis = container.querySelector('.tl-axis');
  const segsEl = container.querySelector('.tl-segs');
  const handle = container.querySelector('.tl-handle');
  const bubble = container.querySelector('.tl-bubble');
  const ghostEl = container.querySelector('.tl-ghost');
  const ghostYear = container.querySelector('.tl-ghost-year');
  const tickEls = Array.from(container.querySelectorAll('.tl-tick'));
  const segEls = Array.from(segsEl.querySelectorAll('.tl-seg'));

  container.querySelectorAll('.tl-dot').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      onEvent(events[Number(el.dataset.i)]);
    })
  );

  // 窄时代段只留色块（名称藏进 title），随布局宽度实时判定
  new ResizeObserver(() =>
    segEls.forEach(el => el.classList.toggle('tiny', el.offsetWidth < 46))
  ).observe(segsEl);

  let dragging = false;
  let pauseTimer = null;
  let lastTickOn = -1;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const shortYear = y => (y < 0 ? `前${Math.round(-y)}` : String(Math.round(y)));

  function setHandle(year) {
    const p = Math.min(100, Math.max(0, pctOf(year)));
    handle.style.left = p + '%';
    // 气泡贴手柄但不出轴两端
    const w = axis.clientWidth;
    bubble.style.left = Math.min(w - 46, Math.max(46, (p / 100) * w)) + 'px';
    bubble.textContent = `${yearLabel(Math.round(year))} · ${eraOf(year).name}`;
    segEls.forEach(el => el.classList.toggle('cur', el.dataset.era === eraOf(year).name));
    axis.setAttribute('aria-valuenow', String(Math.round(year)));
    axis.setAttribute('aria-valuetext', `${yearLabel(Math.round(year))} ${eraOf(year).name}`);
  }

  // 断面刻度落点高亮
  function markSnap(idx) {
    if (lastTickOn >= 0) tickEls[lastTickOn]?.classList.remove('on');
    tickEls[idx]?.classList.add('on');
    lastTickOn = idx;
  }

  function snapTo(idx) {
    const s = snapshots[idx];
    if (!s) return;
    clearTimeout(pauseTimer);
    setHandle(s.year);
    markSnap(idx);
    onSnap(s, idx);
  }

  const yearFromEvent = e => {
    const r = axis.getBoundingClientRect();
    return yearAtPct(((e.clientX - r.left) / r.width) * 100);
  };

  function moveTo(year) {
    const y = clampYear(year);
    setHandle(y);
    // 拖动停顿 DRAG_PAUSE_MS 即提前换最近断面；释放时立即吸附
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      const idx = nearestIdx(y);
      markSnap(idx);
      onSnap(snapshots[idx], idx);
    }, DRAG_PAUSE_MS);
  }

  axis.addEventListener('pointerdown', e => {
    if (e.target.closest('.tl-dot')) return; // 事件点自成点击目标，不参与拖动
    dragging = true;
    axis.classList.add('dragging');
    ghostEl.hidden = true;
    // 指针已失活（合成事件/极端时序）时捕获会抛错，防御后仍可拖动
    try { axis.setPointerCapture(e.pointerId); } catch { }
    moveTo(yearFromEvent(e)); // 点击立即锚定到所指年份
  });
  axis.addEventListener('pointermove', e => {
    if (dragging) {
      moveTo(yearFromEvent(e));
      return;
    }
    // 桌面悬浮：虚线年份预览（非断面、无副作用）
    if (canHover && e.pointerType === 'mouse') {
      const y = clampYear(yearFromEvent(e));
      ghostEl.hidden = false;
      ghostEl.style.left = Math.min(100, Math.max(0, pctOf(y))) + '%';
      ghostYear.textContent = shortYear(y);
    }
  });
  axis.addEventListener('pointerleave', () => { ghostEl.hidden = true; });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    axis.classList.remove('dragging');
    ghostEl.hidden = true;
    snapTo(nearestIdx(yearAtPct(parseFloat(handle.style.left) || 0)));
  };
  axis.addEventListener('pointerup', endDrag);
  axis.addEventListener('pointercancel', endDrag);

  // 滚轮在轴上直接微调年份（向下/向右 = 时间后移），停顿后吸附
  axis.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      const cur = yearAtPct(parseFloat(handle.style.left) || 0);
      moveTo(clampYear(cur + d * (span / axis.clientWidth) * 1.2));
    },
    { passive: false }
  );

  return {
    setSnap: snapTo,
  };
}

export function bindKeyboard(onPrev, onNext) {
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
  });
}
