// A transcript read in full (the Context view needs every row, not only new ones), and text clipping for the page.
'use strict';
const fs = require('fs');
const { CONTEXT_FIELD_MAX } = require('../../building-blocks/config');

const CACHED_FILES_MAX = 50;
const rowsCache = new Map(); // file → { mtimeMs, size, rows }

// every row of a JSONL transcript, cached until the file changes; null when the file can't be read
function readTranscriptRows(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const cached = rowsCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.rows;

  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a partly written line */ }
  }
  rowsCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, rows });
  if (rowsCache.size > CACHED_FILES_MAX) rowsCache.delete(rowsCache.keys().next().value);
  return rows;
}

const clipText = text => text.length > CONTEXT_FIELD_MAX
  ? text.slice(0, CONTEXT_FIELD_MAX) + `\n… [+${text.length - CONTEXT_FIELD_MAX} chars not shown]`
  : text;

const CLIP_DEPTH_MAX = 10; // values nested deeper are kept as they are
// every string inside a value clipped (a tool's input can hold a whole file)
function clipDeep(value, depth = 0) {
  if (typeof value === 'string') return clipText(value);
  if (!value || typeof value !== 'object' || depth > CLIP_DEPTH_MAX) return value;
  if (Array.isArray(value)) return value.map(item => clipDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clipDeep(item, depth + 1)]));
}

// a message's content as text: text blocks as they are, images as a marker, anything else as JSON
function contentText(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.map(block => {
    if (block?.type === 'text') return block.text;
    if (block?.type === 'image') return '[image]';
    return JSON.stringify(block);
  }).join('\n');
}

const textLength = text => String(text ?? '').length;

module.exports = { readTranscriptRows, clipText, clipDeep, contentText, textLength };
