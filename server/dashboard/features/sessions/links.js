'use strict';
// Session Observer dashboard — sessions started by other sessions: Claude Code running Codex, Codex running Claude
// Code. The server names each session's parent ({ id, agent, callId }); these find the links both ways and draw them.

// the links, indexed once after the sessions change, not on every lookup: Route asks for each stop on every redraw
let sessionLinkIndex = null; // { sessions, byParent: parent id → children, byCall: call id → sessions it started }

// the sessions changed: the index is rebuilt on its next use (app/data.js calls this)
function forgetSessionLinks() { sessionLinkIndex = null; }

function sessionLinks() {
  if (sessionLinkIndex?.sessions === state.sessions) return sessionLinkIndex;
  const byParent = new Map(), byCall = new Map();
  const add = (map, key, session) => { if (!map.has(key)) map.set(key, []); map.get(key).push(session); };
  const sessions = [...state.sessions.values()].sort((a, b) => (a.started || '').localeCompare(b.started || ''));
  for (const session of sessions) {
    if (!session.parent) continue;
    add(byParent, session.parent.id, session);
    if (session.parent.callId) add(byCall, session.parent.callId, session);
  }
  sessionLinkIndex = { sessions: state.sessions, byParent, byCall };
  return sessionLinkIndex;
}

// the loaded session that started this one, or null
const parentSessionOf = session => (session?.parent ? state.sessions.get(session.parent.id) || null : null);

// the sessions this one started, oldest first
const childSessionsOf = session => sessionLinks().byParent.get(session.id) || [];

// the sessions one tool call started
const sessionsStartedByCall = toolUseId => (toolUseId ? sessionLinks().byCall.get(toolUseId) || [] : []);

// a button that opens a session: its agent badge and its name
const sessionLinkHtml = session => `<button class="slink" type="button" data-open-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.openSession)}">`
  + `${agentBadgeHtml(session.agent, 'agent-tag')}<span>${escapeHtml(shorten(sessionName(session), 60))}</span></button>`;

// "Started session: …" under a tool call that started agent sessions, or ''
function startedSessionsHtml(toolUseId) {
  const children = sessionsStartedByCall(toolUseId);
  return children.length ? `<div class="slinks"><span class="muted">${escapeHtml(TEXT.startedSessions(children.length))}</span>${children.map(sessionLinkHtml).join('')}</div>` : '';
}
