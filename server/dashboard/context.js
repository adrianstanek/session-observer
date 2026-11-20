'use strict';
// Session Observer dashboard — Context view: one session's whole conversation in one scrolling page, read in full from its transcript.
// ---- context: every prompt, reply, thinking block, tool call with its full input and result, subagent and compaction
// The data comes from /api/context (the transcript itself, not the hook log, whose fields are cut short). It is fetched when
// the view is open, again when the session changes, and rendered once per change (the result is cached as HTML).
const CTX = { sid: null, ver: null, at: 0, busy: false, data: null, err: null, html: '', key: '' };
const ctxOpen = new Set();                       // ids of the cards you opened
const ctxShut = new Set();                       // ids of the turns you collapsed
let ctxMode = ls.get('so.ctxMode', 'all');       // 'all' = the whole session · 'now' = since the last compaction
if (ctxMode !== 'now') ctxMode = 'all';
let ctxOrder = ls.get('so.ctxOrder', 'new');     // 'new' = newest message on top · 'old' = oldest on top, as the model reads it
let ctxMeta = ls.get('so.ctxMeta', '0') === '1'; // show bookkeeping: attachments Claude Code keeps for itself and never sends
let ctxScroll = { sid: null, fromBottom: 0, atTop: true };

// the session the view shows: the selected one, or the only one there is
function ctxSid() {
  if (state.scope !== 'all') return state.scope;
  return state.sessions.size === 1 ? [...state.sessions.keys()][0] : null;
}
function ctxFetch(sid, ver) {
  if (CTX.busy) return;
  CTX.busy = true;
  fetch('/api/context?session=' + encodeURIComponent(sid)).then(r => r.json()).then(d => {
    if (sid !== CTX.sid) { ctxScroll = { sid, fromBottom: 0, atTop: true }; ctxOpen.clear(); ctxShut.clear(); }
    Object.assign(CTX, { sid, ver, at: Date.now(), data: d.error ? null : d, err: d.error || null, key: '' });
  }).catch(e => Object.assign(CTX, { sid, ver, at: Date.now(), data: null, err: String(e.message || e), key: '' }))
    .finally(() => { CTX.busy = false; altDirty = true; });
}

const plural = nw; // a count and its noun, in the chosen language
// characters per token: measured for this session from its first model step when the transcript allows, else about 4
const ctxCpt = () => CTX.data?.measured?.cpt || 4;
const ctxTok = chars => TX.approxTokens(fmtN(Math.round(chars / ctxCpt())));
const ctxLen = s => String(s ?? '').length;
const ctxInputLen = c => ctxLen(JSON.stringify(c.input ?? {}));
// one size for a tool definition, used by both the Tool definitions card and Context usage (the measured characters
// per token already blends prose and JSON, so no separate rate for schemas)
const ctxToolLen = t => ctxLen(t.name) + ctxLen(t.description) + ctxLen(JSON.stringify(t.schema));
const ctxListLen = list => (list || []).reduce((n, x) => n + ctxLen(x.name) + ctxLen(x.description) + 4, 0);
const ctxDeferredLen = df => (df?.tools || []).reduce((n, t) => n + ctxLen(t.name) + 1, 0);
// a deferred tool is loaded when ToolSearch surfaced it, or when its definition is in the request's tools
const ctxLoaded = (d, t) => t.loaded || !!d.tools?.some(x => x.name === t.name);
// a card: <details> that remembers being opened; `open` = how it starts
function ctxCard(id, cls, head, body, open = false) {
  const o = ctxOpen.has(id) || (open && !ctxOpen.has('-' + id));
  return `<details class="cx ${cls}" data-cx="${esc(id)}"${o ? ' open' : ''}><summary>${head}</summary><div class="cxb">${body}</div></details>`;
}
// a tool call's input, in full (the Details panel's cards cut long input short; this view doesn't)
function ctxInput(name, i) {
  i = i || {};
  if (name === 'Bash' || name === 'PowerShell') return (i.command ? `<pre class="code">${bashHtml(i.command)}</pre>` : '') + (i.description ? `<div class="muted">${esc(i.description)}</div>` : '');
  if (name === 'Edit' || name === 'MultiEdit') return toolInputHtml(name, i);
  if (name === 'Write') return evKv({ [TX.kv.file]: i.file_path }, new Set()) + `<pre class="code">${codeHtml(i.content ?? '', langOf(i.file_path))}</pre>`;
  if (name === 'Agent' || name === 'Task') return evKv({ [TX.kv.description]: i.description, [TX.kv.type]: i.subagent_type, [TX.kv.model]: i.model }, new Set()) + `<pre class="cxt">${esc(i.prompt ?? '')}</pre>`;
  return `<pre class="code fj">${jsonHtml(i)}</pre>`;
}
const ctxOutput = (txt, err) => !txt ? `<div class="muted">${esc(TX.noOutput)}</div>`
  : txt.length < 20000 ? evOut(txt, err ? 'err' : '') : `<pre class="code ${err ? 'err' : ''}">${esc(txt)}</pre>`;
const ctxHay = it => (it._hay ??= [it.text, it.name, it.label, it.input && JSON.stringify(it.input), it.result?.text].filter(Boolean).join(' ').toLowerCase());

// link each tool call and its result (the call shows the result's state, the result the call's name), and hang each
// subagent under the call that started it. Results stay where they are: in the user message after the call.
function ctxPair(items, subs) {
  const res = new Map(items.filter(x => x.kind === 'result').map(x => [x.id, x]));
  const calls = new Map(items.filter(x => x.kind === 'call').map(x => [x.id, x]));
  const subBy = new Map(Object.entries(subs || {}).filter(([, a]) => a.toolUseId).map(([id, a]) => [a.toolUseId, { id, ...a }]));
  return items.map(it => {
    if (it.kind === 'result') { const c = calls.get(it.id); return c ? { ...it, call: c } : { ...it, kind: 'orphan' }; }
    if (it.kind !== 'call') return it;
    const r = res.get(it.id) || null;
    const sub = subBy.get(it.id) || (r?.agentId && subs?.[r.agentId] ? { id: r.agentId, ...subs[r.agentId] } : null);
    return { ...it, result: r, sub: sub ? { ...sub, items: ctxPair(sub.items, null) } : null };
  });
}

// The transcript and the hook log are two records of the same session; a message finds its hook events by tool call id
// (PreToolUse for a call, PostToolUse for its result), else by time: the last event of the session at or before it.
let CTX_SEQ = { n: -1, sid: null };
function ctxSeqIndex() {
  const sid = CTX.sid;
  if (CTX_SEQ.sid === sid && CTX_SEQ.n === state.events.length) return CTX_SEQ;
  const byId = new Map(), times = [];
  for (const ev of state.events) {
    if (ev.session_id !== sid || !TURN_BY_SEQ.has(ev.seq)) continue;
    const id = ev.data?.tool_use_id;
    if (id) byId.set((ev.event === 'PreToolUse' ? 'c:' : 'r:') + id, byId.get((ev.event === 'PreToolUse' ? 'c:' : 'r:') + id) ?? ev.seq);
    times.push([tms(ev), ev.seq]);
  }
  times.sort((a, b) => a[0] - b[0]);
  return CTX_SEQ = { n: state.events.length, sid, byId, times };
}
function ctxSeqsOf(m) {
  const ix = ctxSeqIndex(), out = [];
  for (const it of m.items || []) {
    const s = it.kind === 'call' ? ix.byId.get('c:' + it.id) : it.kind === 'result' ? ix.byId.get('r:' + it.id) : null;
    if (s != null) out.push(s);
  }
  if (!out.length && (m.step?.ts || m.ts) && ix.times.length) {
    const t = Date.parse(m.step?.ts || m.ts); let lo = 0, hi = ix.times.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ix.times[mid][0] <= t + 1000) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best != null) out.push(ix.times[best][1]);
  }
  return out;
}

// a row clicked in Details: scroll the Context view to its message and flash it. A tool row finds the message with
// its call (else its result); any other event the last message at or before it.
function ctxFocus(seqs, ts) {
  const top = [...$('alt').querySelectorAll('.cxs > .cxturn > .cxw')];
  if (!top.length) return;
  let el = null;
  for (const s of seqs) if (!el && s) el = top.find(w => (w.dataset.seqs || '').split(' ').includes(String(s)));
  if (!el && ts) {
    const t = Date.parse(ts) + 1000; let best = -1;
    for (const w of top) { const wt = Number(w.dataset.t); if (wt <= t && wt > best) { best = wt; el = w; } }
  }
  if (!el) return;
  const sec = el.closest('.cxturn.shut'); if (sec) ctxSetShut(sec, false); // a row in a collapsed turn opens it
  const box = el.closest('.cxs'); // scroll only the view's own box, not the page
  box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8, behavior: 'smooth' });
  for (const w of top) w.classList.remove('flash');
  void el.offsetWidth; el.classList.add('flash');
}

// the Route page's context badge (bar, size, % of the window, change since the previous step)
function ctxSize(c, d) {
  const win = CTX.data?.window || (c > 200000 ? 1000000 : (CTX.data?.context?.window || 200000));
  const tone = d == null ? '' : d < 0 ? 'down' : d >= win * 0.1 ? 'big' : 'up';
  return { c, d, win, pct: Math.min(1, c / win), tone, dTxt: d ? `${d > 0 ? '+' : '−'}${fmtN(Math.abs(d))}` : '' };
}

// The conversation as messages, the way the model reads them: an assistant message is one model step and the blocks it
// produced (thinking, text, tool calls); a user message is what comes between (prompts, tool results, reminders and
// other attachments). Messages are newest first unless the order is switched; blocks keep their own order.
const CTX_AI = new Set(['step', 'thinking', 'text', 'call']);
function ctxItems(list, pre, q, sub = false) {
  const msgs = []; let cur = null, lastCtx = null, stepped = false;
  list.forEach((it, i) => {
    if (it.kind === 'compact') { msgs.push({ compact: it }); cur = null; return; }
    const role = CTX_AI.has(it.kind) ? 'assistant' : 'user';
    if (!cur || cur.role !== role || it.kind === 'step') msgs.push(cur = { role, blocks: [], size: 0 });
    if (it.kind === 'step') { cur.step = it; cur.d = lastCtx != null ? it.ctx - lastCtx : null; lastCtx = it.ctx; stepped = true; return; }
    if (!cur.ts && it.ts) cur.ts = it.ts;
    if (it.kind === 'user' && cur.prompt == null) cur.prompt = it.text ?? ''; // a prompt opens a turn
    (cur.items ||= []).push(it);
    const h = block(it, pre + i);
    if (h) { cur.blocks.push(h); cur.size += ctxLen(it.text) + (it.kind === 'call' ? ctxInputLen(it) : 0); }
  });
  const old = ctxOrder === 'old';
  let n = 0;
  const out = msgs.map(m => {
    if (m.compact) return compact(m.compact);
    n++;
    if (!m.blocks.length) return '';
    const st = m.step, ts = st?.ts || m.ts;
    const label = m.role === 'assistant' ? `${icon('model')} ${esc(TX.claude)}` : sub ? `${icon('model')} ${esc(TX.taskAndResults)}` : `${icon('you')} ${esc(TX.st.you)}`;
    const right = st ? `${ctxBadge(ctxSize(st.ctx, m.d))} <span class="sz muted">${esc(TX.outX(fmtN(st.out)))}</span>` : `<span class="sz muted">${ctxTok(m.size)}</span>`;
    // the hook events this message matches: its header opens their turn in Details, hovering lights their rows there
    const seqs = m.seqs = ctxSeqsOf(m);
    const link = seqs.length ? ` data-seq="${seqs[0]}" title="${esc(TX.showInDetails)}"` : '';
    return `<div class="cxw ${m.role}"${ts ? ` data-t="${Date.parse(ts)}"` : ''}${seqs.length ? ` data-seqs="${seqs.join(' ')}"` : ''}${st?.model ? ` title="${esc(st.model)}"` : ''}><div class="cxl${seqs.length ? ' go' : ''}"${link}>${label} <span class="muted">#${n}${ts ? ' · ' + fmtTime(ts) : ''}</span><span class="grow"></span>${right}</div>${m.blocks.join('')}</div>`;
  });
  if (sub) { if (!old) out.reverse(); return out.join(''); }
  return ctxTurns(msgs, out, old);

  function compact(it) {
    return `<div class="cxcomp">${icon('context')} ${esc(TX.compacted)}${it.trigger ? ' (' + esc(it.trigger) + ')' : ''}${it.preTokens ? ' ' + esc(TX.atTokens(fmtN(it.preTokens))) : ''}${it.ts ? ' · ' + fmtTime(it.ts) : ''} — ${esc(old ? TX.replacedAbove : TX.replacedBelow)}</div>`;
  }
  function block(it, id) {
    if (q && !ctxHay(it).includes(q) && !(it.sub && it.sub.items.some(x => ctxHay(x).includes(q)))) return '';
    let h = '';
    switch (it.kind) {
      case 'user': return `<div class="cxt">${esc(it.text)}</div>`;
      case 'text': return `<div class="cxt">${mdLite(it.text)}</div>`;
      case 'summary': return ctxCard(id, 'sum', `${icon('context')} <b>${esc(TX.compactionSummary)}</b><span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`, true);
      case 'thinking': return ctxCard(id, 'think', `<b>${esc(TX.thinking)}</b> <span class="muted">${esc(short(it.text, 110))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`);
      case 'meta': return ctxCard(id, 'att', `<b>${esc(TX.injected)}</b> <span class="muted">${esc(short(it.text, 110))}</span><span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`);
      case 'attachment': {
        // bookkeeping only when asked for; the lists pinned on top only when they change later in the session
        if (it.role === 'meta' ? !ctxMeta : it.role === 'pinned' && !stepped) return '';
        const note = it.role === 'meta' ? TX.notSentModel : it.role === 'pinned' ? TX.pinnedChange
          : it.rendered ? TX.sentAsText : TX.sentModel;
        h += ctxCard(id, it.role === 'meta' ? 'att meta' : 'att', `<b>${esc(it.label || TX.attachment)}</b> <span class="muted">${esc(short(it.text, 90))}</span><span class="grow"></span><span class="sz">${it.role === 'meta' ? esc(TX.notSent) : ctxTok(ctxLen(it.text))}</span>`,
          `<div class="muted">${esc(note)}</div><pre class="cxt">${esc(it.text)}</pre>`);
        return h;
      }
      case 'result': {
        const c = it.call;
        h += ctxCard(id, 'tool', `${toolIcon(c.name, c.input, toolStation(c.name, c.input))}<b>${esc(TX.result)}</b> <span class="muted">${esc(toolLabel(c.name))} · ${esc(short(it.text, 90))}</span>${it.error ? ` <span class="err">✕ ${esc(TX.failedLc)}</span>` : ''}<span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, ctxOutput(it.text, it.error));
        return h;
      }
      case 'orphan': h += ctxCard(id, 'tool', `<b>${esc(TX.toolResult)}</b> <span class="muted">${esc(short(it.text, 90))}</span>`, ctxOutput(it.text, it.error)); return h;
      case 'call': {
        const r = it.result, st = toolStation(it.name, it.input);
        const state_ = !r ? `<span class="run">● ${esc(TX.running)}</span>` : r.error ? `<span class="err">✕ ${esc(TX.failedLc)}</span>` : '<span class="ok">✓</span>';
        const arg = toolArg({ tool_name: it.name, tool_input: it.input || {} });
        const head = `${toolIcon(it.name, it.input, st)}<b>${esc(toolLabel(it.name))}</b> <span class="muted mono">${esc(short(arg, 100))}</span><span class="grow"></span><span class="sz">${state_} ${ctxTok(ctxInputLen(it))}</span>`;
        const sub = it.sub ? `<div class="cxsub"><div class="cxl">${icon('agents')} ${esc(TX.subagent)}${it.sub.type ? ' · ' + esc(it.sub.type) : ''}${it.sub.description ? ` <span class="muted">${esc(it.sub.description)}</span>` : ''} <span class="muted">· ${esc(TX.ownContext(plural(it.sub.items.filter(x => x.kind === 'call').length, 'toolCall')))}</span></div>${ctxPrompt(it.sub, id + '.', false)}${ctxItems(it.sub.items, id + '.', q, true)}</div>` : '';
        h += ctxCard(id, 'tool', head, `<div class="lbl2">${esc(TX.input)}</div>${ctxInput(it.name, it.input)}${sub}`);
        return h;
      }
    }
    return h;
  }
}

// The main conversation in turns, the same turns as Details: a turn starts at a prompt and runs to the next one. Each
// turn is a box with a sticky header (its prompt, size, and a link that opens it in Details); the turn Details shows is
// highlighted. A turn finds its Details turn by the hook events its messages match (the most common one wins).
function ctxTurns(msgs, out, old) {
  const groups = []; let g = null;
  msgs.forEach((m, i) => {
    if (!g || m.prompt != null) groups.push(g = { prompt: m.prompt ?? null, ts: m.ts || m.step?.ts, msgs: [], html: [] });
    g.msgs.push(m); g.html.push(out[i]);
  });
  let n = 0;
  const html = groups.map(g => {
    if (g.prompt != null) n++;
    if (!g.html.some(Boolean)) return '';
    const votes = new Map();
    for (const m of g.msgs) for (const s of m.seqs || []) { const k = TURN_BY_SEQ.get(s)?.key; if (k) votes.set(k, (votes.get(k) || 0) + 1); }
    const key = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || null, sel = key && key === state.turnSel;
    const steps = g.msgs.filter(m => m.step).length, calls = g.msgs.reduce((c, m) => c + (m.items || []).filter(x => x.kind === 'call').length, 0);
    const title = esc(g.prompt != null ? TX.turnN(n) : g.msgs[0].compact ? TX.afterCompaction : TX.beforeFirstPrompt);
    // remembered by when the turn started: stable while hook events load and across the two modes, unlike its number or key
    const id = 't' + (g.ts || n), shut = ctxShut.has(id);
    const head = `<div class="cxth${key ? ' go' : ''}"${key ? ` data-key="${esc(key)}" title="${esc(TX.showTurnInDetails)}"` : ''}>`
      + `<button class="cxtog" data-cxtt="${esc(id)}" title="${esc(shut ? TX.expandTurn : TX.collapseTurn)}" aria-expanded="${!shut}"></button>${icon('you')}<b>${title}</b>`
      + `${g.ts ? `<span class="muted">${fmtTime(g.ts)}</span>` : ''}<span class="cxtp">${g.prompt != null ? esc(short(g.prompt, 160)) : ''}</span><span class="grow"></span>`
      + `<span class="muted">${esc(plural(steps, 'step'))} · ${esc(plural(calls, 'toolCall'))}</span>${key ? `<span class="cxtgo">${esc(sel ? TX.inDetails : TX.detailsGo)}</span>` : ''}</div>`;
    const body = old ? g.html : [...g.html].reverse();
    return `<section class="cxturn${sel ? ' sel' : ''}${shut ? ' shut' : ''}" data-cxt="${esc(id)}"${key ? ` data-tk="${esc(key)}"` : ''}>${head}${body.join('')}</section>`;
  });
  if (!old) html.reverse();
  return html.join('');
}
// open or close a turn box in place (no re-render), and remember it for the next one
function ctxSetShut(sec, shut) {
  const id = sec.dataset.cxt, b = sec.querySelector(':scope > .cxth > .cxtog');
  if (shut) ctxShut.add(id); else ctxShut.delete(id);
  sec.classList.toggle('shut', shut);
  if (b) { b.title = shut ? TX.expandTurn : TX.collapseTurn; b.setAttribute('aria-expanded', String(!shut)); }
}
// the arrow only folds the turn: stop the click before it reaches the header's "show in Details"
$('alt').addEventListener('click', e => {
  const b = e.target.closest('[data-cxtt]'); if (!b) return;
  e.stopImmediatePropagation();
  const sec = b.closest('.cxturn'); ctxSetShut(sec, !sec.classList.contains('shut'));
  CTX.key = ''; // the cached HTML no longer matches
});
// a click inside the Context view picks a turn where you already are: don't jump to it (see drawAlt)
let ctxLocalPick = 0;
$('alt').addEventListener('click', () => { if (state.layout === 'context') ctxLocalPick = Date.now(); }, true);

// What the model is given before the conversation, pinned on top: the system prompt (for a custom subagent, the body
// of its .md file), the tool definitions, and the instruction files (CLAUDE.md, AGENTS.md, rules, auto-memory).
const INSTR_KIND = TX.instr;
function ctxPrompt(p, pre, main) {
  let h = '';
  const ms = main && p.measured;
  if (ms) h += `<div class="cxnote muted">${esc(TX.measuredNote(fmtN(ms.firstCtx), ms.cpt ? dec(ms.cpt.toFixed(1)) : null))}</div>`;
  if (p.system != null) {
    h += ctxCard(pre + 'sys', 'sys', `${icon('core')} <b>${esc(TX.systemPrompt)}</b><span class="grow"></span><span class="sz">${esc(TX.charsN(fmtN(p.system.length)))} · ${ctxTok(p.system.length)}</span>`, `<pre class="cxt">${esc(p.system)}</pre>`);
    // built-in tools first, then each MCP server's, largest first
    const tg = ctxGroups(p.tools.map((t, i) => ({ ...t, i })), t => ctxMcp(t.name)?.[0] || '', ctxToolLen);
    const nMcp = tg.filter(([g]) => g).length;
    h += ctxCard(pre + 'tools', 'sys', `${icon('other')} <b>${esc(TX.toolDefs)}</b> <span class="muted">${esc(plural(p.tools.length, 'tool'))}${nMcp ? ` · ${esc(plural(nMcp, 'mcpServer'))}` : ''}</span><span class="grow"></span><span class="sz">${ctxTok(p.tools.reduce((n, t) => n + ctxToolLen(t), 0))}</span>`,
      tg.map(([g, l]) => ctxGroup(pre + 'tools.g.' + g, g ? esc(g) : esc(TX.builtIn), esc(g ? `MCP · ${plural(l.length, 'tool')}` : plural(l.length, 'tool')), ctxTok(l.reduce((n, t) => n + ctxToolLen(t), 0)),
        l.map(t => ctxCard(pre + 'tool.' + t.i, 'tdef', `<b class="mono">${esc(ctxMcp(t.name)?.[1] || t.name)}</b> <span class="muted">${esc(short(t.description, 100))}</span><span class="grow"></span><span class="sz">${ctxTok(ctxToolLen(t))}</span>`,
          `<pre class="cxt">${esc(t.description)}</pre>${t.schema ? `<pre class="code fj">${jsonHtml(t.schema)}</pre>` : ''}`)).join(''))).join(''));
  } else if (main) h += `<div class="cxnote muted">${esc(TX.noSystem)}</div>`;
  const ins = p.instructions || [];
  if (ins.length) h += ctxCard(pre + 'ins', 'sys', `${icon('core')} <b>${esc(TX.instructions)}</b> <span class="muted">${esc(ins.map(f => f.path.split(/[\\/]/).pop()).join(', '))}</span><span class="grow"></span><span class="sz">${ctxTok(ins.reduce((n, f) => n + ctxLen(f.content), 0))}</span>`,
    ins.map((f, i) => ctxCard(pre + 'ins.' + i, 'tdef', `<b class="mono">${esc(f.path)}</b> <span class="muted">${esc(INSTR_KIND[f.type] || f.type || '')}</span><span class="grow"></span><span class="sz">${ctxTok(ctxLen(f.content))}</span>`, `<pre class="cxt">${esc(f.content)}</pre>`)).join(''));
  else if (main) h += `<div class="cxnote muted">${esc(TX.noInstructions)}</div>`;
  // what the model knows it can use: skills and subagent types by name and description, deferred tools by name only
  // skills by source: a plugin's skills are named "plugin:skill"; the transcript doesn't say where the others come from
  if (p.skills?.length) {
    const sg = ctxGroups(p.skills, s => s.name.includes(':') ? s.name.slice(0, s.name.indexOf(':')) : '', s => ctxListLen([s]));
    const nPl = sg.filter(([g]) => g).length;
    h += ctxCard(pre + 'skills', 'sys', `${icon('skills')} <b>${esc(TX.skills)}</b> <span class="muted">${esc(plural(p.skills.length, 'skill'))}${nPl ? ` · ${esc(plural(nPl, 'plugin'))}` : ''}</span><span class="grow"></span><span class="sz">${ctxTok(ctxListLen(p.skills))}</span>`,
      `<div class="muted">${esc(TX.skillsNote)}</div>`
      + sg.map(([g, l]) => ctxGroup(pre + 'skills.g.' + g, g ? esc(g) : esc(TX.notFromPlugin), esc(`${g === 'anthropic-skills' ? TX.claudeSync + ' · ' : g ? TX.pluginLc + ' · ' : ''}${plural(l.length, 'skill')}`), ctxTok(ctxListLen(l)),
        `<div class="cxlist">${l.map(x => `<div><b class="mono">${esc(g ? x.name.slice(g.length + 1) : x.name)}</b>${x.description ? ` <span class="muted">${esc(x.description)}</span>` : ''}</div>`).join('')}</div>`)).join(''));
  }
  // subagent types: one section each, its description inside
  if (p.agents?.length) h += ctxCard(pre + 'agents', 'sys', `${icon('agents')} <b>${esc(TX.subagentTypes)}</b> <span class="muted">${p.agents.length}</span><span class="grow"></span><span class="sz">${ctxTok(ctxListLen(p.agents))}</span>`,
    p.agents.map((x, i) => ctxCard(pre + 'agents.' + i, 'tdef', `<b class="mono">${esc(x.name)}</b> <span class="muted">${esc(short(x.description, 100))}</span><span class="grow"></span><span class="sz">${ctxTok(ctxListLen([x]))}</span>`,
      x.description ? `<pre class="cxt">${esc(x.description)}</pre>` : `<div class="muted">${esc(TX.noDescription)}</div>`)).join(''));
  if (p.mcp?.length) h += ctxCard(pre + 'mcp', 'sys', `${icon('other')} <b>${esc(TX.mcpInstructions)}</b> <span class="muted">${p.mcp.length}</span><span class="grow"></span><span class="sz">${ctxTok(p.mcp.reduce((n, x) => n + ctxLen(x.description), 0))}</span>`,
    p.mcp.map((x, i) => ctxCard(pre + 'mcp.' + i, 'tdef', `<b class="mono">${esc(x.name)}</b><span class="grow"></span><span class="sz">${ctxTok(ctxLen(x.description))}</span>`, `<pre class="cxt">${esc(x.description)}</pre>`)).join(''));
  const df = p.deferred;
  if (df) {
    const loaded = df.tools.filter(t => ctxLoaded(p, t)).length;
    h += ctxCard(pre + 'deferred', 'sys', `${icon('other')} <b>${esc(TX.deferredTools)}</b> <span class="muted">${esc(TX.deferredSub(df.tools.length, loaded))}${df.failedMcp.length ? ` · ${esc(TX.failedX(plural(df.failedMcp.length, 'mcpServer')))}` : ''}</span><span class="grow"></span><span class="sz">${ctxTok(ctxDeferredLen(df))}</span>`,
      `<div class="muted">${esc(TX.deferredNote)}</div>`
      + ctxDeferredGroups(p, df, pre + 'deferred.g.'));
  }
  return h;
}
// groups inside a card: [name, items] with '' (built-in, not from a plugin) first, then the largest
const ctxMcp = n => { const m = /^mcp__(.+?)__(.+)$/.exec(n); return m ? [m[1], m[2]] : null; };
function ctxGroups(list, keyOf, sizeOf) {
  const m = new Map();
  for (const x of list) { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  const size = l => l.reduce((n, x) => n + sizeOf(x), 0);
  return [...m].sort(([a, x], [b, y]) => (b === '') - (a === '') || size(y) - size(x) || a.localeCompare(b));
}
// a group is a collapsible section of its own, closed until opened (and remembered like any card)
const ctxGroup = (id, title, meta, size, body, bad = false) => ctxCard(id, 'grp' + (bad ? ' bad' : ''),
  `<b class="mono">${title}</b> <span class="muted">${meta}</span><span class="grow"></span><span class="sz">${size}</span>`, body);
// deferred tool names by MCP server (built-in first); a server that failed to connect shows its error
function ctxDeferredGroups(p, df, pre) {
  const groups = ctxGroups(df.tools, t => ctxMcp(t.name)?.[0] || '', t => ctxLen(t.name));
  for (const f of df.failedMcp) if (!groups.some(([g]) => g === f.name)) groups.push([f.name, []]);
  const fail = new Map(df.failedMcp.map(f => [f.name, f.error]));
  return groups.map(([g, l]) => {
    const err = fail.get(g), on = l.filter(t => ctxLoaded(p, t)).length;
    return ctxGroup(pre + g, g ? esc(g) : esc(TX.builtIn), err != null ? `<span class="chip err">${esc(TX.failedConnect)}</span>` : esc(`${g ? 'MCP · ' : ''}${plural(l.length, 'tool')}${on ? ` · ${TX.loadedN(on)}` : ''}`),
      l.length ? ctxTok(ctxDeferredLen({ tools: l })) : '',
      (err ? `<div class="cu-err">${esc(err)}</div>` : '')
      + (l.length ? `<div class="cu-chips">${l.map(t => `<span class="chip${ctxLoaded(p, t) ? ' on' : ''}" title="${esc(t.name)} · ${esc(ctxLoaded(p, t) ? TX.loadedLc : TX.nameOnly)}">${esc(ctxMcp(t.name)?.[1] || t.name)}</span>`).join('')}</div>` : ''), err != null);
  }).join('');
}

// ---- usage: Claude Code's /context, rebuilt from the transcript. A grid of 200 cells (each 0.5% of the window) and a legend of
// what fills it; each legend row opens its card below, where the content and the breakdown are. The total is measured (the
// latest model step); the parts are estimates from the text sizes, and Messages is what's left of the total.
const CU_CARD = { sys: 'sys', tools: 'tools', mcpt: 'tools', mcpi: 'mcp', mem: 'ins', skills: 'skills', agents: 'agents', defer: 'deferred', msgs: '@msgs' };
const CTX_BUFFER = 33000; // what Claude Code holds back for auto-compaction
const fmtT = n => n >= 1e6 ? dec(+(n / 1e6).toFixed(1)) + 'm' : n >= 1e3 ? dec(+(n / 1e3).toFixed(1)) + 'k' : String(Math.round(n));
const fmtPct = (n, w) => dec((n / w * 100).toFixed(1)) + '%';
function ctxUsage(d, pre) {
  const last = d.items.filter(x => x.kind === 'step').at(-1);
  if (!last) return '';
  const sz = ctxSize(last.ctx, null), win = sz.win, used = last.ctx, cpt = ctxCpt();
  const tok = chars => Math.round(chars / cpt);
  const tdef = ctxToolLen; // the same sizes as the cards below
  const isMcp = n => /^mcp__/.test(n);
  const known = d.system != null;
  const C = TX.cu;
  const parts = [
    known && ['sys', C.sys, tok(d.system.length)],
    known && ['tools', C.tools, tok(d.tools.filter(t => !isMcp(t.name)).reduce((n, t) => n + tdef(t), 0))],
    known && ['mcpt', C.mcpt, tok(d.tools.filter(t => isMcp(t.name)).reduce((n, t) => n + tdef(t), 0))],
    ['mcpi', C.mcpi, tok((d.mcp || []).reduce((n, x) => n + ctxLen(x.description), 0))],
    ['mem', C.mem, tok((d.instructions || []).reduce((n, f) => n + ctxLen(f.content), 0))],
    ['skills', C.skills, tok(ctxListLen(d.skills))],
    ['agents', C.agents, tok(ctxListLen(d.agents))],
    ['defer', C.defer, tok(ctxDeferredLen(d.deferred))],
  ].filter(p => p && p[2] > 0);
  const rest = Math.max(0, used - parts.reduce((n, p) => n + p[2], 0));
  parts.push(['msgs', known ? C.msgs : C.msgsAll, rest]);
  const buffer = Math.min(CTX_BUFFER, Math.max(0, win - used)), free = Math.max(0, win - used - buffer);

  // the grid: each part gets its share of the 200 cells, at least one; a part's last cell is half-filled when the share isn't whole
  const N = 200, cells = [];
  for (const [k, , n] of parts) {
    const share = n / win * N, full = Math.floor(share), part = share - full > 0.05 || !full;
    for (let i = 0; i < full; i++) cells.push(`<i class="c full cu-${k}"></i>`);
    if (part) cells.push(`<i class="c half cu-${k}"></i>`);
  }
  const nBuf = Math.round(buffer / win * N), nFree = Math.max(0, N - cells.length - nBuf);
  for (let i = 0; i < nFree; i++) cells.push('<i class="c free cu-free"></i>');
  for (let i = 0; i < nBuf && cells.length < N; i++) cells.push('<i class="c buf cu-buf"></i>');

  const tk = esc(TX.tokens);
  const legend = parts.map(([k, label, n]) => `<div class="cu-go" data-cxgo="${CU_CARD[k]}" title="${esc(TX.showBelow)}"><i class="c full cu-${k}"></i> ${esc(label)}: <b>${fmtT(n)}</b> ${tk} <span class="muted">(${fmtPct(n, win)})</span></div>`).join('')
    + `<div><i class="c free cu-free"></i> ${esc(TX.freeSpace)}: <b>${fmtT(free)}</b> <span class="muted">(${fmtPct(free, win)})</span></div>`
    + (buffer ? `<div><i class="c buf cu-buf"></i> ${esc(TX.autocompact)}: <b>${fmtT(buffer)}</b> ${tk} <span class="muted">(${fmtPct(buffer, win)})</span></div>` : '');
  const head = `<div class="cu-top"><div class="cu-grid" title="${esc(TX.cellsTitle)}">${cells.join('')}</div><div class="cu-side">
    <div><b>${esc(d.model || TX.modelUnknown)}</b></div>
    <div><b>${fmtT(used)}</b>/${fmtT(win)} ${tk} <span class="muted">(${Math.round(used / win * 100)}%)</span>${last.ts ? ` <span class="muted">· ${fmtTime(last.ts)}</span>` : ''}</div>
    <div class="cu-h">${esc(TX.usageByCat)}</div>${legend}</div></div>`;

  const note = `<div class="cxnote muted">${esc(TX.cuNote(d.measured?.cpt ? dec(d.measured.cpt.toFixed(1)) : null, known))}</div>`;
  return ctxCard(pre + 'usage', 'sys usage', `${icon('context')} <b>${esc(TX.ctxUsage)}</b> <span class="muted">${esc(d.model || '')}</span><span class="grow"></span><span class="sz">${fmtT(used)}/${fmtT(win)} ${tk} (${Math.round(used / win * 100)}%)</span>`,
    head + note, true);
}

function ctxBody(d, q) {
  let items = ctxPair(d.items, d.subagents);
  const ci = items.map(x => x.kind).lastIndexOf('compact');
  const compacted = ci >= 0;
  if (ctxMode === 'now' && compacted) items = items.slice(ci);
  const calls = items.filter(x => x.kind === 'call').length, nMeta = items.filter(x => x.kind === 'attachment' && x.role === 'meta').length;
  const prompts = items.filter(x => x.kind === 'user').length;
  // context now: the session's latest model step, and its change from the one before (the subagents' don't count)
  const st = d.items.filter(x => x.kind === 'step'), last = st.at(-1);
  const now = last ? ctxSize(last.ctx, st.length > 1 ? last.ctx - st.at(-2).ctx : null) : null;
  const tb = `<div class="cxbar">
    <div class="seg"><button data-cxm="all" class="${ctxMode === 'all' ? 'cur' : ''}">${esc(TX.wholeSession)}</button><button data-cxm="now" class="${ctxMode === 'now' ? 'cur' : ''}" ${compacted ? '' : `disabled title="${esc(TX.notCompacted)}"`}>${esc(TX.sinceCompaction)}</button></div>
    <div class="seg" title="${esc(TX.msgOrder)}"><button data-cxo="new" class="${ctxOrder !== 'old' ? 'cur' : ''}">${esc(TX.newestFirstBtn)}</button><button data-cxo="old" class="${ctxOrder === 'old' ? 'cur' : ''}">${esc(TX.oldestFirstBtn)}</button></div>
    <label class="check" title="${esc(TX.bookkeepingTitle)}"><input type="checkbox" data-cxa ${ctxMeta ? 'checked' : ''}> ${esc(TX.bookkeeping)} (${nMeta})</label>
    <span class="grow"></span>
    <span class="muted">${esc(plural(prompts, 'prompt'))} · ${esc(plural(calls, 'toolCall'))}</span>${now ? `<span class="muted">${esc(TX.ctxNow)}</span>${ctxBadge(now)}` : ''}
    <div class="seg" title="${esc(TX.turns)}"><button data-cxx="topen">${esc(TX.expandTurns)}</button><button data-cxx="tclose">${esc(TX.collapseTurns)}</button></div>
    <button data-cxx="open">${esc(TX.expandAll)}</button><button data-cxx="close">${esc(TX.collapseAll)}</button><button data-cxx="copy" title="${esc(TX.copyTitle)}">${esc(TX.copy)}</button></div>`;
  const body = ctxItems(items, 'i', q);
  return `<div class="ctxv">${tb}<div class="cxs">${ctxUsage(d, '')}${ctxPrompt(d, '', true)}${q ? `<div class="cxnote muted">${esc(TX.showingMatches(q))}</div>` : ''}${body || `<div class="cempty">${esc(TX.nothingYet)}</div>`}</div></div>`;
}

function contextHtml() {
  const sid = ctxSid();
  if (!sid) return `<div class="ctxv"><div class="cempty">${esc(TX.pickSession)}</div></div>`;
  const s = state.sessions.get(sid), ver = s ? `${s.eventCount}:${s.usage?.turns}:${s.last}` : '';
  if (CTX.sid !== sid || (CTX.ver !== ver && Date.now() - CTX.at > 1500)) ctxFetch(sid, ver);
  if (CTX.sid !== sid) return `<div class="ctxv"><div class="cempty">${esc(TX.readingTranscript)}</div></div>`;
  if (!CTX.data) return `<div class="ctxv"><div class="cempty">${esc(TX.cantRead(CTX.err))}</div></div>`;
  const key = [CTX.at, ctxMode, ctxOrder, ctxMeta, state.q, state.turnSel, TURNS.length, [...ctxOpen].join(','), [...ctxShut].join(',')].join('|');
  if (key !== CTX.key) { CTX.key = key; CTX.html = ctxBody(CTX.data, state.q); }
  return CTX.html;
}

// everything shown, as Markdown
function ctxMarkdown() {
  const d = CTX.data; if (!d) return '';
  let items = ctxPair(d.items, d.subagents);
  const ci = items.map(x => x.kind).lastIndexOf('compact');
  if (ctxMode === 'now' && ci >= 0) items = items.slice(ci);
  const fence = (s, lang = '') => '```' + lang + '\n' + String(s ?? '').replace(/```/g, '`​``') + '\n```\n';
  const md = (list, depth = 0) => list.map(it => {
    const hx = '#'.repeat(Math.min(6, 3 + depth));
    switch (it.kind) {
      case 'user': return `${hx} You\n\n${it.text}\n`;
      case 'text': return `${hx} Claude\n\n${it.text}\n`;
      case 'thinking': return `${hx} Thinking\n\n${fence(it.text)}`;
      case 'summary': return `${hx} Compaction summary\n\n${it.text}\n`;
      case 'compact': return `---\n\n*Compacted${it.preTokens ? ` at ${it.preTokens} tokens` : ''}*\n`;
      case 'meta': return `${hx} Injected\n\n${fence(it.text)}`;
      case 'attachment': return it.role !== 'meta' || ctxMeta ? `${hx} Attachment: ${it.label}${it.role === 'meta' ? ' (not sent)' : ''}\n\n${fence(it.text)}` : '';
      case 'call': return `${hx} Tool: ${it.name}\n\n${fence(JSON.stringify(it.input, null, 2), 'json')}${it.sub ? md(it.sub.items, depth + 1) : ''}`;
      case 'result': return `${hx} ${it.error ? 'Failed' : 'Result'}: ${it.call.name}\n\n${fence(it.text)}`;
      case 'orphan': return `${hx} Tool result\n\n${fence(it.text)}`;
      default: return '';
    }
  }).filter(Boolean).join('\n');
  return (d.system != null ? `## System prompt\n\n${fence(d.system)}\n## Tools\n\n${d.tools.map(t => `- **${t.name}**`).join('\n')}\n\n` : '')
    + ((d.instructions || []).length ? `## Instructions\n\n${d.instructions.map(f => `### ${f.path}\n\n${fence(f.content)}`).join('\n')}\n` : '')
    + (d.skills?.length ? `## Skills\n\n${d.skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}\n\n` : '')
    + (d.agents?.length ? `## Subagent types\n\n${d.agents.map(s => `- **${s.name}**: ${s.description}`).join('\n')}\n\n` : '')
    + (d.deferred?.tools.length ? `## Deferred tools\n\n${d.deferred.tools.map(t => `- ${t.name}${ctxLoaded(d, t) ? ' (loaded)' : ''}`).join('\n')}\n\n` : '')
    + `## Conversation\n\n${md(items)}`;
}

// controls (the cards themselves open and close as plain <details>)
$('alt').addEventListener('click', e => {
  const m = e.target.closest('[data-cxm]');
  if (m && !m.disabled) { ctxMode = m.dataset.cxm; ls.set('so.ctxMode', ctxMode); altDirty = true; return; }
  const o = e.target.closest('[data-cxo]');
  if (o) { ctxOrder = o.dataset.cxo; ls.set('so.ctxOrder', ctxOrder); altDirty = true; renderDetail(); return; }
  const a = e.target.closest('[data-cxa]');
  if (a) { ctxMeta = a.checked; ls.set('so.ctxMeta', ctxMeta ? '1' : '0'); altDirty = true; return; }
  const go = e.target.closest('[data-cxgo]');
  if (go) {
    const t = go.dataset.cxgo, root = $('alt');
    const el = t === '@msgs' ? root.querySelector('.cxs > .cxturn') : root.querySelector(`.cxs > details.cx[data-cx="${t}"]`);
    if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  const x = e.target.closest('[data-cxx]'); if (!x) return;
  if (x.dataset.cxx === 'copy') {
    navigator.clipboard?.writeText(ctxMarkdown()).then(() => { x.textContent = TX.copied; setTimeout(() => { x.textContent = TX.copy; }, 1200); }, () => { x.textContent = TX.copyFailed; });
    return;
  }
  if (x.dataset.cxx === 'topen' || x.dataset.cxx === 'tclose') {
    for (const sec of $('alt').querySelectorAll('.cxs > .cxturn')) ctxSetShut(sec, x.dataset.cxx === 'tclose');
    CTX.key = ''; return;
  }
  const open = x.dataset.cxx === 'open';
  for (const el of $('alt').querySelectorAll('details.cx')) el.open = open;
});
// remember which cards are open ('toggle' does not bubble); "-id" marks a card that starts open but was closed
$('alt').addEventListener('toggle', e => {
  const id = e.target.dataset?.cx; if (id == null) return;
  if (e.target.open) { ctxOpen.add(id); ctxOpen.delete('-' + id); } else { ctxOpen.delete(id); ctxOpen.add('-' + id); }
}, true);
