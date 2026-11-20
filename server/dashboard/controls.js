'use strict';
// Session Observer dashboard — the controls: header buttons, filters, the replay bar, and clicks, hovers and keys in
// the views and the Details panel.
const SEARCH_DELAY_MS = 150;
const AGO_REFRESH_MS = 15000;
const NEXT_THEME = { auto: 'dark', dark: 'light', light: 'auto' };

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  elementById('theme').textContent = TEXT.theme(TEXT.themes[state.theme] || state.theme);
}

const refilter = () => scheduleRender('mid', 'detail', 'sessions', 'cats', 'map');

// the turn a clicked event row / chip / stop belongs to, opened at that event
function selectTurnOfSeq(seq) {
  const turn = turnBySeq.get(seq);
  if (turn) selectTurn(turn.key, seq);
  return !!turn;
}

// ---- header
function initLanguageMenu() {
  // Auto follows the browser; a choice is remembered, and the page reloads in it
  const saved = storage.get(LANGUAGE_STORAGE_KEY, '');
  const menu = elementById('lang');
  menu.innerHTML = `<option value="">${escapeHtml(TEXT.langAuto)}</option>`
    + Object.entries(LANGUAGE_NAMES).map(([code, name]) => `<option value="${code}">${escapeHtml(name)}</option>`).join('');
  menu.value = TRANSLATIONS[saved] ? saved : '';
  menu.onchange = event => { storage.set(LANGUAGE_STORAGE_KEY, event.target.value); location.reload(); };
}

function initHeaderButtons() {
  elementById('theme').onclick = () => {
    state.theme = NEXT_THEME[state.theme] || 'auto';
    storage.set('so.theme', state.theme);
    applyTheme();
  };
  elementById('pause').onclick = () => {
    state.frozen = !state.frozen;
    if (!state.frozen) {
      applyFrozenEvents();
      scheduleRender('sessions', 'mid');
    }
    scheduleRender('header');
  };
  elementById('clearLog').onclick = async () => {
    if (!confirm(TEXT.clearConfirm)) return;
    await fetch('/api/clear', { method: 'POST' });
  };
}

// ---- filters
// a select keeps a stored value only when it is one of its options
function setSelectValue(id, value, fallback) {
  const select = elementById(id);
  select.value = String(value);
  if (select.value) return value;
  select.value = String(fallback);
  return fallback;
}

function initFilters() {
  elementById('station').innerHTML = `<option value="">${escapeHtml(TEXT.allGroups)}</option>`
    + TOOL_GROUPS.map(group => `<option value="${group.id}">${escapeHtml(group.label)}</option>`).join('');
  state.rangeMs = setSelectValue('range', state.rangeMs, 86400000);
  state.replaySpeed = setSelectValue('speed', state.replaySpeed, 5);

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

// ---- replay bar
function initReplayControls() {
  elementById('speed').onchange = event => {
    state.replaySpeed = Number(event.target.value);
    storage.set('so.speed', state.replaySpeed);
  };
  elementById('play').onclick = () => {
    if (!state.replaying) return startReplay();
    state.replaying = false;
    renderReplayBar();
  };
  elementById('live').onclick = () => goLive();
  const track = elementById('track');
  let dragging = false;
  track.addEventListener('pointerdown', event => { dragging = true; track.setPointerCapture(event.pointerId); seekReplayTrack(event.clientX); });
  track.addEventListener('pointermove', event => { if (dragging) seekReplayTrack(event.clientX); });
  track.addEventListener('pointerup', () => { dragging = false; });
}

// ---- the views (#alt)
function initViewHover() {
  const box = viewBox();
  box.addEventListener('mouseover', event => {
    const line = event.target.closest('[data-ln]'), lineKey = line ? line.dataset.ln.split(' ')[0] : null;
    // a chat item, route stop or model-step diamond under the mouse lights up its rows in Details
    const item = event.target.closest('[data-seqs]');
    const seqs = item && item.dataset.seqs.trim() ? item.dataset.seqs.trim().split(/\s+/) : null;
    const seqsChanged = String(seqs) !== String(hoveredViewSeqs), lineChanged = lineKey !== hoveredLineKey;
    hoveredViewSeqs = seqs;
    hoveredLineKey = lineKey;
    if (!seqsChanged && !lineChanged) return;
    applyHoverHighlights();
    if (seqsChanged && seqs) revealHighlighted();
  });
  box.addEventListener('mouseleave', () => {
    if (!hoveredLineKey && !hoveredViewSeqs) return;
    hoveredLineKey = null;
    hoveredViewSeqs = null;
    applyHoverHighlights();
  });
}

function initViewClicks() {
  elementById('layouts').onclick = event => {
    const tab = event.target.closest('[data-layout]');
    if (tab) setView(tab.dataset.layout);
  };
  viewBox().addEventListener('click', event => {
    if (event.target.closest('[data-follow]')) {
      state.selectedTurnKey = null;
      renderDetails();
      renderOverview();
      viewNeedsDrawing = true;
      return;
    }
    const turnToggle = event.target.closest('[data-tog]');
    if (turnToggle) {
      routeTurnOpen.set(turnToggle.dataset.tog, turnToggle.dataset.open !== '1');
      viewNeedsDrawing = true;
      return;
    }
    const turnLink = event.target.closest('[data-key]');
    if (turnLink) {
      selectTurn(turnLink.dataset.key);
      viewNeedsDrawing = true;
      return;
    }
    const eventLink = event.target.closest('[data-seq]');
    if (eventLink && selectTurnOfSeq(Number(eventLink.dataset.seq))) viewNeedsDrawing = true;
  });
}

// ---- the overview (#mid) and the sessions panel
function initOverviewClicks() {
  elementById('sessions').onclick = event => {
    const card = event.target.closest('.card');
    if (card) selectScope(card.dataset.id);
  };
  elementById('mid').onclick = event => {
    const turnLink = event.target.closest('[data-key]');
    if (turnLink) {
      selectTurn(turnLink.dataset.key);
      viewNeedsDrawing = true;
      renderOverview();
      return;
    }
    const eventLink = event.target.closest('[data-seq]');
    if (eventLink) {
      if (selectTurnOfSeq(Number(eventLink.dataset.seq))) { viewNeedsDrawing = true; renderOverview(); }
      return;
    }
    const groupCard = event.target.closest('[data-st]');
    if (groupCard) {
      state.group = state.group === groupCard.dataset.st ? '' : groupCard.dataset.st;
      elementById('station').value = state.group;
      refilter();
    }
  };
}

// chart tooltips (one floating box for every [data-tip]) and the context chart's crosshair
function initChartTooltips() {
  const tooltip = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'vtip' }));
  const showTooltip = (text, x, y) => {
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.min(innerWidth - box.width - 8, x + 14) + 'px';
    tooltip.style.top = (y + 16 + box.height > innerHeight ? y - box.height - 10 : y + 16) + 'px';
  };
  const hideCrosshairs = () => { for (const crosshair of elementById('mid').querySelectorAll('.xhair')) crosshair.style.display = 'none'; };

  // the context chart: the step nearest the mouse, with its time and context size
  const showCrosshair = (chart, event) => {
    const geometry = contextChartGeometry, bounds = chart.getBoundingClientRect();
    const mouseX = (event.clientX - bounds.left) * geometry.width / bounds.width;
    const nearest = geometry.points.reduce((best, point) => (Math.abs(point.x - mouseX) < Math.abs(best.x - mouseX) ? point : best));
    const crosshair = chart.querySelector('.xhair'), line = crosshair.querySelector('line'), dot = crosshair.querySelector('circle');
    crosshair.style.display = '';
    line.setAttribute('x1', nearest.x);
    line.setAttribute('x2', nearest.x);
    dot.setAttribute('cx', nearest.x);
    dot.setAttribute('cy', nearest.y);
    const size = TEXT.ofPct(formatCompactNumber(nearest.tokens), formatCompactNumber(geometry.window), Math.round(100 * nearest.tokens / geometry.window));
    showTooltip(`${formatTime(nearest.time)}\n${TEXT.ctxLc} ${size}`, event.clientX, event.clientY);
  };

  elementById('mid').addEventListener('mousemove', event => {
    const chart = event.target.closest('svg.vctx');
    if (chart && contextChartGeometry && event.target.classList.contains('ov')) return showCrosshair(chart, event);
    hideCrosshairs();
    const withTooltip = event.target.closest('[data-tip]');
    if (withTooltip) showTooltip(withTooltip.dataset.tip, event.clientX, event.clientY);
    else tooltip.style.display = 'none';
  });
  elementById('mid').addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hideCrosshairs(); });
}

// ---- the Details panel
function toggleEventRow(seq, callSeq) {
  if (state.openEventSeqs.has(seq) || state.openEventSeqs.has(callSeq)) {
    state.openEventSeqs.delete(seq);
    state.openEventSeqs.delete(callSeq);
  } else {
    state.openEventSeqs.add(seq);
  }
  renderDetails();
}

function initDetailsPanel() {
  const panel = elementById('detail');
  panel.addEventListener('mouseover', event => {
    const row = event.target.closest('.frow[data-seq]'), seq = row ? Number(row.dataset.seq) : null;
    if (seq === hoveredDetailSeq) return;
    hoveredDetailSeq = seq;
    applyHoverHighlights();
    revealHighlighted();
  });
  panel.addEventListener('mouseleave', () => {
    if (hoveredDetailSeq == null) return;
    hoveredDetailSeq = null;
    applyHoverHighlights();
  });
  // remember which Details sections are open ('toggle' does not bubble, so listen in the capture phase)
  panel.addEventListener('toggle', event => {
    const id = event.target.dataset?.dsec;
    if (!id) return;
    detailSectionOpen[id] = event.target.open;
    storage.set('so.dsec', JSON.stringify(detailSectionOpen));
  }, true);
  panel.onclick = event => {
    if (event.target.closest('#closeTurn')) return closeSelectedTurn();
    if (event.target.closest('#prevTurn')) return selectAdjacentTurn(-1);
    if (event.target.closest('#nextTurn')) return selectAdjacentTurn(1);
    if (event.target.closest('pre.raw, .evx')) return; // inside an open card
    const row = event.target.closest('.erow');
    if (!row) return;
    const seq = Number(row.id.slice(3)), callSeq = Number(row.dataset.pre);
    // beside the Context view a row click brings up its message there, and only the arrow opens or closes the row
    if (state.view === 'context' && !event.target.closest('.etog')) {
      if (!event.target.closest('.erh')) return;
      return focusContextMessage([callSeq, seq], state.events.find(other => other.seq === callSeq)?.ts);
    }
    toggleEventRow(seq, callSeq);
  };
}

// Esc closes the turn; [ and ] step through the turns
function initKeyboard() {
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'Escape') closeSelectedTurn();
    else if (event.key === '[') selectAdjacentTurn(-1);
    else if (event.key === ']') selectAdjacentTurn(1);
  });
}

function initControls() {
  applyPageText();
  initLanguageMenu();
  initFilters();
  applyTheme();
  initHeaderButtons();
  initReplayControls();
  initViewClicks();
  initViewHover();
  initDetailsPanel();
  initOverviewClicks();
  initChartTooltips();
  initKeyboard();
  setInterval(() => { if (!state.frozen) scheduleRender('header', 'sessions', 'mid'); }, AGO_REFRESH_MS); // refresh "ago" labels
}
