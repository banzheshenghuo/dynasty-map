import { yearLabel } from './timeline.js';

// 侧栏：断面头卡（时代简介 + 政权图例）+ 当前时代大事年表
export function renderSidebar({ infoEl, listEl, era, snap, events, selected, onEventClick }) {
  const primary = snap.regimes.find(r => !r.weak) || snap.regimes[0];
  infoEl.innerHTML = `
    <div class="dyn-head" style="--dyn-color:${primary.color}">
      <h2>${era.name}</h2>
      <span class="dyn-period">${yearLabel(snap.year)} · ${snap.label}</span>
    </div>
    <p class="dyn-summary">${era.summary}</p>
    <div class="regime-chips">
      ${snap.regimes
        .map(r => `<span class="chip${r.weak ? ' weak' : ''}" style="--c:${r.color}">${r.name}</span>`)
        .join('')}
    </div>
    <p class="dyn-source">${snap.note}</p>`;

  listEl.innerHTML =
    '<div class="evt-caption">大事年表</div>' +
    (events.length
      ? events
          .map(
            e => `
      <div class="evt-item ${selected && selected.title === e.title ? 'selected' : ''}" data-title="${e.title}">
        <span class="evt-year">${e.yearLabel}</span>
        <div class="evt-main">
          <span class="evt-name">${e.title}</span>
          ${e.location.name ? `<span class="evt-loc">${e.location.name}</span>` : ''}
          <p class="evt-desc">${e.description}</p>
        </div>
      </div>`
          )
          .join('')
      : '<p class="evt-empty">本时代暂无收录大事</p>');
  listEl.querySelectorAll('.evt-item').forEach(item =>
    item.addEventListener('click', () => {
      const evt = events.find(e => e.title === item.dataset.title);
      onEventClick(evt);
    })
  );

  // 选中条目滚入抽屉可视区——只能滚 #sidebar 自身。
  // 不能用 scrollIntoView：抽屉收起时条目在视口外，它会把 body
  // 也滚上去（overflow:hidden 仍可编程滚动），整个页面错位
  const sel = listEl.querySelector('.evt-item.selected');
  if (sel) {
    const sb = sel.closest('#sidebar');
    if (sb) {
      const selTop = sel.getBoundingClientRect().top;
      const sbTop = sb.getBoundingClientRect().top;
      if (selTop < sbTop + 60 || selTop > sbTop + sb.clientHeight - 90) {
        sb.scrollTop += selTop - sbTop - 60;
      }
    }
  }
}
