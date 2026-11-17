'use strict';
// Session Observer dashboard — the middle stage: switching between Overview / Route / Chat / Context, and the activity-by-group cards.
// ---------------------------------------------------------------- stage views
// Two views of the same state (M, state.events, cursor):
//   board — a grid of station cards with counts, 15-min sparklines and live "running" state
//   route — the current turn as a metro line: every model step and tool call is a stop
//   chat  — the conversation as a messenger: prompts, the agent's replies, tool calls as chips
//   context — one session's whole conversation in full, read from its transcript
const LAYOUTS = [['overview', 'Overview'], ['route', 'Route'], ['chat', 'Chat'], ['context', 'Context']];
const ROW = Object.fromEntries(STATIONS.map((s, i) => [s.id, i]));
let altDirty = true, lastAltT = 0, lastAltRaw = '';
const evEnd = () => state.cursor == null ? state.events.length : Math.min(state.replayIdx, state.events.length);
const agoMs = ms => ms < 60000 ? `${Math.max(0, Math.round(ms / 1000))}s` : ms < 3600000 ? `${Math.floor(ms / 60000)}m` : ms < 86400000 ? `${Math.floor(ms / 3600000)}h` : `${Math.floor(ms / 86400000)}d`;
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const evTip = ev => esc(describe(ev).map(x => short(x, 160)).join(' · '));
const svgIcon = (id, x, y, sc) => `<g class="ico" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc})">${ICONS[id] || ICONS.other}</g>`;

function setLayout(id) {
  if (!LAYOUTS.some(l => l[0] === id)) id = 'overview';
  state.layout = id; ls.set('so.layout', id);
  document.querySelector('.stage').dataset.layout = id;
  $('layouts').innerHTML = LAYOUTS.map(([k, l]) => `<button role="tab" aria-selected="${k === id}" data-layout="${k}" class="${k === id ? 'cur' : ''}">${l}</button>`).join('');
  $('alt').innerHTML = ''; lastAltRaw = ''; altDirty = true; mapDirty = true;
  if (id === 'overview') schedule('mid');
}
function drawAlt(now) {
  if (!altDirty && now - lastAltT < 250) return;
  altDirty = false; lastAltT = now;
  if (state.layout === 'overview') return; // the overview is #mid, drawn by renderMid
  const raw = state.layout === 'chat' ? chatHtml() : state.layout === 'context' ? contextHtml() : routeHtml();
  if (raw === lastAltRaw) return;
  lastAltRaw = raw;
  // keep CSS animations in phase across re-renders
  // route: jump to the focused turn when it changes; when following live, stay at the bottom unless the user scrolled up
  const sc = $('alt').querySelector('.mscroll');
  const prevKey = sc?.dataset.focus, atBottom = !sc || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8, top = sc ? sc.scrollTop : 0;
  const cx = $('alt').querySelector('.cxs');
  if (cx) ctxScroll = { sid: CTX.sid, top: cx.scrollTop, atBottom: cx.scrollTop > 0 && cx.scrollTop + cx.clientHeight >= cx.scrollHeight - 8 };
  $('alt').innerHTML = raw.replaceAll('__D__', `-${Math.round(now % 1400)}ms`);
  // context: keep the scroll position; stay at the bottom if you were there (new messages arrive at the bottom)
  const cx2 = $('alt').querySelector('.cxs');
  if (cx2 && ctxScroll.sid === CTX.sid) cx2.scrollTop = ctxScroll.atBottom ? cx2.scrollHeight : ctxScroll.top;
  const sc2 = $('alt').querySelector('.mscroll');
  applyHover();
  const ch = $('alt').querySelector('.chat');
  if (ch) {
    // chat: jump to the selected turn when it changes; otherwise follow the bottom unless scrolled up
    const pc = chatScroll; chatScroll = { key: state.turnSel };
    const el = state.turnSel && ch.querySelector(`.cturn[data-tk="${CSS.escape(state.turnSel)}"]`);
    if (el && pc.key !== state.turnSel) ch.scrollTop = el.offsetTop - ch.offsetTop - 8;
    else ch.scrollTop = pc.atBottom !== false ? ch.scrollHeight : pc.top;
    ch.onscroll = () => { chatScroll.atBottom = ch.scrollTop + ch.clientHeight >= ch.scrollHeight - 8; chatScroll.top = ch.scrollTop; };
    chatScroll.atBottom = ch.scrollTop + ch.clientHeight >= ch.scrollHeight - 8; chatScroll.top = ch.scrollTop;
  }
  // route: newest turn is on top, so jump to the focused turn when it changes, otherwise keep the scroll position
  if (sc2) sc2.scrollTop = sc2.dataset.focus !== prevKey ? Number(sc2.dataset.fy) : top;
}

// ---- board: station cards
function spark(arr, max) {
  const n = arr.length; let r = '';
  arr.forEach((v, j) => { if (v) { const hh = 1 + 11 * Math.sqrt(v / max); r += `<rect x="${j + 0.15}" y="${(12 - hh).toFixed(2)}" width=".7" height="${hh.toFixed(2)}"/>`; } });
  return `<svg class="spark" viewBox="0 0 ${n} 12" preserveAspectRatio="none"><line x1="0" y1="12" x2="${n}" y2="12"/>${r}</svg>`;
}
// tool-group cards (the old Board view, now on the Overview): count, problems, last-15-min sparkline,
// what is running right now or what ran last; click a card to filter everything to that group
function groupCards() {
  const evs = state.events, end = evEnd(), sn = simNow();
  const BINS = 30, SPAN = 15 * 60000, b0 = sn - SPAN;
  const bins = {}, errs = {}, last = {};
  const COUNTED = new Set(['PreToolUse', 'ModelStep', 'UserPromptSubmit', 'SubagentStart', 'PermissionRequest', 'InstructionsLoaded', 'PreCompact', 'TaskCreated']);
  for (let i = 0; i < end; i++) {
    const ev = evs[i], st = stationOf(ev); if (!st) continue;
    if (isProblem(ev)) errs[st] = (errs[st] || 0) + 1;
    last[st] = ev;
    const t = tms(ev);
    if (COUNTED.has(ev.event) && t >= b0) { const j = Math.min(BINS - 1, Math.floor((t - b0) / SPAN * BINS)); (bins[st] ||= new Array(BINS).fill(0))[j]++; }
  }
  const max = Math.max(1, ...Object.values(bins).flat());
  const runBy = {};
  for (const r of M.running.values()) { const o = (runBy[r.st] ||= { n: 0, start: r.start }); o.n++; o.start = Math.min(o.start, r.start); }
  if (M.agents.size && !runBy.agents) runBy.agents = { n: M.agents.size, start: Math.min(...[...M.agents.values()].map(a => a.start)) };
  const used = STATIONS.filter(s => M.counts[s.id] || runBy[s.id]).sort((a, b) => (M.counts[b.id] || 0) - (M.counts[a.id] || 0));
  if (!used.length) return vcard('Activity by group', '', '<div class="none">No activity yet.</div>');
  let h = '<div class="sgrid">';
  for (const s of used) {
    const n = M.counts[s.id] || 0, run = runBy[s.id], e = errs[s.id] || 0, L = last[s.id];
    const what = L ? esc(short(describe(L)[1] || describe(L)[0], 80)) : '';
    const foot = run ? `● ${run.n > 1 ? '×' + run.n + ' ' : ''}${fmtDur(sn - run.start)} · ${what}` : L ? `${agoMs(sn - tms(L))} ago · ${what}` : '';
    const cls = ['used', run && 'hot', state.station === s.id && 'sel', state.station && state.station !== s.id && 'dim'].filter(Boolean).join(' ');
    h += `<div class="bcard ${cls}" data-st="${s.id}" style="--c:var(--s-${s.id});--d:__D__" ${tipAttr(`${s.label}: ${n}${e ? ` · ✕ ${e} problems` : ''}\n${L ? 'last: ' + short(describe(L).join(' '), 200) : ''}\nbars: last 15 min · click to filter to ${s.label}`)}>
      <div class="bh2">${icon(s.id)}<span class="nm">${s.label}</span>${e ? `<span class="x">✕${e}</span>` : ''}<span class="n">${n}</span></div>
      ${spark(bins[s.id] || new Array(BINS).fill(0), max)}<div class="ft ${run ? 'run' : ''}">${foot}</div></div>`;
  }
  const idle = STATIONS.length - used.length;
  return vcard('Activity by group', `${used.length} active${idle ? ` · ${idle} idle hidden` : ''} · bars = last 15 min · click to filter`, h + '</div>');
}
