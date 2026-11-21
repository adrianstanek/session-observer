// Per-session JSONL paths and the one-time import from the former global event log.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEGACY_OFFSET_FIELD = '_session_observer_legacy_offset';
const sessionLogKey = sessionId => crypto.createHash('sha256').update(String(sessionId || 'unknown')).digest('hex');
const sessionLogPath = (directory, sessionId) => path.join(directory, sessionLogKey(sessionId) + '.jsonl');

function truncateToCompleteLine(file) {
  let data;
  try { data = fs.readFileSync(file); } catch { return; }
  const lastNewline = data.lastIndexOf(10);
  if (lastNewline + 1 < data.length) fs.truncateSync(file, lastNewline + 1);
}

function migrateLegacyLog({ legacyFile, sessionDirectory, markerFile }) {
  fs.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(markerFile)) return false;

  const importedOffsets = new Set();
  for (const name of fs.readdirSync(sessionDirectory)) {
    if (!/^[a-f0-9]{64}[.]jsonl$/.test(name)) continue;
    const file = path.join(sessionDirectory, name);
    truncateToCompleteLine(file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const offset = JSON.parse(line)[LEGACY_OFFSET_FIELD];
        if (Number.isSafeInteger(offset) && offset >= 0) importedOffsets.add(offset);
      } catch { /* skip a corrupt line */ }
    }
  }

  let data;
  try { data = fs.readFileSync(legacyFile); } catch { data = Buffer.alloc(0); }
  let start = 0;
  for (let end = 0; end < data.length; end++) {
    if (data[end] !== 10) continue;
    const offset = start;
    const line = data.subarray(start, end).toString('utf8');
    start = end + 1;
    if (!line.trim() || importedOffsets.has(offset)) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    event.session_id = String(event.session_id || 'unknown');
    event[LEGACY_OFFSET_FIELD] = offset;
    const destination = sessionLogPath(sessionDirectory, event.session_id);
    fs.appendFileSync(destination, JSON.stringify(event) + '\n', { mode: 0o600 });
    try { fs.chmodSync(destination, 0o600); } catch { /* Windows ACLs are managed by the user */ }
  }

  // The per-session copies are durable before the old source is cleared. If we stop mid-import,
  // the offset marker in each copied row lets the next start safely resume.
  try { fs.writeFileSync(legacyFile, '', { mode: 0o600 }); } catch { /* absent legacy log */ }
  fs.writeFileSync(markerFile, '1\n', { mode: 0o600 });
  try { fs.chmodSync(markerFile, 0o600); } catch { /* Windows ACLs are managed by the user */ }
  return true;
}

module.exports = { LEGACY_OFFSET_FIELD, sessionLogKey, sessionLogPath, migrateLegacyLog };
