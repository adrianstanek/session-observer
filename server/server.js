#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/sessions/*.jsonl, keeps sessions in memory, reads model steps and token usage from
// each session's transcript, serves the dashboard and pushes live updates over Server-Sent Events.
// The parts live in server/lib (building-blocks/ and features/); this file loads the log and starts listening.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, HOST, DATA_DIR, LOG_FILE, SESSION_LOG_DIR, LEGACY_LOG_MIGRATION_FILE, TOKEN } = require('./lib/building-blocks/config');
const { EventStore } = require('./lib/building-blocks/event-store');
const { sessionLogPath, migrateLegacyLog, LEGACY_OFFSET_FIELD } = require('./lib/building-blocks/session-logs');
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
const logTails = new Map();
const legacyTail = new FileTail(LOG_FILE);
let eventStore;

function readNewLogEvents() {
  const touchedSessions = new Set();
  const indexedEvents = [];
  for (const name of fs.readdirSync(SESSION_LOG_DIR)) {
    if (!/^[a-f0-9]{64}[.]jsonl$/.test(name)) continue;
    const file = path.join(SESSION_LOG_DIR, name);
    let tail = logTails.get(file);
    if (!tail) { tail = new FileTail(file); logTails.set(file, tail); }
    for (const { line, offset } of tail.readNewRecords()) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      delete event[LEGACY_OFFSET_FIELD];
      touchedSessions.add(transcripts.ingestEvent(event));
      indexedEvents.push({ event, key: `${name}:${offset}`, fileKey: name, offset });
    }
  }
  // Older installed hooks may keep appending to the former combined log until their plugin is updated.
  for (const { line, offset } of legacyTail.readNewRecords()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const session = transcripts.ingestEvent(event);
    touchedSessions.add(session);
    indexedEvents.push({ event, key: `legacy:${offset}`, fileKey: 'legacy', offset });
  }
  eventStore.addMany(indexedEvents);
  for (const { event } of indexedEvents) broadcast('event', event);
  for (const session of touchedSessions) broadcast('session', sessionSummary(session));
}

function clearLog() {
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  for (const name of fs.readdirSync(SESSION_LOG_DIR)) {
    if (/^[a-f0-9]{64}[.]jsonl$/.test(name)) {
      try { fs.unlinkSync(path.join(SESSION_LOG_DIR, name)); } catch { /* ignore */ }
    }
  }
  eventStore.clear();
  sessions.clear();
  transcripts.resetTranscriptState();
  clearTranscriptRowsCache();
  logTails.clear();
  legacyTail.reset();
}

function reloadAfterSessionDelete(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const file = sessionLogPath(SESSION_LOG_DIR, sessionId);
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  logTails.delete(file);
  eventStore.deleteSession(sessionId);
  transcripts.clearSessionState(sessionId, session);
  clearTranscriptRowsCache(session);
  sessions.delete(sessionId);
  readNewLogEvents(); // pick up other session files that were appended just before this delete
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
  migrateLegacyLog({ legacyFile: LOG_FILE, sessionDirectory: SESSION_LOG_DIR, markerFile: LEGACY_LOG_MIGRATION_FILE });
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
eventStore = new EventStore();
transcripts.setEventSink(event => eventStore.addSynthetic(event));
loadExistingEvents();
setInterval(readNewLogEvents, LOG_POLL_MS);
setInterval(pingClients, PING_MS);
setInterval(pollBusyTranscripts, BUSY_TRANSCRIPT_POLL_MS);

const server = http.createServer(createRequestHandler({ clearLog, deleteSession: reloadAfterSessionDelete, eventStore }));
server.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(error);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Session Observer → http://localhost:${PORT}`);
  warnIfReachableFromOtherMachines();
});
