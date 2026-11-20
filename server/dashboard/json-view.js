'use strict';
// Session Observer dashboard — JSON and tool output as readable, coloured HTML.
const JSON_LINE_WIDTH = 72;
const OUTPUT_CHARS_MAX = 20000;
// strings (keys when followed by a colon), literals and numbers
const JSON_TOKEN = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

// Compact layout: an object / array stays on one line while that fits in about 72 columns, otherwise one child per line.
function compactJson(value, indent = '', width = JSON_LINE_WIDTH) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const isArray = Array.isArray(value);
  const entries = isArray ? value.map(item => [null, item]) : Object.entries(value);
  if (!entries.length) return isArray ? '[]' : '{}';
  const keyPrefix = key => (key == null ? '' : JSON.stringify(key) + ': ');
  const oneLine = (isArray ? '[' : '{ ') + entries.map(([key, item]) => keyPrefix(key) + compactJson(item, '', Infinity)).join(', ') + (isArray ? ']' : ' }');
  if (indent.length + oneLine.length <= width) return oneLine;
  const childIndent = indent + '  ';
  const children = entries.map(([key, item]) => childIndent + keyPrefix(key) + compactJson(item, childIndent, width)).join(',\n');
  return (isArray ? '[' : '{') + '\n' + children + '\n' + indent + (isArray ? ']' : '}');
}

function jsonTokenClass(match) {
  const token = match[0];
  if (token[0] === '"') return match[2] ? 'jk' : 'js'; // key or string
  return /^[tfn]/.test(token) ? 'jb' : 'jn';           // literal or number
}

// JSON pretty-printed with keys / strings / numbers / literals coloured (escaped token by token)
function jsonHtml(value) {
  const source = compactJson(value);
  let html = '', last = 0;
  for (const match of source.matchAll(JSON_TOKEN)) {
    html += escapeHtml(source.slice(last, match.index)) + `<span class="${jsonTokenClass(match)}">${escapeHtml(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(source.slice(last));
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

// a line that ends in a JSON object / array ("PreToolUse 302 {…}"): its label and the value, or just the line
function splitLabelledJson(line) {
  const start = line.search(/[\[{]/);
  const value = start < 0 ? undefined : parseJsonObject(line.slice(start));
  return value === undefined ? { line } : { label: line.slice(0, start).trimEnd(), value };
}

// 3+ labelled JSON lines: one folding row each (label + its first keys), expanded on click
function foldedJsonLineHtml(part) {
  if (part.value === undefined) return `<div>${escapeHtml(part.line) || '&nbsp;'}</div>`;
  const isArray = Array.isArray(part.value);
  const preview = isArray ? countOf(part.value.length, 'item') : Object.keys(part.value).join(', ');
  return `<details class="jfold"><summary><b class="jl">${escapeHtml(part.label || (isArray ? 'array' : 'object'))}</b> <span class="muted">${escapeHtml(truncateToColumns(preview, 110))}</span></summary><div class="jbody">${jsonHtml(part.value)}</div></details>`;
}

function plainJsonLineHtml(part) {
  if (part.value === undefined) return escapeHtml(part.line);
  return (part.label ? `<b class="jl">${escapeHtml(part.label)}</b>\n` : '') + jsonHtml(part.value);
}

// Tool output: all-JSON output is pretty-printed; otherwise a line ending in a JSON object / array keeps its text and
// gets the JSON laid out under it; anything else stays as is. Returns { html, json, fold }.
function formatToolOutput(output) {
  const text = String(output).length > OUTPUT_CHARS_MAX ? String(output).slice(0, OUTPUT_CHARS_MAX) + '\n…' : String(output);
  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) {
    const value = parseJsonObject(trimmed);
    if (value !== undefined) return { html: jsonHtml(value), json: true };
  }
  const parts = text.split('\n').map(splitLabelledJson);
  const jsonLines = parts.filter(part => part.value !== undefined).length;
  if (!jsonLines) return { html: escapeHtml(text), json: false };
  const fold = jsonLines >= 3;
  const html = fold ? parts.map(foldedJsonLineHtml).join('') : parts.map(plainJsonLineHtml).join('\n');
  return { html, json: true, fold };
}

// tool output as a code block (folding rows go in a div)
function outputBlockHtml(output, className = '') {
  if (output == null || output === '') return '';
  const formatted = formatToolOutput(output), tag = formatted.fold ? 'div' : 'pre';
  return `<${tag} class="code ${className}${formatted.json ? ' fj' : ''}">${formatted.html}</${tag}>`;
}
