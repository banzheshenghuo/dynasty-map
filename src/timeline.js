// 时间轴：noUiSlider 托管拖拽内核 + 播放控制 + 大号年份读数。
// 参考市面历史地图范式（Chronas/Paradox/全历史）：当前年份大号常显、
// 播放/暂停/步进按钮看疆域演变、手柄接近断面刻度时磁吸回应。
// 统一 update 管线：拖动/点击/滚轮/程序设置都走 slider update——
// 跨断面边界即换图（400ms 节流，快速扫过不闪）；外部离散指令即时换图
import noUiSlider from 'nouislider';

export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// 控制按钮的内联 SVG（fill: currentColor，随主题变色）
const SVG = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1l8 5-8 5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1h2.6v10H2.5zM6.9 1h2.6v10H6.9z"/></svg>',
  prev: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 1v10L2.5 6z"/></svg>',
  next: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1v10l7-5z"/></svg>',
};

export function createTimeline(container, { range, eras, snapshots, events, onSnap, onEvent }) {
  const span = range.to - range.from;
  const pctOf = year => ((year - range.from) / span) * 100;
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

  // DOM：控制组（播放/步进/大读数）在带上方；slider 为拖拽层，deco/dots/ghost 为展示层
  container.innerHTML = `
    <div class="tl-ctl">
      <button type="button" class="tl-btn tl-btn-play" aria-label="播放年代演变">${SVG.play}</button>
      <button type="button" class="tl-btn" aria-label="上一断面">${SVG.prev}</button>
      <button type="button" class="tl-btn" aria-label="下一断面">${SVG.next}</button>
      <div class="tl-readout" aria-live="polite">
        <span class="tl-year"></span><span class="tl-era"></span>
      </div>
    </div>
    <div class="tl-wrap">
      <div class="tl-deco">
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
        </div>
      </div>
      <div class="tl-slider" aria-label="历史时间轴：点击或拖动选择年份，滚轮微调"></div>
      <div class="tl-dots">${events
        .map(
          (e, i) =>
            `<i class="tl-dot" data-i="${i}" style="left:${pctOf(e.year)}%" title="${e.yearLabel} ${e.title}"></i>`
        )
        .join('')}</div>
      <div class="tl-ghost" hidden><span class="tl-ghost-year"></span></div>
    </div>
    <div class="tl-years">${yearTicks
      .map(y => `<i style="left:${pctOf(y)}%">${y < 0 ? '前' + -y : y}</i>`)
      .join('')}</div>`;

  const wrap = container.querySelector('.tl-wrap');
  const sliderEl = container.querySelector('.tl-slider');
  const btnPlay = container.querySelector('.tl-btn-play');
  const btnPrev = container.querySelectorAll('.tl-btn')[1];
  const btnNext = container.querySelectorAll('.tl-btn')[2];
  const readYear = container.querySelector('.tl-year');
  const readEra = container.querySelector('.tl-era');
  const segEls = Array.from(container.querySelectorAll('.tl-seg'));
  const tickEls = Array.from(container.querySelectorAll('.tl-tick'));
  const ghostEl = container.querySelector('.tl-ghost');
  const ghostYear = container.querySelector('.tl-ghost-year');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const shortYear = y => (y < 0 ? `前${Math.round(-y)}` : String(Math.round(y)));

  // 展示同步：大读数 + 当前时代分段高亮 + 磁吸回应（手柄 ±13 年内的断面刻度放大）
  const NEAR_YEARS = Math.max(8, span * 0.006);
  function setVisuals(year) {
    const y = clampYear(year);
    readYear.textContent = yearLabel(Math.round(y));
    readEra.textContent = eraOf(y).name;
    segEls.forEach(el => el.classList.toggle('cur', el.dataset.era === eraOf(y).name));
    let nearIdx = -1, bd = NEAR_YEARS;
    snapshots.forEach((s, i) => {
      const d = Math.abs(s.year - y);
      if (d < bd) { bd = d; nearIdx = i; }
    });
    tickEls.forEach((el, i) => el.classList.toggle('near', i === nearIdx));
  }

  // 换图调度：跨断面边界即请求换图，400ms 节流——快速扫过只换停留断面，慢速拖动每 400ms 跟上一帧
  let lastFired = -1;
  let lastTickOn = -1;
  let fireTimer = null;
  function markTick(idx) {
    if (lastTickOn >= 0) tickEls[lastTickOn]?.classList.remove('on');
    tickEls[idx]?.classList.add('on');
    lastTickOn = idx;
  }
  function requestSnap(idx) {
    if (idx === lastFired) return;
    clearTimeout(fireTimer);
    fireTimer = setTimeout(() => {
      if (idx === lastFired) return; // fireNow 已抢先处理
      lastFired = idx;
      markTick(idx);
      onSnap(snapshots[idx], idx);
    }, 400);
  }
  function fireNow(idx) {
    clearTimeout(fireTimer);
    lastFired = idx;
    markTick(idx);
    onSnap(snapshots[idx], idx);
  }

  // ── 播放：沿断面每 1.6s 步进，播完自动停；任何外部干预即停 ──
  let playing = false;
  let playTimer = null;
  function renderPlayBtn() {
    btnPlay.innerHTML = playing ? SVG.pause : SVG.play;
    btnPlay.setAttribute('aria-label', playing ? '暂停播放' : '播放年代演变');
    btnPlay.classList.toggle('playing', playing);
  }
  function stopPlay() {
    if (!playing) return;
    playing = false;
    clearTimeout(playTimer);
    renderPlayBtn();
  }
  function tickPlay() {
    if (!playing) return;
    const next = lastFired + 1;
    if (next >= snapshots.length) { stopPlay(); return; }
    slider.set(snapshots[next].year); // update 同步视觉；fireNow 立即换图
    fireNow(next);
    playTimer = setTimeout(tickPlay, 1600);
  }

  noUiSlider.create(sliderEl, {
    start: range.from,
    range: { min: range.from, max: range.to },
    step: 1,
    behaviour: 'tap-drag', // 点击锚定后可继续拖动
    animate: true,
    format: {
      to: v => Math.round(v),
      from: v => Number(v),
    },
    ariaFormat: {
      to: v => `${yearLabel(Math.round(v))} ${eraOf(v).name}`,
      from: v => Number(v),
    },
  });

  const slider = sliderEl.noUiSlider;

  slider.on('update', (values, _handle, unencoded) => {
    const y = Array.isArray(unencoded) ? unencoded[0] : unencoded;
    setVisuals(y);
    requestSnap(nearestIdx(y));
  });
  slider.on('start', () => {
    stopPlay(); // 用户接管，播放即停
    wrap.classList.add('dragging'); // 关闭吸附过渡，读数跟手
    ghostEl.hidden = true;
  });
  slider.on('end', (values, _handle, unencoded) => {
    wrap.classList.remove('dragging');
    const y = Array.isArray(unencoded) ? unencoded[0] : unencoded;
    const idx = nearestIdx(y);
    if (Math.round(y) !== snapshots[idx].year) slider.set(snapshots[idx].year); // 触发吸附动画
    fireNow(idx); // 松手立即换图，不等节流
  });

  // 滚轮微调：交给 slider.set，与拖动共用 update 管线（含平滑动画与换图节流）
  wrap.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      const cur = Number(slider.get());
      slider.set(clampYear(cur + d * (span / wrap.clientWidth) * 1.2));
    },
    { passive: false }
  );

  // 桌面悬浮预览：虚线指针 + 小年份签（不改变断面）
  if (canHover) {
    wrap.addEventListener('pointermove', e => {
      if (wrap.classList.contains('dragging')) return;
      if (e.pointerType !== 'mouse') return;
      const r = wrap.getBoundingClientRect();
      const y = clampYear(((e.clientX - r.left) / r.width) * span + range.from);
      ghostEl.hidden = false;
      ghostEl.style.left = Math.min(100, Math.max(0, pctOf(y))) + '%';
      ghostYear.textContent = shortYear(y);
    });
    wrap.addEventListener('pointerleave', () => { ghostEl.hidden = true; });
  }

  // 事件打点：独立于拖拽层（点击不触发 slider tap）
  container.querySelectorAll('.tl-dot').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      onEvent(events[Number(el.dataset.i)]);
    })
  );

  // 控制按钮
  function jump(idx) {
    if (idx < 0 || idx >= snapshots.length) return;
    stopPlay();
    slider.set(snapshots[idx].year);
    fireNow(idx);
  }
  btnPlay.addEventListener('click', () => {
    if (playing) { stopPlay(); return; }
    // 从头播：若已在末断面则回到起点
    playing = true;
    renderPlayBtn();
    if (lastFired >= snapshots.length - 1) jump(0);
    tickPlay();
  });
  btnPrev.addEventListener('click', () => jump(lastFired - 1));
  btnNext.addEventListener('click', () => jump(lastFired + 1));

  // 空格 = 播放/暂停（输入框/按钮/手柄聚焦时让位）
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, button, .noUi-handle')) return;
    e.preventDefault();
    btnPlay.click();
  });

  // 窄时代段只留色块（名称藏进 title），随布局宽度实时判定
  new ResizeObserver(() =>
    segEls.forEach(el => el.classList.toggle('tiny', el.offsetWidth < 46))
  ).observe(container.querySelector('.tl-deco'));

  return {
    // 外部离散指令（键盘步进/事件点跳转/URL 初始化）即时换图并停止播放
    setSnap: idx => {
      const s = snapshots[idx];
      if (!s) return;
      stopPlay();
      slider.set(s.year); // update → setVisuals 同步视觉
      fireNow(idx);
    },
  };
}

export function bindKeyboard(onPrev, onNext) {
  window.addEventListener('keydown', e => {
    // 焦点在手柄上时让位给 noUiSlider 的微调（←→ 1 年 / PgUp·Dn 大步）
    if (e.target instanceof Element && e.target.closest('.noUi-handle')) return;
    if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
  });
}
