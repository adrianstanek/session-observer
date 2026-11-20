'use strict';
// Session Observer dashboard — Home: what waits on you, on top, then every agent as a tree: project folder → session
// → its subagents. A row opens its session.
const WAIT_TEXT_MAX = 160;
const SUBAGENT_DESCRIPTION_MAX = 90;
const HOME_DOT = { needsYou: 'dot need', working: 'dot busy', yourTurn: 'dot on', inactive: 'dot', ended: 'dot' };

const homeSessionName = session => stripTags(session.title) || baseName(session.cwd) || session.id.slice(0, 8);
const homeAgentTag = session => `<span class="agent-tag agent-${agentKey(session.agent)}">${escapeHtml(agentName(session.agent))}</span>`;
const openAttributes = session => `data-home-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.home.open)}"`;

function waitTitle(wait) {
  if (wait.kind === 'permission') return TEXT.home.permission(wait.tool ? toolDisplayName(wait.tool) : '');
  if (wait.kind === 'mcp') return TEXT.home.mcp(wait.tool || '');
  return TEXT.home.question;
}

function waitHtml(wait) {
  const where = wait.agentType || wait.agentId != null ? ` <span class="muted">· ${escapeHtml(TEXT.home.inSubagent(wait.agentType || ''))}</span>` : '';
  return `<div class="hwait hwait-${escapeHtml(wait.kind)}">${iconSvg('you')}<b>${escapeHtml(waitTitle(wait))}</b>${where}`
    + `<span class="grow"></span><span class="muted">${wait.since ? escapeHtml(formatAgo(wait.since)) : ''}</span>`
    + (wait.text ? `<div class="hwait-text mono">${escapeHtml(shorten(wait.text, WAIT_TEXT_MAX))}</div>` : '') + '</div>';
}

// one card per session waiting on you, with everything it waits for
function needsYouHtml(sessions) {
  const waiting = sessionsNeedingYou(sessions);
  const cards = waiting.map(session => `<button class="hneed" ${openAttributes(session)}>
      <div class="hrow"><span class="dot need"></span><b class="hname">${escapeHtml(homeSessionName(session))}</b>${homeAgentTag(session)}<span class="muted hpath">${escapeHtml(baseName(session.cwd) || '')}</span></div>
      ${session.needsYou.map(waitHtml).join('')}</button>`).join('');
  return `<section class="hsec hneeds ${waiting.length ? 'on' : ''}"><h3>${iconSvg('you')} ${escapeHtml(TEXT.home.needsYou)}${waiting.length ? ` <span class="hcount">${waiting.length}</span>` : ''}</h3>
    ${cards || `<div class="muted">${escapeHtml(TEXT.home.allClear)}</div>`}</section>`;
}

function subagentRowHtml(subagent) {
  const running = !subagent.ended;
  const duration = subagent.started ? formatDuration(Date.parse(subagent.ended || new Date().toISOString()) - Date.parse(subagent.started)) : '';
  return `<li class="hsub"><span class="dot ${running ? 'busy' : ''}"></span>${iconSvg('agents')}<b>${escapeHtml(subagent.type || TEXT.subagentLc)}</b>`
    + `<span class="muted">${escapeHtml(shorten(subagent.description || '', SUBAGENT_DESCRIPTION_MAX))}</span><span class="grow"></span>`
    + `<span class="muted">${escapeHtml(running ? TEXT.sessionState.working : TEXT.home.done)}${duration ? ' · ' + escapeHtml(duration) : ''}</span></li>`;
}

function sessionRowHtml(session) {
  const activity = sessionActivity(session);
  const { subagents, folded } = shownSubagents(session);
  const lastTool = activity === 'working' && session.lastTool
    ? `<span class="muted mono hlast">${escapeHtml(toolDisplayName(session.lastTool.name))} ${escapeHtml(shorten(session.lastTool.arg, 60))}</span>` : '';
  const children = subagents.map(subagentRowHtml).join('') + (folded ? `<li class="hsub muted">${escapeHtml(TEXT.home.more(folded))}</li>` : '');
  return `<li class="hsess act-${activity} ${session.id === state.scope ? 'sel' : ''}">
      <div class="hrow" ${openAttributes(session)}><span class="${HOME_DOT[activity]}"></span><span class="hname">${escapeHtml(homeSessionName(session))}</span>${homeAgentTag(session)}
        <span class="hstate">${escapeHtml(TEXT.sessionState[activity])}</span>${lastTool}<span class="grow"></span>
        <span class="muted">${escapeHtml(countOf(session.turns || 0, 'turn'))}${session.last ? ' · ' + escapeHtml(formatAgo(session.last)) : ''}</span></div>
      ${children ? `<ul>${children}</ul>` : ''}</li>`;
}

function projectHtml(project) {
  const name = baseName(project.path) || project.path || '?';
  return `<li class="hproj"><div class="hrow">${iconSvg('files')}<b>${escapeHtml(name)}</b><span class="muted mono hpath" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</span></div>
    <ul>${project.sessions.map(sessionRowHtml).join('')}</ul></li>`;
}

function homeViewHtml() {
  const sessions = homeSessions();
  const tree = sessions.length
    ? `<ul class="htree">${projectTree(sessions).map(projectHtml).join('')}</ul>`
    : `<div class="cempty">${escapeHtml(TEXT.home.noSessions)}</div>`;
  return `<div class="home">${needsYouHtml(sessions)}<section class="hsec">${tree}</section></div>`;
}
