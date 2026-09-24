export function renderTimeline(container, dynasties, currentId, onSelect) {
  container.innerHTML = dynasties
    .map(
      d => `
      <button class="tl-item ${d.id === currentId ? 'active' : ''}" data-id="${d.id}" style="--dyn-color:${d.color}">
        <span class="tl-name">${d.name}</span>
        <span class="tl-period">${d.period}</span>
      </button>`
    )
    .join('');
  container.querySelectorAll('.tl-item').forEach(btn =>
    btn.addEventListener('click', () => onSelect(btn.dataset.id))
  );
}

export function bindKeyboard(onPrev, onNext) {
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
  });
}
