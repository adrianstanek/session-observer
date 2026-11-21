#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/sessions/<day>/*.jsonl, keeps sessions in memory, reads model steps and token usage from
// each session's transcript, serves the dashboard and pushes live updates over Server-Sent Events.
// The parts live in server/lib (building-blocks/ and features/); this file loads the log and starts listening.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, HOST, DATA_DIR, LOG_FILE, SESSION_LOG_DIR, DELETED_SESSIONS_FILE, LOAD_DAYS, TOKEN } = require('./lib/building-blocks/config');
const {
  MIGRATED_FIELD, today, addDays, listDays, sessionFilesInDay, filesOfSession, readDeletedSessions, recordDeletedSession, isDeleted,
  migrateLegacyLog,
} = require('./lib/building-blocks/session-logs');
const { LOOPBACK_NAMES, WILDCARD_ADDRESSES } = require('./lib/features/web/request-guard');
const { FileTail } = require('./lib/building-blocks/file-tail');
const { sessions, sessionSummary } = require('./lib/features/sessions/sessions');
const { broadcast, pingClients, startBroadcasting } = require('./lib/building-blocks/live-updates');
const transcripts = require('./lib/features/sessions/transcript-steps');
const { clearTranscriptRowsCache } = require('./lib/features/context/transcript-rows');
const { createRequestHandler } = require('./lib/features/web/routes');

const LOG_POLL_MS = 400;
const PING_MS = 15000;
const BUSY_TRANSCRIPT_POLL_MS = 2000;

// ---------- the event log ----------
// sessions/<day>/<session hash>.jsonl: only the last LOAD_DAYS day folders are read at start, and older ones when the
// dashboard asks. A session found in a loaded day is read whole, its earlier days too, so its state is complete.
const ALL_DAYS = '0000-00-00';
const firstLoadedDay = () => (LOAD_DAYS ? addDays(today(), 1 - LOAD_DAYS) : ALL_DAYS);
const COPY_FIELDS = [MIGRATED_FIELD, '_session_observer_legacy_offset'];
const logTails = new Map(); // file → FileTail
const legacyTail = new FileTail(LOG_FILE);
let loadedFrom = firstLoadedDay();
let deletedSessions = new Map();
let lastReadError = '';

function parseEvent(line) {
  if (!line.trim()) return null;
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  for (const field of COPY_FIELDS) delete event[field];
  return event;
}

function readFile(file, fresh) {
  let tail = logTails.get(file);
  if (!tail) { tail = new FileTail(file); logTails.set(file, tail); }
  for (const { line } of tail.readNewRecords()) {
    const event = parseEvent(line);
    if (!event) continue;
    transcripts.ingestEvent(event);
    fresh.push(event);
  }
}

// a session file seen for the first time: its earlier days go first, so its events arrive in order
function readSessionFile(days, day, name, fresh) {
  const file = path.join(SESSION_LOG_DIR, day, name);
  if (!logTails.has(file)) {
    for (const earlier of days) {
      if (earlier >= day) break;
      const earlierFile = path.join(SESSION_LOG_DIR, earlier, name);
      if (!logTails.has(earlierFile) && fs.existsSync(earlierFile)) readFile(earlierFile, fresh);
    }
  }
  readFile(file, fresh);
}

function readNewLogEvents() {
  const fresh = [];
  try {
    const days = listDays(SESSION_LOG_DIR);
    for (const day of days) {
      if (day < loadedFrom) continue;
      for (const name of sessionFilesInDay(SESSION_LOG_DIR, day)) readSessionFile(days, day, name, fresh);
    }
    // Older installed hooks may keep appending to the former combined log until their plugin is updated; the next
    // start moves those lines into the day folders.
    for (const { line } of legacyTail.readNewRecords()) {
      const event = parseEvent(line);
      if (!event || isDeleted(deletedSessions, event)) continue;
      transcripts.ingestEvent(event);
      fresh.push(event);
    }
    lastReadError = '';
  } catch (error) {
    // a polling error must not stop the server: report it once, and try again on the next tick
    const message = String(error?.message || error);
    if (message !== lastReadError) console.error('session-observer: reading the event log failed:', message);
    lastReadError = message;
  }
  const touched = new Set();
  for (const event of fresh) {
    broadcast('event', event);
    const session = sessions.get(event.session_id);
    if (session) touched.add(session);
  }
  for (const session of touched) broadcast('session', sessionSummary(session));
  return fresh.length;
}

// what is loaded, and whether older days are left
function logHistory() {
  const older = listDays(SESSION_LOG_DIR).filter(day => day < loadedFrom);
  return { loadedFrom: loadedFrom === ALL_DAYS ? null : loadedFrom, olderDays: older.length, loadDays: LOAD_DAYS };
}

// the next LOAD_DAYS day folders (that exist) before the loaded ones
function loadOlderDays() {
  const older = listDays(SESSION_LOG_DIR).filter(day => day < loadedFrom);
  if (!older.length) return logHistory();
  const known = new Set(sessions.keys());
  loadedFrom = LOAD_DAYS ? older[Math.max(0, older.length - LOAD_DAYS)] : ALL_DAYS;
  readNewLogEvents();
  transcripts.cancelScheduledReads();
  for (const session of sessions.values()) {
    if (known.has(session.id)) continue;
    try { transcripts.readTranscripts(session); } catch { /* ignore */ }
  }
  broadcast('reset', {});
  return logHistory();
}

function clearLog() {
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  for (const name of fs.readdirSync(SESSION_LOG_DIR)) {
    try { fs.rmSync(path.join(SESSION_LOG_DIR, name), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { fs.writeFileSync(DELETED_SESSIONS_FILE, ''); } catch { /* ignore */ }
  deletedSessions = new Map();
  sessions.clear();
  transcripts.resetTranscriptState();
  clearTranscriptRowsCache();
  logTails.clear();
  legacyTail.reset();
  loadedFrom = firstLoadedDay();
}

function reloadAfterSessionDelete(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  readNewLogEvents(); // take in what was appended just before this delete, so it isn't read again afterwards
  for (const file of filesOfSession(SESSION_LOG_DIR, sessionId)) {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    logTails.delete(file);
  }
  // its lines in the former combined log are skipped when that log is imported
  recordDeletedSession(DELETED_SESSIONS_FILE, deletedSessions, sessionId);
  transcripts.clearSessionState(sessionId, session);
  clearTranscriptRowsCache(session);
  sessions.delete(sessionId);
  broadcast('reset', {});
  return true;
}

// the log holds prompts, file contents and command output: readable by its owner only (no effect on Windows ACLs)
function protectDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* ignore */ }
  try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* not there yet */ }
  fs.mkdirSync(SESSION_LOG_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(SESSION_LOG_DIR, 0o700); } catch { /* ignore */ }
  deletedSessions = readDeletedSessions(DELETED_SESSIONS_FILE);
  migrateLegacyLog({ legacyFile: LOG_FILE, sessionDirectory: SESSION_LOG_DIR, deleted: deletedSessions });
}

// everything already in the log, then every transcript once, before any page is told about changes
function loadExistingEvents() {
  readNewLogEvents();
  transcripts.cancelScheduledReads();
  for (const session of sessions.values()) {
    try { transcripts.readTranscripts(session); } catch { /* ignore */ }
  }
  startBroadcasting();
}

// live sessions: keep picking up model steps even between hook events
function pollBusyTranscripts() {
  for (const session of sessions.values()) {
    if (session.busy && session.transcript_path) transcripts.scheduleTranscriptRead(session, 0);
  }
}

function warnIfReachableFromOtherMachines() {
  if (LOOPBACK_NAMES.has(HOST.toLowerCase())) return;
  const where = WILDCARD_ADDRESSES.has(HOST) ? `every network interface (${HOST || '0.0.0.0'})` : HOST;
  console.warn(`Listening on ${where}:${PORT}, not only this machine.`);
  console.warn(TOKEN
    ? 'Other machines need OBSERVER_TOKEN; the token travels over plain HTTP, so use a trusted network.'
    : 'Other machines are refused until OBSERVER_TOKEN is set.');
}

// ---------- start ----------
protectDataDir();
loadExistingEvents();
setInterval(readNewLogEvents, LOG_POLL_MS);
setInterval(pingClients, PING_MS);
setInterval(pollBusyTranscripts, BUSY_TRANSCRIPT_POLL_MS);

const server = http.createServer(createRequestHandler({ clearLog, deleteSession: reloadAfterSessionDelete, logHistory, loadOlderDays }));
server.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(error);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Session Observer → http://localhost:${PORT}`);
  warnIfReachableFromOtherMachines();
});
