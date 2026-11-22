// Agent sessions started by other agent sessions: the hook reads the parents from the environment, the server resolves
// the direct parent and the tool call that started it. Run with `node --test test/session-links.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parentSessions } = require('../scripts/hook');
const { ingest, sessionSummary } = require('../server/lib/features/sessions/sessions');

let clock = Date.parse('2026-11-22T10:00:00Z');
const nextTs = () => new Date((clock += 1000)).toISOString();
const send = (sessionId, agent, eventName, data = {}, parents) =>
  ingest({ ts: nextTs(), event: eventName, session_id: sessionId, agent, data: { hook_event_name: eventName, ...data }, ...(parents ? { parents } : {}) });

test('the hook names the parents its environment shows, never its own session', () => {
  assert.deepEqual(parentSessions('own', {}), []);
  assert.deepEqual(parentSessions('own', { CLAUDE_CODE_SESSION_ID: 'own' }), []);
  assert.deepEqual(parentSessions('child', { CLAUDE_CODE_SESSION_ID: 'claude-1' }), [{ agent: 'claude', session_id: 'claude-1' }]);
  assert.deepEqual(parentSessions('child', { CODEX_SESSION_ID: 'codex-1', CODEX_TOOL_CALL_ID: 'exec-9', CLAUDE_CODE_SESSION_ID: 'claude-1' }), [
    { agent: 'codex', session_id: 'codex-1', tool_call_id: 'exec-9' },
    { agent: 'claude', session_id: 'claude-1' },
  ]);
  assert.deepEqual(parentSessions('child', { CODEX_THREAD_ID: 'codex-2' }), [{ agent: 'codex', session_id: 'codex-2' }]);
});

test('Claude Code → Codex: the parent and its shell call that ran codex', () => {
  send('L-claude', 'claude', 'SessionStart');
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_ls', tool_input: { command: 'ls' } });
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_codex', tool_input: { command: 'codex exec -s read-only "review"' } });
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_codex2', tool_input: { command: 'codex exec "another"' } });
  const child = send('L-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-claude' }]);
  // the latest call running codex before the child began
  assert.deepEqual(sessionSummary(child).parent, { id: 'L-claude', agent: 'claude', callId: 'toolu_codex2' });
  assert.equal(sessionSummary(child).parentCandidates, undefined);
});

test('Codex → Claude Code: the tool call id from the environment', () => {
  send('L-codex-2', 'codex', 'SessionStart');
  const child = send('L-claude-2', 'claude', 'SessionStart', {}, [{ agent: 'codex', session_id: 'L-codex-2', tool_call_id: 'exec-1' }]);
  assert.deepEqual(sessionSummary(child).parent, { id: 'L-codex-2', agent: 'codex', callId: 'exec-1' });
});

test('a chain: the direct parent is the named session that started last', () => {
  send('L-root', 'claude', 'SessionStart');
  send('L-middle', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-root' }]);
  const leaf = send('L-leaf', 'claude', 'SessionStart', {}, [
    { agent: 'codex', session_id: 'L-middle', tool_call_id: 'exec-7' },
    { agent: 'claude', session_id: 'L-root' },
  ]);
  assert.deepEqual(sessionSummary(leaf).parent, { id: 'L-middle', agent: 'codex', callId: 'exec-7' });
});

test('no parent: none named, or the named one is not loaded', () => {
  assert.equal(sessionSummary(send('L-alone', 'claude', 'SessionStart')).parent, null);
  assert.equal(sessionSummary(send('L-orphan', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'not-loaded' }])).parent, null);
});
