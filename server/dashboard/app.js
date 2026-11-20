'use strict';
// Session Observer dashboard — header, render scheduling, loading and live updates, controls, start-up.
// ---------------------------------------------------------------- header
function renderHeader() {
  const c = $('conn'); c.className = 'dot ' + (state.connected ? 'on' : 'bad');
  $('connTxt').textContent = state.connected ? TX.live : TX.disconnected;
  const working = [...state.sessions.values()].filter(s => s.busy && !s.ended).length;
  $('hdrBusy').innerHTML = `<span class="dot ${working ? 'busy' : ''}"></span>${esc(TX.working(working))}`;
  $('conn').parentElement.title = TX.connTitle + (state.updated ? TX.lastUpdate(fmtTime(state.updated)) : '');
  $('pause').textContent = state.paused ? TX.unfreeze(state.buffer.length) : TX.freeze;
  $('pause').classList.toggle('on', state.paused);
}

// ---------------------------------------------------------------- render scheduling
const dirty = new Set();
let raf = 0;
function schedule(...parts) { for (const p of parts) dirty.add(p); if (!raf) raf = requestAnimationFrame(flush); }
function flush() {
  raf = 0;
  if (dirty.has('turns')) TURNS = computeTurns(state.events);
  if (dirty.has('header')) renderHeader();
  if (dirty.has('sessions')) renderSessions();
  if (dirty.has('cats')) renderCats();
  if (dirty.has('mid')) renderMid();
  if (dirty.has('detail')) renderDetail();
  if (dirty.has('replay')) renderReplay();
  if (dirty.has('map')) markStage();
  dirty.clear();
  altDirty = true;
}
const ALL = ['turns', 'header', 'sessions', 'feed', 'cats', 'mid', 'detail', 'replay', 'map'];

function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  if (state.playing) advanceReplay(now);
  if (mapDirty) { mapDirty = false; markStage(); altDirty = true; }
  drawAlt(now);
}

// ---------------------------------------------------------------- data
let loadToken = 0;
async function loadScope() {
  const tok = ++loadToken;
  const cut = cutoffIso();
  const url = state.scope === 'all' ? `/api/events?session=all${cut ? '&since=' + encodeURIComponent(cut) : ''}` : `/api/events?session=${encodeURIComponent(state.scope)}`;
  let evs = [];
  try { const r = await fetch(url); if (r.ok) evs = await r.json(); } catch { /* offline */ }
  if (tok !== loadToken) return;
  evs.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
  state.events = evs; state.buffer = [];
  state.cursor = null; state.playing = false;
  TURNS = computeTurns(evs);
  if (state.turnSel && !TURNS.some(t => t.key === state.turnSel)) state.turnSel = null;
  rebuildMap();
  schedule(...ALL);
}
function selectScope(id) {
  state.scope = id; state.turnSel = null; state.evOpen.clear();
  try { history.replaceState(null, '', id === 'all' ? location.pathname : '#session=' + encodeURIComponent(id)); } catch { /* ignore */ }
  schedule('sessions', 'header');
  loadScope();
}
function inScope(ev) {
  if (state.scope !== 'all' && ev.session_id !== state.scope) return false;
  return true;
}
function insertEvent(ev) {
  const a = state.events; let i = a.length;
  while (i > 0 && (a[i - 1].ts > ev.ts || (a[i - 1].ts === ev.ts && a[i - 1].seq > ev.seq))) i--;
  a.splice(i, 0, ev);
  if (a.length > 12000) a.splice(0, a.length - 12000);
  return i === a.length - 1;
}
function takeEvent(ev) {
  // the server re-sends a model step when later transcript lines add its tool calls: update it in place
  if (ev.seq != null) for (let a = state.events, i = a.length - 1, n = 0; i >= 0 && n < 4000; i--, n++) if (a[i].seq === ev.seq) {
    a[i].data = ev.data; schedule('turns', 'mid', 'map', 'detail'); markStage(); return;
  }
  const atEnd = insertEvent(ev);
  if (state.cursor == null) {
    if (atEnd) applyEvent(ev); else rebuildMap(); // late model step: rebuild
  }
  schedule('turns', 'feed', 'cats', 'mid', 'replay', 'map');
  if (state.turnSel && ev.session_id === state.turnSel.split(':')[0]) schedule('detail');
}
function flushBuffer() { const b = state.buffer; state.buffer = []; for (const ev of b) takeEvent(ev); schedule('header'); }

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { state.connected = true; schedule('header'); };
  es.onerror = () => { state.connected = false; schedule('header'); };
  es.addEventListener('hello', m => { const v = JSON.parse(m.data).version; $('ver').textContent = v ? 'v' + v : ''; });
  es.addEventListener('session', m => {
    const s = JSON.parse(m.data); state.sessions.set(s.id, s); state.updated = Date.now();
    if (state.paused) return schedule('header');
    schedule('sessions', 'header', 'mid');
  });
  es.addEventListener('event', m => {
    const ev = JSON.parse(m.data); state.updated = Date.now();
    if (!inScope(ev)) return;
    if (state.paused) { state.buffer.push(ev); return schedule('header'); }
    takeEvent(ev);
  });
  es.addEventListener('reset', () => { state.sessions.clear(); state.events = []; state.turnSel = null; state.scope = 'all'; TURNS = []; rebuildMap(); schedule(...ALL); });
}

// ---------------------------------------------------------------- wiring
function applyTheme() {
  const r = document.documentElement;
  if (state.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = state.theme;
  $('theme').textContent = TX.theme(TX.themes[state.theme] || state.theme);
}
function initControls() {
  applyText();
  // the language: Auto follows the browser; a choice is remembered, and the page reloads in it
  const saved = ls.get('so.lang', '');
  $('lang').innerHTML = `<option value="">${esc(TX.langAuto)}</option>` + Object.entries(LANGS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  $('lang').value = TEXT[saved] ? saved : '';
  $('lang').onchange = e => { ls.set('so.lang', e.target.value); location.reload(); };
  $('station').innerHTML = `<option value="">${esc(TX.allGroups)}</option>` + STATIONS.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
  $('range').value = String(state.range); if (!$('range').value) { $('range').value = '86400000'; state.range = 86400000; }
  $('speed').value = String(state.speed); if (!$('speed').value) { $('speed').value = '5'; state.speed = 5; }
  applyTheme();

  const refilter = () => schedule('feed', 'mid', 'detail', 'sessions', 'cats', 'map');
  let qt; $('q').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); refilter(); }, 150); };
  $('station').onchange = e => { state.station = e.target.value; refilter(); };
  $('problems').onchange = e => { state.problems = e.target.checked; refilter(); };
  $('clearFilters').onclick = () => {
    state.q = state.station = state.category = ''; state.problems = false;
    $('q').value = ''; $('station').value = ''; $('problems').checked = false; refilter();
  };
  $('range').onchange = e => { state.range = Number(e.target.value); ls.set('so.range', state.range); loadScope(); };
  $('speed').onchange = e => { state.speed = Number(e.target.value); ls.set('so.speed', state.speed); };
  $('theme').onclick = () => { state.theme = { auto: 'dark', dark: 'light', light: 'auto' }[state.theme] || 'auto'; ls.set('so.theme', state.theme); applyTheme(); };
  $('pause').onclick = () => { state.paused = !state.paused; if (!state.paused) { flushBuffer(); schedule('sessions', 'mid'); } schedule('header'); };
  $('clearLog').onclick = async () => { if (!confirm(TX.clearConfirm)) return; await fetch('/api/clear', { method: 'POST' }); };
  $('play').onclick = () => { if (state.playing) { state.playing = false; renderReplay(); } else startReplay(); };
  $('live').onclick = () => goLive();

  const tr = $('track'); let drag = false;
  tr.addEventListener('pointerdown', e => { drag = true; tr.setPointerCapture(e.pointerId); trackSeek(e.clientX); });
  tr.addEventListener('pointermove', e => { if (drag) trackSeek(e.clientX); });
  tr.addEventListener('pointerup', () => { drag = false; });

  $('layouts').onclick = e => { const b = e.target.closest('[data-layout]'); if (b) setLayout(b.dataset.layout); };
  $('alt').addEventListener('mouseover', e => {
    const el = e.target.closest('[data-ln]'), k = el ? el.dataset.ln.split(' ')[0] : null;
    // a chat item, route stop or model-step diamond under the mouse lights up its rows in Details
    const c = e.target.closest('[data-seqs]'), cs = c && c.dataset.seqs.trim() ? c.dataset.seqs.trim().split(/\s+/) : null;
    const changed = String(cs) !== String(viewHover), lnChanged = k !== hoverLn;
    viewHover = cs; hoverLn = k;
    if (changed || lnChanged) { applyHover(); if (changed && cs) revealPin(); }
  });
  $('alt').addEventListener('mouseleave', () => { if (hoverLn || viewHover) { hoverLn = null; viewHover = null; applyHover(); } });
  $('detail').addEventListener('mouseover', e => {
    const row = e.target.closest('.frow[data-seq]'), k = row ? Number(row.dataset.seq) : null;
    if (k !== hoverSeq) { hoverSeq = k; applyHover(); revealPin(); }
  });
  $('detail').addEventListener('mouseleave', () => { if (hoverSeq != null) { hoverSeq = null; applyHover(); } });
  // remember which Details sections are open ('toggle' does not bubble, so listen in the capture phase)
  $('detail').addEventListener('toggle', e => {
    const id = e.target.dataset?.dsec; if (!id) return;
    dsecOpen[id] = e.target.open; ls.set('so.dsec', JSON.stringify(dsecOpen));
  }, true);
  $('alt').addEventListener('click', e => {
    if (e.target.closest('[data-follow]')) { state.turnSel = null; renderDetail(); renderMid(); altDirty = true; return; }
    const tg = e.target.closest('[data-tog]');
    if (tg) { const k = tg.dataset.tog; routeOpen.set(k, tg.dataset.open !== '1'); altDirty = true; return; }
    const k = e.target.closest('[data-key]'); if (k) { selectTurn(k.dataset.key); altDirty = true; return; }
    const q = e.target.closest('[data-seq]');
    if (q) { const seq = Number(q.dataset.seq), t = TURN_BY_SEQ.get(seq); if (t) { selectTurn(t.key, seq); altDirty = true; } return; }
  });
  $('cats').onclick = e => {
    const c = e.target.closest('[data-cat]'); if (!c) return;
    state.category = state.category === c.dataset.cat ? '' : c.dataset.cat; refilter();
  };
  $('sessions').onclick = e => { const c = e.target.closest('.card'); if (c) selectScope(c.dataset.id); };
  $('mid').onclick = e => {
    const k = e.target.closest('[data-key]'); if (k) { selectTurn(k.dataset.key); altDirty = true; renderMid(); return; }
    const q = e.target.closest('[data-seq]');
    if (q) { const seq = Number(q.dataset.seq), t = TURN_BY_SEQ.get(seq); if (t) { selectTurn(t.key, seq); altDirty = true; renderMid(); } return; }
    const st = e.target.closest('[data-st]');
    if (st) { state.station = state.station === st.dataset.st ? '' : st.dataset.st; $('station').value = state.station; refilter(); }
  };
  // chart tooltips (one floating box for every [data-tip]) and the context chart's crosshair
  const vtip = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'vtip' }));
  const showTip = (txt, x, y) => {
    vtip.textContent = txt; vtip.style.display = 'block';
    const r = vtip.getBoundingClientRect();
    vtip.style.left = Math.min(innerWidth - r.width - 8, x + 14) + 'px';
    vtip.style.top = (y + 16 + r.height > innerHeight ? y - r.height - 10 : y + 16) + 'px';
  };
  $('mid').addEventListener('mousemove', e => {
    const svg = e.target.closest('svg.vctx'), xh = svg?.querySelector('.xhair');
    if (svg && VCTX && e.target.classList.contains('ov')) {
      const b = svg.getBoundingClientRect(), mx = (e.clientX - b.left) * VCTX.W / b.width;
      const p = VCTX.pts.reduce((a, q) => Math.abs(q.x - mx) < Math.abs(a.x - mx) ? q : a);
      xh.style.display = ''; xh.querySelector('line').setAttribute('x1', p.x); xh.querySelector('line').setAttribute('x2', p.x);
      xh.querySelector('circle').setAttribute('cx', p.x); xh.querySelector('circle').setAttribute('cy', p.y);
      return showTip(`${fmtTime(p.t)}\n${TX.ctxLc} ${TX.ofPct(fmtN(p.v), fmtN(VCTX.win), Math.round(100 * p.v / VCTX.win))}`, e.clientX, e.clientY);
    }
    for (const x of $('mid').querySelectorAll('.xhair')) x.style.display = 'none';
    const t = e.target.closest('[data-tip]');
    if (t) showTip(t.dataset.tip, e.clientX, e.clientY); else vtip.style.display = 'none';
  });
  $('mid').addEventListener('mouseleave', () => { vtip.style.display = 'none'; for (const x of $('mid').querySelectorAll('.xhair')) x.style.display = 'none'; });
  $('detail').onclick = e => {
    if (e.target.closest('#closeTurn')) { state.turnSel = null; renderDetail(); renderMid(); return; }
    if (e.target.closest('#prevTurn')) return stepTurn(-1);
    if (e.target.closest('#nextTurn')) return stepTurn(1);
    if (e.target.closest('pre.raw, .evx')) return;
    const r = e.target.closest('.erow'); if (!r) return;
    const seq = Number(r.id.slice(3)), pre = Number(r.dataset.pre);
    // beside the Context view a row click brings up its message there, and only the arrow opens or closes the row
    if (state.layout === 'context' && !e.target.closest('.etog')) {
      if (!e.target.closest('.erh')) return; // inside the open card
      return ctxFocus([pre, seq], state.events.find(x => x.seq === pre)?.ts);
    }
    if (state.evOpen.has(seq) || state.evOpen.has(pre)) { state.evOpen.delete(seq); state.evOpen.delete(pre); } else state.evOpen.add(seq);
    renderDetail();
  };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') { state.turnSel = null; renderDetail(); renderMid(); }
    else if (e.key === '[') stepTurn(-1);
    else if (e.key === ']') stepTurn(1);
  });
  setInterval(() => { if (!state.paused) schedule('header', 'sessions', 'mid'); }, 15000); // refresh "ago" labels
}

async function boot() {
  initControls();
  // the route / board are sized from their container, which now follows the window height
  const fitPanels = () => document.documentElement.style.setProperty('--ptop', Math.round($('panels').getBoundingClientRect().top + scrollY) + 'px');
  fitPanels();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { fitPanels(); VW = {}; markStage(); schedule('map', 'mid'); }, 120); });
  setLayout(new URLSearchParams(location.search).get('layout') || ls.get('so.layout', 'overview'));
  try { const list = await (await fetch('/api/sessions')).json(); state.sessions = new Map(list.map(s => [s.id, s])); } catch { /* server down */ }
  const m = location.hash.match(/session=([^&]+)/);
  if (m && state.sessions.has(decodeURIComponent(m[1]))) state.scope = decodeURIComponent(m[1]);
  await loadScope();
  connect();
  requestAnimationFrame(loop);
}
boot();
