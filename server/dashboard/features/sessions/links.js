'use strict';
// Session Observer dashboard — sessions started by other sessions: Claude Code running Codex, Codex running Claude
// Code. The server names each session's parent ({ id, agent, callId }); these find the links both ways and draw them.

// the loaded session that started this one, or null
const parentSessionOf = session => (session?.parent ? state.sessions.get(session.parent.id) || null : null);

// the sessions this one started, oldest first
const childSessionsOf = session => [...state.sessions.values()]
  .filter(child => child.parent?.id === session.id)
  .sort((a, b) => (a.started || '').localeCompare(b.started || ''));

// the sessions one tool call started
const sessionsStartedByCall = toolUseId => (toolUseId ? [...state.sessions.values()].filter(child => child.parent?.callId === toolUseId) : []);

// a button that opens a session: its agent badge and its name
const sessionLinkHtml = session => `<button class="slink" type="button" data-open-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.openSession)}">`
  + `${agentBadgeHtml(session.agent, 'agent-tag')}<span>${escapeHtml(shorten(sessionName(session), 60))}</span></button>`;

// "Started session: …" under a tool call that started agent sessions, or ''
function startedSessionsHtml(toolUseId) {
  const children = sessionsStartedByCall(toolUseId);
  return children.length ? `<div class="slinks"><span class="muted">${escapeHtml(TEXT.startedSessions(children.length))}</span>${children.map(sessionLinkHtml).join('')}</div>` : '';
}
