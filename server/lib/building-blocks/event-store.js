// SQLite index for the append-only event log. JSONL remains the recovery source.
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const { DATABASE_FILE, MAX_ALL_EVENTS, MAX_EVENTS_PER_SESSION } = require('./config');

class EventStore {
  constructor(file = DATABASE_FILE) {
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs are managed by the user */ }
    this.db = new DatabaseSync(file);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 0 && version < 4) this.db.exec('DROP TABLE IF EXISTS events'); // reindex when moving to per-file offsets
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        source_key TEXT PRIMARY KEY,
        file_key TEXT NOT NULL,
        log_offset INTEGER,
        ts TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL,
        agent TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        UNIQUE(file_key, log_offset)
      );
      CREATE INDEX IF NOT EXISTS events_session_time ON events(session_id, ts, seq);
      CREATE INDEX IF NOT EXISTS events_time ON events(ts, seq);
      PRAGMA user_version = 4;
    `);
    this.insertEvent = this.db.prepare(`
      INSERT INTO events(source_key, file_key, log_offset, ts, session_id, event, agent, seq, json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET ts = excluded.ts, session_id = excluded.session_id,
        file_key = excluded.file_key, log_offset = excluded.log_offset, event = excluded.event,
        agent = excluded.agent, seq = excluded.seq, json = excluded.json
    `);
    this.bySession = this.db.prepare('SELECT json FROM events WHERE session_id = ? AND (? IS NULL OR ts >= ?) ORDER BY ts DESC, seq DESC LIMIT ?');
    this.allEvents = this.db.prepare('SELECT json FROM events WHERE (? IS NULL OR ts >= ?) ORDER BY ts DESC, seq DESC LIMIT ?');
    this.insertBatch = rows => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const { event, key, fileKey = 'synthetic', offset = null } of rows) {
          this.insertEvent.run(key, fileKey, offset, event.ts, event.session_id, event.event, event.agent || 'claude', event.seq || 0, JSON.stringify(event));
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  add(event, fileKey, offset) {
    this.addMany([{ event, key: `${fileKey}:${offset}`, fileKey, offset }]);
  }

  addSynthetic(event) {
    const data = event.data || {};
    const subagent = data.agent_id || '';
    const identity = event.event === 'ModelStep'
      ? data.msg_id || event.ts
      : event.event === 'ModelText'
        ? `${data.msg_id || event.ts}:${data.kind || ''}:${subagent}:${data.text || ''}`
        : event.ts;
    this.addMany([{ event, key: `synthetic:${event.session_id}:${event.event}:${identity}:${subagent}`, fileKey: `synthetic:${event.session_id}` }]);
  }

  addMany(rows) {
    if (rows.length) this.insertBatch(rows);
  }

  forSession(sessionId, since = null) {
    return this.bySession.all(sessionId, since, since, MAX_EVENTS_PER_SESSION).reverse().map(row => JSON.parse(row.json));
  }

  all(since = null) {
    return this.allEvents.all(since, since, MAX_ALL_EVENTS).reverse().map(row => JSON.parse(row.json));
  }

  clear() {
    this.db.exec('DELETE FROM events; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }

  deleteSession(sessionId) {
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }

  close() {
    this.db.close();
  }
}

module.exports = { EventStore };
