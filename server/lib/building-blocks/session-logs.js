// The event log on disk: one JSONL file per session, named by a hash of the session id, in the folder of the UTC day
// the session was last active.
// Also the import from the former combined log and the list of deleted sessions.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATTERN = /^[a-f0-9]{64}[.]jsonl$/;
const MIGRATED_FIELD = '_observer_migrated'; // "<source file>:<byte offset>" on a line copied by the import
const MIGRATING_PATTERN = /^events[.]\d+[.]migrating$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const sessionLogKey = sessionId => crypto.createHash('sha256').update(String(sessionId || 'unknown')).digest('hex');
const sessionLogName = sessionId => sessionLogKey(sessionId) + '.jsonl';
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = ts => {
  const day = String(ts || '').slice(0, 10);
  return DAY_PATTERN.test(day) ? day : today();
};
const addDays = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
const sessionLogPath = (directory, sessionId, ts) => path.join(directory, dayOf(ts), sessionLogName(sessionId));

const readNames = directory => { try { return fs.readdirSync(directory); } catch { return []; } };

// the day folders, oldest first
const listDays = directory => readNames(directory).filter(name => DAY_PATTERN.test(name)).sort();
const sessionFilesInDay = (directory, day) => readNames(path.join(directory, day)).filter(name => FILE_PATTERN.test(name));

// every file with this name, oldest day first: one, unless an earlier build split the session over several days
const filesNamed = (directory, name, days = listDays(directory)) =>
  days.map(day => path.join(directory, day, name)).filter(file => fs.existsSync(file));
const filesOfSession = (directory, sessionId) => filesNamed(directory, sessionLogName(sessionId));

// The file to append a session's event to. A session lives in one file, in the folder of the day it was last active:
// its first event of a new day moves the file from the earlier day's folder into today's.
function sessionLogForAppend(directory, sessionId, ts) {
  const name = sessionLogName(sessionId);
  const target = path.join(directory, dayOf(ts), name);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  for (const day of listDays(directory).reverse()) {
    const earlier = path.join(directory, day, name);
    if (earlier === target || !fs.existsSync(earlier)) continue;
    try {
      fs.renameSync(earlier, target);
    } catch {
      // another hook moved it first (then it is at target), or the move is refused for now: append where it is
      return fs.existsSync(target) || !fs.existsSync(earlier) ? target : earlier;
    }
    try { fs.rmdirSync(path.dirname(earlier)); } catch { /* the day still holds other sessions */ }
    return target;
  }
  return target;
}

function appendLine(file, event) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
}

// ---------- deleted sessions ----------
// A deleted session's events can still sit in the former combined log, written by an older hook. The import skips
// them: every event of that session up to the moment it was deleted. A later event of the same id starts it again.
function readDeletedSessions(file) {
  const deleted = new Map();
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return deleted; }
  for (const line of text.split('\n')) {
    try {
      const { session_id: id, deleted_at: at } = JSON.parse(line);
      if (id != null && at && !(deleted.get(String(id)) >= at)) deleted.set(String(id), at);
    } catch { /* skip a corrupt line */ }
  }
  return deleted;
}

function recordDeletedSession(file, deleted, sessionId, at = new Date().toISOString()) {
  deleted.set(String(sessionId), at);
  appendLine(file, { session_id: String(sessionId), deleted_at: at });
}

const isDeleted = (deleted, event) => {
  const at = deleted.get(String(event.session_id ?? 'unknown'));
  return !!at && String(event.ts || '') <= at;
};

// ---------- the import ----------
// the tags already copied into the files a source's lines go to, so an interrupted import resumes without copying twice
function copiedTags(sessionDirectory, files) {
  const tags = new Set();
  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes(MIGRATED_FIELD)) continue;
      try { tags.add(JSON.parse(line)[MIGRATED_FIELD]); } catch { /* a cut-off last line */ }
    }
  }
  return tags;
}

function* linesOf(data) {
  let start = 0;
  for (let end = 0; end < data.length; end++) {
    if (data[end] !== 10) continue;
    yield { offset: start, line: data.subarray(start, end).toString('utf8') };
    start = end + 1;
  }
}

// a session's one file: the one it already has, or a new one in the folder of the day it was last active
function importDestinations(sessionDirectory, events) {
  const lastTs = new Map();
  for (const event of events) if (!(lastTs.get(event.session_id) >= event.ts)) lastTs.set(event.session_id, event.ts);
  const destinations = new Map();
  for (const [sessionId, ts] of lastTs) {
    destinations.set(sessionId, filesOfSession(sessionDirectory, sessionId).at(-1) || sessionLogPath(sessionDirectory, sessionId, ts));
  }
  return events.map(event => destinations.get(event.session_id));
}

// copies each line of one source file into its session's file, then removes the source
function importFile(source, { sessionDirectory, deleted, resumed }) {
  let data;
  try { data = fs.readFileSync(source); } catch { return 0; }
  const label = path.basename(source);
  const events = [];
  for (const { offset, line } of linesOf(data)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    event.session_id = String(event.session_id || 'unknown');
    if (isDeleted(deleted, event)) continue;
    event[MIGRATED_FIELD] = `${label}:${offset}`;
    events.push(event);
  }
  const destinations = importDestinations(sessionDirectory, events);
  const done = resumed ? copiedTags(sessionDirectory, new Set(destinations)) : new Set();
  let copied = 0;
  events.forEach((event, index) => {
    if (done.has(event[MIGRATED_FIELD])) return;
    appendLine(destinations[index], event);
    copied++;
  });
  fs.unlinkSync(source);
  return copied;
}

// Moves events written outside the day folders into them: the former combined events.jsonl (renamed first, so an
// older hook that appends meanwhile starts a new file that the server tails), and per-session files written straight
// into sessions/ by an earlier build of this layout. Runs at every start; returns how many lines were copied.
function migrateLegacyLog({ legacyFile, sessionDirectory, deleted = new Map() }) {
  fs.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  const dataDirectory = path.dirname(legacyFile);
  const leftOver = readNames(dataDirectory).filter(name => MIGRATING_PATTERN.test(name)).sort();
  const sources = leftOver.map(name => ({ file: path.join(dataDirectory, name), resumed: true }));
  try {
    if (fs.statSync(legacyFile).size > 0) {
      const renamed = path.join(dataDirectory, `events.${Date.now()}.migrating`);
      fs.renameSync(legacyFile, renamed);
      sources.push({ file: renamed, resumed: false });
    }
  } catch { /* no legacy log, or an older hook holds it open: it is tailed instead, and imported next start */ }
  for (const name of readNames(sessionDirectory)) {
    if (FILE_PATTERN.test(name)) sources.push({ file: path.join(sessionDirectory, name), resumed: true });
  }
  let copied = 0;
  for (const { file, resumed } of sources) {
    try { copied += importFile(file, { sessionDirectory, deleted, resumed }); } catch { /* left for the next start */ }
  }
  return copied;
}

module.exports = {
  MIGRATED_FIELD, sessionLogKey, sessionLogName, sessionLogPath, sessionLogForAppend, today, dayOf, addDays, listDays,
  sessionFilesInDay, filesNamed, filesOfSession, readDeletedSessions, recordDeletedSession, isDeleted, migrateLegacyLog,
};
