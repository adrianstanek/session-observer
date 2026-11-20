'use strict';
// Session Observer dashboard — the chosen language, constants (icons, tool groups, event categories), and small
// DOM and storage helpers.
// ---------------------------------------------------------------- language
// the text table every view reads (i18n.js and the i18n-<code>.js tables load before this file)
const LANGUAGE = pickLanguage();
const TEXT = textTableFor(LANGUAGE);
// times in the chosen language, in the browser's regional variant of it when it has one (en-GB: 24 h, en-US: AM/PM)
const TIME_LOCALE = browserLanguages().find(tag => String(tag).toLowerCase().startsWith(LANGUAGE)) || LANGUAGE;

// ---------------------------------------------------------------- constants
// line icons in a 24×24 box, by tool group (and a few more)
const ICONS = {
  you: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  model: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  shell: '<path d="M5 7l5 5-5 5M12 18h7"/>',
  git: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-5 5-11 8.5"/>',
  mcp: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  network: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/>',
  agents: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1M15 13v1M9 17h6"/>',
  skills: '<path d="M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
  context: '<path d="M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>',
  other: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  core: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  turn: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/>',
};
// The tool groups ("stations" of the map): what an event works with. Each has an icon and a colour (--s-<id> in CSS).
const TOOL_GROUPS = ['you', 'model', 'files', 'shell', 'git', 'mcp', 'network', 'browser', 'agents', 'skills', 'context', 'other']
  .map(id => ({ id, label: TEXT.groups[id] }));
const TOOL_GROUP_BY_ID = Object.fromEntries(TOOL_GROUPS.map(group => [group.id, group]));
// event categories (set by the server), with their labels in the chosen language
const CATEGORY_LABELS = Object.fromEntries(['model', 'prompt', 'tool', 'skill', 'question', 'subagent', 'task', 'mcp', 'permission',
  'error', 'notification', 'compact', 'context', 'lifecycle', 'env'].map(category => [category, TEXT.categories[category]]));
// the tool group whose colour a category's chip uses ('err' is the error colour)
const CATEGORY_COLOR = {
  model: 'model', prompt: 'you', tool: 'files', skill: 'skills', question: 'you', subagent: 'agents', task: 'other', mcp: 'mcp',
  permission: 'git', error: 'err', notification: 'agents', compact: 'context', context: 'context', lifecycle: 'other', env: 'other',
};
// hidden from the Details list: MessageDisplay repeats the model's text, PostToolBatch repeats the tool rows
const HIDDEN_IN_EVENT_LIST = new Set(['MessageDisplay', 'PostToolBatch']);
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor']);
const SUBAGENT_CALL_TOOLS = new Set(['Agent', 'Task']); // the tool calls that start a subagent

// ---------------------------------------------------------------- helpers
const elementById = id => document.getElementById(id);
const iconSvg = (id, className = 'ic') => `<svg class="${className}" viewBox="0 0 24 24">${ICONS[id] || ICONS.other}</svg>`;
// an event's time in ms, parsed once
const eventTime = event => event._t ?? (event._t = Date.parse(event.ts));
const isSubagentCall = toolName => SUBAGENT_CALL_TOOLS.has(toolName);

// localStorage that never throws (private windows, blocked storage)
const storage = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};
