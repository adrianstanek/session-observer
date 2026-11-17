'use strict';
// Session Observer dashboard — event rows, the replay bar and the sessions panel.
// ---------------------------------------------------------------- feed
function feedText(ev) {
  const [label, sub] = describe(ev);
  return { label, sub };
}
function feedMarker(ev, running) {
  if (running) return '<span class="mk run">●</span>';
  if (isProblem(ev) || ev.event === 'StopFailure') return '<span class="mk fail">✕</span>';
  if (ev.event === 'ModelStep') return '<span class="mk model">◆</span>';
  if (ev.event === 'Stop') return '<span class="mk">›</span>';
  return '<span class="mk">·</span>';
}
function feedRow(ev, running, opts = {}) {
  const st = stationOf(ev) || (ev.event === 'Stop' ? 'turn' : 'other');
  const ft = feedText(ev), label = ft.label, sub = opts.sub != null ? opts.sub : opts.said ? `${opts.said}  → ${ft.sub}` : ft.sub;
  const color = ev.event === 'Stop' ? 'var(--ok)' : `var(--s-${st})`;
  const proj = opts.proj ? `<span class="proj">${esc(opts.proj)}</span>` : '';
  const dur = opts.dur ? `<span class="dur">${running ? 'running…' : esc(fmtDur(ev.duration_ms))}</span>` : '';
  return `<div class="frow ${isProblem(ev) ? 'fail' : ''}" data-seq="${ev.seq}">${feedMarker(ev, running)}<span class="t">${fmtTime(opts.ts || ev.ts)}</span>
    <span class="who" style="color:${color}">${evIcon(ev, st, 2)}<span>${esc(label)}</span></span><span class="what">${proj}${esc(short(sub, 300))}</span>${dur}</div>`;
}
function renderCats() {
  const counts = {}, errs = {};
  for (const ev of state.events) { counts[ev.category] = (counts[ev.category] || 0) + 1; if (isProblem(ev)) errs[ev.category] = (errs[ev.category] || 0) + 1; }
  $('cats').innerHTML = `<span class="ttl">${icon('core')} Event types</span>` + Object.entries(CATS).filter(([k]) => counts[k]).map(([k, l]) =>
    `<span class="chip click ${state.category === k ? 'sel' : ''}" data-cat="${k}"><i style="background:${CAT_COLOR[k] === 'err' ? 'var(--err)' : `var(--s-${CAT_COLOR[k]})`}"></i>${l} <b>${counts[k]}</b>${errs[k] && k !== 'error' ? ` <span class="x">✕${errs[k]}</span>` : ''}</span>`).join('');
}

// ---------------------------------------------------------------- replay bar
function domain() {
  const e = state.events; if (!e.length) return null;
  const a = tms(e[0]), b = Math.max(tms(e[e.length - 1]), a + 1000);
  return [a, b];
}
function renderReplay() {
  const dm = domain();
  const pos = !dm ? 1 : state.cursor == null ? 1 : Math.max(0, Math.min(1, (state.cursor - dm[0]) / (dm[1] - dm[0])));
  $('fill').style.width = (pos * 100) + '%'; $('thumb').style.left = (pos * 100) + '%';
  $('live').classList.toggle('on', state.cursor == null);
  $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Replay';
  const lim = state.cursor ?? Infinity;
  let cur = null;
  for (const t of TURNS) if (Date.parse(t.start) <= lim) cur = t;
  if (dm) {
    const maxTools = Math.max(1, ...TURNS.map(t => t.tools + t.steps));
    $('ticks').innerHTML = TURNS.filter(t => t.prompt !== null).map(t => {
      const x = (Date.parse(t.start) - dm[0]) / (dm[1] - dm[0]) * 100;
      const hgt = 5 + 15 * Math.sqrt((t.tools + t.steps) / maxTools);
      return `<div class="tick ${t.errors ? 'err' : ''} ${t === cur ? 'cur' : ''}" style="left:${x.toFixed(3)}%;height:${hgt.toFixed(1)}px" title="${esc(fmtTime(t.start) + ' · ' + short(t.prompt, 80))}"></div>`;
    }).join('');
  } else $('ticks').innerHTML = '';
  const mode = state.cursor == null ? '<b>Live</b>' : `<b>${state.playing ? 'Replaying' : 'Paused'}</b> · ${fmtTime(state.cursor)}`;
  $('rlabel').innerHTML = `${mode}${cur && cur.prompt ? ` · turn ${fmtTime(cur.start)} · ${esc(short(cur.prompt, 60))}` : ''}`;
  for (const el of document.querySelectorAll('#mid .col')) el.classList.toggle('cur', !!cur && el.dataset.key === cur.key && state.cursor != null);
}
function setCursor(ts) {
  state.cursor = ts; rebuildMap(); renderReplay(); markStage();
}
function goLive() {
  state.playing = false; state.cursor = null;
  if (state.buffer.length && !state.paused) flushBuffer();
  rebuildMap(); renderReplay(); markStage();
}
function startReplay() {
  if (!state.events.length) return;
  if (state.cursor == null) {
    const t = state.turnSel && TURNS.find(x => x.key === state.turnSel);
    const start = t ? Date.parse(t.start) : tms(state.events[0]);
    state.cursor = start - 1; rebuildMap();
  }
  state.playing = true; state.lastTick = performance.now();
  renderReplay(); markStage();
}
let lastReplayRender = 0;
function advanceReplay(now) {
  const dt = Math.min(250, now - state.lastTick); state.lastTick = now;
  const evs = state.events; let i = state.replayIdx;
  if (i >= evs.length) { goLive(); return; }
  let next = state.cursor + dt * state.speed;
  const nt = tms(evs[i]);
  if (nt - state.cursor > 1500 * state.speed) next = Math.max(next, nt - 400 * state.speed); // skip idle gaps
  let changed = false;
  while (i < evs.length && tms(evs[i]) <= next) { applyEvent(evs[i]); i++; changed = true; }
  state.replayIdx = i; state.cursor = next;
  if (i >= evs.length) { goLive(); return; }
  if (changed) markStage();
  if (now - lastReplayRender > 200) { lastReplayRender = now; renderReplay(); }
}
function trackSeek(clientX) {
  const dm = domain(); if (!dm) return;
  const r = $('track').getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  state.playing = false;
  if (f > 0.995) goLive(); else setCursor(dm[0] + f * (dm[1] - dm[0]));
}

// ---------------------------------------------------------------- sessions panel
function sessState(s) {
  if (s.ended) return ['ended', 'dot'];
  if (s.busy) return ['working', 'dot busy'];
  if (Date.now() - Date.parse(s.last) < 30 * 60000) return ['live', 'dot on'];
  return ['inactive', 'dot'];
}
function visibleSessions() {
  const cut = cutoffIso();
  return [...state.sessions.values()]
    .filter(s => !cut || (s.last || '') >= cut)
    .filter(s => !state.q || ((s.title || '') + ' ' + (s.cwd || '') + ' ' + s.id).toLowerCase().includes(state.q) || state.scope === s.id)
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}
function rangeLabel() { const o = $('range').selectedOptions[0]; return o ? o.textContent : ''; }
function renderSessions() {
  const list = visibleSessions();
  const el = $('sessions'); const top = el.scrollTop;
  el.innerHTML = `
    <div class="card ${state.scope === 'all' ? 'sel' : ''}" data-id="all">
      <div class="row1"><span class="name">All activity</span></div>
      <div class="meta">every session combined</div>
    </div>
    <div class="sect">Sessions <span>${list.length}</span></div>
    <div class="sess-list">${list.map(s => {
      const [st, dot] = sessState(s);
      const out = s.usage ? s.usage.output : 0;
      const lt = !s.ended && s.lastTool ? `<div class="meta">last: <b>${esc(toolLabel(s.lastTool.name))}</b> <span class="mono">${esc(short(s.lastTool.arg, 60))}</span></div>` : '';
      return `<div class="card ${s.id === state.scope ? 'sel' : ''}" data-id="${esc(s.id)}">
        <div class="row1"><span class="name">${esc(clean(s.title) || base(s.cwd) || s.id.slice(0, 8))}</span><span class="state"><span class="${dot}"></span>${st}</span></div>
        <div class="meta">${s.last ? fmtAgo(s.last) : ''} · ${s.turns || 0} turns · ${s.toolCalls} tools${out ? ` · ${fmtN(out)} out` : ''}</div>${lt}
        <div class="chips">${s.title ? `<span class="chip" title="${esc(s.cwd || '')}">${icon('files')}${esc(base(s.cwd) || '?')}</span>` : ''}${s.model ? `<span class="chip">${esc(s.model)}</span>` : ''}${s.subagents ? `<span class="chip">${icon('agents')}${s.subagents}</span>` : ''}${s.failures ? `<span class="chip"><span class="x">✕ ${s.failures}</span></span>` : ''}${s.context ? `<span class="chip" title="context window">ctx ${Math.round(s.context.pct * 100)}%</span>` : ''}</div>
      </div>`;
    }).join('') || '<div class="empty">No sessions in this range.</div>'}</div>`;
  el.scrollTop = top;
}
