'use strict';
// Session Observer dashboard — Route view: a turn as a metro line.
// ---- route: the current turn as a metro line; each subagent forks a branch below and merges back
function routeModel(t, lim) {
  const evs = t.events.filter(e => tms(e) <= lim);
  const stops = [], open = new Map(), branches = new Map(), pendingAgent = [];
  let steps = 0, tools = 0, errs = 0, ended = null, maxLane = 0, mainLast, say = null, lastTs = 0;
  const lastStep = new Map(); // lane (branch id or 'main') → its latest model-step stop, which gets the text it wrote
  // every lane keeps its own left→right position (px along the unwrapped route), so a busy subagent
  // never pushes the main line or the other subagents apart
  const add = s => {
    s.i = stops.length; s.br = br0; s.seqs = s.seq != null ? [s.seq] : [];
    const p = br0 ? br0.last : mainLast, ps = p != null ? stops[p] : null;
    s.prev = p; s.pos = ps ? ps.pos + routeGap(ps, s) : 0;
    if (br0) br0.last = s.i; else mainLast = s.i;
    stops.push(s); return s;
  };
  let br0 = null;
  // a stop on the main line (never on a subagent's branch)
  const mainStop = (ev, st, label, sub) => { br0 = null; return add({ st, label, sub, seq: ev.seq, tip: evTip(ev) }); };
  const branchOf = d => { const b = d.agent_id != null && branches.get(String(d.agent_id)); return b && !b.closed ? b : null; };
  for (const ev of evs) {
    const d = ev.data || {}, st = stationOf(ev) || 'other', br = branchOf(d);
    lastTs = Math.max(lastTs, tms(ev));
    br0 = br;
    switch (ev.event) {
      case 'UserPromptSubmit': br0 = null; add({ st: 'you', label: 'You', sub: 'prompt', seq: ev.seq, tip: evTip(ev) }); break;
      case 'ModelStep':
        if (d.subagent && !br) break; // internal helper agents with no branch: not part of the route
        steps++; lastStep.set(br ? br.id : 'main', add({ st: br ? 'agents' : 'model', small: true, seq: ev.seq, tip: evTip(ev) })); break;
      case 'ModelText': {
        if (d.subagent && !br) break;
        const tx = { text: String(d.text || ''), kind: d.kind, ts: tms(ev) }, ls = lastStep.get(br ? br.id : 'main');
        if (ls) { ls.said = (ls.said ? ls.said + ' ' : '') + (tx.kind === 'thinking' ? '(thinking) ' : '') + tx.text; ls.seqs.push(ev.seq); }
        if (br) br.say = tx; else say = tx;
        break;
      }
      case 'PreToolUse': {
        tools++;
        const s = add({ st, tech: evTech(ev), techs: evTechs(ev), label: toolLabel(d.tool_name), sub: toolArg(d), seq: ev.seq, a: tms(ev), tip: evTip(ev), id: d.tool_use_id });
        if (s.id) open.set(s.id, s);
        if (!br && (d.tool_name === 'Agent' || d.tool_name === 'Task')) { s.desc = d.tool_input?.description; pendingAgent.push(s); }
        break;
      }
      case 'PostToolUse': case 'PostToolUseFailure': {
        const s = open.get(d.tool_use_id);
        if (s) { open.delete(d.tool_use_id); s.dur = ev.duration_ms ?? tms(ev) - s.a; s.seq = ev.seq; s.seqs.push(ev.seq); s.tip = evTip(ev); if (ev.event === 'PostToolUseFailure') { s.fail = true; errs++; } }
        break;
      }
      case 'SubagentStart': {
        const from = pendingAgent.shift() ?? (mainLast != null ? stops[mainLast] : null);
        const b = { id: String(d.agent_id ?? ev.seq), type: d.agent_type || 'subagent', a: tms(ev), last: null };
        branches.set(b.id, b); br0 = b;
        const s = add({ st: 'agents', label: b.type, sub: from?.desc || 'subagent', seq: ev.seq, tip: evTip(ev), fork: from ? from.i : null, branch: b });
        s.prev = null; s.pos = from ? from.pos + 64 : 0; b.first = s.i;
        break;
      }
      case 'SubagentStop': {
        if (!br) break; // helper agent that never started a branch
        br.closed = true; br0 = null;
        const tail = stops[br.last];
        const s = add({ st: 'agents', label: '⤴ ' + br.type, sub: 'back · ' + fmtDur(tms(ev) - br.a), seq: ev.seq, tip: evTip(ev), merge: br.last });
        s.pos = Math.max(s.pos, tail.pos + 64); br.mergeAt = s.i;
        break;
      }
      case 'PermissionRequest': add({ st: 'you', label: 'Permission', sub: toolLabel(d.tool_name), seq: ev.seq, tip: evTip(ev) }); break;
      case 'PermissionDenied': errs++; add({ st: 'you', label: 'Denied', sub: toolLabel(d.tool_name), fail: true, seq: ev.seq, tip: evTip(ev) }); break;
      // a model switch mid-session is a stop on the main line: the steps after it run on a different model
      case 'PostModelSwitch': mainStop(ev, 'model', 'Model', '→ ' + String(d.to_model || '?').replace(/^claude-/, '')); break;
      // session start, config changes and memory loads are stops too (the first turn opens with the ones before its prompt);
      // the sub is kept short, since the route cuts it at 12 characters — the tooltip has the full description
      case 'SessionStart': mainStop(ev, 'context', describe(ev)[0], d.source || 'started'); break;
      case 'ConfigChange': mainStop(ev, 'context', describe(ev)[0], spaced(d.source) || 'changed'); break;
      case 'PreCompact': case 'InstructionsLoaded': { const [label, sub] = describe(ev); mainStop(ev, 'context', label, base(sub)); break; }
      case 'Stop': case 'StopFailure': case 'SessionEnd': ended = ended || ev; break;
    }
  }
  for (const [key, s] of open) s.run = M.running.has(key);
  for (const b of branches.values()) if (!b.closed) b.run = [...M.agents.keys()].some(k => String(k) === b.id);

  // lanes: the subagent forked last gets the lane nearest the main line, so parallel forks nest
  // (└┘ inside └──┘) instead of crossing; a lane is reused once its previous subagent has finished
  const span = b => [stops[b.first].pos - 64, b.mergeAt != null ? stops[b.mergeAt].pos : stops[b.last].pos + (b.run ? 40 : 0)];
  const taken = [];
  for (const b of [...branches.values()].sort((x, y) => stops[y.first].pos - stops[x.first].pos || y.first - x.first)) {
    const [a, z] = span(b);
    let k = 1; while ((taken[k] ||= []).some(([p, q]) => a < q + 40 && p < z + 40)) k++;
    taken[k].push([a, z]); b.lane = k; maxLane = Math.max(maxLane, k);
  }
  for (const s of stops) s.lane = s.br ? s.br.lane : 0;
  return { stops, branches, steps, tools, errs, ended, maxLane, mainLast, say, lastTs };
}
// context at the end of a turn: the last main-line model step's context tokens (null if none reported yet)
function turnCtx(t, lim) {
  let c = null;
  for (const e of t.events) if (e.event === 'ModelStep' && !e.data?.subagent && e.data?.agent_id == null && e.data?.tokens?.context && tms(e) <= lim) c = e.data.tokens.context;
  return c;
}
// context at the end of this turn, its change from the end of the turn before, and how full the window is
function ctxInfo(sess, tt, lim) {
  const c = turnCtx(tt, lim); if (c == null) return null;
  let p = null; for (let i = sess.indexOf(tt) - 1; i >= 0 && p == null; i--) p = turnCtx(sess[i], lim);
  const win = c > 200000 ? 1000000 : (state.sessions.get(tt.sid)?.context?.window || 200000);
  const d = p == null ? null : c - p;
  // delta colour: shrank (compaction) = ok, big jump (≥ 10% of the window) = warn, otherwise neutral
  const tone = d == null ? '' : d < 0 ? 'down' : d >= win * 0.1 ? 'big' : 'up';
  return { c, d, win, pct: Math.min(1, c / win), tone, dTxt: d == null ? '' : `${d >= 0 ? '+' : '−'}${fmtN(Math.abs(d))}` };
}
const ctxTip = x => `Context at the end of this turn: ${fmtN(x.c)} of ${fmtN(x.win)} (${Math.round(x.pct * 100)}%)${x.d == null ? '' : `\nChange from the previous turn: ${x.dTxt}${x.d < 0 ? ' (compacted)' : ''}`}`;
// HTML badge for the route header
function ctxBadge(x) {
  if (!x) return '';
  return `<span class="ctxb" title="${esc(ctxTip(x))}"><span class="cbar"><i style="width:${(x.pct * 100).toFixed(1)}%"></i></span><b>${fmtN(x.c)}</b><span class="muted">${Math.round(x.pct * 100)}%</span>${x.dTxt ? `<span class="cd ${x.tone}">${x.dTxt}</span>` : ''}</span>`;
}
// SVG badge right-aligned at xr on a turn divider (baseline y)
function ctxBadgeSvg(x, xr, y) {
  if (!x) return '';
  const cw = 7.2, dW = x.dTxt ? x.dTxt.length * cw + 16 : 0, vTxt = `${fmtN(x.c)} · ${Math.round(x.pct * 100)}%`, vW = vTxt.length * cw + 12, BW = 46;
  const w = 10 + BW + 8 + vW + dW, x0 = xr - w;
  return `<g class="ctxs"><title>${esc(ctxTip(x))}</title><rect class="cbg" x="${x0}" y="${y - 15}" width="${w}" height="22" rx="11"/>`
    + `<rect class="ctrk" x="${x0 + 10}" y="${y - 7}" width="${BW}" height="6" rx="3"/><rect class="cfil" x="${x0 + 10}" y="${y - 7}" width="${(BW * x.pct).toFixed(1)}" height="6" rx="3"/>`
    + `<text class="cv" x="${x0 + 10 + BW + 8}" y="${y}">${esc(vTxt)}</text>`
    + (x.dTxt ? `<text class="cd ${x.tone}" x="${xr - 10}" y="${y}" text-anchor="end">${esc(x.dTxt)}</text>` : '') + '</g>';
}
// spacing between two consecutive stops on one lane
const routeW = s => s.small ? 24 : s.end ? 58 : 80;
const routeGap = (a, b) => (routeW(a) + routeW(b)) / 2;
function routeHtml() {
  const box = $('alt'), W = box.clientWidth, H = box.clientHeight, sn = simNow();
  if (W < 120 || H < 160) return '';
  const lim = state.cursor ?? Infinity;
  const pinned = state.turnSel ? TURNS.find(x => x.key === state.turnSel) : null;
  let t = pinned; if (!t) for (const x of TURNS) if (Date.parse(x.start) <= lim) t = x;
  if (!t) return '<div class="empty">No turns yet — the next prompt draws its route here.</div>';

  // chain this session's turns, oldest → newest (at most CAP, always including the focused one)
  const sess = TURNS.filter(x => x.sid === t.sid && Date.parse(x.start) <= lim), CAP = 30;
  let from = Math.max(0, sess.length - CAP); const fi = sess.indexOf(t); if (fi >= 0 && fi < from) from = fi;
  // newest turn on top; every turn is collapsed to its divider unless it is the focused one or toggled open
  const chain = sess.slice(from, from + CAP).reverse(), newest = chain[0];
  // the turn that just became focused opens even if it was collapsed by hand earlier
  if (routeFocus !== t.key) { routeFocus = t.key; routeOpen.set(t.key, true); }
  // a turn shown open stays open (a new turn starting, or picking another turn, never closes it) until collapsed by hand
  for (const tt of chain) if (!routeOpen.has(tt.key) && (tt.key === t.key || tt === newest)) routeOpen.set(tt.key, true);
  const isOpen = tt => routeOpen.get(tt.key) === true;
  const stops = [], models = new Map(), tails = [];
  chain.forEach(tt => {
    const R = routeModel(tt, lim), off = stops.length;
    models.set(tt.key, R);
    if (!isOpen(tt)) return;
    let maxPos = 0;
    for (const s of R.stops) {
      s.i += off; for (const k of ['prev', 'fork', 'merge']) if (s[k] != null) s[k] += off;
      s.turn = tt.key; stops.push(s); maxPos = Math.max(maxPos, s.pos);
    }
    const live = !R.ended && tt === newest &&(state.cursor != null || turnRunning(tt));
    const endAt = R.ended ? tms(R.ended) : sn;
    if (R.ended || (live && !R.stops.some(s => s.run && s.lane === 0))) {
      // the main line always runs to the end of the turn: past every subagent stop, not just its own last stop
      const lastMain = R.mainLast != null ? R.mainLast + off : null;
      const e = { lane: 0, end: true, fail: R.ended?.event === 'StopFailure', pending: !R.ended, seq: R.ended?.seq, prev: lastMain, turn: tt.key, dur: endAt - Date.parse(tt.start) };
      e.pos = Math.max(lastMain != null ? stops[lastMain].pos + routeGap(stops[lastMain], e) : 0, R.stops.length ? maxPos + 70 : 0);
      e.i = stops.length; stops.push(e);
    }
    for (const b of R.branches.values()) if (!b.closed && b.run) tails.push(b.last + off);
  });

  // layout: each turn starts on a fresh band under a divider ("Turn N · time · prompt"). A turn too long
  // for one band wraps like text — the whole band (main line + its subagent lanes) continues on the next one,
  // each lane running off the right edge and picking up again at the left edge of the row underneath
  const PAD = 56, TOPY = 18, LANEH = 52, BASEH = 50, ROWGAP = 34, DIVH = 50;
  const usable = Math.max(160, W - 2 * PAD - 30), SW = usable + 2 * PAD;
  const rows = [], byTurn = new Map();
  for (const s of stops) (byTurn.get(s.turn) || byTurn.set(s.turn, []).get(s.turn)).push(s);
  for (const tt of chain) {
    const rowBase = rows.length, open = isOpen(tt);
    rows.push({ maxLane: 0, div: tt, collapsed: !open });
    if (!open) continue;
    for (const s of byTurn.get(tt.key) || []) {
      const k = Math.floor(s.pos / usable);
      while (rows.length <= rowBase + k) rows.push({ maxLane: 0 });
      s.row = rowBase + k; s.x = PAD + s.pos - k * usable;
    }
  }
  // every link between two stops; a link's travel lane is where it runs horizontally
  const links = [];
  for (const s of stops) {
    if (s.fork != null) links.push({ a: stops[s.fork], b: s, kind: 'fork', L: s.lane });
    else if (s.prev != null) links.push({ a: stops[s.prev], b: s, kind: 'line', L: s.lane });
    if (s.merge != null) links.push({ a: stops[s.merge], b: s, kind: 'merge', L: stops[s.merge].lane });
  }
  for (const s of stops) rows[s.row].maxLane = Math.max(rows[s.row].maxLane, s.lane);
  for (const g of links) for (let r = g.a.row; r <= g.b.row; r++) rows[r].maxLane = Math.max(rows[r].maxLane, g.L);
  // the main line runs along the TOP of each band (You first) and subagent lanes hang BELOW it (lane 1 nearest),
  // so every fork drops from its Agent call and every merge rises back into the main line from underneath.
  // Main-line labels sit above their stops (MAINL), out of the way of the forks leaving underneath
  const MAINL = 32;
  let y = TOPY, tailGap = 0;
  for (const r of rows) {
    if (r.div) { r.divY = y; y += r.collapsed ? 36 : DIVH; tailGap = 0; }
    if (r.collapsed) continue;
    r.y0 = y; r.main = y + MAINL; y = r.main + r.maxLane * LANEH + BASEH + ROWGAP; tailGap = ROWGAP;
  }
  const SH = y - tailGap + 10;
  const laneY = (r, L) => rows[r].main + L * LANEH, LE = 18, RE = SW - 18;
  for (const s of stops) s.y = laneY(s.row, s.lane);

  const P = s => `${s.x.toFixed(1)} ${s.y}`, poly = routePoly;
  // a fork drops from the Agent call then runs along its lane; a merge runs along the subagent's lane then
  // rises into the main line. Across a wrap there is no connecting loop: each line runs off the right edge
  // and continues from the left edge of the next row on the same lane
  const linkPaths = ({ a, b, kind, L }) => {
    if (a.row === b.row) {
      if (kind === 'fork') return [poly([a, { x: a.x, y: b.y }, b])];
      if (kind === 'merge') return [poly([a, { x: b.x, y: a.y }, b])];
      return [poly([a, b])];
    }
    // wrap: no return loop — the line runs off the right edge and the row underneath picks it up at its left edge
    const out = [];
    out.push(poly(kind === 'fork' ? [a, { x: a.x, y: laneY(a.row, L) }, { x: RE, y: laneY(a.row, L) }] : [a, { x: RE, y: a.y }]));
    for (let r = a.row + 1; r < b.row; r++) out.push(poly([{ x: LE, y: laneY(r, L) }, { x: RE, y: laneY(r, L) }]));
    out.push(poly(kind === 'merge' ? [{ x: LE, y: laneY(b.row, L) }, { x: b.x, y: laneY(b.row, L) }, b] : [{ x: LE, y: b.y }, b]));
    return out;
  };
  const dim = s => pinned && s.turn !== t.key ? ' dim' : '', sl = stopLn(stops);
  let svg = `<svg class="metro" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">`;
  // turn dividers
  for (const r of rows) {
    if (!r.div) continue;
    const tt = r.div, n = sess.indexOf(tt) + 1, cur = tt.key === t.key, dy = r.divY + 6;
    const M2 = models.get(tt.key), sum = r.collapsed && M2 ? ` · ${M2.steps} steps · ${M2.tools} tools${M2.errs ? ` · ✕${M2.errs}` : ''}` : '';
    const cx = ctxInfo(sess, tt, lim);
    const label = `Turn ${n} · ${fmtTime(tt.start)} · ${trunc(clean(tt.prompt ?? 'Session start'), cx ? Math.max(20, Math.floor((usable - 260) / 8) - 30) : 90)}${sum}`;
    // the chevron toggles the turn open / collapsed; the rest of the divider selects the turn
    svg += `<g class="tdiv ${cur ? 'cur' : ''}${pinned && !cur ? ' dim' : ''}" data-key="${esc(tt.key)}"><line x1="6" y1="${dy}" x2="${usable + 2 * PAD - 6}" y2="${dy}"/>`
      + `<g class="ttog" data-tog="${esc(tt.key)}" data-open="${r.collapsed ? 0 : 1}"><rect x="6" y="${dy + 6}" width="18" height="18" rx="5"/><path d="${r.collapsed ? `M13 ${dy + 11}l4 4l-4 4` : `M11 ${dy + 13}l4 4l4 -4`}"/><title>${r.collapsed ? 'Expand' : 'Collapse'} this turn</title></g>`
      + `<text x="32" y="${dy + 20}">${esc(label)}</text>${ctxBadgeSvg(cx, usable + 2 * PAD - 6, dy + 20)}<title>${esc(short(tt.prompt ?? 'Session start', 300))}</title></g>`;
  }
  // draw order: subagent lanes, then the forks / merges (over a background-coloured halo, so where one
  // has to cross another lane it passes over it with a small gap), then the main line on top
  const order = g => g.L === 0 ? 2 : g.kind === 'line' ? 0 : 1;
  for (const g of [...links].sort((p, q) => order(p) - order(q))) {
    const s = g.b, col = s.end ? (s.fail ? 'var(--err)' : s.pending ? 'var(--faint)' : 'var(--ok)') : `var(--s-${s.st})`;
    const cls = g.L ? 'ml br' : `ml ${s.run || s.pending ? 'flow' : ''}`, sty = g.L ? '' : ` style="stroke:${col}"`;
    for (const d of linkPaths(g)) {
      if (order(g) === 1) svg += `<path class="halo${dim(s)}" d="${d}"/>`;
      svg += `<path class="${cls}${dim(s)}" data-ln="${linkKey(g)}" d="${d}"${sty}/><path class="hit" data-ln="${linkKey(g)}" d="${d}"/>`;
    }
  }
  // subagent still running: short dashed tail from its last stop
  for (const i of tails) { const s = stops[i]; if (s) svg += `<path class="ml br flow${dim(s)}" data-ln="${lnKey(s)}" d="M${P(s)}l${Math.min(30, RE - s.x)} 0"/>`; }
  for (const s of stops) {
    if (s.small) { svg += `<path class="md${s.said ? ' said' : ''}${dim(s)}" data-ln="${sl(s)}" data-seqs="${(s.seqs || []).join(' ')}" d="M${s.x.toFixed(1)} ${s.y - 5}l5 5l-5 5l-5 -5z" style="fill:var(--s-${s.st})" data-seq="${s.seq}"><title>${s.tip}${s.said ? '\n\n' + esc(short(s.said, 600)) : ''}</title></path>`; continue; }
    if (s.end) {
      const col = s.fail ? 'var(--err)' : s.pending ? 'var(--faint)' : 'var(--ok)';
      svg += `<g class="stop${dim(s)}" data-ln="${sl(s)}" data-seqs="${s.seq ?? ''}" transform="translate(${s.x.toFixed(1)},${s.y})"${s.seq != null ? ` data-seq="${s.seq}"` : ''} style="color:${col}">${s.pending ? '<circle r="8" class="ring"/>' : `<circle r="8" fill="${col}"/><circle r="13" fill="none" stroke="${col}" stroke-width="2"/>`}
        ${s.pending ? `<title>${esc(routeActivity(models.get(s.turn), sn))}</title>` : ''}<text class="sl" y="-33">${s.pending ? 'working…' : s.fail ? 'failed' : 'done'}</text><text class="ss" y="-21">${esc(fmtDur(s.dur))}</text></g>`;
      continue;
    }
    const arg = String(s.sub ?? ''), subTxt = s.run ? `● ${fmtDur(sn - s.a)}` : s.fail ? 'failed' : /[\\/]/.test(arg) && !/\s/.test(arg) ? base(arg) : arg;
    const r = s.lane && !s.branch ? 10 : 12;
    // a call with a known language / tool: the stop is filled with the badge colour and carries its mark
    const k = s.tech ? TECH[s.tech] : null, ks = r * 0.85, more = k ? s.techs.length - 1 : 0;
    svg += `<g class="stop ${s.fail ? 'fail' : ''} ${s.merge != null ? 'mg' : ''}${dim(s)}" data-ln="${sl(s)}" data-seqs="${(s.seqs || []).join(' ')}" transform="translate(${s.x.toFixed(1)},${s.y})" style="color:var(--s-${s.st})" data-seq="${s.seq}">
      <circle class="sn" r="${r}"${k ? ` style="fill:${k[2]}"` : ''}/>${k ? `<g transform="translate(${-ks.toFixed(2)},${-ks.toFixed(2)}) scale(${(ks / 12).toFixed(3)})">${techMark(s.tech)}</g>` : svgIcon(s.st, -r * 0.62, -r * 0.62, (r * 0.052).toFixed(3))}${more ? `<g class="tmore" transform="translate(${(r * 0.8).toFixed(1)},${(-r * 0.8).toFixed(1)})"><circle r="6.5"/><text y="3">+${more}</text></g>` : ''}${s.run ? `<circle class="ring" r="${r + 5}"/>` : ''}
      <text class="sl" y="${s.lane ? r + 16 : -r - 20}">${esc(trunc(s.label, 12))}</text><text class="ss ${s.fail ? 'err' : s.run ? 'run' : ''}" y="${s.lane ? r + 28 : -r - 8}">${esc(trunc(subTxt, 12))}</text>
      <title>${k ? esc(s.techs.map(x => TECH[x][0]).join(' + ')) + ' · ' : ''}${s.tip}${s.dur != null ? ' · ' + fmtDur(s.dur) : ''}</title></g>`;
  }
  svg += '</svg>';
  const fr = rows.find(r => r.div === t), fy = fr ? Math.max(0, fr.divY - 6) : 0;
  return routeFrame(t, pinned, sess, models, lim, H, svg, fy);
}

// line keys for hover highlighting: every stop and link belongs to its turn's main line or to one subagent's branch
const lnKey = s => `${s.turn}|${s.br ? s.br.id : 'main'}`.replace(/[\s"]/g, '_');
const linkKey = g => lnKey(g.kind === 'merge' ? g.a : g.b);
// a stop's keys: its own line, plus the branch it starts (Agent call) or brings back (⤴ stop)
function stopLn(stops) {
  const extra = new Map(), add = (i, k) => extra.set(i, (extra.get(i) || '') + ' ' + k);
  for (const s of stops) { if (s.fork != null) add(s.fork, lnKey(s)); if (s.merge != null) add(s.i, lnKey(stops[s.merge])); }
  return s => lnKey(s) + (extra.get(s.i) || '');
}
// hoverSeq: an event row hovered in the details panel; its stop on the route is lit up, everything else fades
let hoverLn = null, hoverSeq = null, viewHover = null;
// route: which turns are open (key → open). Turns start collapsed; the focused and the newest turn get opened
// and stay open after that, until collapsed by hand
const routeOpen = new Map();
let routeFocus = null; // the turn the route was last focused on
const seqStop = (svg, seq) => svg.querySelector(`[data-seqs~="${CSS.escape(String(seq))}"]`);
function applyHover() {
  const svg = $('alt').querySelector('svg.metro');
  if (svg) {
    const pin = hoverSeq != null ? seqStop(svg, hoverSeq) : null;
    svg.classList.toggle('hl', !!hoverLn || !!pin);
    for (const e of svg.querySelectorAll('.on, .pin')) e.classList.remove('on', 'pin');
    if (hoverLn) for (const e of svg.querySelectorAll(`[data-ln~="${CSS.escape(hoverLn)}"]`)) e.classList.add('on');
    if (pin) pin.classList.add('on', 'pin');
  }
  // chat: light up the item for the hovered details row, fade the rest
  const ch = $('alt').querySelector('.chat');
  if (ch) {
    for (const e of ch.querySelectorAll('.pin')) e.classList.remove('pin');
    const hits = hoverSeq != null ? [...ch.querySelectorAll(`[data-seqs~="${hoverSeq}"]`)] : [];
    for (const e of hits) e.classList.add('pin');
    ch.classList.toggle('hl', hits.length > 0);
  }
  // details: light up the rows for the chat item / route stop under the mouse
  for (const r of $('detail').querySelectorAll('.erow.pin')) r.classList.remove('pin');
  if (viewHover) for (const q of viewHover) ($('ev-' + q) || $('detail').querySelector(`.erow[data-pre="${q}"]`))?.classList.add('pin');
}
// bring the lit item into view inside its scroll box (route stop / chat item / details row), if it is outside it
const revealIn = (sc, el) => {
  if (!sc || !el) return;
  const a = sc.getBoundingClientRect(), b = el.getBoundingClientRect();
  if (b.top < a.top + 20 || b.bottom > a.bottom - 20) sc.scrollTop += b.top - a.top - a.height / 2 + b.height / 2;
};
function revealPin() {
  const sc = $('alt').querySelector('.mscroll'), svg = sc?.querySelector('svg.metro');
  if (svg && hoverSeq != null) revealIn(sc, seqStop(svg, hoverSeq));
  const ch = $('alt').querySelector('.chat');
  if (ch && hoverSeq != null) revealIn(ch, ch.querySelector('.pin'));
  if (viewHover) revealIn($('detail'), $('detail').querySelector('.erow.pin'));
}

// polyline with rounded corners
function routePoly(pts) {
  const f = n => n.toFixed(1), P = s => `${f(s.x)} ${f(s.y)}`;
  pts = pts.filter((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
  let d = `M${P(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(12, Math.hypot(q.x - p.x, q.y - p.y) / 2, Math.hypot(n.x - q.x, n.y - q.y) / 2);
    const u = (s, t) => { const l = Math.hypot(t.x - s.x, t.y - s.y) || 1; return [(t.x - s.x) / l, (t.y - s.y) / l]; };
    const [ix, iy] = u(p, q), [ox, oy] = u(q, n);
    d += `L${f(q.x - ix * r)} ${f(q.y - iy * r)}Q${f(q.x)} ${f(q.y)} ${f(q.x + ox * r)} ${f(q.y + oy * r)}`;
  }
  return d + `L${P(pts[pts.length - 1])}`;
}

// what a running turn is doing right now: running tools on the main line, subagents still working,
// a permission prompt waiting on you, or — with nothing else in flight — the model generating its next step
function routeActivity(R, sn) {
  if (!R) return '';
  const parts = [], runBr = [...R.branches.values()].filter(b => !b.closed && b.run);
  for (const s of R.stops) if (s.run && !s.br) parts.push(`running ${s.label}${s.sub ? ' ' + trunc(base(String(s.sub)), 40) : ''} · ${fmtDur(sn - s.a)}`);
  if (runBr.length) parts.push(`${runBr.length} subagent${runBr.length > 1 ? 's' : ''} working`);
  const lastMain = R.mainLast != null ? R.stops[R.mainLast] : null;
  if (!parts.length) parts.push(lastMain?.label === 'Permission' ? 'waiting for your permission' : `model generating · ${fmtDur(Math.max(0, sn - R.lastTs))} since last step`);
  return parts.join(' · ');
}

// header + scroll box + turn navigator around a drawn route
function routeFrame(t, pinned, sess, models, lim, H, svg, fy) {
  const R = models.get(t.key) || routeModel(t, lim), ended = R.ended;
  const live = !ended && (state.cursor != null || turnRunning(t));
  const nb = R.branches.size;
  const state2 = live ? '<span class="dot busy"></span>running' : ended ? (ended.event === 'StopFailure' ? '<span class="err">✕</span> failed' : '<span style="color:var(--ok)">✓</span> done') : '<span class="dot"></span>unfinished';
  // live: what it is doing now, and the latest thing the model wrote in this turn
  const sn = simNow(), now = live ? `<div class="la"><b>Now:</b> <span class="act">${esc(routeActivity(R, sn))}</span>${R.say ? ` · “${esc(short(R.say.text, 220))}” <span class="muted">${agoMs(sn - R.say.ts)} ago</span>` : ''}</div>` : '';
  const head = `<div class="lhead${live ? ' live' : ''}"><div class="lp">${t.prompt !== null ? esc(short(clean(t.prompt), 240)) : '<span class="muted">Session start</span>'}</div>
    <div class="lm"><span class="state">${state2}</span>·<span>${esc(base(state.sessions.get(t.sid)?.cwd))}</span>·<span>${fmtTime(t.start)}</span>·<span>${R.steps} steps · ${R.tools} tools${nb ? ` · ${nb} subagent${nb > 1 ? 's' : ''}` : ''}</span>${ctxBadge(ctxInfo(sess, t, lim))}${R.errs ? `·<span class="err">${R.errs} problems</span>` : ''}
</div>${now}</div>`;
  // turn navigator: previous / next turn, position, and a way back to the live (latest) turn
  const list = sess, idx = list.indexOf(t);
  const prevT = list[idx - 1], nextT = list[idx + 1];
  const nav = (p, txt) => p ? `<button class="seg" data-key="${esc(p.key)}" title="${esc(fmtTime(p.start) + ' · ' + short(p.prompt ?? 'Session start', 120))}">${txt}</button>` : `<button class="seg" disabled>${txt}</button>`;
  const hist = `<div class="lhist">${nav(prevT, '‹ Previous turn')}<span class="muted">Turn <b style="color:var(--text)">${idx + 1}</b> of ${list.length}</span>${nav(nextT, 'Next turn ›')}
    <span class="grow"></span>${pinned ? '<button class="seg" data-follow>Back to latest ⟳</button>' : '<span class="muted"><span class="dot busy"></span> showing the latest turn · updates live</span>'}</div>`;
  return head + `<div class="mscroll" data-focus="${esc(t.key)}" data-fy="${isFinite(fy) ? fy : 0}" style="height:${H - (live ? 70 : 50) - 48}px">${svg}</div>` + hist;
}
