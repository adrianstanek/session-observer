'use strict';
// Session Observer dashboard — Overview: stat tiles, charts and the file / command / subagent / problem lists.
// ---------------------------------------------------------------- middle panel
function tile(l, v, s, bad) { return `<div class="tile ${bad ? 'bad' : ''}"><div class="l">${l}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`; }
function turnRow(t, showProj) {
  const running = turnRunning(t);
  const mk = running ? '<span class="dot busy"></span>' : t.failed || t.errors ? '<span class="err">✕</span>' : t.done ? '<span style="color:var(--ok)">✓</span>' : '<span class="dot"></span>';
  const dur = Date.parse(t.end) - Date.parse(t.start);
  const st = Object.entries(t.stations).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => `<span class="st-mini" style="color:var(--s-${k})" title="${ST[k]?.label || k}">${icon(k)}<span class="muted">${n}</span></span>`).join('');
  const proj = showProj ? `<span>${esc(base(state.sessions.get(t.sid)?.cwd))}</span>` : '';
  return `<div class="turn ${state.turnSel === t.key ? 'sel' : ''}" data-key="${esc(t.key)}">
    <div class="mk">${mk}</div>
    <div><div class="p">${t.prompt !== null ? esc(short(clean(t.prompt), 300)) : `<span class="muted">${esc(TX.sessionStart)}</span>`}</div>
      <div class="m">${proj}<span>${esc(nw(t.steps, 'step'))}</span><span>${esc(nw(t.tools, 'tool'))}</span>${t.errors ? `<span class="err">${esc(nw(t.errors, 'problem'))}</span>` : ''}${st}</div></div>
    <div class="tm">${fmtTime(t.start)}<br>${running ? esc(TX.running) : fmtDur(dur)}</div></div>`;
}
// ---- overview: charts and detail lists for the session (or all activity)
let VCTX = null; // context chart geometry + points, for the crosshair
let VW = {};      // measured chart widths (px) by chart, so the next draw matches its card
function vizHtml(sess, fnote) {
  const W = VW.turns || Math.max(300, ($('mid').clientWidth || 700) - 30);
  const turns = TURNS.filter(turnMatches), evs = state.events.filter(evMatches);
  return `<div class="viz">${turnChart(turns, W, fnote)}${sess ? ctxChart(sess, VW.ctx || Math.max(300, W / 2 - 14)) : ''}${groupCards()}${filesList(evs)}${cmdList(evs)}${agentList(evs)}${problemList(evs)}</div>`;
}
const vcard = (title, sub, body, wide) => `<div class="vcard ${wide ? 'wide' : ''}"><div class="vh">${title}<span>${sub || ''}</span></div>${body}</div>`;
const tipAttr = txt => `data-tip="${esc(txt)}"`;

// turns: one column per turn, height = how long it ran; click opens the turn
function turnChart(all, W, fnote) {
  const turns = all.slice(-150), N = turns.length, H = 120, L = 46, B = 18, T = 12;
  if (!N) return vcard(TX.turns, fnote, `<div class="none">${esc(TX.noTurnsMatch)}</div>`, true);
  const now = simNow(), dur = t => (turnRunning(t) ? now : Date.parse(t.end)) - Date.parse(t.start);
  const max = Math.max(1000, ...turns.map(dur)), pw = W - L, cw = pw / N, bw = Math.max(1, Math.min(28, cw - 2));
  const y = v => T + (H - T) * (1 - v / max);
  let g = '';
  for (const f of [0.5, 1]) g += `<line class="grid" x1="${L}" x2="${W}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end">${esc(fmtDur(max * f))}</text>`;
  g += `<line class="base" x1="${L}" x2="${W}" y1="${H}" y2="${H}"/>`;
  turns.forEach((t, i) => {
    const d = dur(t), x = L + i * cw + (cw - bw) / 2, top = Math.min(H - 2, y(d)), run = turnRunning(t), sel = state.turnSel === t.key;
    const tip = `${short(clean(t.prompt) || TX.sessionStartParen, 140)}\n${fmtTime(t.start)} · ${fmtDur(d)}${run ? ' · ' + TX.running : ''}\n${nw(t.steps, 'modelStep')} · ${nw(t.tools, 'toolCall')}${t.errors ? ` · ✕ ${nw(t.errors, 'problem')}` : ''}`;
    g += `<g class="col ${sel ? 'sel' : ''}" data-key="${esc(t.key)}" ${tipAttr(tip)}><rect class="hit" x="${(L + i * cw).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${H}"/>
      <rect class="bar ${run ? 'run' : ''} ${sel ? 'sel' : ''}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - top).toFixed(1)}" rx="${Math.min(3, bw / 2)}"/>
      ${t.errors ? `<text class="x" x="${(x + bw / 2).toFixed(1)}" y="${(top - 3).toFixed(1)}">✕</text>` : ''}</g>`;
  });
  g += `<text class="ax" x="${L}" y="${H + 14}">${esc(fmtTime(turns[0].start))}</text><text class="ax" x="${W}" y="${H + 14}" text-anchor="end">${esc(fmtTime(turns[N - 1].start))}</text>`;
  const body = `<svg class="vchart" data-k="turns" data-w="${W}" viewBox="0 0 ${W} ${H + B}" height="${H + B}" role="img" aria-label="${esc(TX.turnChartAria)}">${g}</svg>`;
  return vcard(TX.turns, `${all.length}${N < all.length ? ' ' + esc(TX.lastNShown(N)) : ''}${fnote} · ${esc(TX.turnChartHint)}`, body, true);
}

// context window use over the session (main agent's model steps); compactions show as drops
function ctxChart(sess, W) {
  const pts = state.events.filter(e => e.event === 'ModelStep' && e.session_id === sess.id && !e.data?.subagent && e.data?.tokens?.context && tms(e) <= (state.cursor ?? Infinity))
    .map(e => ({ t: tms(e), v: e.data.tokens.context, seq: e.seq }));
  if (pts.length < 2) { VCTX = null; return vcard(TX.st.context, '', `<div class="none">${esc(TX.notEnoughSteps)}</div>`); }
  const win = sess.context?.window || (Math.max(...pts.map(p => p.v)) > 200000 ? 1000000 : 200000);
  const H = 120, L = 40, B = 18, T = 8, t0 = pts[0].t, t1 = Math.max(t0 + 1, pts[pts.length - 1].t), top = Math.max(win, ...pts.map(p => p.v));
  const x = t => L + (W - L) * (t - t0) / (t1 - t0), y = v => T + (H - T) * (1 - v / top);
  for (const p of pts) { p.x = x(p.t); p.y = y(p.v); }
  VCTX = { pts, win, W, H };
  let g = `<line class="grid" x1="${L}" x2="${W}" y1="${y(win / 2)}" y2="${y(win / 2)}"/><text class="ax" x="${L - 6}" y="${y(win / 2) + 4}" text-anchor="end">${fmtN(win / 2)}</text>
    <line class="warn" x1="${L}" x2="${W}" y1="${y(win * 0.8)}" y2="${y(win * 0.8)}"/>
    <line class="win" x1="${L}" x2="${W}" y1="${y(win)}" y2="${y(win)}"/><text class="ax" x="${L - 6}" y="${y(win) + 4}" text-anchor="end">${fmtN(win)}</text>
    <line class="base" x1="${L}" x2="${W}" y1="${H}" y2="${H}"/>`;
  g += `<path class="ln" d="M${pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}"/>`;
  const last = pts[pts.length - 1];
  g += `<circle class="dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4"/>`;
  g += `<g class="xhair" style="display:none"><line class="xh" y1="${T}" y2="${H}"/><circle class="dot" r="4.5"/></g>`;
  g += `<text class="ax" x="${L}" y="${H + 14}">${esc(fmtTime(t0))}</text><text class="ax" x="${W}" y="${H + 14}" text-anchor="end">${esc(fmtTime(t1))}</text>`;
  g += `<rect class="ov" x="${L}" y="0" width="${W - L}" height="${H}"/>`;
  const pct = Math.round(100 * last.v / win);
  return vcard(TX.st.context, esc(`${TX.nowLc} ${TX.ofPct(fmtN(last.v), fmtN(win), pct)} · ${TX.ctxChartKey}`), `<svg class="vchart vctx" data-k="ctx" data-w="${W}" viewBox="0 0 ${W} ${H + B}" height="${H + B}" role="img" aria-label="${esc(TX.ctxChartAria)}">${g}</svg>`);
}

// the files the agent worked on most
function filesList(evs) {
  const f = new Map();
  for (const e of evs) {
    if (e.event !== 'PreToolUse' || !FILE_TOOLS.has(e.data?.tool_name)) continue;
    const ti = e.data.tool_input || {}, p = ti.file_path || ti.notebook_path; if (!p) continue;
    const o = f.get(p) || { r: 0, w: 0, seq: e.seq }; o.seq = e.seq;
    /^(Read|NotebookRead)$/.test(e.data.tool_name) ? o.r++ : o.w++;
    f.set(p, o);
  }
  const top = [...f.entries()].sort((a, b) => (b[1].r + b[1].w) - (a[1].r + a[1].w)).slice(0, 8);
  if (!top.length) return vcard(TX.files, '', `<div class="none">${esc(TX.noFiles)}</div>`);
  // paths relative to the session's folder when inside it; a long folder keeps its last part
  const cwd = (state.sessions.get(state.scope)?.cwd || '').replace(/[\\/]+$/, '');
  const rel = p => cwd && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
  const dir = p => { const r = rel(p), d = r.slice(0, Math.max(0, r.length - base(r).length)); return d.length > 36 ? '…' + d.slice(-35) : d; };
  return vcard(TX.files, esc(TX.filesSub(f.size, top.length)), `<div class="vlist">${top.map(([p, o]) => `<div class="vrow" data-seq="${o.seq}" ${tipAttr(p + '\n' + TX.openLatest)}>
    <span class="a mono">${techIcon(fileTech(p)) || icon('files')}<span class="d">${esc(trunc(dir(p), 40))}</span>${esc(base(p))}</span><span class="b">${o.w ? TX.count(`<b>${o.w}</b>`, esc(TX.w.edit(o.w))) : ''}${o.w && o.r ? ' · ' : ''}${o.r ? TX.count(`<b>${o.r}</b>`, esc(TX.w.read(o.r))) : ''}</span></div>`).join('')}</div>`);
}

// shell commands by program (the part after any leading `cd … &&`)
function cmdList(evs) {
  const failed = new Set(evs.filter(e => e.event === 'PostToolUseFailure').map(e => e.data?.tool_use_id)), c = new Map();
  for (const e of evs) {
    if (e.event !== 'PreToolUse' || !SHELL_TOOLS.has(e.data?.tool_name)) continue;
    const cmd = String(e.data.tool_input?.command || '').trim(); if (!cmd) continue;
    const seg = shellSegments(cmd).find(x => !/^(cd|export|for)\s/.test(x) && progWord(x)) || cmd;
    const prog = base(progWord(seg) || seg);
    const o = c.get(prog) || { n: 0, x: 0, seq: e.seq, ex: seg }; o.n++; o.seq = e.seq; o.ex = seg;
    if (failed.has(e.data.tool_use_id)) o.x++;
    c.set(prog, o);
  }
  const top = [...c.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  if (!top.length) return vcard(TX.commands, '', `<div class="none">${esc(TX.noCommands)}</div>`);
  return vcard(TX.commands, esc(`${nw(c.size, 'program')} · ${TX.topN(top.length)}`), `<div class="vlist">${top.map(([p, o]) => `<div class="vrow ${o.x === o.n ? 'fail' : ''}" data-seq="${o.seq}" ${tipAttr(TX.latestX(short(o.ex, 300)))}>
    <span class="a mono">${techIcon(nameTech(p)) || icon('shell')}${esc(p)}</span><span class="b">${TX.count(`<b>${o.n}</b>`, esc(TX.w.run(o.n)))}${o.x ? ` · <span class="err">✕ ${o.x}</span>` : ''}</span></div>`).join('')}</div>`);
}

// subagents: what type, what they were asked, how long they ran
function agentList(evs) {
  const a = new Map(), desc = [];
  for (const e of evs) {
    const d = e.data || {};
    if (e.event === 'PreToolUse' && (d.tool_name === 'Agent' || d.tool_name === 'Task')) desc.push(d.tool_input?.description || '');
    if (e.event === 'SubagentStart') a.set(d.agent_id ?? e.seq, { type: d.agent_type || TX.subagentLc, start: tms(e), end: null, seq: e.seq, desc: desc.shift() || '' });
    if (e.event === 'SubagentStop' && a.has(d.agent_id)) a.get(d.agent_id).end = tms(e);
  }
  if (!a.size) return '';
  const rows = [...a.values()].slice(-8).reverse(), now = simNow();
  return vcard(TX.subagents, `${a.size}`, `<div class="vlist">${rows.map(r => `<div class="vrow" data-seq="${r.seq}" ${tipAttr(`${r.type}${r.desc ? ' — ' + r.desc : ''}\n${TX.startedAt(fmtTime(r.start))}`)}>
    <span class="a"><b>${esc(r.type)}</b> <span class="d">${esc(r.desc)}</span></span><span class="b">${r.end ? esc(fmtDur(r.end - r.start)) : `<span style="color:var(--ok)">● ${esc(fmtDur(now - r.start))}</span>`}</span></div>`).join('')}</div>`);
}

// the latest failures and denials
function problemList(evs) {
  const p = evs.filter(isProblem);
  if (!p.length) return '';
  return vcard(TX.problems, `${p.length} · ${esc(TX.latestFirst)}`, `<div class="vlist">${p.slice(-6).reverse().map(e => { const [l, d] = describe(e); return `<div class="vrow fail" data-seq="${e.seq}" ${tipAttr(l + ': ' + short(d, 400))}>
    <span class="a"><b>${esc(l)}</b> ${esc(short(d, 120))}</span><span class="b">${esc(fmtTime(e.ts))}</span></div>`; }).join('')}</div>`);
}

function renderMid(again) {
  if (state.layout !== 'overview') return;
  const el = $('mid'); const top = el.scrollTop;
  const fnote = filtersActive() ? ` <span class="muted">· ${esc(TX.filtered)}</span>` : '';
  if (state.scope === 'all') {
    const cut = cutoffIso();
    const all = [...state.sessions.values()].filter(s => !cut || (s.last || '') >= cut);
    const sum = k => all.reduce((a, s) => a + (s[k] || 0), 0);
    const out = all.reduce((a, s) => a + (s.usage?.output || 0), 0);
    const T = TX.tile;
    el.innerHTML = `<h2>${esc(TX.allActivity)}</h2><p class="lead">${esc(TX.allLead(rangeLabel()))}</p>
      <div class="tiles">${tile(T.sessions, all.length)}${tile(T.turns, sum('turns'))}${tile(T.toolCalls, sum('toolCalls'))}${tile(T.modelSteps, sum('modelSteps'))}${tile(T.problems, sum('failures'), T.failedOrDenied, sum('failures') > 0)}${tile(T.outputTokens, fmtN(out))}</div>
      ${vizHtml(null, fnote)}`.replaceAll('__D__', `-${Math.round(performance.now() % 1400)}ms`);
  } else {
    const s = state.sessions.get(state.scope);
    if (!s) { el.innerHTML = `<div class="empty">${esc(TX.sessionNotFound)}</div>`; return; }
    const T = TX.tile;
    const [st, dot] = sessState(s);
    const u = s.usage || {};
    el.innerHTML = `<h2>${esc(short(clean(s.title) || base(s.cwd) || s.id, 140))}</h2>
      <p class="lead"><span class="state"><span class="${dot}"></span>${st}</span> · <span class="mono">${esc(s.cwd || '')}</span> · ${esc(s.model || '')}${s.permission_mode ? ' · ' + esc(s.permission_mode) : ''} · <span class="mono">${esc(s.id.slice(0, 8))}</span>${s.ended && s.endReason ? ' · ' + esc(TX.endedX(s.endReason)) : ''}</p>
      <div class="tiles">${tile(T.turns, s.turns || 0)}${tile(T.toolCalls, s.toolCalls, TX.inTools(fmtDur(s.toolMs)))}${tile(T.modelSteps, s.modelSteps || 0)}${tile(T.subagents, s.subagents || 0)}${tile(T.problems, s.failures, '', s.failures > 0)}
        ${tile(T.duration, fmtDur(Date.parse(s.last) - Date.parse(s.started)))}${tile(T.context, s.context ? Math.round(s.context.pct * 100) + '%' : '–', s.context ? `${fmtN(s.context.tokens)} / ${fmtN(s.context.window)}` : '')}${tile(T.tokens, fmtN((u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0)), TX.tokSub(fmtN(u.output || 0)))}</div>
      ${vizHtml(s, fnote)}`.replaceAll('__D__', `-${Math.round(performance.now() % 1400)}ms`);
  }
  el.scrollTop = top;
  // charts are drawn in px: if a card turned out a different width than estimated, draw again at the real width
  let off = false;
  for (const sv of el.querySelectorAll('svg.vchart[data-w]')) { const w = Math.round(sv.getBoundingClientRect().width); if (w && Math.abs(w - Number(sv.dataset.w)) > 4) { VW[sv.dataset.k] = w; off = true; } }
  if (off && !again) renderMid(true);
}
