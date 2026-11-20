'use strict';
// Session Observer dashboard — building blocks of a card: a header, labelled sections, text and code blocks, and a
// key → value table.
const CARD_TEXT_MAX = 6000;
const NO_FIELDS_SKIPPED = new Set();

const clipText = (text, max, ellipsis) => (String(text).length > max ? String(text).slice(0, max) + ellipsis : text);

const cardHeaderHtml = (group, title, ...parts) =>
  `<div class="hd"><b style="color:var(--s-${group})">${iconSvg(group)}${escapeHtml(title)}</b>${parts.filter(Boolean).map(part => `<span>${part}</span>`).join('')}</div>`;
const cardSectionHtml = (label, html) => (html ? `<div><div class="k">${label}</div>${html}</div>` : '');
const cardTextHtml = (text, className = '') => (text ? `<div class="said ${className}">${escapeHtml(clipText(text, CARD_TEXT_MAX, '…'))}</div>` : '');
const cardCodeHtml = (text, className = '') => (text != null && text !== '' ? `<pre class="code ${className}">${escapeHtml(clipText(text, CARD_TEXT_MAX, '\n…'))}</pre>` : '');

const isEmptyField = value => value == null || value === '' || (Array.isArray(value) && !value.length);

// key → value table; short scalars inline, long text / objects as code blocks
function fieldTableHtml(fields, skipped = NO_FIELDS_SKIPPED) {
  const rows = Object.entries(fields || {}).filter(([key, value]) => !skipped.has(key) && !isEmptyField(value));
  if (!rows.length) return '';
  const valueHtml = value => {
    if (typeof value !== 'string') return `<pre class="code fj">${jsonHtml(value)}</pre>`;
    return value.length > 140 || value.includes('\n') ? outputBlockHtml(value) : escapeHtml(value);
  };
  return `<dl class="kv">${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${valueHtml(value)}</dd>`).join('')}</dl>`;
}

