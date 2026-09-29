// 时间轴（胶片条式离散导航）：
// 全部断面为等距节点连成一条可横向滚动的带，视口限宽、两端渐隐——
// 滚动/拖带只用于浏览历代（不换地图），点击节点才切换断面；
// ‹ ▶ › 步进与播放沿全断面推进，并把当前节点滚回视野中央
export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);
const shortYear = y => (y < 0 ? `前${-y}` : `${y}`);

const SVG = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1l8 5-8 5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1h2.6v10H2.5zM6.9 1h2.6v10H6.9z"/></svg>',
  prev: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 1v10L2.5 6z"/></svg>',
  next: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1v10l7-5z"/></svg>',
};

export function createTimeline(container, { eras, snapshots, onSnap }) {
  // 时代 → 该时代内断面索引列表（snapshots 已按年份升序）
  const snapsOfEra = eras.map(e =>
    snapshots.map((s, i) => (s.era === e.name ? i : -1)).filter(i => i >= 0)
  );
  const eraIdxOfSnap = idx => eras.findIndex(e => e.name === snapshots[idx].era);

  // ── DOM：等距节点带，按时代分组挂标 ─────────────────────
  container.innerHTML = `
    <div class="tl-row">
      <div class="tl-ctl">
        <button type="button" class="tl-btn" aria-label="上一断面">${SVG.prev}</button>
        <button type="button" class="tl-btn tl-btn-play" aria-label="播放年代演变">${SVG.play}</button>
        <button type="button" class="tl-btn" aria-label="下一断面">${SVG.next}</button>
        <div class="tl-readout" aria-live="polite">
          <span class="tl-year"></span><span class="tl-era"></span>
        </div>
      </div>
      <div class="tl-strip">
        <div class="tl-track">${eras
          .map((e, ei) => {
            const idxs = snapsOfEra[ei];
            if (!idxs.length) return '';
            return `<div class="tl-group" data-ei="${ei}">
              <button type="button" class="tl-gcap" style="--gcap-color:${e.color}"
                title="${e.name}（${yearLabel(e.from)}—${yearLabel(e.to)}）">${e.name}</button>
              <div class="tl-gnodes">${idxs
                .map(
                  i => `<button type="button" class="tl-node" data-i="${i}" title="${snapshots[i].label}"
                    style="--n-color:${e.color}">
                    <i class="tl-tick"></i><span class="tl-ylab">${shortYear(snapshots[i].year)}</span>
                  </button>`
                )
                .join('')}</div>
            </div>`;
          })
          .join('')}</div>
      </div>
    </div>`;

  const strip = container.querySelector('.tl-strip');
  const nodeEls = Array.from(container.querySelectorAll('.tl-node'));
  const groupEls = Array.from(container.querySelectorAll('.tl-group'));
  const btnPrev = container.querySelector('.tl-ctl .tl-btn');
  const btnPlay = container.querySelector('.tl-btn-play');
  const btnNext = container.querySelector('.tl-ctl .tl-btn:last-of-type');
  const readYear = container.querySelector('.tl-year');
  const readEra = container.querySelector('.tl-era');

  let curIdx = -1;
  let revealed = false; // 首帧定位不做动画
  let revealTimer = null;
  const cancelReveal = () => clearTimeout(revealTimer);

  // 当前节点滚回视口中央（只在节点带容器内滚动，绝不波及页面）。
  // 不用 scrollTo smooth（部分 webview 不生效）也不用 rAF（遮挡即停摆），
  // 定时器补间在节流环境下降速但仍会走完，最稳
  function reveal(idx, smooth = true) {
    const el = nodeEls[idx];
    if (!el) return;
    const max = strip.scrollWidth - strip.clientWidth;
    const target = Math.max(0, Math.min(el.offsetLeft + el.offsetWidth / 2 - strip.clientWidth / 2, max));
    cancelReveal();
    if (!smooth || !revealed || Math.abs(target - strip.scrollLeft) < 2) {
      strip.scrollLeft = target;
      revealed = true;
      return;
    }
    const from = strip.scrollLeft;
    const t0 = Date.now();
    const D = 320; // easeOutCubic 时长 ms
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / D);
      strip.scrollLeft = from + (target - from) * (1 - Math.pow(1 - p, 3));
      if (p < 1) revealTimer = setTimeout(step, 16);
    };
    revealTimer = setTimeout(step, 16);
    revealed = true;
  }

  // ── 渲染：节点选中态 + 时代标加粗 + 大读数 ──
  function render() {
    const snap = snapshots[curIdx];
    const ei = eraIdxOfSnap(curIdx);
    nodeEls.forEach((el, i) => el.classList.toggle('on', i === curIdx));
    groupEls.forEach((el, i) => el.classList.toggle('cur', i === ei));
    readYear.textContent = yearLabel(snap.year);
    readEra.textContent = snap.era;
  }

  // ── 切换断面：即时换图 ──
  function go(idx, { reveal: doReveal = true } = {}) {
    if (idx < 0 || idx >= snapshots.length || idx === curIdx) return;
    curIdx = idx;
    render();
    if (doReveal) reveal(idx);
    onSnap(snapshots[idx], idx);
  }

  // ── 播放：沿全断面每 1.6s 步进，播完自动停 ──
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
    if (curIdx >= snapshots.length - 1) { stopPlay(); return; }
    go(curIdx + 1);
    playTimer = setTimeout(tickPlay, 1600);
  }

  // 节点点击 = 唯一换图入口（点击的节点已在视野内，不回中）
  nodeEls.forEach(el =>
    el.addEventListener('click', () => go(Number(el.dataset.i), { reveal: false }))
  );
  // 时代标点击 → 进入该时代首断面（可能不在视野内，回中）
  groupEls.forEach((el, ei) =>
    el.querySelector('.tl-gcap').addEventListener('click', () => go(snapsOfEra[ei][0]))
  );

  btnPrev.addEventListener('click', () => go(curIdx - 1));
  btnNext.addEventListener('click', () => go(curIdx + 1));
  btnPlay.addEventListener('click', () => {
    if (playing) { stopPlay(); return; }
    if (curIdx >= snapshots.length - 1) go(0); // 已在末断面则从头播
    playing = true;
    renderPlayBtn();
    tickPlay();
  });

  // 空格 = 播放/暂停（输入框/按钮聚焦时让位）
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, button')) return;
    e.preventDefault();
    btnPlay.click();
  });

  // 滚轮纵滚 → 横向浏览（横滚让位原生）；只滚带子，不切断面
  strip.addEventListener(
    'wheel',
    e => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      cancelReveal();
      strip.scrollLeft += e.deltaY;
    },
    { passive: false }
  );

  // 鼠标拖带平移（触屏走原生滑动）；拖动后吞掉本次 click，防止误切图
  let panStart = null;
  let panning = false;
  strip.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelReveal();
    panStart = { x: e.clientX, left: strip.scrollLeft };
    panning = false;
  });
  window.addEventListener('pointermove', e => {
    if (!panStart) return;
    const dx = e.clientX - panStart.x;
    if (!panning && Math.abs(dx) < 6) return;
    panning = true;
    strip.classList.add('panning');
    strip.scrollLeft = panStart.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!panStart) return;
    panStart = null;
    strip.classList.remove('panning');
    // click 在 pointerup 之后派发，下一轮宏任务再复位，留出吞点击的窗口
    setTimeout(() => { panning = false; }, 0);
  });
  strip.addEventListener(
    'click',
    e => {
      if (!panning) return;
      panning = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );

  // 视口尺寸变化（旋转/缩放窗口）后当前节点重新回中，避免漂出视野
  window.addEventListener('resize', () => {
    if (curIdx >= 0) reveal(curIdx, false);
  });

  return {
    // 外部指令（键盘步进/事件跳转/URL 初始化）：切断面并把节点滚回视野
    setSnap: idx => {
      if (idx < 0 || idx >= snapshots.length) return;
      stopPlay();
      curIdx = idx;
      render();
      reveal(idx);
      onSnap(snapshots[idx], idx);
    },
  };
}

export function bindKeyboard(onPrev, onNext) {
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
  });
}
