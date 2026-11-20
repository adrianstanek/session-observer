'use strict';
// Session Observer dashboard — Context view, its cards: collapsible blocks that remember being opened, and full
// tool input and output (the Details panel's cards cut long input short; this view doesn't).
const FULL_OUTPUT_FORMAT_MAX = 20000; // longer output is shown as plain text

// a card: a <details> that remembers being opened; `openByDefault` = how it starts
function contextCardHtml(id, className, header, body, openByDefault = false) {
  const open = openContextCards.has(id) || (openByDefault && !openContextCards.has('-' + id));
  return `<details class="cx ${className}" data-cx="${escapeHtml(id)}"${open ? ' open' : ''}><summary>${header}</summary><div class="cxb">${body}</div></details>`;
}

// a card's header: an icon or badge, a bold title, a muted note, and a size on the right
const cardHeader = ({ icon = '', title, note, size }) =>
  `${icon}<b>${title}</b>${note != null ? ` <span class="muted">${note}</span>` : ''}<span class="grow"></span><span class="sz">${size}</span>`;

const preText = text => `<pre class="cxt">${escapeHtml(text)}</pre>`;

// a tool call's input, in full
function fullToolInputHtml(tool, input) {
  input = input || {};
  const fields = TEXT.fields;
  if (tool === 'Bash' || tool === 'PowerShell') return shellCommandHtml(input);
  if (tool === 'Edit' || tool === 'MultiEdit') return toolInputHtml(tool, input);
  if (tool === 'Write') return fieldTableHtml({ [fields.file]: input.file_path }, NO_FIELDS_SKIPPED) + `<pre class="code">${highlightCode(input.content ?? '', codeLanguageOfFile(input.file_path))}</pre>`;
  if (isSubagentCall(tool)) return subagentCallFieldsHtml(input) + preText(input.prompt ?? '');
  return `<pre class="code fj">${jsonHtml(input)}</pre>`;
}

function fullToolOutputHtml(text, isError) {
  if (!text) return `<div class="muted">${escapeHtml(TEXT.noOutput)}</div>`;
  if (text.length < FULL_OUTPUT_FORMAT_MAX) return outputBlockHtml(text, isError ? 'err' : '');
  return `<pre class="code ${isError ? 'err' : ''}">${escapeHtml(text)}</pre>`;
}

// Groups inside a card: [name, entries] with '' (built in, not from a plugin) first, then the largest.
function groupEntries(entries, groupOf, sizeOf) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groupOf(entry);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  const totalSize = list => list.reduce((sum, entry) => sum + sizeOf(entry), 0);
  return [...groups].sort(([nameA, listA], [nameB, listB]) => (nameB === '') - (nameA === '') || totalSize(listB) - totalSize(listA) || nameA.localeCompare(nameB));
}

// a group is a collapsible section of its own, closed until opened (and remembered like any card)
const contextGroupHtml = (id, title, note, size, body, isBad = false) =>
  contextCardHtml(id, 'grp' + (isBad ? ' bad' : ''), `<b class="mono">${title}</b> <span class="muted">${note}</span><span class="grow"></span><span class="sz">${size}</span>`, body);
