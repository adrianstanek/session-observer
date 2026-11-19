#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/events.jsonl, keeps sessions in memory,
// reads model steps + token usage from each session's transcript, serves the
// dashboard and pushes live updates over Server-Sent Events.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.OBSERVER_PORT || 4777);
const HOST = process.env.OBSERVER_HOST || '127.0.0.1'; // local only by default
const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
const MAX_EVENTS_PER_SESSION = Number(process.env.OBSERVER_MAX_EVENTS || 5000);
const MAX_ALL_EVENTS = Number(process.env.OBSERVER_MAX_ALL_EVENTS || 10000);
const CONTEXT_WINDOW = Number(process.env.OBSERVER_CONTEXT_WINDOW || 200000);
const DASHBOARD = path.join(__dirname, 'dashboard.html');
const ASSETS = path.join(__dirname, 'dashboard'); // the page's stylesheet and scripts
const ASSET_TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// ---------- request guard ----------
// The dashboard shows prompts, file contents and command output, so only pages served by this server may use it.
// Host: a web page that points its own domain at 127.0.0.1 (DNS rebinding) sends that domain as Host, and is refused.
// Origin: a page on another site can still send a simple POST without a preflight; a request with a foreign Origin is
// refused, and a POST must carry this server's own Origin.
// Loopback names are always allowed; OBSERVER_HOST (when it names one address) and OBSERVER_ALLOWED_HOSTS add more.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const WILDCARD = new Set(['0.0.0.0', '::', '']);
const ALLOWED_NAMES = new Set([
  ...LOOPBACK,
  ...(WILDCARD.has(HOST) ? [] : [HOST.toLowerCase()]),
  ...String(process.env.OBSERVER_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
]);
function hostOk(host) {
  const m = /^(?:\[([0-9a-f:.]+)\]|([^:[\]]+))(?::(\d+))?$/i.exec(String(host || ''));
  if (!m) return false;
  const name = (m[1] || m[2]).toLowerCase(), port = m[3] ? Number(m[3]) : 80;
  return ALLOWED_NAMES.has(name) && port === PORT;
}
function originOk(origin) {
  try { const u = new URL(origin); return u.protocol === 'http:' && hostOk(u.host); } catch { return false; }
}
// sent with every response: no MIME sniffing, no framing (clickjacking), no referrer, no cross-site embedding
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
// The page's Content-Security-Policy: scripts only from this server, plus the page's own inline scripts by hash.
// The HTML parser turns CRLF into LF before the browser hashes a script, so the hash is taken over LF text.
function pageCsp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`);
  return [
    "default-src 'none'", `script-src 'self' ${hashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
}

// ---------- classification ----------
const QUESTION_TOOLS = new Set(['AskUserQuestion']);
const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop']);

function classify(ev) {
  const d = ev.data || {};
  const tool = d.tool_name || '';
  switch (ev.event) {
    case 'ModelStep':
    case 'ModelText': return 'model';
    case 'UserPromptSubmit':
    case 'UserPromptExpansion': return 'prompt';
    case 'PermissionRequest':
    case 'PermissionDenied': return 'permission';
    case 'PostToolUseFailure':
    case 'StopFailure': return 'error';
    case 'SubagentStart':
    case 'SubagentStop':
    case 'TeammateIdle': return 'subagent';
    case 'TaskCreated':
    case 'TaskCompleted': return 'task';
    case 'Notification':
    case 'MessageDisplay': return 'notification';
    case 'Elicitation':
    case 'ElicitationResult': return 'question';
    case 'PreCompact':
    case 'PostCompact': return 'compact';
    case 'InstructionsLoaded': return 'context';
    case 'SessionStart':
    case 'SessionEnd':
    case 'Setup':
    case 'Stop': return 'lifecycle';
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolBatch':
      if (tool === 'Skill') return 'skill';
      if (QUESTION_TOOLS.has(tool)) return 'question';
      if (SUBAGENT_TOOLS.has(tool)) return 'subagent';
      if (TASK_TOOLS.has(tool)) return 'task';
      if (tool.startsWith('mcp__')) return 'mcp';
      return 'tool';
    default: return 'env'; // ConfigChange, CwdChanged, FileChanged, Worktree*, model switches...
  }
}

// ---------- state ----------
const sessions = new Map(); // id -> session
let seq = 0;

function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id, cwd: null, started: null, last: null, ended: false, endReason: null,
      model: null, permission_mode: null, transcript_path: null, source: null,
      title: null, turns: 0, busy: false, subagents: 0, lastTool: null,
      counts: {}, tools: {}, skills: {}, mcp: {}, agents: {},
      toolMs: 0, toolCalls: 0, failures: 0, modelSteps: 0,
      usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0, models: {} },
      context: null,
      events: [], pending: new Map(),
    };
    sessions.set(id, s);
  }
  return s;
}

function toolArg(d) {
  const ti = d.tool_input || {};
  return ti.command || ti.file_path || ti.path || ti.pattern || ti.url || ti.query || ti.skill || ti.description || '';
}

function insertSorted(arr, ev) {
  // events almost always arrive in order; model steps from the transcript can be slightly late
  let i = arr.length;
  while (i > 0 && arr[i - 1].ts > ev.ts) i--;
  arr.splice(i, 0, ev);
}

function ingest(ev) {
  ev.seq = ++seq;
  ev.category = classify(ev);
  const d = ev.data || {};
  const s = getSession(ev.session_id);
  if (!s.started || ev.ts < s.started) s.started = ev.ts;
  if (!s.last || ev.ts > s.last) s.last = ev.ts;
  if (d.cwd) s.cwd = d.cwd;
  if (d.transcript_path && !d.agent_transcript_path) s.transcript_path = d.transcript_path;
  else if (d.transcript_path && !s.transcript_path) s.transcript_path = d.transcript_path;
  if (d.permission_mode) s.permission_mode = d.permission_mode;
  if (d.model) s.model = typeof d.model === 'string' ? d.model : (d.model.id || d.model.display_name || s.model);
  if (d.to_model) s.model = d.to_model;
  s.counts[ev.category] = (s.counts[ev.category] || 0) + 1;

  switch (ev.event) {
    case 'SessionStart': s.ended = false; s.source = d.source || s.source; break;
    case 'SessionEnd': s.ended = true; s.busy = false; s.endReason = d.reason || null; s.pending.clear(); break;
    case 'UserPromptSubmit':
      s.turns++; s.busy = true;
      if (!s.title && d.prompt) s.title = String(d.prompt).replace(/\s+/g, ' ').trim().slice(0, 140);
      break;
    case 'Stop': case 'StopFailure': s.busy = false; s.pending.clear(); break;
    case 'SubagentStart': s.subagents++; break;
    case 'ModelStep': s.modelSteps++; break;
  }

  const tool = d.tool_name;
  if (ev.event === 'PreToolUse' && tool) {
    s.toolCalls++;
    s.tools[tool] = (s.tools[tool] || 0) + 1;
    s.lastTool = { name: tool, arg: String(toolArg(d)).slice(0, 200), ts: ev.ts };
    if (tool === 'Skill') {
      const name = (d.tool_input && (d.tool_input.skill || d.tool_input.name)) || '?';
      s.skills[name] = (s.skills[name] || 0) + 1;
    }
    if (tool.startsWith('mcp__')) {
      const server = tool.split('__')[1] || '?';
      s.mcp[server] = (s.mcp[server] || 0) + 1;
    }
    if (SUBAGENT_TOOLS.has(tool)) {
      const t = (d.tool_input && (d.tool_input.subagent_type || d.tool_input.description)) || tool;
      s.agents[t] = (s.agents[t] || 0) + 1;
    }
    if (d.tool_use_id) s.pending.set(d.tool_use_id, Date.parse(ev.ts));
  }
  if ((ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure') && d.tool_use_id) {
    const start = s.pending.get(d.tool_use_id);
    if (start) {
      ev.duration_ms = Date.parse(ev.ts) - start;
      s.toolMs += ev.duration_ms;
      s.pending.delete(d.tool_use_id);
    }
  }
  if (ev.category === 'error') s.failures++;

  insertSorted(s.events, ev);
  if (s.events.length > MAX_EVENTS_PER_SESSION) s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION);

  if (ev.event !== 'ModelStep' && s.transcript_path) scheduleTranscript(s);
  return s;
}

// ---------- model steps + token usage from the transcript ----------
// Hooks don't see individual model calls, so each assistant API response in the
// transcript (and subagent transcripts) becomes a synthetic "ModelStep" event.
const tails = new Map(); // file -> { offset, partial }
const seenMsgs = new Map(); // session id -> Set(message id)
const transcriptTimers = new Map();

function scheduleTranscript(s, delay = 700) {
  if (transcriptTimers.has(s.id)) return;
  transcriptTimers.set(s.id, setTimeout(() => {
    transcriptTimers.delete(s.id);
    try { readTranscripts(s); } catch { /* ignore */ }
  }, delay));
}

function readTail(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  let t = tails.get(file);
  if (!t) { t = { offset: 0, partial: '' }; tails.set(file, t); }
  if (stat.size < t.offset) { t.offset = 0; t.partial = ''; }
  if (stat.size === t.offset) return [];
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - t.offset);
  fs.readSync(fd, buf, 0, buf.length, t.offset);
  fs.closeSync(fd);
  t.offset = stat.size;
  const lines = (t.partial + buf.toString('utf8')).split('\n');
  t.partial = lines.pop();
  return lines;
}

// the tool calls in one transcript line of a response: name + the tool_use id the hooks report as tool_use_id
const toolUses = m => (Array.isArray(m.content) ? m.content : []).filter(c => c && c.type === 'tool_use').map(c => ({ name: c.name, id: c.id || null }));
const stepByMsg = new Map(); // message id → its ModelStep event (recent ones), so later lines can add their tool calls

// what the model wrote: one ModelText per finished text / thinking block (thinking is often stored empty)
const TEXT_MAX = 2000;
function modelTexts(s, row, m, isSub) {
  const out = [];
  for (const c of Array.isArray(m.content) ? m.content : []) {
    const raw = c && (c.type === 'text' ? c.text : c.type === 'thinking' ? c.thinking : null);
    const text = raw ? String(raw).trim() : '';
    if (!text) continue;
    out.push({
      ts: row.timestamp || new Date().toISOString(), event: 'ModelText', session_id: s.id, synthetic: true,
      data: { kind: c.type, text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) + '…' : text, msg_id: m.id || null, subagent: isSub || !!row.isSidechain, agent_id: row.agentId || null },
    });
  }
  return out;
}

function readTranscripts(s) {
  const main = s.transcript_path;
  if (!main) return;
  const files = [[main, false]];
  const subDir = path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents');
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith('.jsonl')) files.push([path.join(subDir, f), true]); } catch { /* none */ }

  let seen = seenMsgs.get(s.id);
  if (!seen) { seen = new Set(); seenMsgs.set(s.id, seen); }
  const fresh = [];
  for (const [file, isSub] of files) {
    for (const line of readTail(file)) {
      if (!line) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const m = row.message;
      if (!m || m.role !== 'assistant' || !m.usage) continue;
      const key = m.id || row.uuid;
      // only responses from the logged part of the session: after "Clear log" the log restarts at the next
      // hook event, and the transcript's earlier history must not come back without its prompts and tools
      if (s.started && row.timestamp && row.timestamp < s.started) { if (key) seen.add(key); continue; }
      // one API response spans several lines (one per content block): its first line becomes the ModelStep,
      // and every non-empty text / thinking block, on whichever line it comes, also becomes a ModelText
      const said = modelTexts(s, row, m, isSub), uses = toolUses(m);
      if (key && seen.has(key)) {
        // a later line of a response we already have: tool calls usually arrive here, so add them to its
        // ModelStep and send that step again (same seq: the dashboard updates it in place)
        const step = stepByMsg.get(key);
        if (step) {
          const ids = step.data.tool_ids, add = uses.filter(u => !ids.includes(u.id));
          if (add.length) { for (const u of add) { step.data.tools.push(u.name); ids.push(u.id); } fresh.push(step); }
        }
        for (const t of said) { ingest(t); fresh.push(t); }
        continue;
      }
      if (key) seen.add(key);
      const u = m.usage;
      s.usage.input += u.input_tokens || 0;
      s.usage.output += u.output_tokens || 0;
      s.usage.cache_read += u.cache_read_input_tokens || 0;
      s.usage.cache_write += u.cache_creation_input_tokens || 0;
      s.usage.turns++;
      if (m.model) s.usage.models[m.model] = (s.usage.models[m.model] || 0) + 1;
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (!isSub && !row.isSidechain) {
        const window = /\[1m\]|-1m/i.test(m.model || s.model || '') || ctx > CONTEXT_WINDOW ? 1000000 : CONTEXT_WINDOW;
        s.context = { tokens: ctx, window, pct: Math.min(1, ctx / window), ts: row.timestamp };
      }
      const ev = {
        ts: row.timestamp || new Date().toISOString(),
        event: 'ModelStep',
        session_id: s.id,
        synthetic: true,
        data: {
          model: m.model, stop_reason: m.stop_reason, subagent: isSub || !!row.isSidechain,
          agent_id: row.agentId || null, msg_id: m.id || null, tools: uses.map(u => u.name), tool_ids: uses.map(u => u.id),
          tokens: { input: u.input_tokens || 0, output: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, context: ctx },
        },
      };
      // keep model on the event without overwriting the session's model with a subagent's
      const keepModel = s.model;
      ingest(ev);
      if (key) { stepByMsg.set(key, ev); if (stepByMsg.size > 2000) stepByMsg.delete(stepByMsg.keys().next().value); }
      if (isSub) s.model = keepModel;
      fresh.push(ev);
      for (const t of said) { ingest(t); fresh.push(t); }
    }
  }
  if (initialLoadDone && fresh.length) {
    for (const ev of fresh) broadcast('event', ev);
    broadcast('session', summary(s));
  } else if (initialLoadDone) {
    broadcast('session', summary(s));
  }
}

function summary(s) {
  const { events, pending, ...rest } = s;
  return { ...rest, eventCount: events.length, running: pending.size };
}

// ---------- whole context: one session's transcript, in full, for the Context view ----------
// The hook log keeps at most OBSERVER_MAX_FIELD chars per field and the model's text at TEXT_MAX, so this view reads the
// transcript itself: every prompt, reply, thinking block, tool call with its input and result, attachment and compaction.
// Read on request (only while the view is open), cached per file until it changes.
const CTX_FIELD_MAX = Number(process.env.OBSERVER_CONTEXT_FIELD || 100000); // chars kept per text, so one huge output can't stall the page
const ctxCache = new Map(); // file -> { mtimeMs, size, rows }
function readRows(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const c = ctxCache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.rows;
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (line) try { rows.push(JSON.parse(line)); } catch { /* partial line */ } }
  ctxCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, rows });
  if (ctxCache.size > 50) ctxCache.delete(ctxCache.keys().next().value);
  return rows;
}
const clipStr = s => s.length > CTX_FIELD_MAX ? s.slice(0, CTX_FIELD_MAX) + `\n… [+${s.length - CTX_FIELD_MAX} chars not shown]` : s;
function clipDeep(v, d = 0) {
  if (typeof v === 'string') return clipStr(v);
  if (!v || typeof v !== 'object' || d > 10) return v;
  if (Array.isArray(v)) return v.map(x => clipDeep(x, d + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipDeep(x, d + 1)]));
}
const blockText = c => typeof c === 'string' ? c : Array.isArray(c)
  ? c.map(b => b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : JSON.stringify(b)).join('\n') : c == null ? '' : JSON.stringify(c);

// CLAUDE.md, AGENTS.md (pulled in by an @import), rules and auto-memory reach the model as an 'instructions' attachment:
// a list of { path, type: User | Project | Local | AutoMem | …, content }
const instructionsText = files => files.map(f => `Contents of ${f.path} (${f.type}):\n\n${f.content || ''}`).join('\n\n');

// "- name: description" lines (skill and agent listings) → name → description; a line not starting "- " continues the one
// before. Split at the first ": ", since plugin skill names hold a colon ("plugin:skill").
function listingLines(lines, into) {
  let last = null;
  for (const l of lines) {
    const m = /^- (.+?): ([\s\S]*)$/.exec(l);
    if (m) { last = m[1]; into.set(last, m[2]); } else if (/^- /.test(l)) { last = l.slice(2).trim(); into.set(last, ''); }
    else if (last != null && l.trim()) into.set(last, into.get(last) + '\n' + l);
  }
}

// What the model knows it can use, beyond the tool definitions, as attachments that set or change a list:
// skill_listing (skills by name and description; a skill's SKILL.md arrives only when it is invoked),
// agent_listing_delta (subagent types) and deferred_tools_delta (tools known by name only, loaded through ToolSearch;
// also which MCP servers failed to connect) and mcp_instructions_delta (each MCP server's own instructions).
// An initial listing replaces the list; a delta adds and removes.
function listingsOf(rows) {
  const skills = new Map(), agents = new Map(), deferred = new Map(), mcp = new Map(); let failed = null;
  for (const r of rows) {
    const a = r.attachment; if (!a) continue;
    if (a.type === 'mcp_instructions_delta') {
      for (const n of a.removedNames || []) mcp.delete(n);
      (a.addedNames || []).forEach((n, i) => mcp.set(n, String(a.addedBlocks?.[i] ?? '')));
    } else if (a.type === 'skill_listing') {
      if (a.isInitial !== false) skills.clear();
      if (typeof a.content === 'string') listingLines(a.content.split('\n'), skills);
      for (const n of Array.isArray(a.names) ? a.names : []) if (!skills.has(n)) skills.set(n, '');
    } else if (a.type === 'agent_listing_delta') {
      if (a.isInitial) agents.clear();
      for (const n of a.removedTypes || []) agents.delete(n);
      if (Array.isArray(a.addedLines)) listingLines(a.addedLines, agents);
      for (const n of a.addedTypes || []) if (!agents.has(n)) agents.set(n, '');
    } else if (a.type === 'deferred_tools_delta') {
      for (const n of a.removedNames || []) deferred.delete(n);
      for (const n of [...(a.addedNames || []), ...(a.readdedNames || [])]) if (!deferred.has(n)) deferred.set(n, false);
      for (const n of a.surfacedNames || []) deferred.set(n, true);
      if (Array.isArray(a.failedMcpServers)) failed = a.failedMcpServers;
    }
  }
  const list = m => [...m].map(([name, description]) => ({ name, description: clipStr(description) }));
  return {
    skills: skills.size ? list(skills) : null,
    agents: agents.size ? list(agents) : null,
    mcp: mcp.size ? list(mcp) : null,
    deferred: deferred.size || failed?.length ? {
      tools: [...deferred].map(([name, loaded]) => ({ name, loaded })),
      failedMcp: (failed || []).map(f => ({ name: String(f?.name || '?'), error: clipStr(String(f?.error || f?.errorCode || '')) })),
    } : null,
  };
}

// what the model is told before the conversation: the system prompt and tool definitions, when this Claude Code version
// records the request shape in the transcript, the instruction files, newest copy of each, and the listings above
function promptOf(rows) {
  let shape = null; const files = new Map();
  for (const r of rows) {
    if (r.type === 'api-request-shape' && r.shape) shape = r.shape;
    if (r.attachment?.type === 'instructions' && Array.isArray(r.attachment.files))
      for (const f of r.attachment.files) if (f?.path) files.set(f.path, { path: f.path, type: f.type || null, content: clipStr(String(f.content ?? '')) });
  }
  return {
    system: shape && Array.isArray(shape.system) ? clipStr(shape.system.map(b => b?.text || '').join('\n\n')) : null,
    tools: shape && Array.isArray(shape.tools)
      ? shape.tools.map(t => ({ name: t.name || t.type || '?', description: clipStr(String(t.description || '')), schema: t.input_schema || null })) : null,
    instructions: [...files.values()],
    ...listingsOf(rows),
  };
}

// Attachments are of three kinds. Most reach the model as text (a system-reminder or a system message): 'sent'.
// Some are lists the view pins on top (instructions, skills, subagent types, deferred tools, MCP instructions): 'pinned'.
// And some are records Claude Code keeps for itself and never sends: 'meta' (bookkeeping).
const ATT_META = new Set(['prompt_snapshot', 'credential_org', 'deferred_tools_record', 'command_permissions', 'thinking_drop']);
const ATT_PINNED = new Set(['instructions', 'skill_listing', 'agent_listing_delta', 'deferred_tools_delta', 'mcp_instructions_delta']);
const attRole = t => ATT_META.has(t) ? 'meta' : ATT_PINNED.has(t) ? 'pinned' : 'sent';
// Some are stored as data and turned into text when sent; this is a readable form of that data, not the exact wording
// (the "As sent" view has the exact text when the transcript records the request).
const asText = v => typeof v === 'string' ? v : JSON.stringify(v);
const ATT_RENDER = {
  environment: a => Object.entries(a.snapshot || {}).map(([k, v]) => `${k}: ${asText(v)}`).join('\n'),
  session_context: a => Object.entries(a.context || {}).map(([k, v]) => `# ${k}\n${asText(v)}`).join('\n\n'),
  date: a => `Today's date is ${a.date}.`,
  remote_session_change: a => [a.commit && `End git commit messages with:\n${a.commit}`, a.pr && `End pull request descriptions with:\n${a.pr}`].filter(Boolean).join('\n\n'),
  auto_mode: a => `Auto mode is active. Settings: ${JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'type')))}`,
  hook_non_blocking_error: a => `${a.hookName || 'hook'} error: ${a.stderr || a.stdout || ''}`,
  file: a => `Contents of ${a.filename || a.displayPath}:\n\n${asText(a.content?.file?.content ?? a.content ?? '')}`,
  edited_text_file: a => `${a.filename} changed on disk since it was last read${a.snippet ? `:\n\n${a.snippet}` : ''}`,
  compact_file_reference: a => `${a.displayPath || a.filename} was read before the compaction`,
  task_status: a => `Background task ${a.taskId}${a.description ? ` (${a.description})` : ''}: ${a.status}`,
};
function attachmentItem(a, ts) {
  const role = attRole(a.type), render = ATT_RENDER[a.type];
  const t = a.type === 'instructions' && Array.isArray(a.files) ? instructionsText(a.files)
    : render ? render(a) : a.type === 'hook_success' && a.hookName && typeof a.content === 'string' ? `${a.hookName} hook success: ${a.content}`
    : a.content ?? a.prompt ?? a.text;
  return { kind: 'attachment', ts, type: a.type || null, role, rendered: !!render, label: [a.type, a.hookName].filter(Boolean).join(' · '),
    text: clipStr(typeof t === 'string' ? t : JSON.stringify(a, null, 2)) };
}

// The exact messages of the latest API request, when this Claude Code version records them. Each 'api-request' row keeps
// the first `keep` messages of the request before it (same querySource) and adds `tail`, a list of message hashes;
// 'api-request-blob' rows hold messages by hash. Messages the transcript already has (the model's replies and tool
// results) are mostly not stored as blobs: those are rebuilt from the transcript and marked recorded: false.
const blockChars = b => b.type === 'text' || b.type === 'thinking' || b.type === 'tool_result' ? ctxStrLen(b.text) : JSON.stringify(b).length;
const ctxStrLen = s => String(s ?? '').length;
function wireBlock(b) {
  switch (b?.type) {
    case 'text': return { type: 'text', text: clipStr(b.text || '') };
    case 'thinking': return { type: 'thinking', text: clipStr(b.thinking || ''), signature: String(b.signature || '').length };
    case 'redacted_thinking': return { type: 'thinking', text: '', signature: String(b.data || '').length };
    case 'tool_use': return { type: 'tool_use', id: b.id, name: b.name, input: clipDeep(b.input) };
    case 'tool_result': return { type: 'tool_result', id: b.tool_use_id, error: !!b.is_error, text: clipStr(blockText(b.content)) };
    case 'tool_addition': { const d = b.tool?.definition || b.tool || {}; return { type: 'tool_addition', name: d.name || '?', description: clipStr(String(d.description || '')), schema: d.input_schema || null }; }
    case 'image': return { type: 'image' };
    default: return { type: b?.type || '?', text: clipStr(JSON.stringify(b)) };
  }
}
const wireBlocks = m => typeof m.content === 'string' ? [{ type: 'text', text: clipStr(m.content) }] : (Array.isArray(m.content) ? m.content : []).map(wireBlock);
function wireOf(rows) {
  const blobs = new Map(), reqs = [];
  for (const r of rows) {
    if (r.type === 'api-request-blob' && r.hash && r.message) blobs.set(r.hash, r.message);
    else if (r.type === 'api-request' && Array.isArray(r.tail)) reqs.push(r);
  }
  if (!reqs.length) return null;
  const chain = reqs.filter(r => r.querySource === reqs.at(-1).querySource);
  // the model's replies (one per API response, its blocks spread over several rows) and tool results by tool_use id
  const replies = [], byId = new Map(), results = new Map(), prompts = [];
  for (const r of rows) {
    const m = r.message; if (!m || (r.type !== 'user' && r.type !== 'assistant')) continue;
    if (r.type === 'assistant' && m.usage) {
      const k = m.id || r.uuid; let x = byId.get(k);
      if (!x) { x = { role: 'assistant', content: [], ts: r.timestamp || '' }; byId.set(k, x); replies.push(x); }
      if (Array.isArray(m.content)) x.content.push(...m.content);
    } else if (r.type === 'user' && Array.isArray(m.content) && m.content.some(b => b?.type === 'tool_result')) {
      for (const b of m.content) if (b?.type === 'tool_result') results.set(b.tool_use_id, b);
    } else if (r.type === 'user' && !r.isMeta && !r.isCompactSummary) prompts.push({ role: 'user', content: m.content, ts: r.timestamp || '' });
  }
  const promptsUsed = new Set(); // your prompts used so far
  const promptAfter = x => prompts.find(p => !promptsUsed.has(p) && p.ts >= (x?.ts || ''));
  const used = new Set();
  const replyTo = q => replies.find(x => !used.has(x) && x.ts >= (q.timestamp || '')); // the first reply after the request
  const cache = new Map(); let msgs = [], firstChars = null;
  chain.forEach((q, i) => {
    const next = msgs.slice(0, q.keep || 0);
    q.tail.forEach((h, j) => {
      let m = cache.get(h);
      if (!m && blobs.has(h)) m = { ...blobs.get(h), recorded: true };
      if (!m && j === 0 && i > 0) { const x = replyTo(chain[i - 1]); if (x) { used.add(x); m = x; } } // the reply to the request before
      if (!m && next.at(-1)?.role === 'assistant') { // the results of the calls in the message before
        const got = (next.at(-1).content || []).filter(b => b?.type === 'tool_use').map(b => results.get(b.id)).filter(Boolean);
        if (got.length) m = { role: 'user', content: got };
        else { const p = promptAfter(next.at(-1)); if (p) { promptsUsed.add(p); m = p; } } // a reply with no calls: your next prompt
      }
      if (m) cache.set(h, m);
      next.push(m || { role: '?', missing: true, content: [] });
    });
    if (i === 0) firstChars = next.reduce((n, m) => n + wireBlocks(m).reduce((k, b) => k + blockChars(b), 0), 0);
    msgs = next;
  });
  const last = chain.at(-1);
  return {
    ts: last.timestamp || null, requests: chain.length, model: last.params?.model || null,
    edits: (last.params?.context_management?.edits || []).map(e => e?.type || '?'), firstChars,
    messages: msgs.map(m => ({ role: m.role, recorded: !!m.recorded, missing: !!m.missing, blocks: wireBlocks(m) })),
  };
}

// Measured size: the first model step's context (from usage) is everything the model was given up front, so it sets this
// session's characters per token, used for the cards' sizes instead of a flat 4.
function measuredOf(rows, shape, wire) {
  const first = rows.find(r => r.type === 'assistant' && r.message?.usage), u = first?.message.usage;
  if (!u) return null;
  const firstCtx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  let chars = null;
  if (shape) {
    chars = (shape.system || []).reduce((n, b) => n + ctxStrLen(b?.text), 0) + JSON.stringify(shape.tools || []).length;
    if (wire?.firstChars != null) chars += wire.firstChars;
    else for (const r of rows) {
      if (r === first) break;
      if (r.type === 'attachment' && r.attachment && attRole(r.attachment.type) !== 'meta') chars += attachmentItem(r.attachment, null).text.length;
      else if (r.type === 'user' && r.message) chars += ctxStrLen(blockText(r.message.content));
    }
  }
  const cpt = chars && firstCtx ? chars / firstCtx : null;
  return { firstCtx, chars, cpt: cpt && cpt >= 1.5 && cpt <= 8 ? cpt : null };
}

// transcript rows → the items the view shows, in order
function contextItems(rows) {
  const items = [], steps = new Set();
  for (const r of rows) {
    const ts = r.timestamp || null;
    if (r.type === 'system' && r.subtype === 'compact_boundary') {
      items.push({ kind: 'compact', ts, trigger: r.compactMetadata?.trigger || null, preTokens: r.compactMetadata?.preTokens || null });
      continue;
    }
    if (r.type === 'attachment' && r.attachment) { items.push(attachmentItem(r.attachment, ts)); continue; }
    const m = r.message;
    if (!m || (r.type !== 'user' && r.type !== 'assistant')) continue;
    if (r.type === 'user') {
      const kind = r.isCompactSummary ? 'summary' : r.isMeta ? 'meta' : 'user';
      if (typeof m.content === 'string') { items.push({ kind, ts, text: clipStr(m.content) }); continue; }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type === 'tool_result') items.push({ kind: 'result', ts, id: b.tool_use_id, error: !!b.is_error, text: clipStr(blockText(b.content)), agentId: r.toolUseResult?.agentId || null });
        else if (b?.type === 'text') items.push({ kind, ts, text: clipStr(b.text || '') });
        else if (b?.type === 'image') items.push({ kind, ts, text: '[image]' });
      }
      continue;
    }
    // one API response spans several lines (one per content block); its first line marks the model step
    const u = m.usage, key = m.id || r.uuid;
    if (u && key && !steps.has(key)) {
      steps.add(key);
      items.push({ kind: 'step', ts, model: m.model || null, out: u.output_tokens || 0, ctx: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) });
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'text' && b.text?.trim()) items.push({ kind: 'text', ts, text: clipStr(b.text) });
      else if (b?.type === 'thinking' && b.thinking?.trim()) items.push({ kind: 'thinking', ts, text: clipStr(b.thinking) });
      else if (b?.type === 'tool_use') items.push({ kind: 'call', ts, id: b.id, name: b.name, input: clipDeep(b.input) });
    }
  }
  return items;
}

function sessionContext(s) {
  const main = s.transcript_path;
  const rows = main && readRows(main);
  if (!rows) return { error: 'transcript not found', transcript: main || null };
  // subagents: <transcript>/subagents/agent-<id>.jsonl, with agent-<id>.meta.json next to it
  const subagents = {};
  const subDir = path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents');
  let files = []; try { files = fs.readdirSync(subDir).filter(f => /^agent-[\w-]+\.jsonl$/.test(f)); } catch { /* none */ }
  for (const f of files) {
    const id = f.slice(6, -6), sub = readRows(path.join(subDir, f)) || [];
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(subDir, `agent-${id}.meta.json`), 'utf8')); } catch { /* optional */ }
    // a subagent has its own system prompt (a custom agent's is the body of its .md file), tools and instructions
    subagents[id] = { type: meta.agentType || null, description: meta.description || null, toolUseId: meta.toolUseId || null, ...promptOf(sub), items: contextItems(sub) };
  }
  // the first request's shape, to match the first model step it is measured against (later requests carry more tools)
  const wire = wireOf(rows), shape = rows.find(r => r.type === 'api-request-shape' && r.shape)?.shape || null;
  return { session: s.id, transcript: main, model: s.model, context: s.context, window: reportedWindow(rows), ...promptOf(rows), items: contextItems(rows), subagents, wire, measured: measuredOf(rows, shape, wire) };
}

// The context window, from the latest /context report in the transcript ("**Tokens:** 51.9k / 1m (5%)"): the model id
// doesn't always say whether the session has the 1M window.
function reportedWindow(rows) {
  const unit = { k: 1e3, m: 1e6 };
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i].type === 'user' ? rows[i].message?.content : null;
    const m = typeof c === 'string' && c.startsWith('## Context Usage') && /\*\*Tokens:\*\*\s*[\d.]+[km]?\s*\/\s*([\d.]+)([km]?)/i.exec(c);
    if (m) return Math.round(parseFloat(m[1]) * (unit[m[2].toLowerCase()] || 1)) || null;
  }
  return null;
}

// ---------- log tailing ----------
let offset = 0;
let partial = '';
function readNew() {
  let stat;
  try { stat = fs.statSync(LOG_FILE); } catch { return; }
  if (stat.size < offset) { offset = 0; partial = ''; } // file truncated / cleared
  if (stat.size === offset) return;
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = stat.size;
  const lines = (partial + buf.toString('utf8')).split('\n');
  partial = lines.pop();
  const touched = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const s = ingest(ev);
    touched.add(s);
    if (initialLoadDone) broadcast('event', ev);
  }
  if (initialLoadDone) for (const s of touched) broadcast('session', summary(s));
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function allEvents(since) {
  const out = [];
  for (const s of sessions.values()) for (const e of s.events) if (!since || e.ts >= since) out.push(e);
  out.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
  return out.length > MAX_ALL_EVENTS ? out.slice(out.length - MAX_ALL_EVENTS) : out;
}

const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  if (!hostOk(req.headers.host)) return json(res, 403, { error: 'forbidden host' });
  const origin = req.headers.origin;
  if (origin !== undefined && !originOk(origin)) return json(res, 403, { error: 'forbidden origin' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !origin) return json(res, 403, { error: 'origin required' });
  // a fixed base: the Host header is never parsed as part of the URL (a malformed one used to crash the server)
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'bad request' }); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    let html; try { html = fs.readFileSync(DASHBOARD, 'utf8'); } catch { return json(res, 500, { error: 'dashboard missing' }); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': pageCsp(html) });
    return res.end(html);
  }
  // the page's own files. Only a bare file name with a known extension matches, so a request can't leave the folder.
  const asset = /^[/]dashboard[/]([A-Za-z0-9_-]+)([.]css|[.]js)$/.exec(url.pathname);
  if (asset) {
    return fs.readFile(path.join(ASSETS, asset[1] + asset[2]), (err, body) => {
      if (err) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': ASSET_TYPES[asset[2]], 'Cache-Control': 'no-store' });
      res.end(body);
    });
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, port: PORT, log: LOG_FILE, sessions: sessions.size });
  if (url.pathname === '/api/sessions') {
    const list = [...sessions.values()].map(summary).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    return json(res, 200, list);
  }
  if (url.pathname === '/api/events') {
    const id = url.searchParams.get('session');
    const since = url.searchParams.get('since') || null;
    if (id === 'all') return json(res, 200, allEvents(since));
    const s = sessions.get(id);
    if (!s) return json(res, 404, { error: 'unknown session' });
    return json(res, 200, since ? s.events.filter(e => e.ts >= since) : s.events);
  }
  if (url.pathname === '/api/context') {
    const s = sessions.get(url.searchParams.get('session'));
    if (!s) return json(res, 404, { error: 'unknown session' });
    try { return json(res, 200, sessionContext(s)); } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/clear' && req.method === 'POST') {
    try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
    sessions.clear(); seenMsgs.clear(); stepByMsg.clear(); tails.clear(); offset = 0; partial = '';
    broadcast('reset', {});
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
});

let initialLoadDone = false;
// the log holds prompts, file contents and command output: readable by its owner only (no effect on Windows ACLs)
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* ignore */ }
try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* not there yet */ }
readNew();
for (const t of transcriptTimers.values()) clearTimeout(t);
transcriptTimers.clear();
for (const s of sessions.values()) { try { readTranscripts(s); } catch { /* ignore */ } }
initialLoadDone = true;
setInterval(readNew, 400);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);
// live sessions: keep picking up model steps even between hook events
setInterval(() => { for (const s of sessions.values()) if (s.busy && s.transcript_path) scheduleTranscript(s, 0); }, 2000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(err); process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Session Observer → http://${WILDCARD.has(HOST) ? 'localhost' : HOST}:${PORT}`);
  if (!LOOPBACK.has(HOST.toLowerCase())) console.warn(`Warning: listening on ${HOST}. The dashboard has no login, so anyone who can reach this address can read your sessions.`);
});
