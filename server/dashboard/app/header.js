'use strict';
// Session Observer dashboard — the header: connection, working sessions, Freeze, theme, language and Clear log.
const NEXT_THEME = { auto: 'dark', dark: 'light', light: 'auto' };

function renderHeader() {
  const connection = elementById('conn');
  connection.className = 'dot ' + (state.connected ? 'on' : 'bad');
  elementById('connTxt').textContent = state.connected ? TEXT.live : TEXT.disconnected;
  const workingSessions = [...state.sessions.values()].filter(session => session.busy && !session.ended).length;
  elementById('hdrBusy').innerHTML = `<span class="dot ${workingSessions ? 'busy' : ''}"></span>${escapeHtml(TEXT.working(workingSessions))}`;
  connection.parentElement.title = TEXT.connTitle + (state.lastUpdateAt ? TEXT.lastUpdate(formatTime(state.lastUpdateAt)) : '');
  elementById('pause').textContent = state.frozen ? TEXT.unfreeze(state.frozenEvents.length) : TEXT.freeze;
  elementById('pause').classList.toggle('on', state.frozen);
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  elementById('theme').textContent = TEXT.theme(TEXT.themes[state.theme] || state.theme);
}

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
