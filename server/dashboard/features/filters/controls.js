'use strict';
// Session Observer dashboard — Filters, the controls: search, tool group, only problems, range, event-type chips.
const SEARCH_DELAY_MS = 150;

const refilter = () => scheduleRender('mid', 'detail', 'sessions', 'cats', 'map');


function initFilterControls() {
  elementById('station').innerHTML = `<option value="">${escapeHtml(TEXT.allGroups)}</option>`
    + TOOL_GROUPS.map(group => `<option value="${group.id}">${escapeHtml(group.label)}</option>`).join('');
  state.rangeMs = setSelectValue('range', state.rangeMs, 86400000);

  let searchTimer;
  elementById('q').oninput = event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchText = event.target.value.trim().toLowerCase(); refilter(); }, SEARCH_DELAY_MS);
  };
  elementById('station').onchange = event => { state.group = event.target.value; refilter(); };
  elementById('problems').onchange = event => { state.onlyProblems = event.target.checked; refilter(); };
  elementById('clearFilters').onclick = () => {
    state.searchText = state.group = state.category = '';
    state.onlyProblems = false;
    elementById('q').value = '';
    elementById('station').value = '';
    elementById('problems').checked = false;
    refilter();
  };
  elementById('range').onchange = event => {
    state.rangeMs = Number(event.target.value);
    storage.set('so.range', state.rangeMs);
    loadScope();
  };
  elementById('cats').onclick = event => {
    const chip = event.target.closest('[data-cat]');
    if (!chip) return;
    state.category = state.category === chip.dataset.cat ? '' : chip.dataset.cat;
    refilter();
  };
}
