// End-to-end smoke test: feed hook payloads through scripts/hook.js into a temp
// log, start server/server.js on a free port, and check the HTTP API sees them.
// Zero dependencies — run with `node --test test/smoke.test.js`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hook.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'so-test-'));
const LOG = path.join(DATA_DIR, 'events.jsonl');
let PORT, server, base;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address(); srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const env = () => ({ ...process.env, OBSERVER_DATA_DIR: DATA_DIR, OBSERVER_PORT: String(PORT), OBSERVER_AUTOSTART: '0' });

function runHook(eventName, payload, extraEnv = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [HOOK, eventName], { input, env: { ...env(), ...extraEnv }, timeout: 10000 });
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw last || new Error('timed out');
}

const get = async p => { const r = await fetch(base + p); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; };
const getJson = async p => JSON.parse((await get(p)).body);
const readLog = () => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

before(async () => {
  PORT = await freePort();
  base = `http://127.0.0.1:${PORT}`;
  server = spawn(process.execPath, [SERVER], { env: env(), stdio: 'ignore' });
  await waitFor(async () => (await getJson('/api/health')).ok);
});

after(() => {
  if (server) server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('hook appends one JSON line per event', () => {
  const r = runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'sess-1', cwd: '/tmp/proj', source: 'startup' });
  assert.equal(r.status, 0);
  const evs = readLog();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].event, 'SessionStart');
  assert.equal(evs[0].session_id, 'sess-1');
  assert.ok(!Number.isNaN(Date.parse(evs[0].ts)));
});

test('hook never fails on bad input', () => {
  const r = runHook('Notification', 'this is not json');
  assert.equal(r.status, 0);
  const last = readLog().at(-1);
  assert.equal(last.event, 'Notification');
  assert.equal(last.session_id, 'unknown');
  assert.equal(last.data.raw, 'this is not json');
});

test('hook truncates long strings', () => {
  runHook('PostToolUse', { hook_event_name: 'PostToolUse', session_id: 'sess-1', tool_name: 'Read', tool_response: 'x'.repeat(500) }, { OBSERVER_MAX_FIELD: '50' });
  const last = readLog().at(-1);
  assert.ok(last.data.tool_response.length < 100, 'long field should be cut');
  assert.match(last.data.tool_response, /\[\+450 chars\]$/);
});

test('server ingests hook events and serves the API', async () => {
  runHook('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', session_id: 'sess-1', prompt: 'hello' });
  runHook('PreToolUse', { hook_event_name: 'PreToolUse', session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' });
  runHook('PostToolUse', { hook_event_name: 'PostToolUse', session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1', tool_response: 'ok' });

  const sess = await waitFor(async () => {
    const list = await getJson('/api/sessions');
    const s = list.find(x => x.id === 'sess-1');
    return s && s.eventCount >= 5 ? s : null;
  });
  assert.equal(sess.cwd, '/tmp/proj');

  const events = await getJson('/api/events?session=sess-1');
  assert.ok(Array.isArray(events));
  assert.ok(events.some(e => e.event === 'UserPromptSubmit'));
  assert.ok(Array.isArray(await getJson('/api/events?session=all')));
  assert.equal((await get('/api/events?session=nope')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
});

test('dashboard HTML is served', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /<html/i);
});

test('every stylesheet and script the dashboard asks for is served', async () => {
  const html = (await get('/')).body;
  const refs = [...html.matchAll(/<(?:script[^>]*[ ]src|link[^>]*[ ]href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length > 1, 'the dashboard should load its files from dashboard/');
  for (const ref of refs) {
    const r = await get('/' + ref);
    assert.equal(r.status, 200, ref);
    assert.match(r.type, ref.endsWith('.css') ? /text[/]css/ : /javascript/, ref);
    assert.ok(r.body.length > 0, ref);
  }
});

test('nothing else is served from the dashboard folder', async () => {
  for (const p of ['/dashboard/nope.js', '/dashboard/', '/dashboard/..%2Fserver.js', '/dashboard/%2e%2e/server.js', '/dashboard/sub/core.js', '/dashboard/core.js.map', '/server.js']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('clear wipes the log and sessions', async () => {
  const r = await fetch(base + '/api/clear', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(LOG, 'utf8'), '');
  assert.deepEqual(await getJson('/api/sessions'), []);
});
