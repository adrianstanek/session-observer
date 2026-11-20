'use strict';
// Session Observer dashboard — building blocks of the Details panel: collapsible sections, colour key, and card parts.
const CARD_TEXT_MAX = 6000;
// collapsible sections of the Details panel; which ones you closed is remembered across turns and reloads
const detailSectionOpen = (() => { try { return JSON.parse(storage.get('so.dsec', '{}')) || {}; } catch { return {}; } })();
const isDetailSectionOpen = (id, openByDefault = true) => detailSectionOpen[id] ?? openByDefault;
const detailSectionHtml = (id, title, body) =>
  `<details class="dsec" data-dsec="${id}"${isDetailSectionOpen(id) ? ' open' : ''}><summary class="lbl2">${title}</summary>${body}</details>`;

function colourKeyHtml(turn) {
  const techs = turn ? [...new Set(turn.events.flatMap(techsOfEvent))] : [];
  const techKey = techs.length
    ? `<div class="muted" style="margin-top:12px;font-size:12px">${escapeHtml(TEXT.langsInTurn)}</div><div class="keygrid">${techs.map(id => `<div>${techBadgeIcon(id)}<span>${escapeHtml(TECH_BADGES[id].name)}</span></div>`).join('')}</div>` : '';
  const groups = TOOL_GROUPS.map(group => `<div style="color:var(--s-${group.id})">${iconSvg(group.id)}<span style="color:var(--text)">${group.label}</span></div>`).join('');
  return `<details class="key dsec" data-dsec="key"${isDetailSectionOpen('key', false) ? ' open' : ''}><summary>${escapeHtml(TEXT.colourKey)}</summary><div class="keygrid">${groups}
    <div><span style="color:var(--ok)">●</span> ${escapeHtml(TEXT.running)}</div><div><span class="muted">·</span> ${escapeHtml(TEXT.event.done)}</div><div><span class="err">✕</span> ${escapeHtml(TEXT.failedDenied)}</div><div><span style="color:var(--s-model)">◆</span> ${escapeHtml(TEXT.modelReply)}</div></div>${techKey}</details>`;
}

// ---- an opened event row: a readable card for every event, with the raw hook payload folded underneath
const rawPayloadHtml = event => `<pre class="raw">${escapeHtml(event.event)}${event.duration_ms ? ' · ' + formatDuration(event.duration_ms) : ''}\n${jsonHtml(event.data)}</pre>`;

// fields every hook payload carries; the card footer shows the useful ones, the field tables skip them
const COMMON_HOOK_FIELDS = new Set(['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'permission_mode', 'scratchpad_dir', 'prompt_id', 'effort', 'agent_id', 'agent_type', 'tool_use_id']);
// the common fields and the ones a card already shows
const fieldsShownElsewhere = (...fields) => new Set([...COMMON_HOOK_FIELDS, ...fields]);
const NO_FIELDS_SKIPPED = new Set();

const clipText = (text, max, ellipsis) => (String(text).length > max ? String(text).slice(0, max) + ellipsis : text);

const cardHeaderHtml = (group, title, ...parts) =>
  `<div class="hd"><b style="color:var(--s-${group})">${iconSvg(group)}${escapeHtml(title)}</b>${parts.filter(Boolean).map(part => `<span>${part}</span>`).join('')}</div>`;
const cardSectionHtml = (label, html) => (html ? `<div><div class="k">${label}</div>${html}</div>` : '');
const cardTextHtml = (text, className = '') => (text ? `<div class="said ${className}">${escapeHtml(clipText(text, CARD_TEXT_MAX, '…'))}</div>` : '');
const cardCodeHtml = (text, className = '') => (text != null && text !== '' ? `<pre class="code ${className}">${escapeHtml(clipText(text, CARD_TEXT_MAX, '\n…'))}</pre>` : '');

const isEmptyField = value => value == null || value === '' || (Array.isArray(value) && !value.length);

// key → value table; short scalars inline, long text / objects as code blocks
function fieldTableHtml(fields, skipped = COMMON_HOOK_FIELDS) {
  const rows = Object.entries(fields || {}).filter(([key, value]) => !skipped.has(key) && !isEmptyField(value));
  if (!rows.length) return '';
  const valueHtml = value => {
    if (typeof value !== 'string') return `<pre class="code fj">${jsonHtml(value)}</pre>`;
    return value.length > 140 || value.includes('\n') ? outputBlockHtml(value) : escapeHtml(value);
  };
  return `<dl class="kv">${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${valueHtml(value)}</dd>`).join('')}</dl>`;
}

// a whole card: its body, a meta line (time, agent, effort, mode, seq) and, by default, the event's raw payload
function eventCardHtml(event, body, footer) {
  const data = event.data || {};
  const agent = data.agent_type ? `${TEXT.subagentLc} ${data.agent_type}` : data.subagent ? TEXT.subagentLc : TEXT.mainAgentLc;
  const meta = [formatTime(event.ts), agent, data.effort?.level && TEXT.effortX(data.effort.level), data.permission_mode && TEXT.modeX(data.permission_mode), `#${event.seq}`];
  const raw = footer ?? `<details><summary>${escapeHtml(TEXT.rawPayload)}</summary>${rawPayloadHtml(event)}</details>`;
  return `<div class="evx">${body}<div class="meta">${meta.filter(Boolean).map(escapeHtml).join(' · ')}</div>${raw}</div>`;
}
