#!/usr/bin/env node
// Demo mode: starts the dashboard on its own port with made-up sessions
// (history + one session that keeps working live). Touches nothing in ~/.claude.
//   node scripts/demo.js        → http://localhost:4800
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.DEMO_PORT || 4800);
const DIR = path.join(os.tmpdir(), 'session-observer-demo');
const LOG = path.join(DIR, 'events.jsonl');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const MODEL = 'claude-opus-5-5';
const TOOLS = [
  ['Read', { file_path: 'src/routes/auth.ts' }], ['Grep', { pattern: 'rateLimit' }], ['Glob', { pattern: 'src/**/*.test.ts' }],
  ['Edit', { file_path: 'src/middleware/limiter.ts' }], ['Write', { file_path: 'src/middleware/limiter.test.ts' }],
  ['Bash', { command: 'npm test' }], ['Bash', { command: 'git status' }], ['Bash', { command: 'git diff --stat' }],
  ['Bash', { command: 'node scripts/seed.js' }], ['Bash', { command: 'docker compose up -d redis' }], ['Read', { file_path: 'package.json' }],
  ['WebFetch', { url: 'https://expressjs.com/en/guide/behind-proxies.html' }], ['WebSearch', { query: 'express rate limit redis store' }],
  ['Skill', { skill: 'patterns' }], ['Agent', { subagent_type: 'Explore', description: 'find all route handlers' }],
  ['mcp__claude-in-chrome__navigate', { url: 'http://localhost:3000' }], ['mcp__codebase-memory-mcp__search_graph', { name_pattern: 'Limiter' }],
  ['TodoWrite', { todos: [] }],
];
const pick = a => a[Math.floor(Math.random() * a.length)];
let uid = 0;

function session(id, project) {
  const cwd = `D:/git/${project}`;
  const transcript = path.join(DIR, 'projects', `${id}.jsonl`);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  let ctx = 18000;
  return {
    id, cwd, transcript,
    hook(ts, event, data = {}) {
      fs.appendFileSync(LOG, JSON.stringify({ ts: new Date(ts).toISOString(), event, session_id: id,
        data: { session_id: id, transcript_path: transcript, cwd, hook_event_name: event, ...data } }) + '\n');
    },
    // subagent model step: its own transcript under <session>/subagents/, as Claude Code writes it
    subStep(ts, agentId, tools, stop = 'tool_use') {
      const file = path.join(path.dirname(transcript), id, 'subagents', `agent-${agentId}.jsonl`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ type: 'assistant', isSidechain: true, agentId, timestamp: new Date(ts).toISOString(), uuid: 'u' + (++uid),
        message: { id: 'msg_' + uid, role: 'assistant', model: MODEL, stop_reason: stop,
          usage: { input_tokens: 3, output_tokens: 80 + Math.floor(Math.random() * 400), cache_read_input_tokens: 9000, cache_creation_input_tokens: 800 },
          content: tools.map(name => ({ type: 'tool_use', name })) } }) + '\n');
    },
    step(ts, tools, stop = 'tool_use') {
      ctx += 1500 + Math.floor(Math.random() * 4000);
      fs.appendFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), uuid: 'u' + (++uid),
        message: { id: 'msg_' + uid, role: 'assistant', model: MODEL, stop_reason: stop,
          usage: { input_tokens: 3, output_tokens: 120 + Math.floor(Math.random() * 900), cache_read_input_tokens: ctx - 1200, cache_creation_input_tokens: 1200 },
          content: tools.map(name => ({ type: 'tool_use', name })) } }) + '\n');
    },
  };
}

// one turn as a list of [delayMs, fn(ts)] so it can be written instantly (history) or in real time (live).
// Built on absolute offsets first so parallel subagents can interleave, then turned into delays.
const SUB_TOOLS = [
  ['Grep', { pattern: 'router\\.(get|post)' }], ['Glob', { pattern: 'src/routes/**/*.ts' }], ['Read', { file_path: 'src/routes/users.ts' }],
  ['Read', { file_path: 'src/app.ts' }], ['Bash', { command: 'git log --oneline -5 -- src/routes' }],
];
const SUB_TASKS = ['find all route handlers', 'check how auth middleware is wired', 'list existing tests for routes'];
function turnPlan(s, prompt, n, explore = 0) {
  const ev = []; let t = 0;
  const at = (dt, f) => { t += dt; ev.push([t, f]); };
  at(0, ts => s.hook(ts, 'UserPromptSubmit', { prompt }));
  if (explore) subagents(explore);
  for (let i = 0; i < n; i++) {
    const [tool, input] = pick(TOOLS);
    if (tool === 'Agent') { subagents(Math.random() < 0.4 ? 2 : 1); continue; }
    const id = 'toolu_' + (++uid), fail = Math.random() < 0.08;
    at(900 + Math.random() * 1500, ts => s.step(ts, [tool]));
    at(250, ts => s.hook(ts, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }));
    at(tool === 'Bash' ? 2500 + Math.random() * 5000 : 300 + Math.random() * 1500, ts => fail
      ? s.hook(ts, 'PostToolUseFailure', { tool_name: tool, tool_input: input, tool_use_id: id, error: 'Exit code 1: 2 tests failed' })
      : s.hook(ts, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: 'ok' }));
  }
  // k subagents launched together; each runs its own model steps and tool calls, then hands back
  function subagents(k) {
    at(900 + Math.random() * 1500, ts => s.step(ts, new Array(k).fill('Agent')));
    let end = t;
    for (let j = 0; j < k; j++) {
      const id = 'toolu_' + (++uid), aid = 'a' + Math.random().toString(16).slice(2, 12), task = SUB_TASKS[(uid + j) % SUB_TASKS.length];
      const input = { subagent_type: 'Explore', description: task }, who = { agent_id: aid, agent_type: 'Explore' };
      let tt = t + 150 + j * 120;
      ev.push([tt, ts => s.hook(ts, 'PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: id })]);
      ev.push([tt += 200, ts => s.hook(ts, 'SubagentStart', who)]);
      for (let q = 2 + Math.floor(Math.random() * 3); q > 0; q--) {
        const [st, si] = pick(SUB_TOOLS), tid = 'toolu_' + (++uid);
        ev.push([tt += 700 + Math.random() * 900, ts => s.subStep(ts, aid, [st])]);
        ev.push([tt += 200, ts => s.hook(ts, 'PreToolUse', { tool_name: st, tool_input: si, tool_use_id: tid, ...who })]);
        ev.push([tt += 300 + Math.random() * 900, ts => s.hook(ts, 'PostToolUse', { tool_name: st, tool_input: si, tool_use_id: tid, tool_response: 'ok', ...who })]);
      }
      ev.push([tt += 600, ts => s.subStep(ts, aid, [], 'end_turn')]);
      ev.push([tt += 150, ts => s.hook(ts, 'SubagentStop', { ...who, last_assistant_message: `Done: ${task}.` })]);
      ev.push([tt += 150, ts => s.hook(ts, 'PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: id, tool_response: 'ok' })]);
      end = Math.max(end, tt);
    }
    t = end;
  }
  at(1200, ts => s.step(ts, [], 'end_turn'));
  at(300, ts => s.hook(ts, 'Stop', { last_assistant_message: `Done — ${prompt.toLowerCase()}. Tests pass; changes are in the working tree, not committed.` }));
  ev.sort((x, y) => x[0] - y[0]);
  let prev = 0;
  return ev.map(([x, f]) => { const d = x - prev; prev = x; return [d, f]; });
}
function writeNow(plan, start) { let t = start; for (const [d, f] of plan) { t += d; f(t); } return t; }

// ---------- history ----------
let t = Date.now() - 4 * 3600e3;
const history = [
  ['infra', ['Bump Node to 22 in the CI workflow']],
  ['web-ui', ['Make the header sticky on scroll', 'Add a dark mode toggle that remembers the choice', 'Fix the layout shift on the pricing page']],
  ['api-server', ['Add a login endpoint with JWT', 'The auth tests are flaky, find out why']],
];
const sessions = {};
for (const [project, prompts] of history) {
  const s = sessions[project] = session(`${project}-${Math.random().toString(16).slice(2, 10)}`, project);
  s.hook(t, 'SessionStart', { source: 'startup', model: MODEL, permission_mode: 'default' });
  s.hook(t + 200, 'InstructionsLoaded', { file_path: `${s.cwd}/CLAUDE.md` });
  for (const p of prompts) t = writeNow(turnPlan(s, p, 6 + Math.floor(Math.random() * 14)), t + 60000);
  if (project !== 'api-server') s.hook(t + 5000, 'SessionEnd', { reason: 'exit' });
  t += 20 * 60000;
}

// ---------- server + live session ----------
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  stdio: 'inherit', env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DIR },
});
process.on('SIGINT', () => { server.kill(); process.exit(0); });
process.on('exit', () => server.kill());

const live = sessions['api-server'];
const prompts = ['Add rate limiting to the public API', 'Store the limiter counters in Redis', 'Write tests for the limiter', 'Document the new limits in the README'];
(async () => {
  await new Promise(r => setTimeout(r, 1500));
  console.log(`Demo running → http://localhost:${PORT}  (Ctrl+C to stop)`);
  for (let k = 0; ; k++) {
    for (const [d, f] of turnPlan(live, prompts[k % prompts.length], 5 + Math.floor(Math.random() * 6), k % 2 ? 0 : 2)) {
      await new Promise(r => setTimeout(r, d)); f(Date.now());
    }
    await new Promise(r => setTimeout(r, 6000));
  }
})();
