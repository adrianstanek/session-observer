#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/events.jsonl, keeps sessions in memory, reads model steps and token usage from
// each session's transcript, serves the dashboard and pushes live updates over Server-Sent Events.
// The parts live in server/lib; this file loads the log and starts listening.
'use strict';
const http = require('http');
const fs = require('fs');
const { PORT, HOST, DATA_DIR, LOG_FILE, TOKEN } = require('./lib/config');
const { LOOPBACK_NAMES, WILDCARD_ADDRESSES } = require('./lib/request-guard');
const { FileTail } = require('./lib/file-tail');
const { sessions, sessionSummary } = require('./lib/sessions');
const { broadcast, pingClients, startBroadcasting } = require('./lib/live-updates');
const transcripts = require('./lib/transcript-steps');
const { createRequestHandler } = require('./lib/routes');

const LOG_POLL_MS = 400;
const PING_MS = 15000;
const BUSY_TRANSCRIPT_POLL_MS = 2000;

// ---------- the event log ----------
const logTail = new FileTail(LOG_FILE);

function readNewLogEvents() {
  const touchedSessions = new Set();
  for (const line of logTail.readNewLines()) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    touchedSessions.add(transcripts.ingestEvent(event));
    broadcast('event', event);
  }
  for (const session of touchedSessions) broadcast('session', sessionSummary(session));
}

function clearLog() {
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  sessions.clear();
  transcripts.resetTranscriptState();
  logTail.reset();
}

// the log holds prompts, file contents and command output: readable by its owner only (no effect on Windows ACLs)
function protectDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* ignore */ }
  try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* not there yet */ }
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

const server = http.createServer(createRequestHandler({ clearLog }));
server.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(error);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Session Observer → http://localhost:${PORT}`);
  warnIfReachableFromOtherMachines();
});
