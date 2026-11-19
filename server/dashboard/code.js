'use strict';
// Session Observer dashboard — code display: syntax colouring, and how a tool's input and output are shown.
// ---- code display: a small syntax colouring for shell, Python and JavaScript (escaped token by token)
const KW = {
  sh: new Set('if then else elif fi for while until do done case esac in function return export local set unset source exit'.split(' ')),
  py: new Set('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False global nonlocal yield async await assert del'.split(' ')),
  js: new Set('const let var function return if else for while do of in new class extends try catch finally throw typeof instanceof await async import export from default null undefined true false this switch case break continue delete void yield'.split(' ')),
};
// groups: 1 comment · 2 string · 3 variable · 4 operator · 5 flag · 6 number · 7 word ("(?!)" = a part the language lacks)
const CODE_PARTS = {
  sh: [String.raw`(?<![\w$])#[^\n]*`, String.raw`"(?:\\[\s\S]|[^"\\])*"|'[^']*'`, String.raw`\$\{[^}\n]*\}|\$\w+|\$[@#?*!$0-9]`, String.raw`&&|\|\||2>&1|&>|>>|[|;<>]`, String.raw`(?<![\w./-])--?[A-Za-z][\w-]*`],
  py: [String.raw`#[^\n]*`, String.raw`\b[rRbBfFuU]{1,2}(?="|')(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`, '(?!)', '(?!)', '(?!)'],
  js: [String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, String.raw`\x60(?:\\[\s\S]|[^\x60\\])*\x60|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`, '(?!)', String.raw`=>`, '(?!)'],
};
const CODE_RX = Object.fromEntries(Object.entries(CODE_PARTS).map(([l, p]) => [l, new RegExp([...p, String.raw`\b\d+(?:\.\d+)?\b`, String.raw`[A-Za-z_$][\w$]*`].map(x => `(${x})`).join('|'), 'g')]));
const TK = [null, 'c', 's', 'v', 'o', 'f', 'n'];
function codeHtml(src, lang) {
  src = String(src ?? '');
  const rx = CODE_RX[lang]; if (!rx) return esc(src);
  let out = '', last = 0;
  for (const m of src.matchAll(rx)) {
    const t = m[0]; let c = null;
    for (let g = 1; g <= 6; g++) if (m[g] !== undefined) { c = TK[g]; break; }
    if (!c && KW[lang].has(t)) c = 'k';
    out += esc(src.slice(last, m.index)) + (c ? `<span class="tk-${c}">${esc(t)}</span>` : esc(t)); last = m.index + t.length;
  }
  return out + esc(src.slice(last));
}
const langOf = f => { const x = String(f || '').split('.').pop().toLowerCase(); return ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(x) ? 'js' : x === 'py' ? 'py' : ['sh', 'bash', 'zsh'].includes(x) ? 'sh' : x === 'json' ? 'json' : null; };
// a long shell line wraps at its top-level && || ; | (not inside quotes, $( ) or ( )), continuation lines indented
function splitShell(line) {
  if (line.length <= 100) return line;
  let out = '', q = null, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], two = line.slice(i, i + 2);
    if (q) { out += c; if (c === '\\' && q !== "'") { out += line[++i] ?? ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
    if (!depth && (two === '&&' || two === '||')) { out += two + '\n  '; i += 1 + (line[i + 2] === ' ' ? 1 : 0); continue; }
    if (!depth && (c === ';' || (c === '|' && line[i + 1] !== '|'))) { out += c + '\n  '; if (line[i + 1] === ' ') i++; continue; }
    out += c;
  }
  return out;
}
const codeLangOf = s => /\bpython3?\b/.test(s) ? 'py' : /\b(node|deno|bun)\b/.test(s) ? 'js' : /\b(bash|sh|zsh)\b/.test(s) ? 'sh' : null;
// a Bash command: shell coloured; heredoc bodies and `node -e '…'` / `python -c '…'` scripts coloured as their language
function bashHtml(cmd) {
  cmd = String(cmd ?? '');
  const inl = !/<<-?\s*['"]?\w+/.test(cmd) && cmd.match(/^([\s\S]*?\b(?:node|python3?|deno|bun)\s+(?:-\S+\s+)*?-[ec]\s+)'([^']*)'([\s\S]*)$/);
  if (inl) return codeHtml(inl[1], 'sh') + `<span class="tk-s">'</span>${codeHtml(inl[2], codeLangOf(inl[1]))}<span class="tk-s">'</span>` + bashHtml(inl[3]);
  const lines = cmd.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], m = line.match(/<<-?\s*(['"]?)(\w+)\1/);
    out.push(codeHtml(splitShell(line), 'sh'));
    if (!m) continue;
    const body = []; i++;
    while (i < lines.length && lines[i].trim() !== m[2]) body.push(lines[i++]);
    out.push(codeHtml(body.join('\n'), codeLangOf(line.slice(0, m.index))));
    if (i < lines.length) out.push(`<span class="tk-o">${esc(lines[i])}</span>`);
  }
  return out.join('\n');
}

// a tool's input, shaped per tool
function toolInputHtml(name, i) {
  i = i || {};
  const K = TX.kv;
  switch (name) {
    case 'Bash': return (i.command ? `<pre class="code">${bashHtml(i.command)}</pre>` : '') + (i.description ? `<div class="muted">${esc(i.description)}</div>` : '');
    case 'Edit': return evKv({ [K.file]: i.file_path, [K.replaceAll]: i.replace_all || null }, new Set()) + diffHtml(i.old_string, i.new_string);
    case 'MultiEdit': return evKv({ [K.file]: i.file_path }, new Set()) + (i.edits || []).map(x => diffHtml(x.old_string, x.new_string)).join('');
    case 'Write': { const l = langOf(i.file_path), j = l === 'json' && (() => { try { return JSON.parse(i.content); } catch { return undefined; } })(); return evKv({ [K.file]: i.file_path }, new Set()) + (i.content == null ? '' : `<pre class="code">${j !== undefined && j !== false ? jsonHtml(j) : codeHtml(String(i.content).slice(0, 20000), l)}</pre>`); }
    case 'Agent': case 'Task': return evKv({ [K.description]: i.description, [K.type]: i.subagent_type, [K.model]: i.model }, new Set()) + evSec(esc(TX.prompt), evText(i.prompt));
    case 'AskUserQuestion': return (i.questions || []).map(q => `<div class="q2"><b>${esc(q.question)}</b>${(q.options || []).map(o => `<div class="opt">• ${esc(o.label)}${o.description ? ` <span class="muted">— ${esc(o.description)}</span>` : ''}</div>`).join('')}</div>`).join('');
    default: return evKv(i, new Set());
  }
}
function diffHtml(a, b) {
  const lines = (s, c, p) => String(s ?? '').split('\n').map(l => `<span class="${c}">${p} ${esc(l)}</span>`).join('\n');
  return `<pre class="code diff">${lines(a, 'del', '-')}\n${lines(b, 'ins', '+')}</pre>`;
}
// a tool's result, shaped per tool
function toolOutputHtml(name, post) {
  const d = post.data || {}, r = d.tool_response, K = TX.kv, none = `<div class="muted">${esc(TX.noOutput)}</div>`;
  if (post.event === 'PostToolUseFailure') return evOut(d.error, 'err') + (d.is_interrupt ? `<div class="muted">${esc(TX.interruptedByUser)}</div>` : '');
  if (r == null) return none;
  if (typeof r === 'string') return evOut(r);
  switch (name) {
    case 'Bash': return (r.stdout || r.stderr ? evOut(r.stdout) + evOut(r.stderr, 'err') : none) + (r.interrupted ? `<div class="err">${esc(TX.interrupted)}</div>` : '');
    case 'Read': { const f = r.file || {}; return evKv({ [K.file]: f.filePath, [K.lines]: f.numLines != null ? TX.linesOf(f.startLine ?? 1, (f.startLine ?? 1) + f.numLines - 1, f.totalLines ?? '?') : null, [K.type]: r.type }, new Set()) + evCode(f.content && String(f.content).slice(0, 1500) + (String(f.content).length > 1500 ? '\n…' : '')); }
    case 'Edit': case 'MultiEdit': case 'Write': return `<div>${esc(r.userModified ? TX.appliedChanged : TX.applied)} · <span class="muted">${esc(r.filePath || '')}</span></div>`;
    case 'Agent': case 'Task': return evKv({ [K.status]: r.status, [K.agent]: r.agentId, [K.model]: r.resolvedModel, [K.async]: r.isAsync }, new Set()) + evText(Array.isArray(r.content) ? r.content.map(c => c.text || '').join('\n') : r.result);
    case 'AskUserQuestion': return evKv(r.answers, new Set()) || `<div class="muted">${esc(TX.noAnswers)}</div>`;
    default: return evKv(r, new Set(['originalFile', 'structuredPatch']));
  }
}
