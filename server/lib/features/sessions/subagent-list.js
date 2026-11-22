// A session's subagents, for the Home view's tree: each one's type, what it was asked to do, and whether it is still
// running. The description comes from the call that started it (Agent / Task / spawn_agent), which comes before its
// SubagentStart. Hooks race into the log, so a SubagentStart takes the oldest waiting call of its own type
// (subagent_type), or else the oldest call that names no type. A call that started no subagent leaves the queue: one
// refused at its prompt (PermissionDenied, or its error result read from the transcript), or one that failed.
// A turn that stops ends its subagents, except background agents: they go on after the turn, until their own
// SubagentStop, an interrupt or the session's end. A subagent runs in the background when its call asked for it
// (run_in_background), or when its call returned while it still runs (Claude Code can start an agent in the
// background without that flag; a foreground agent's call returns only after its SubagentStop).
'use strict';
const { SUBAGENT_TOOLS } = require('./event-categories');

const SUBAGENTS_KEPT_MAX = 50;
const DESCRIPTION_MAX = 200;
const NO_SUBAGENT_STARTED = new Set(['PermissionDenied', 'PostToolUseFailure']);
const ENDED_CALLS_KEPT_MAX = 50;

// the ids of calls known to have started no subagent: the transcript can show a refusal before the log has given
// its PreToolUse, which then must not join the queue
const endedCalls = new WeakMap(); // session → [tool_use_id]

// the waiting call a subagent of this type came from
function takeSubagentCall(session, agentType) {
  const waiting = session.subagentDescriptionsWaiting;
  let index = agentType ? waiting.findIndex(call => call.type === agentType) : -1;
  if (index < 0) index = waiting.findIndex(call => !call.type);
  if (index < 0) index = 0;
  return waiting.splice(index, 1)[0] || { description: '', background: false };
}

// a call that started no subagent: its description must not go to the next one
function dropSubagentCall(session, toolUseId) {
  if (!toolUseId) return;
  const ended = endedCalls.get(session) || [];
  ended.push(toolUseId);
  if (ended.length > ENDED_CALLS_KEPT_MAX) ended.splice(0, ended.length - ENDED_CALLS_KEPT_MAX);
  endedCalls.set(session, ended);
  session.subagentDescriptionsWaiting = session.subagentDescriptionsWaiting.filter(call => call.toolUseId !== toolUseId);
}

function trackSubagents(session, event, data) {
  if (event.event === 'PreToolUse' && SUBAGENT_TOOLS.has(data.tool_name) && data.tool_name !== 'SendMessage') {
    if (data.tool_use_id && endedCalls.get(session)?.includes(data.tool_use_id)) return;
    const input = data.tool_input || {};
    session.subagentDescriptionsWaiting.push({
      toolUseId: data.tool_use_id || null,
      type: input.subagent_type || input.agent_type || null,
      description: String(input.description || input.message || input.prompt || '').slice(0, DESCRIPTION_MAX),
      background: input.run_in_background === true,
    });
  } else if (NO_SUBAGENT_STARTED.has(event.event)) {
    dropSubagentCall(session, data.tool_use_id);
  } else if (event.event === 'PostToolUse' && data.tool_use_id && SUBAGENT_TOOLS.has(data.tool_name)) {
    // (hooks race into the log: the call can also return before its SubagentStart)
    const subagent = session.subagentList.find(candidate => candidate.callId === data.tool_use_id && !candidate.ended);
    if (subagent) subagent.background = true;
    const waiting = session.subagentDescriptionsWaiting.find(call => call.toolUseId === data.tool_use_id);
    if (waiting) waiting.background = true;
  } else if (event.event === 'SubagentStart' && data.agent_id != null) {
    const call = takeSubagentCall(session, data.agent_type);
    session.subagentList.push({
      id: data.agent_id, type: data.agent_type || null, callId: call.toolUseId || null,
      description: call.description, background: call.background, started: event.ts, ended: null,
    });
    if (session.subagentList.length > SUBAGENTS_KEPT_MAX) session.subagentList.splice(0, session.subagentList.length - SUBAGENTS_KEPT_MAX);
  } else if (event.event === 'SubagentStop' && data.agent_id != null) {
    const subagent = session.subagentList.find(candidate => candidate.id === data.agent_id && !candidate.ended);
    if (subagent) subagent.ended = event.ts;
  } else if (event.event === 'Stop' || event.event === 'SessionEnd' || event.event === 'Interrupt') {
    // a turn that ends ends its subagents too, whether or not each one said so; a Stop leaves background agents
    // (an interrupt is read from the transcript, late: a subagent started after it goes on)
    const ends = subagent => !subagent.ended && subagent.started <= event.ts && !(event.event === 'Stop' && subagent.background);
    for (const subagent of session.subagentList) if (ends(subagent)) subagent.ended = event.ts;
    session.subagentDescriptionsWaiting = [];
  }
}

// a still-running background subagent of this session
const isRunningBackgroundSubagent = (session, agentId) =>
  agentId != null && session.subagentList.some(subagent => subagent.id === agentId && subagent.background && !subagent.ended);

module.exports = { trackSubagents, dropSubagentCall, isRunningBackgroundSubagent };
