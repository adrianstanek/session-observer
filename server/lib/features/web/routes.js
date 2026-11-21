// HTTP: the request checks, the dashboard page and its files, and the JSON API.
'use strict';
const fs = require('fs');
const path = require('path');
const { PORT, SESSION_LOG_DIR, TOKEN, VERSION, DASHBOARD_PAGE, DASHBOARD_ASSETS_DIR } = require('../../building-blocks/config');
const guard = require('./request-guard');
const { sessions, sessionSummary } = require('../sessions/sessions');
const { sessionContext } = require('../context/session-context');
const { addClient, broadcast } = require('../../building-blocks/live-updates');

const ALL_SESSIONS = 'all'; // the session id in /api/events?session= that asks for every session's events
const ASSET_CONTENT_TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
// a file in the dashboard folder or its subfolders: every part of the path is a plain name (letters, digits, - and _,
// never a dot), and the file has a known extension, so a request can't leave the folder
const ASSET_PATH = /^[/]dashboard[/]((?:[A-Za-z0-9_-]+[/])*[A-Za-z0-9_-]+)([.]css|[.]js)$/;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const sendError = (response, status, message) => sendJson(response, status, { error: message });

// Why a request that isn't from this server's own pages is refused, or null when it is fine.
function foreignRequestRefusal(request) {
  if (!guard.isAllowedHost(request.headers.host)) return 'forbidden host';
  const origin = request.headers.origin;
  if (origin !== undefined && !guard.isAllowedOrigin(origin)) return 'forbidden origin';
  if (request.method !== 'GET' && request.method !== 'HEAD' && !origin) return 'origin required';
  // a browser marks a request another site's page makes; a link from another site (a navigation) may still open the page
  if (request.headers['sec-fetch-site'] === 'cross-site' && request.headers['sec-fetch-mode'] !== 'navigate') return 'cross-site request';
  return null;
}

// Another machine needs the token. Returns true when the request was answered here (refused, or redirected).
function answeredPeerWithoutToken(request, response, url) {
  if (guard.isLoopbackPeer(request)) return false;
  if (!TOKEN) {
    sendError(response, 403, 'access from another machine needs OBSERVER_TOKEN');
    return true;
  }
  const tokenInUrl = url.searchParams.get('token');
  if (tokenInUrl != null && guard.isValidToken(tokenInUrl)) {
    // trade the URL token for a cookie, and drop it from the address bar
    response.writeHead(302, { Location: '/', 'Set-Cookie': guard.tokenCookieHeader() });
    response.end();
    return true;
  }
  if (!guard.isValidToken(guard.tokenFromRequest(request))) {
    sendError(response, 401, 'token required');
    return true;
  }
  return false;
}

function serveDashboardPage(response) {
  let html;
  try { html = fs.readFileSync(DASHBOARD_PAGE, 'utf8'); } catch { return sendError(response, 500, 'dashboard missing'); }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': guard.contentSecurityPolicy(html),
  });
  response.end(html);
}

function serveDashboardAsset(response, [, relativePath, extension]) {
  fs.readFile(path.join(DASHBOARD_ASSETS_DIR, ...relativePath.split('/')) + extension, (error, body) => {
    if (error) return sendError(response, 404, 'not found');
    response.writeHead(200, { 'Content-Type': ASSET_CONTENT_TYPES[extension], 'Cache-Control': 'no-store' });
    response.end(body);
  });
}

function sessionsNewestFirst() {
  return [...sessions.values()].map(sessionSummary).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function serveEvents(response, url, eventStore) {
  const sessionId = url.searchParams.get('session');
  const since = url.searchParams.get('since') || null;
  if (sessionId === ALL_SESSIONS) return sendJson(response, 200, eventStore.all(since));
  const session = sessions.get(sessionId);
  if (!session) return sendError(response, 404, 'unknown session');
  sendJson(response, 200, eventStore.forSession(sessionId, since));
}

function serveContext(response, url) {
  const session = sessions.get(url.searchParams.get('session'));
  if (!session) return sendError(response, 404, 'unknown session');
  try {
    sendJson(response, 200, sessionContext(session));
  } catch (error) {
    sendError(response, 500, String(error.message || error));
  }
}

// GET routes by path; the clear-log POST is handled on its own
function createRequestHandler({ clearLog, deleteSession, eventStore }) {
  const routes = {
    '/': (request, response) => serveDashboardPage(response),
    '/index.html': (request, response) => serveDashboardPage(response),
    '/favicon.ico': (request, response) => { response.writeHead(204); response.end(); },
    '/api/health': (request, response) => sendJson(response, 200, { ok: true, version: VERSION, port: PORT, log: SESSION_LOG_DIR, sessions: sessions.size }),
    '/api/sessions': (request, response) => sendJson(response, 200, sessionsNewestFirst()),
    '/api/events': (request, response, url) => serveEvents(response, url, eventStore),
    '/api/context': (request, response, url) => serveContext(response, url),
    '/api/stream': (request, response) => addClient(request, response, { version: VERSION }),
  };

  return (request, response) => {
    for (const [header, value] of Object.entries(guard.SECURITY_HEADERS)) response.setHeader(header, value);
    const refusal = foreignRequestRefusal(request);
    if (refusal) return sendError(response, 403, refusal);
    // a fixed base: the Host header is never parsed as part of the URL (a malformed one used to crash the server)
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return sendError(response, 400, 'bad request'); }
    if (answeredPeerWithoutToken(request, response, url)) return;

    const asset = ASSET_PATH.exec(url.pathname);
    if (asset) return serveDashboardAsset(response, asset);
    if (url.pathname === '/api/clear' && request.method === 'POST') {
      clearLog();
      broadcast('reset', {});
      return sendJson(response, 200, { ok: true });
    }
    const deleteMatch = request.method === 'DELETE' && url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (deleteMatch) {
      let sessionId;
      try { sessionId = decodeURIComponent(deleteMatch[1]); } catch { return sendError(response, 400, 'bad session id'); }
      try {
        if (!deleteSession(sessionId)) return sendError(response, 404, 'unknown session');
        return sendJson(response, 200, { ok: true });
      } catch (error) {
        return sendError(response, 500, String(error.message || error));
      }
    }
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (route) return route(request, response, url);
    sendError(response, 404, 'not found');
  };
}

module.exports = { createRequestHandler };
