// Agent sessions started by other agent sessions: Claude Code running `codex exec`, Codex running `claude -p`, and
// chains of both. The hook writes on each event the parent sessions its environment names (`event.parents`); here a
// session keeps them, and its parent is resolved when asked: the named session that started last, before this one.
'use strict';

// the commands that start each agent, to find the tool call that started a session when its parent names none
const STARTS_AGENT = { claude: /\bclaude\b/i, codex: /\bcodex\b/i };
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'exec_command', 'local_shell']);

// takes the parent sessions an event names (once: they are the same on every event of a session)
function trackParents(session, event) {
  if (session.parentCandidates || !Array.isArray(event.parents) || !event.parents.length) return;
  session.parentCandidates = event.parents
    .filter(parent => parent && typeof parent.session_id === 'string' && parent.session_id !== session.id)
    .map(parent => ({ agent: parent.agent || null, id: parent.session_id, callId: parent.tool_call_id || null }));
}

// the parent's shell call that started the session: the last one before it began whose command runs its agent
function startingCall(parent, child) {
  const pattern = STARTS_AGENT[child.agent];
  if (!pattern || !child.started) return null;
  let found = null;
  for (const event of parent.events) {
    if (event.ts > child.started) break;
    const data = event.data || {};
    if (event.event !== 'PreToolUse' || !SHELL_TOOLS.has(data.tool_name) || !data.tool_use_id) continue;
    if (pattern.test(String(data.tool_input?.command || ''))) found = data.tool_use_id;
  }
  return found;
}

// { id, agent, callId } of the session that started this one, or null. Not kept: the direct parent's file can load
// after a grandparent's (an older day), and the link must then move to it.
function parentOf(session, sessions) {
  const candidates = (session.parentCandidates || [])
    .map(candidate => ({ candidate, parent: sessions.get(candidate.id) }))
    .filter(({ parent }) => parent && parent.started && (!session.started || parent.started <= session.started));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.parent.started < b.parent.started ? 1 : -1));
  const { candidate, parent } = candidates[0];
  return { id: parent.id, agent: parent.agent, callId: candidate.callId || startingCall(parent, session) };
}

module.exports = { trackParents, parentOf };
