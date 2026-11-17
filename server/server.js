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

// transcript rows → the items the view shows, in order
function contextItems(rows) {
  const items = [], steps = new Set();
  for (const r of rows) {
    const ts = r.timestamp || null;
    if (r.type === 'system' && r.subtype === 'compact_boundary') {
      items.push({ kind: 'compact', ts, trigger: r.compactMetadata?.trigger || null, preTokens: r.compactMetadata?.preTokens || null });
      continue;
    }
    if (r.type === 'attachment' && r.attachment) {
      const a = r.attachment, t = a.content ?? a.prompt ?? a.text;
      items.push({ kind: 'attachment', ts, label: [a.type, a.hookName].filter(Boolean).join(' · '), text: clipStr(typeof t === 'string' ? t : JSON.stringify(a, null, 2)) });
      continue;
    }
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
  // the system prompt and tool definitions, when this Claude Code version records the request shape in the transcript
  let shape = null;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].type === 'api-request-shape' && rows[i].shape) { shape = rows[i].shape; break; }
  const system = shape && Array.isArray(shape.system) ? clipStr(shape.system.map(b => b?.text || '').join('\n\n')) : null;
  const tools = shape && Array.isArray(shape.tools)
    ? shape.tools.map(t => ({ name: t.name || t.type || '?', description: clipStr(String(t.description || '')), schema: t.input_schema || null })) : null;
  // subagents: <transcript>/subagents/agent-<id>.jsonl, with agent-<id>.meta.json next to it
  const subagents = {};
  const subDir = path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents');
  let files = []; try { files = fs.readdirSync(subDir).filter(f => /^agent-[\w-]+\.jsonl$/.test(f)); } catch { /* none */ }
  for (const f of files) {
    const id = f.slice(6, -6), sub = readRows(path.join(subDir, f)) || [];
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(subDir, `agent-${id}.meta.json`), 'utf8')); } catch { /* optional */ }
    subagents[id] = { type: meta.agentType || null, description: meta.description || null, toolUseId: meta.toolUseId || null, items: contextItems(sub) };
  }
  return { session: s.id, transcript: main, model: s.model, context: s.context, system, tools, items: contextItems(rows), subagents };
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(DASHBOARD).pipe(res);
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
fs.mkdirSync(DATA_DIR, { recursive: true });
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
server.listen(PORT, HOST, () => console.log(`Session Observer → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
