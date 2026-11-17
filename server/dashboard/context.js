'use strict';
// Session Observer dashboard — Context view: one session's whole conversation in one scrolling page, read in full from its transcript.
// ---- context: every prompt, reply, thinking block, tool call with its full input and result, subagent and compaction
// The data comes from /api/context (the transcript itself, not the hook log, whose fields are cut short). It is fetched when
// the view is open, again when the session changes, and rendered once per change (the result is cached as HTML).
const CTX = { sid: null, ver: null, at: 0, busy: false, data: null, err: null, html: '', key: '' };
const ctxOpen = new Set();                       // ids of the cards you opened
let ctxMode = ls.get('so.ctxMode', 'all');       // 'all' = the whole session · 'now' = since the last compaction
let ctxAtt = ls.get('so.ctxAtt', '0') === '1';  // show attachments (hook output, reminders, file snapshots…)
let ctxScroll = { sid: null, top: 0, atBottom: false };

// the session the view shows: the selected one, or the only one there is
function ctxSid() {
  if (state.scope !== 'all') return state.scope;
  return state.sessions.size === 1 ? [...state.sessions.keys()][0] : null;
}
function ctxFetch(sid, ver) {
  if (CTX.busy) return;
  CTX.busy = true;
  fetch('/api/context?session=' + encodeURIComponent(sid)).then(r => r.json()).then(d => {
    if (sid !== CTX.sid) { ctxScroll = { sid, top: 0, atBottom: false }; ctxOpen.clear(); }
    Object.assign(CTX, { sid, ver, at: Date.now(), data: d.error ? null : d, err: d.error || null, key: '' });
  }).catch(e => Object.assign(CTX, { sid, ver, at: Date.now(), data: null, err: String(e.message || e), key: '' }))
    .finally(() => { CTX.busy = false; altDirty = true; });
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ctxTok = chars => '≈' + fmtN(Math.round(chars / 4)) + ' tokens'; // rough: ~4 characters per token
const ctxLen = s => String(s ?? '').length;
const ctxInputLen = c => ctxLen(JSON.stringify(c.input ?? {}));
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
  if (name === 'Write') return evKv({ file: i.file_path }, new Set()) + `<pre class="code">${codeHtml(i.content ?? '', langOf(i.file_path))}</pre>`;
  if (name === 'Agent' || name === 'Task') return evKv({ description: i.description, type: i.subagent_type, model: i.model }, new Set()) + `<pre class="cxt">${esc(i.prompt ?? '')}</pre>`;
  return `<pre class="code fj">${jsonHtml(i)}</pre>`;
}
const ctxOutput = (txt, err) => !txt ? '<div class="muted">no output</div>'
  : txt.length < 20000 ? evOut(txt, err ? 'err' : '') : `<pre class="code ${err ? 'err' : ''}">${esc(txt)}</pre>`;
const ctxHay = it => (it._hay ??= [it.text, it.name, it.label, it.input && JSON.stringify(it.input), it.result?.text].filter(Boolean).join(' ').toLowerCase());

// pair each tool call with its result, and hang each subagent under the call that started it
function ctxPair(items, subs) {
  const res = new Map(items.filter(x => x.kind === 'result').map(x => [x.id, x]));
  const subBy = new Map(Object.entries(subs || {}).filter(([, a]) => a.toolUseId).map(([id, a]) => [a.toolUseId, { id, ...a }]));
  const used = new Set(), out = [];
  for (const it of items) {
    if (it.kind === 'result') continue;
    if (it.kind === 'call') {
      const r = res.get(it.id); if (r) used.add(it.id);
      const sub = subBy.get(it.id) || (r?.agentId && subs?.[r.agentId] ? { id: r.agentId, ...subs[r.agentId] } : null);
      out.push({ ...it, result: r || null, sub: sub ? { ...sub, items: ctxPair(sub.items, null) } : null });
    } else out.push(it);
  }
  for (const r of res.values()) if (!used.has(r.id)) out.push({ ...r, kind: 'orphan' });
  return out;
}

function ctxItems(list, pre, q, sub = false) {
  let h = '', lastCtx = null;
  list.forEach((it, i) => {
    const id = pre + i;
    if (q && it.kind !== 'step' && it.kind !== 'compact' && !ctxHay(it).includes(q) && !(it.sub && it.sub.items.some(x => ctxHay(x).includes(q)))) return;
    switch (it.kind) {
      case 'step': {
        if (q) return;
        const d = lastCtx != null ? it.ctx - lastCtx : null; lastCtx = it.ctx;
        h += `<div class="cxstep" title="${esc(it.model || '')}"><span>◆ model step</span><span class="grow"></span>context <b>${fmtN(it.ctx)}</b>${d ? ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmtN(Math.abs(d))}</span>` : ''} · ${fmtN(it.out)} out${it.ts ? ' · ' + fmtTime(it.ts) : ''}</div>`;
        return;
      }
      case 'compact':
        h += `<div class="cxcomp">${icon('context')} Compacted${it.trigger ? ' (' + esc(it.trigger) + ')' : ''}${it.preTokens ? ` at ${fmtN(it.preTokens)} tokens` : ''}${it.ts ? ' · ' + fmtTime(it.ts) : ''} — everything above was replaced by the summary below</div>`;
        return;
      case 'user': h += `<div class="cxmsg me"><div class="cxl">${sub ? `${icon('model')} Task from Claude` : `${icon('you')} You`}${it.ts ? ` <span class="muted">${fmtTime(it.ts)}</span>` : ''}</div><div class="cxt">${esc(it.text)}</div></div>`; return;
      case 'text': h += `<div class="cxmsg ai"><div class="cxl">${icon('model')} Claude</div><div class="cxt">${mdLite(it.text)}</div></div>`; return;
      case 'summary': h += ctxCard(id, 'sum', `${icon('context')} <b>Compaction summary</b><span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`, true); return;
      case 'thinking': h += ctxCard(id, 'think', `<b>thinking</b> <span class="muted">${esc(short(it.text, 110))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`); return;
      case 'meta': h += ctxCard(id, 'att', `<b>injected</b> <span class="muted">${esc(short(it.text, 110))}</span><span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`); return;
      case 'attachment': if (!ctxAtt) return;
        h += ctxCard(id, 'att', `<b>${esc(it.label || 'attachment')}</b> <span class="muted">${esc(short(it.text, 90))}</span><span class="grow"></span><span class="sz">${ctxTok(ctxLen(it.text))}</span>`, `<pre class="cxt">${esc(it.text)}</pre>`); return;
      case 'orphan': h += ctxCard(id, 'tool', `<b>tool result</b> <span class="muted">${esc(short(it.text, 90))}</span>`, ctxOutput(it.text, it.error)); return;
      case 'call': {
        const r = it.result, st = toolStation(it.name, it.input), size = ctxInputLen(it) + ctxLen(r?.text);
        const state_ = !r ? '<span class="run">● running</span>' : r.error ? '<span class="err">✕ failed</span>' : '<span class="ok">✓</span>';
        const arg = toolArg({ tool_name: it.name, tool_input: it.input || {} });
        const head = `${toolIcon(it.name, it.input, st)}<b>${esc(toolLabel(it.name))}</b> <span class="muted mono">${esc(short(arg, 100))}</span><span class="grow"></span><span class="sz">${state_} ${ctxTok(size)}</span>`;
        const sub = it.sub ? `<div class="cxsub"><div class="cxl">${icon('agents')} Subagent${it.sub.type ? ' · ' + esc(it.sub.type) : ''}${it.sub.description ? ` <span class="muted">${esc(it.sub.description)}</span>` : ''} <span class="muted">· its own context, ${plural(it.sub.items.filter(x => x.kind === 'call').length, 'tool call')}</span></div>${ctxItems(it.sub.items, id + '.', q, true)}</div>` : '';
        h += ctxCard(id, 'tool', head, `<div class="lbl2">Input</div>${ctxInput(it.name, it.input)}${sub}<div class="lbl2">Result</div>${r ? ctxOutput(r.text, r.error) : '<div class="muted">no result yet</div>'}`);
      }
    }
  });
  return h;
}

function ctxBody(d, q) {
  let items = ctxPair(d.items, d.subagents);
  const ci = items.map(x => x.kind).lastIndexOf('compact');
  const compacted = ci >= 0;
  if (ctxMode === 'now' && compacted) items = items.slice(ci);
  const calls = items.filter(x => x.kind === 'call').length, nAtt = items.filter(x => x.kind === 'attachment').length;
  const prompts = items.filter(x => x.kind === 'user').length;
  const c = d.context;
  const tb = `<div class="cxbar">
    <div class="seg"><button data-cxm="all" class="${ctxMode === 'all' ? 'cur' : ''}">Whole session</button><button data-cxm="now" class="${ctxMode === 'now' ? 'cur' : ''}" ${compacted ? '' : 'disabled title="This session has not been compacted, so the whole session is the current context"'}>Since last compaction</button></div>
    <label class="check"><input type="checkbox" data-cxa ${ctxAtt ? 'checked' : ''}> attachments (${nAtt})</label>
    <span class="grow"></span>
    <span class="muted">${plural(prompts, 'prompt')} · ${plural(calls, 'tool call')}${c ? ` · context now <b>${fmtN(c.tokens)}</b> of ${fmtN(c.window)} (${Math.round(c.pct * 100)}%)` : ''}</span>
    <button data-cxx="open">Expand all</button><button data-cxx="close">Collapse all</button><button data-cxx="copy" title="Copy everything shown as Markdown">Copy</button></div>`;
  const sys = d.system != null
    ? ctxCard('sys', 'sys', `${icon('core')} <b>System prompt</b><span class="grow"></span><span class="sz">${fmtN(d.system.length)} chars · ${ctxTok(d.system.length)}</span>`, `<pre class="cxt">${esc(d.system)}</pre>`)
      + ctxCard('tools', 'sys', `${icon('other')} <b>Tool definitions</b> <span class="muted">${d.tools.length} tools</span><span class="grow"></span><span class="sz">${ctxTok(d.tools.reduce((n, t) => n + ctxLen(t.description) + ctxLen(JSON.stringify(t.schema)), 0))}</span>`,
        d.tools.map((t, i) => ctxCard('tool.' + i, 'tdef', `<b class="mono">${esc(t.name)}</b> <span class="muted">${esc(short(t.description, 110))}</span>`, `<pre class="cxt">${esc(t.description)}</pre>${t.schema ? `<pre class="code fj">${jsonHtml(t.schema)}</pre>` : ''}`)).join(''))
    : `<div class="cxnote muted">The system prompt and tool definitions are not in this transcript: Claude Code records them only in some versions. Everything below is.</div>`;
  const body = ctxItems(items, 'i', q);
  return `<div class="ctxv">${tb}<div class="cxs">${sys}${q ? `<div class="cxnote muted">Showing what matches “${esc(q)}”. Reset filters to see everything.</div>` : ''}${body || '<div class="cempty">Nothing here yet</div>'}</div></div>`;
}

function contextHtml() {
  const sid = ctxSid();
  if (!sid) return `<div class="ctxv"><div class="cempty">Pick a session on the left to see its whole context.</div></div>`;
  const s = state.sessions.get(sid), ver = s ? `${s.eventCount}:${s.usage?.turns}:${s.last}` : '';
  if (CTX.sid !== sid || (CTX.ver !== ver && Date.now() - CTX.at > 1500)) ctxFetch(sid, ver);
  if (CTX.sid !== sid) return `<div class="ctxv"><div class="cempty">Reading the transcript…</div></div>`;
  if (!CTX.data) return `<div class="ctxv"><div class="cempty">Could not read this session's transcript${CTX.err ? `: ${esc(CTX.err)}` : ''}.</div></div>`;
  const key = [CTX.at, ctxMode, ctxAtt, state.q, [...ctxOpen].join(',')].join('|');
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
      case 'attachment': return ctxAtt ? `${hx} Attachment: ${it.label}\n\n${fence(it.text)}` : '';
      case 'call': return `${hx} Tool: ${it.name}\n\n${fence(JSON.stringify(it.input, null, 2), 'json')}${it.sub ? md(it.sub.items, depth + 1) : ''}${it.result ? `\n${it.result.error ? 'Failed:' : 'Result:'}\n\n${fence(it.result.text)}` : ''}`;
      case 'orphan': return `${hx} Tool result\n\n${fence(it.text)}`;
      default: return '';
    }
  }).filter(Boolean).join('\n');
  return (d.system != null ? `## System prompt\n\n${fence(d.system)}\n## Tools\n\n${d.tools.map(t => `- **${t.name}**`).join('\n')}\n\n` : '') + `## Conversation\n\n${md(items)}`;
}

// controls (the cards themselves open and close as plain <details>)
$('alt').addEventListener('click', e => {
  const m = e.target.closest('[data-cxm]');
  if (m && !m.disabled) { ctxMode = m.dataset.cxm; ls.set('so.ctxMode', ctxMode); altDirty = true; return; }
  const a = e.target.closest('[data-cxa]');
  if (a) { ctxAtt = a.checked; ls.set('so.ctxAtt', ctxAtt ? '1' : '0'); altDirty = true; return; }
  const x = e.target.closest('[data-cxx]'); if (!x) return;
  if (x.dataset.cxx === 'copy') {
    navigator.clipboard?.writeText(ctxMarkdown()).then(() => { x.textContent = 'Copied'; setTimeout(() => { x.textContent = 'Copy'; }, 1200); }, () => { x.textContent = 'Copy failed'; });
    return;
  }
  const open = x.dataset.cxx === 'open';
  for (const el of $('alt').querySelectorAll('details.cx')) el.open = open;
});
// remember which cards are open ('toggle' does not bubble); "-id" marks a card that starts open but was closed
$('alt').addEventListener('toggle', e => {
  const id = e.target.dataset?.cx; if (id == null) return;
  if (e.target.open) { ctxOpen.add(id); ctxOpen.delete('-' + id); } else { ctxOpen.delete(id); ctxOpen.add('-' + id); }
}, true);
