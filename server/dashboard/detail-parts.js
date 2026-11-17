'use strict';
// Session Observer dashboard — building blocks of the Details panel: collapsible sections, colour key, JSON and card parts.
// ---------------------------------------------------------------- detail panel
// collapsible sections of the Details panel; which ones you closed is remembered across turns and reloads
const dsecOpen = (() => { try { return JSON.parse(ls.get('so.dsec', '{}')) || {}; } catch { return {}; } })();
const isDsecOpen = (id, dflt = true) => dsecOpen[id] ?? dflt;
const dsec = (id, title, body) => `<details class="dsec" data-dsec="${id}"${isDsecOpen(id) ? ' open' : ''}><summary class="lbl2">${title}</summary>${body}</details>`;
function colourKey(t) {
  const ks = t ? [...new Set(t.events.flatMap(evTechs))] : [];
  const tech = ks.length ? `<div class="muted" style="margin-top:12px;font-size:12px">Languages and tools in this turn</div><div class="keygrid">${ks.map(k => `<div>${techIcon(k)}<span>${esc(TECH[k][0])}</span></div>`).join('')}</div>` : '';
  return `<details class="key dsec" data-dsec="key"${isDsecOpen('key', false) ? ' open' : ''}><summary>Colour key</summary><div class="keygrid">${STATIONS.map(s => `<div style="color:var(--s-${s.id})">${icon(s.id)}<span style="color:var(--text)">${s.label}</span></div>`).join('')}
    <div><span style="color:var(--ok)">●</span> running</div><div><span class="muted">·</span> done</div><div><span class="err">✕</span> failed / denied</div><div><span style="color:var(--s-model)">◆</span> model reply</div></div>${tech}</details>`;
}
// ---- an opened event row: a readable card for every event, with the raw hook payload folded underneath
const rawPre = e => `<pre class="raw">${esc(e.event)}${e.duration_ms ? ' · ' + fmtDur(e.duration_ms) : ''}\n${jsonHtml(e.data)}</pre>`;
// JSON pretty-printed with keys / strings / numbers / literals coloured (escaped token by token)
const JSON_TOK = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
// compact layout: an object / array stays on one line while that fits in ~72 columns, otherwise one child per line
function jsonStr(v, ind = '', w = 72) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const arr = Array.isArray(v), ents = arr ? v.map(x => [null, x]) : Object.entries(v);
  if (!ents.length) return arr ? '[]' : '{}';
  const key = k => k == null ? '' : JSON.stringify(k) + ': ';
  const one = (arr ? '[' : '{ ') + ents.map(([k, x]) => key(k) + jsonStr(x, '', Infinity)).join(', ') + (arr ? ']' : ' }');
  if (ind.length + one.length <= w) return one;
  const i2 = ind + '  ';
  return (arr ? '[' : '{') + '\n' + ents.map(([k, x]) => i2 + key(k) + jsonStr(x, i2, w)).join(',\n') + '\n' + ind + (arr ? ']' : '}');
}
function jsonHtml(v) {
  const src = jsonStr(v);
  let out = '', last = 0;
  for (const m of src.matchAll(JSON_TOK)) {
    const t = m[0], cls = t[0] === '"' ? (m[2] ? 'jk' : 'js') : /^[tfn]/.test(t) ? 'jb' : 'jn';
    out += esc(src.slice(last, m.index)) + `<span class="${cls}">${esc(t)}</span>`; last = m.index + t.length;
  }
  return out + esc(src.slice(last));
}
// tool output: all-JSON output is pretty-printed; otherwise a line ending in a JSON object / array
// ("PreToolUse 302 {…}") keeps its text and gets the JSON laid out under it; anything else stays as is
function fmtOutput(txt) {
  const s = String(txt).length > 20000 ? String(txt).slice(0, 20000) + '\n…' : String(txt), tr = s.trim();
  const parse = x => { try { const v = JSON.parse(x); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; } };
  if (/^[\[{]/.test(tr)) { const v = parse(tr); if (v !== undefined) return { html: jsonHtml(v), json: true }; }
  const lines = s.split('\n').map(line => {
    const i = line.search(/[\[{]/), v = i < 0 ? undefined : parse(line.slice(i));
    return v === undefined ? { line } : { label: line.slice(0, i).trimEnd(), v };
  });
  const n = lines.filter(x => x.v !== undefined).length;
  if (!n) return { html: esc(s), json: false };
  // 3+ labelled JSON lines: one folding row each (label + its first keys), expanded on click
  const fold = n >= 3;
  const html = lines.map(x => {
    if (x.v === undefined) return fold ? `<div>${esc(x.line) || '&nbsp;'}</div>` : esc(x.line);
    if (!fold) return (x.label ? `<b class="jl">${esc(x.label)}</b>\n` : '') + jsonHtml(x.v);
    const keys = Array.isArray(x.v) ? `${x.v.length} items` : Object.keys(x.v).join(', ');
    return `<details class="jfold"><summary><b class="jl">${esc(x.label || (Array.isArray(x.v) ? 'array' : 'object'))}</b> <span class="muted">${esc(trunc(keys, 110))}</span></summary><div class="jbody">${jsonHtml(x.v)}</div></details>`;
  }).join(fold ? '' : '\n');
  return { html, json: true, fold };
}
const evOut = (txt, cls = '') => { if (txt == null || txt === '') return ''; const f = fmtOutput(txt), tag = f.fold ? 'div' : 'pre'; return `<${tag} class="code ${cls}${f.json ? ' fj' : ''}">${f.html}</${tag}>`; };
// fields every hook payload carries; the card footer shows the useful ones, the field tables skip them
const EV_COMMON = new Set(['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'permission_mode', 'scratchpad_dir', 'prompt_id', 'effort', 'agent_id', 'agent_type', 'tool_use_id']);
const evHead = (st, title, ...bits) => `<div class="hd"><b style="color:var(--s-${st})">${icon(st)}${esc(title)}</b>${bits.filter(Boolean).map(b => `<span>${b}</span>`).join('')}</div>`;
const evSec = (label, html) => html ? `<div><div class="k">${label}</div>${html}</div>` : '';
const evText = (txt, cls = '') => txt ? `<div class="said ${cls}">${esc(String(txt).length > 6000 ? String(txt).slice(0, 6000) + '…' : txt)}</div>` : '';
const evCode = (txt, cls = '') => txt != null && txt !== '' ? `<pre class="code ${cls}">${esc(String(txt).length > 6000 ? String(txt).slice(0, 6000) + '\n…' : txt)}</pre>` : '';
// key → value table; short scalars inline, long text / objects as code blocks
function evKv(o, skip = EV_COMMON) {
  const rows = Object.entries(o || {}).filter(([k, v]) => !skip.has(k) && v != null && v !== '' && !(Array.isArray(v) && !v.length));
  if (!rows.length) return '';
  return `<dl class="kv">${rows.map(([k, v]) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return `<dt>${esc(k)}</dt><dd>${typeof v !== 'string' ? `<pre class="code fj">${jsonHtml(v)}</pre>` : s.length > 140 || s.includes('\n') ? evOut(s) : esc(s)}</dd>`;
  }).join('')}</dl>`;
}
// raw: what goes under the meta line; by default the event's own payload
function evCard(e, inner, raw) {
  const d = e.data || {}, bits = [fmtTime(e.ts), d.agent_type ? `subagent ${d.agent_type}` : d.subagent ? 'subagent' : 'main agent', d.effort?.level && `effort ${d.effort.level}`, d.permission_mode && `mode ${d.permission_mode}`, `#${e.seq}`];
  return `<div class="evx">${inner}<div class="meta">${bits.filter(Boolean).map(esc).join(' · ')}</div>${raw ?? `<details><summary>Raw payload</summary>${rawPre(e)}</details>`}</div>`;
}
