// 时间轴：noUiSlider 托管拖拽内核（点击锚定/拖动/键盘/ARIA），装饰层自绘——
// 时代分段色条 + 断面刻度 + 事件打点 + 悬浮年份预览 + 读数气泡。
// 统一事件管线：拖动/点击/滚轮/程序设置都走 slider update——跨断面边界即换图
// （400ms 节流，连续扫过不闪），松手立即吸附最近断面
import noUiSlider from 'nouislider';

export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
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

  // DOM：slider 为拖拽层（底层），deco/dots/ghost/bubble 为展示层（上层）
  container.innerHTML = `
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
      <div class="tl-bubble"></div>
    </div>
    <div class="tl-years">${yearTicks
      .map(y => `<i style="left:${pctOf(y)}%">${y < 0 ? '前' + -y : y}</i>`)
      .join('')}</div>`;

  const wrap = container.querySelector('.tl-wrap');
  const sliderEl = container.querySelector('.tl-slider');
  const segEls = Array.from(container.querySelectorAll('.tl-seg'));
  const tickEls = Array.from(container.querySelectorAll('.tl-tick'));
  const ghostEl = container.querySelector('.tl-ghost');
  const ghostYear = container.querySelector('.tl-ghost-year');
  const bubble = container.querySelector('.tl-bubble');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const shortYear = y => (y < 0 ? `前${Math.round(-y)}` : String(Math.round(y)));

  // 展示同步：手柄位置由 noUiSlider 管理，这里只跟气泡/分段高亮/aria 文案
  function setVisuals(year) {
    const y = clampYear(year);
    const w = wrap.clientWidth;
    const px = Math.min(w - 46, Math.max(46, (pctOf(y) / 100) * w));
    bubble.style.left = px + 'px';
    bubble.textContent = `${yearLabel(Math.round(y))} · ${eraOf(y).name}`;
    segEls.forEach(el => el.classList.toggle('cur', el.dataset.era === eraOf(y).name));
  }

  // 换图调度：跨断面边界即请求换图，400ms 节流——快速扫过只换停留断面，慢速拖动每 400ms 跟上一帧
  let lastFired = -1;
  let lastTickOn = -1;
  let fireTimer = null;
  function requestSnap(idx) {
    if (idx === lastFired) return;
    clearTimeout(fireTimer);
    fireTimer = setTimeout(() => {
      lastFired = idx;
      if (tickEls[lastTickOn]) tickEls[lastTickOn].classList.remove('on');
      tickEls[idx]?.classList.add('on');
      lastTickOn = idx;
      onSnap(snapshots[idx], idx);
    }, 400);
  }
  function fireNow(idx) {
    clearTimeout(fireTimer);
    lastFired = idx;
    if (tickEls[lastTickOn]) tickEls[lastTickOn].classList.remove('on');
    tickEls[idx]?.classList.add('on');
    lastTickOn = idx;
    onSnap(snapshots[idx], idx);
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

  // 窄时代段只留色块（名称藏进 title），随布局宽度实时判定
  new ResizeObserver(() =>
    segEls.forEach(el => el.classList.toggle('tiny', el.offsetWidth < 46))
  ).observe(container.querySelector('.tl-deco'));

  const slider = sliderEl.noUiSlider;

  slider.on('update', (values, _handle, unencoded) => {
    const y = Array.isArray(unencoded) ? unencoded[0] : unencoded;
    setVisuals(y);
    requestSnap(nearestIdx(y));
  });
  slider.on('start', () => {
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

  return {
    // 外部离散指令（键盘步进/事件点跳转/URL 初始化）立即换图不走节流——
    // 节流只服务拖动/滚轮的连续 update，否则跳转后 400ms 才切断面会吃掉选中态
    setSnap: idx => {
      const s = snapshots[idx];
      if (!s) return;
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
