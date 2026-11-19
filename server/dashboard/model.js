'use strict';
// Session Observer dashboard — what the events mean: tool groups and labels, filters, turns, and the replayable activity state.
// a tool event's languages / tools (worked out once per event), and the first of them
const evTechs = ev => ev._tk !== undefined ? ev._tk : (ev._tk = ev.event === 'PreToolUse' || ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure' ? techsOf(ev.data?.tool_name, ev.data?.tool_input) : []);
const evTech = ev => evTechs(ev)[0] || null;
// the icons for a tool call: its language / tool badges when there are any, otherwise its group's icon
const evIcon = (ev, st, max) => techIcons(evTechs(ev), max) || icon(st);
const toolIcon = (tool, ti, st) => techIcons(techsOf(tool, ti)) || icon(st);

function toolStation(tool, ti) {
  if (!tool) return 'other';
  if (SHELL_TOOLS.has(tool)) return /^\s*(git|gh)\b/.test((ti && ti.command) || '') ? 'git' : 'shell';
  if (FILE_TOOLS.has(tool)) return 'files';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'network';
  if (tool === 'Skill') return 'skills';
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') return 'agents';
  if (tool === 'AskUserQuestion') return 'you';
  if (tool.startsWith('mcp__')) return /chrome|browser|playwright|puppeteer/i.test(tool) ? 'browser' : 'mcp';
  return 'other';
}
function stationOf(ev) {
  if (ev._st !== undefined) return ev._st;
  const d = ev.data || {};
  let s = null;
  switch (ev.event) {
    case 'ModelStep': case 'ModelText': s = 'model'; break;
    case 'UserPromptSubmit': case 'UserPromptExpansion': case 'Elicitation': case 'ElicitationResult':
    case 'PermissionRequest': case 'PermissionDenied': s = 'you'; break;
    case 'PreToolUse': case 'PostToolUse': case 'PostToolUseFailure': s = toolStation(d.tool_name, d.tool_input); break;
    case 'SubagentStart': case 'SubagentStop': case 'TeammateIdle': s = 'agents'; break;
    case 'InstructionsLoaded': case 'PreCompact': case 'PostCompact': s = 'context'; break;
    case 'TaskCreated': case 'TaskCompleted': s = 'other'; break;
    case 'FileChanged': case 'DirectoryAdded': case 'WorktreeCreate': case 'WorktreeRemove': s = 'files'; break;
    case 'PreModelSwitch': case 'PostModelSwitch': s = 'model'; break;
    case 'ConfigChange': case 'CwdChanged': case 'Setup': s = 'context'; break;
  }
  return (ev._st = s);
}
// a model step that only announces tool calls: the tool rows that follow already show them
const isToolStep = ev => ev.event === 'ModelStep' && (ev.data?.tools?.length || 0) > 0;
const isProblem = ev => ev.category === 'error' || ev.event === 'PermissionDenied';

function toolArg(d) {
  const ti = d.tool_input || {}, tool = d.tool_name;
  if (tool === 'Skill') return ti.skill || ti.name;
  if (tool === 'AskUserQuestion') return (ti.questions || []).map(q => q.question).join(' | ');
  if (tool === 'Agent' || tool === 'Task') return [ti.subagent_type, ti.description].filter(Boolean).join(' — ');
  if (/^(WebFetch)$/.test(tool) && ti.url) { try { return new URL(ti.url).host + new URL(ti.url).pathname; } catch { return ti.url; } }
  return ti.command || ti.file_path || ti.notebook_path || ti.path || ti.pattern || ti.url || ti.query || ti.description || ti.subject || ti.prompt || Object.values(ti).find(v => typeof v === 'string') || (Object.keys(ti).length ? JSON.stringify(ti) : '');
}
function toolLabel(tool) {
  if (!tool) return '?';
  if (tool.startsWith('mcp__')) { const p = tool.split('__'); return p.slice(2).join('__') || p[1]; }
  return tool;
}
// [short label, detail text]
function describe(ev) {
  const d = ev.data || {}, tool = d.tool_name, X = TX.ev;
  switch (ev.event) {
    case 'ModelStep': return [d.subagent ? TX.subagent : TX.st.model, d.tools && d.tools.length ? X.calls(d.tools.map(toolLabel).join(', ')) : `${d.stop_reason === 'end_turn' ? X.replied : X.thought}${d.tokens?.output ? ' · ' + TX.outTokens(fmtN(d.tokens.output)) : ''}`];
    case 'ModelText': return [d.subagent ? TX.subagent : TX.st.model, (d.kind === 'thinking' ? X.thinking + ': ' : '') + d.text];
    case 'UserPromptSubmit': return [TX.st.you, d.prompt];
    case 'UserPromptExpansion': return [X.expanded, d.prompt || d.expanded_prompt];
    case 'PreToolUse': case 'PostToolUse': {
      let extra = toolArg(d);
      if (ev.event === 'PostToolUse' && tool === 'AskUserQuestion') { const r = d.tool_response; extra = X.answered + ': ' + short(typeof r === 'string' ? r : JSON.stringify(r?.answers ?? r), 200); }
      return [toolLabel(tool), extra];
    }
    case 'PostToolUseFailure': return [toolLabel(tool), `${X.failed}: ${short(d.error || d.tool_response?.error || toolArg(d), 200)}`];
    case 'PermissionRequest': return [X.permission, `${X.asked} · ${tool || ''} ${short(toolArg(d), 120)}`];
    case 'PermissionDenied': return [X.denied, `${tool || ''} ${d.reason || ''}`];
    case 'Notification': return [TX.cat.notification, d.message || d.notification_type];
    case 'MessageDisplay': return [X.message, d.message || d.text];
    case 'Stop': return [X.turn, d.last_assistant_message || X.done];
    case 'StopFailure': return [X.turnFailed, d.error || d.reason];
    case 'SubagentStart': return [TX.subagent, `${X.started} ${d.agent_type || d.agent_id || ''}`];
    case 'SubagentStop': return [TX.subagent, `${X.finished} ${[d.agent_type, short(d.last_assistant_message, 120)].filter(Boolean).join(' — ')}`];
    case 'TaskCreated': return [TX.cat.task, X.created + ' ' + (d.subject || d.task?.subject || d.description || '')];
    case 'TaskCompleted': return [TX.cat.task, X.completed + ' ' + (d.subject || d.task?.subject || '')];
    case 'SessionStart': return [X.session, [X.started, d.source, d.model?.id || d.model].filter(Boolean).join(' · ')];
    case 'SessionEnd': return [X.session, X.ended + ' ' + (d.reason || '')];
    case 'PreCompact': return [TX.cat.compact, X.compacting + ' · ' + (d.trigger || '')];
    case 'PostCompact': return [TX.cat.compact, X.compacted + ' · ' + (d.trigger || '')];
    case 'InstructionsLoaded': return [X.memory, d.file_path || d.path || (d.files || []).join(', ')];
    case 'Elicitation': return [X.mcpAsks, d.message || d.server_name];
    case 'ElicitationResult': return [TX.st.you, X.answeredMcp + ': ' + (d.action || JSON.stringify(d.content || ''))];
    case 'PreModelSwitch': case 'PostModelSwitch': return [ev.event === 'PreModelSwitch' ? X.modelSwitch : X.modelSwitched, `${d.from_model || '?'} → ${d.to_model || '?'}${d.source ? ' · ' + d.source : ''}`];
    case 'CwdChanged': return ['cwd', d.old_cwd || d.new_cwd ? `${d.old_cwd || '?'} → ${d.new_cwd || '?'}` : d.cwd];
    case 'FileChanged': return [X.file, `${d.event || X.changed} ${d.file_path || d.path || ''}`];
    case 'ConfigChange': return [X.config, `${X.changed} ${spaced(d.source || 'settings')}${d.file_path ? ' · ' + d.file_path : ''}`];
    case 'DirectoryAdded': return [X.directory, `${X.added} ${d.directory || ''}${d.source ? ` · ${X.via} ` + spaced(d.source) : ''}`];
    case 'WorktreeCreate': return [X.worktree, X.created + ' ' + (d.name || '')];
    case 'WorktreeRemove': return [X.worktree, X.removed + ' ' + (d.worktree_path || '')];
    case 'Setup': return [X.setup, d.trigger || ''];
    case 'TeammateIdle': return [X.teammate, `${X.idle} ${[d.teammate_name, d.team_name && `(${d.team_name})`].filter(Boolean).join(' ')}`];
    default: return [ev.event, ''];
  }
}

// ---------------------------------------------------------------- state
const state = {
  sessions: new Map(), events: [], scope: 'all', turnSel: null, evOpen: new Set(),
  range: Number(ls.get('so.range', 86400000)), q: '', station: '', category: '', problems: false,
  cursor: null, playing: false, speed: Number(ls.get('so.speed', 5)), replayIdx: 0, lastTick: 0,
  paused: false, buffer: [], theme: ls.get('so.theme', 'auto'), connected: false, updated: null,
  layout: 'overview',
};
let TURNS = [], TURN_BY_SEQ = new Map();

function cutoffIso() { return state.range ? new Date(Date.now() - state.range).toISOString() : null; }
function evMatches(ev) {
  if (state.station && stationOf(ev) !== state.station) return false;
  if (state.category && ev.category !== state.category) return false;
  if (state.problems && !isProblem(ev)) return false;
  if (state.q) { const h = ev._hay ?? (ev._hay = (ev.event + ' ' + JSON.stringify(ev.data)).toLowerCase()); if (!h.includes(state.q)) return false; }
  return true;
}
const filtersActive = () => !!(state.station || state.category || state.problems || state.q);

// ---------------------------------------------------------------- turns
const BETWEEN_TURNS = new Set(['PreModelSwitch', 'PostModelSwitch', 'ConfigChange', 'DirectoryAdded', 'CwdChanged', 'InstructionsLoaded',
  'WorktreeCreate', 'WorktreeRemove', 'SessionStart', 'PreCompact', 'PostCompact']);
function computeTurns(evs) {
  const cur = new Map(), turns = [], owner = new Map();
  TURN_BY_SEQ = new Map();
  for (const ev of evs) {
    let t = cur.get(ev.session_id);
    // a subagent's events stay with the turn that started it, even after a later prompt (a background
    // subagent's hand-back arrives as a new prompt) — so its branch can still merge back on the route
    const aid = ev.data?.agent_id != null ? ev.session_id + '/' + ev.data.agent_id : null;
    const prelude = x => x && x.prompt === null && !x.tools && !x.steps;
    // a slash command / skill fires UserPromptExpansion just before its UserPromptSubmit: the expansion opens
    // the turn and the prompt joins it (unless the prompt came first and this turn has only just started)
    const expandsNext = ev.event === 'UserPromptExpansion' && !(t && t.prompt !== null && !t.tools && !t.steps && tms(ev) - Date.parse(t.start) < 2000);
    if (aid && ev.event !== 'SubagentStart' && owner.has(aid)) t = owner.get(aid);
    else if (ev.event === 'UserPromptSubmit' && t?.pending) { t.pending = false; t.prompt = String(ev.data?.prompt ?? ''); }
    // things you do between turns (/model, /add-dir, settings edits, /clear or /compact…) belong to the turn
    // they lead into: once a turn has finished, they open a prelude that the next prompt's turn takes over
    else if (ev.event === 'UserPromptSubmit' || expandsNext || !t || (t.done && BETWEEN_TURNS.has(ev.event) && !prelude(t))) {
      const isPrompt = ev.event === 'UserPromptSubmit' || expandsNext;
      const nt = { key: ev.session_id + ':' + ev.seq, sid: ev.session_id, start: ev.ts, end: ev.ts, prompt: ev.event === 'UserPromptSubmit' ? String(ev.data?.prompt ?? '') : expandsNext ? String(ev.data?.prompt ?? '') : null,
        pending: expandsNext, events: [], tools: 0, steps: 0, errors: 0, stations: {}, answer: null, done: false, failed: false, out: 0, toolMs: 0 };
      // what happened before the first prompt (SessionStart, Setup, instructions loaded…) joins that prompt's turn
      if (isPrompt && prelude(t)) { nt.events = t.events; t.events = []; for (const x of nt.events) TURN_BY_SEQ.set(x.seq, nt); }
      t = nt; cur.set(ev.session_id, t); turns.push(t);
    }
    t.events.push(ev); t.end = ev.ts; TURN_BY_SEQ.set(ev.seq, t);
    const st = stationOf(ev), d = ev.data || {};
    if (ev.event === 'PreToolUse') { t.tools++; t.stations[st] = (t.stations[st] || 0) + 1; }
    else if (ev.event === 'ModelStep') { t.steps++; t.out += d.tokens?.output || 0; }
    else if (ev.event === 'SubagentStart') { t.stations.agents = (t.stations.agents || 0) + 1; if (aid) owner.set(aid, t); }
    if (ev.duration_ms) t.toolMs += ev.duration_ms;
    if (isProblem(ev)) t.errors++;
    if (ev.event === 'Stop') { t.done = true; t.answer = d.last_assistant_message || t.answer; }
    if (ev.event === 'StopFailure') { t.done = true; t.failed = true; }
    if (ev.event === 'SessionEnd') t.done = true;
  }
  // hide prelude "turns" with nothing in them (a session that started but got no prompt yet, or whose
  // prelude moved into its first prompt's turn)
  return turns.filter(t => t.prompt !== null || t.tools || t.steps);
}
function turnMatches(t) {
  if (!filtersActive()) return true;
  if (state.q && !state.station && !state.category && !state.problems && ((t.prompt || '') + ' ' + (t.answer || '')).toLowerCase().includes(state.q)) return true;
  return t.events.some(evMatches);
}
function turnRunning(t) {
  const s = state.sessions.get(t.sid);
  if (t.done || !s || s.ended || !s.busy) return false;
  const last = [...TURNS].reverse().find(x => x.sid === t.sid);
  return last === t;
}

// ---------------------------------------------------------------- stage state
// Running totals for the Route / Board views, rebuilt up to the replay cursor.
function newMap() { return { counts: {}, running: new Map(), agents: new Map(), ctx: null, lastModel: null, lastModelTs: null, busy: new Set(), steps: 0, tools: 0, turns: 0, events: 0, errors: 0 }; }
let M = newMap();
const simNow = () => state.cursor ?? Date.now();
function bump(st) { M.counts[st] = (M.counts[st] || 0) + 1; }

function applyEvent(ev) {
  const t = tms(ev), d = ev.data || {}, st = stationOf(ev), key = d.tool_use_id;
  M.events++;
  switch (ev.event) {
    case 'PreToolUse':
      bump(st); M.tools++;
      if (key) M.running.set(key, { st, start: t, sid: ev.session_id });
      M.busy.add(ev.session_id);
      break;
    case 'PostToolUse': case 'PostToolUseFailure':
      if (key) M.running.delete(key);
      if (ev.event === 'PostToolUseFailure') M.errors++;
      break;
    case 'ModelStep':
      bump('model'); M.steps++; M.lastModel = d.model; M.lastModelTs = t;
      if (!d.subagent && d.tokens) M.ctx = d.tokens.context;
      break;
    case 'UserPromptSubmit': bump('you'); M.turns++; M.busy.add(ev.session_id); break;
    case 'Stop': case 'StopFailure': case 'SessionEnd':
      for (const [k, r] of M.running) if (r.sid === ev.session_id) M.running.delete(k);
      for (const [k, a] of M.agents) if (a.sid === ev.session_id) M.agents.delete(k);
      M.busy.delete(ev.session_id);
      if (ev.event === 'StopFailure') M.errors++;
      break;
    case 'SubagentStart': bump('agents'); M.agents.set(d.agent_id || ev.seq, { sid: ev.session_id, start: t }); break;
    case 'SubagentStop': M.agents.delete(d.agent_id); break;
    case 'PermissionRequest': case 'Elicitation': bump('you'); break;
    case 'PermissionDenied': bump('you'); M.errors++; break;
    case 'InstructionsLoaded': case 'PreCompact': case 'PostCompact': bump('context'); break;
    case 'TaskCreated': case 'TaskCompleted': bump('other'); break;
  }
  mapDirty = true;
}

function rebuildMap() {
  M = newMap();
  const lim = state.cursor ?? Infinity;
  let i = 0;
  for (; i < state.events.length; i++) { const ev = state.events[i]; if (tms(ev) > lim) break; applyEvent(ev); }
  state.replayIdx = i;
  mapDirty = true;
}

let mapDirty = true;
function markStage() { altDirty = true; }
