'use strict';
// The day-folder event log: the import from the former combined log, deleted sessions, the loaded window of days.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { FileTail } = require('../server/lib/building-blocks/file-tail');
const {
  MIGRATED_FIELD, sessionLogPath, addDays, today, filesOfSession, migrateLegacyLog, readDeletedSessions, recordDeletedSession,
} = require('../server/lib/building-blocks/session-logs');

const SERVER = path.join(__dirname, '..', 'server', 'server.js');
const tempDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const lines = file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const writeEvents = (file, events) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, events.map(event => JSON.stringify(event) + '\n').join(''));
};
const at = (day, time = '10:00:00') => `${day}T${time}.000Z`;

test('the import sorts the combined log into day folders per session, then removes it', () => {
  const dir = tempDir('so-migrate-');
  const legacyFile = path.join(dir, 'events.jsonl');
  const sessionDirectory = path.join(dir, 'sessions');
  try {
    writeEvents(legacyFile, [
      { ts: at('2026-01-01'), session_id: 'a', event: 'SessionStart' },
      { ts: at('2026-01-01'), session_id: 'b', event: 'UserPromptSubmit' },
      { ts: at('2026-01-02'), session_id: 'a', event: 'Stop' },
    ]);
    assert.equal(migrateLegacyLog({ legacyFile, sessionDirectory }), 3);
    assert.equal(fs.existsSync(legacyFile), false);
    assert.deepEqual(filesOfSession(sessionDirectory, 'a').map(file => path.basename(path.dirname(file))), ['2026-01-01', '2026-01-02']);
    assert.deepEqual(lines(sessionLogPath(sessionDirectory, 'a', at('2026-01-01'))).map(event => event.event), ['SessionStart']);
    assert.deepEqual(lines(sessionLogPath(sessionDirectory, 'b', at('2026-01-01'))).map(event => event.event), ['UserPromptSubmit']);
    assert.equal(migrateLegacyLog({ legacyFile, sessionDirectory }), 0, 'nothing is left to import');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an interrupted import resumes without copying a line twice', () => {
  const dir = tempDir('so-resume-');
  const sessionDirectory = path.join(dir, 'sessions');
  const leftOver = path.join(dir, 'events.1700000000000.migrating');
  try {
    const first = { ts: at('2026-01-01'), session_id: 'a', event: 'SessionStart' };
    writeEvents(leftOver, [first, { ts: at('2026-01-01', '10:00:01'), session_id: 'a', event: 'Stop' }]);
    // the first line was copied before the import stopped
    writeEvents(sessionLogPath(sessionDirectory, 'a', first.ts), [{ ...first, [MIGRATED_FIELD]: 'events.1700000000000.migrating:0' }]);
    assert.equal(migrateLegacyLog({ legacyFile: path.join(dir, 'events.jsonl'), sessionDirectory }), 1);
    assert.deepEqual(lines(sessionLogPath(sessionDirectory, 'a', first.ts)).map(event => event.event), ['SessionStart', 'Stop']);
    assert.equal(fs.existsSync(leftOver), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the import skips what a deleted session wrote before it was deleted, and keeps what came later', () => {
  const dir = tempDir('so-deleted-');
  const legacyFile = path.join(dir, 'events.jsonl');
  const sessionDirectory = path.join(dir, 'sessions');
  const deletedFile = path.join(dir, 'deleted-sessions.jsonl');
  try {
    recordDeletedSession(deletedFile, new Map(), 'gone', at('2026-01-01', '12:00:00'));
    writeEvents(legacyFile, [
      { ts: at('2026-01-01', '11:00:00'), session_id: 'gone', event: 'UserPromptSubmit' },
      { ts: at('2026-01-01', '13:00:00'), session_id: 'gone', event: 'UserPromptSubmit' },
    ]);
    const deleted = readDeletedSessions(deletedFile);
    assert.equal(migrateLegacyLog({ legacyFile, sessionDirectory, deleted }), 1);
    assert.deepEqual(lines(sessionLogPath(sessionDirectory, 'gone', at('2026-01-01'))).map(event => event.ts), [at('2026-01-01', '13:00:00')]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file tail reports stable byte offsets for complete lines across partial writes', () => {
  const dir = tempDir('so-tail-');
  const file = path.join(dir, 'events.jsonl');
  const tail = new FileTail(file);
  try {
    fs.writeFileSync(file, '{"text":"café"}');
    assert.deepEqual(tail.readNewRecords(), []);
    fs.appendFileSync(file, '\n{"next":true}\n');
    assert.deepEqual(tail.readNewRecords(), [
      { line: '{"text":"café"}', offset: 0 },
      { line: '{"next":true}', offset: Buffer.byteLength('{"text":"café"}\n') },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the server ----------
function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

async function waitFor(check, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const value = await check(); if (value) return value; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function startServer(dataDir, env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, OBSERVER_DATA_DIR: dataDir, OBSERVER_PORT: String(port), ...env }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitFor(async () => (await fetch(base + '/api/health')).ok);
  const stop = async () => {
    if (proc.exitCode != null) return;
    const stopped = new Promise(resolve => proc.once('exit', resolve));
    proc.kill();
    await stopped;
  };
  const getJson = async route => (await fetch(base + route)).json();
  const sessionIds = async () => (await getJson('/api/sessions')).map(session => session.id).sort();
  return { proc, base, stop, getJson, sessionIds };
}

test('the server loads recent days at start, a recent session whole, and older days when asked', async () => {
  const dataDir = tempDir('so-window-');
  const sessionDirectory = path.join(dataDir, 'sessions');
  const day = offset => addDays(today(), offset);
  // old: only 10 days ago; long: 10 days ago and today; recent: today
  writeEvents(sessionLogPath(sessionDirectory, 'old', at(day(-10))), [{ ts: at(day(-10)), event: 'SessionStart', session_id: 'old', data: {} }]);
  writeEvents(sessionLogPath(sessionDirectory, 'long', at(day(-10))), [{ ts: at(day(-10)), event: 'SessionStart', session_id: 'long', data: {} }]);
  writeEvents(sessionLogPath(sessionDirectory, 'long', at(day(0))), [{ ts: at(day(0), '00:00:01'), event: 'UserPromptSubmit', session_id: 'long', data: { prompt: 'hi' } }]);
  writeEvents(sessionLogPath(sessionDirectory, 'recent', at(day(0))), [{ ts: at(day(0), '00:00:02'), event: 'SessionStart', session_id: 'recent', data: {} }]);
  const server = await startServer(dataDir, { OBSERVER_LOAD_DAYS: '3' });
  try {
    assert.deepEqual(await server.sessionIds(), ['long', 'recent']);
    assert.deepEqual((await server.getJson('/api/events?session=long')).map(event => event.event), ['SessionStart', 'UserPromptSubmit']);
    assert.deepEqual(await server.getJson('/api/history'), { loadedFrom: day(-2), olderDays: 1, loadDays: 3 });

    const response = await fetch(server.base + '/api/history/older', { method: 'POST', headers: { Origin: server.base } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { loadedFrom: day(-10), olderDays: 0, loadDays: 3 });
    assert.deepEqual(await server.sessionIds(), ['long', 'old', 'recent']);
    assert.equal((await server.getJson('/api/events?session=long')).length, 2, 'the long session is not read twice');
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a session deleted while an older hook writes the combined log stays deleted after a restart', async () => {
  const dataDir = tempDir('so-legacy-delete-');
  let server = await startServer(dataDir);
  try {
    writeEvents(path.join(dataDir, 'events.jsonl'), [{ ts: new Date().toISOString(), event: 'SessionStart', session_id: 'old-hook', data: {} }]);
    await waitFor(async () => (await server.sessionIds()).includes('old-hook'));
    const response = await fetch(server.base + '/api/sessions/old-hook', { method: 'DELETE', headers: { Origin: server.base } });
    assert.equal(response.status, 200);
    await server.stop();
    server = await startServer(dataDir);
    assert.deepEqual(await server.sessionIds(), []);
    assert.equal(fs.existsSync(path.join(dataDir, 'events.jsonl')), false, 'the combined log was imported');
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the server keeps running when the sessions folder disappears', async () => {
  const dataDir = tempDir('so-missing-');
  const server = await startServer(dataDir);
  try {
    fs.rmSync(path.join(dataDir, 'sessions'), { recursive: true, force: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(server.proc.exitCode, null);
    assert.ok((await fetch(server.base + '/api/health')).ok);
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
