// 时间轴（两级离散导航，参考全历史式范式）：
// 第一级 = 时代条（15 个时代段按时长成比例，点选进入该时代，段上打大事点）
// 第二级 = 该时代内的断面切片标签（点选切换；‹ ▶ › 步进跨时代顺延；播放沿全断面推进）
// 无连续拖动轴——断面是离散数据，交互同为离散，消除「拖动连续/地图跳变」的错位
export const yearLabel = y => (y < 0 ? `前${-y}年` : `${y}年`);

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const SVG = {
  play: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1l8 5-8 5z"/></svg>',
  pause: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1h2.6v10H2.5zM6.9 1h2.6v10H6.9z"/></svg>',
  prev: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.5 1v10L2.5 6z"/></svg>',
  next: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1v10l7-5z"/></svg>',
};

export function createTimeline(container, { range, eras, snapshots, events, onSnap, onEvent }) {
  const span = range.to - range.from;
  const pctOf = year => ((year - range.from) / span) * 100;
  // 时代 → 该时代内断面索引列表（snapshots 已按年份升序）
  const slicesOfEra = eras.map(e =>
    snapshots.map((s, i) => (s.era === e.name ? i : -1)).filter(i => i >= 0)
  );
  const eraIdxOfSnap = idx => eras.findIndex(e => e.name === snapshots[idx].era);

  // ── DOM ──────────────────────────────────────────────
  container.innerHTML = `
    <div class="tl-eras">
      <div class="tl-segs">${eras
        .map((e, ei) => {
          const w = pctOf(e.to) - pctOf(e.from);
          return `<button type="button" class="tl-seg" data-era="${e.name}" data-ei="${ei}"
            title="${e.name}（${yearLabel(e.from)}—${yearLabel(e.to)}）"
            style="flex:0 0 ${w}%; --seg-color:${hexA(e.color, 0.42)}"><span>${e.name}</span></button>`;
        })
        .join('')}</div>
      <div class="tl-dots">${events
        .map(
          (e, i) =>
            `<i class="tl-dot" data-i="${i}" style="left:${pctOf(e.year)}%" title="${e.yearLabel} ${e.title}"></i>`
        )
        .join('')}</div>
    </div>
    <div class="tl-sub">
      <div class="tl-slices" aria-label="当前时代断面"></div>
      <div class="tl-ctl">
        <button type="button" class="tl-btn" aria-label="上一断面">${SVG.prev}</button>
        <button type="button" class="tl-btn tl-btn-play" aria-label="播放年代演变">${SVG.play}</button>
        <button type="button" class="tl-btn" aria-label="下一断面">${SVG.next}</button>
        <div class="tl-readout" aria-live="polite">
          <span class="tl-year"></span><span class="tl-era"></span>
        </div>
      </div>
    </div>`;

  const erasEl = container.querySelector('.tl-eras');
  const segEls = Array.from(container.querySelectorAll('.tl-seg'));
  const slicesEl = container.querySelector('.tl-slices');
  const btnPrev = container.querySelector('.tl-ctl .tl-btn');
  const btnPlay = container.querySelector('.tl-btn-play');
  const btnNext = container.querySelector('.tl-ctl .tl-btn:last-of-type');
  const readYear = container.querySelector('.tl-year');
  const readEra = container.querySelector('.tl-era');

  // 事件打点：独立层，点击跳转（onEvent 由 main 接管，跨时代先切断面）
  container.querySelectorAll('.tl-dot').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      onEvent(events[Number(el.dataset.i)]);
    })
  );

  let curIdx = -1;

  // ── 渲染：时代条高亮 + 当前时代切片标签 + 大读数 ──
  function render() {
    const snap = snapshots[curIdx];
    const ei = eraIdxOfSnap(curIdx);
    segEls.forEach((el, i) => el.classList.toggle('cur', i === ei));
    slicesEl.innerHTML = slicesOfEra[ei]
      .map(
        i =>
          `<button type="button" class="tl-slice${i === curIdx ? ' on' : ''}" data-i="${i}"
            title="${snapshots[i].label}">${yearLabel(snapshots[i].year)}</button>`
      )
      .join('');
    slicesEl.querySelectorAll('.tl-slice').forEach(el =>
      el.addEventListener('click', () => go(Number(el.dataset.i)))
    );
    readYear.textContent = yearLabel(snap.year);
    readEra.textContent = snap.era;
  }

  // ── 切换断面：即时换图（离散切换无节流需求）──
  function go(idx) {
    if (idx < 0 || idx >= snapshots.length || idx === curIdx) return;
    curIdx = idx;
    render();
    onSnap(snapshots[idx], idx);
  }

  // ── 播放：沿全断面每 1.6s 步进，播完自动停；手动干预即停 ──
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

  // 时代段点击 → 进入该时代（取其首断面）。播放中点选 = 换位置继续播（进度条心智）
  segEls.forEach((el, ei) =>
    el.addEventListener('click', () => go(slicesOfEra[ei][0]))
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

  // 窄时代段只留色块（名称藏进 title），随布局宽度实时判定
  const markTiny = () =>
    segEls.forEach(el => el.classList.toggle('tiny', el.offsetWidth < 46));
  new ResizeObserver(markTiny).observe(erasEl);
  markTiny(); // RO 首回调可能晚于首屏，初始先判一次

  return {
    // 外部指令（键盘步进/事件点跳转/URL 初始化）：切断面并联动两级导航
    setSnap: idx => {
      if (idx < 0 || idx >= snapshots.length) return;
      stopPlay();
      curIdx = idx;
      render();
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
