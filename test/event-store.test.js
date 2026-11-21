'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventStore } = require('../server/lib/building-blocks/event-store');
const { FileTail } = require('../server/lib/building-blocks/file-tail');
const { migrateLegacyLog, sessionLogPath } = require('../server/lib/building-blocks/session-logs');

test('SQLite indexes events by session and time, ignores replayed log offsets, and clears', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-store-'));
  const file = path.join(dir, 'events.sqlite');
  const store = new EventStore(file);
  const first = { ts: '2026-01-01T00:00:00.000Z', seq: 1, session_id: 'a', event: 'Start', agent: 'codex', data: {} };
  const second = { ts: '2026-01-01T00:00:01.000Z', seq: 2, session_id: 'b', event: 'Prompt', agent: 'claude', data: {} };
  try {
    store.add(first, 'f1', 0);
    store.add(second, 'f2', 100);
    store.add(first, 'f1', 0);
    assert.deepEqual(store.forSession('a').map(event => event.event), ['Start']);
    const step = { ...first, seq: 3, event: 'ModelStep', synthetic: true, data: { msg_id: 'm1', tools: [] } };
    store.addSynthetic(step);
    store.addSynthetic({ ...step, data: { ...step.data, tools: ['Bash'] } });
    assert.deepEqual(store.forSession('a').map(event => event.event), ['Start', 'ModelStep']);
    assert.deepEqual(store.forSession('a').at(-1).data.tools, ['Bash']);
    assert.deepEqual(store.all().map(event => event.session_id), ['a', 'a', 'b']);
    assert.deepEqual(store.all('2026-01-01T00:00:01.000Z').map(event => event.session_id), ['b']);
    store.clear();
    assert.deepEqual(store.all(), []);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy combined log migrates once into session files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-migrate-'));
  const legacyFile = path.join(dir, 'events.jsonl');
  const sessionDirectory = path.join(dir, 'sessions');
  const markerFile = path.join(dir, '.migrated');
  const events = [
    { ts: '2026-01-01T00:00:00.000Z', session_id: 'a', event: 'Start' },
    { ts: '2026-01-01T00:00:01.000Z', session_id: 'b', event: 'Prompt' },
    { ts: '2026-01-01T00:00:02.000Z', session_id: 'a', event: 'Stop' },
  ];
  try {
    fs.writeFileSync(legacyFile, events.map(event => JSON.stringify(event)).join('\n') + '\n');
    assert.equal(migrateLegacyLog({ legacyFile, sessionDirectory, markerFile }), true);
    assert.deepEqual(fs.readFileSync(sessionLogPath(sessionDirectory, 'a'), 'utf8').trim().split('\n').map(JSON.parse).map(event => event.event), ['Start', 'Stop']);
    assert.deepEqual(fs.readFileSync(sessionLogPath(sessionDirectory, 'b'), 'utf8').trim().split('\n').map(JSON.parse).map(event => event.event), ['Prompt']);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), '');
    assert.equal(migrateLegacyLog({ legacyFile, sessionDirectory, markerFile }), false);
    assert.equal(fs.readFileSync(sessionLogPath(sessionDirectory, 'a'), 'utf8').trim().split('\n').length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file tail reports stable byte offsets for complete lines across partial writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-tail-'));
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
