// Agent sessions started by other agent sessions: Claude Code running `codex exec`, Codex running `claude -p`, and
// chains of both. The hook writes on each event the parent sessions its environment names (`event.parents`); here a
// session keeps them, and its parent is resolved when asked: the named session that started last, before this one.
'use strict';

// the commands that start each agent, to find the tool call that started a session when its parent names none: the
// agent's name as a command word (`codex exec`, `npx @openai/codex`, `& "C:\…\claude.exe" -p`), not inside a path or a
// word (`~/.codex/config.toml`, `codex-rollout.js`)
const agentCommand = name => new RegExp(`(?:^|[\\s;&|(\`"'/\\\\])${name}(?:\\.(?:exe|cmd|ps1))?(?=$|[\\s;&|)"'])`, 'i');
const STARTS_AGENT = { claude: agentCommand('claude'), codex: agentCommand('codex') };
const RESULT_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'exec_command', 'local_shell']);

// takes the parent sessions an event names (once: they are the same on every event of a session)
function trackParents(session, event) {
  if (session.parentCandidates || !Array.isArray(event.parents) || !event.parents.length) return;
  session.parentCandidates = event.parents
    .filter(parent => parent && typeof parent.session_id === 'string' && parent.session_id !== session.id)
    .map(parent => ({ agent: parent.agent || null, id: parent.session_id, callId: parent.tool_call_id || null }));
}

// the parent's shell call that started the session: of those before it began whose command runs its agent, the last
// one still running then (a `codex exec` waits for its child), or else the last one (a child left running in the
// background, or a result that came early)
function startingCall(parent, child) {
  const pattern = STARTS_AGENT[child.agent];
  if (!pattern || !child.started) return null;
  const matches = [], finished = new Set();
  for (const event of parent.events) {
    if (event.ts > child.started) break;
    const data = event.data || {};
    if (RESULT_EVENTS.has(event.event) && data.tool_use_id) finished.add(data.tool_use_id);
    if (event.event !== 'PreToolUse' || !SHELL_TOOLS.has(data.tool_name) || !data.tool_use_id) continue;
    if (pattern.test(String(data.tool_input?.command || ''))) matches.push(data.tool_use_id);
  }
  const running = matches.filter(callId => !finished.has(callId));
  return running.at(-1) ?? matches.at(-1) ?? null;
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
