'use strict';
// Session Observer dashboard — Filters, the event-type chips under the stage: a chip per category, a click filters.
const categoryColor = category => (CATEGORY_COLOR[category] === 'err' ? 'var(--err)' : `var(--s-${CATEGORY_COLOR[category]})`);

// whether any filter is set (Range is a window, not a filter)
const filtersActive = () => anyFilterActive() || !!state.agent;

// a chip per event category in the loaded events, with its count and problems; a click filters to it
function renderCategoryChips() {
  const counts = {}, problems = {};
  for (const event of state.events) {
    counts[event.category] = (counts[event.category] || 0) + 1;
    if (isProblemEvent(event)) problems[event.category] = (problems[event.category] || 0) + 1;
  }
  const chips = Object.entries(CATEGORY_LABELS).filter(([category]) => counts[category]).map(([category, label]) => {
    const problemCount = problems[category] && category !== 'error' ? ` <span class="x">✕${problems[category]}</span>` : '';
    return `<span class="chip click ${state.category === category ? 'sel' : ''}" data-cat="${category}"><i style="background:${categoryColor(category)}"></i>${label} <b>${counts[category]}</b>${problemCount}</span>`;
  });
  elementById('cats').innerHTML = `<span class="ttl">${iconSvg('core')} ${escapeHtml(TEXT.eventTypes)}</span>` + chips.join('');
  elementById('clearFilters').disabled = !filtersActive(); // Reset filters has nothing to do
  // the Filters button counts the filters inside it, so one set there shows while the menu is shut
  const inMenu = [state.group, state.agent, state.onlyProblems].filter(Boolean).length;
  Object.assign(elementById('filterCount'), { hidden: !inMenu, textContent: inMenu || '' });
}
