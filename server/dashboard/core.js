'use strict';
// Session Observer dashboard — constants (icons, tool groups, event categories) and small helpers.
// ---------------------------------------------------------------- constants
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
const STATIONS = [
  ['you', 'You'], ['model', 'Model'], ['files', 'Files'], ['shell', 'Shell'], ['git', 'Git'], ['mcp', 'MCP'],
  ['network', 'Network'], ['browser', 'Browser'], ['agents', 'Agents'], ['skills', 'Skills'], ['context', 'Context'], ['other', 'Other'],
].map(([id, label]) => ({ id, label }));
const ST = Object.fromEntries(STATIONS.map(s => [s.id, s]));
const CATS = {
  model: 'Model', prompt: 'Prompt', tool: 'Tool', skill: 'Skill', question: 'Question', subagent: 'Subagent',
  task: 'Task', mcp: 'MCP', permission: 'Permission', error: 'Error', notification: 'Notice',
  compact: 'Compact', context: 'Context', lifecycle: 'Lifecycle', env: 'Env',
};
const CAT_COLOR = { model: 'model', prompt: 'you', tool: 'files', skill: 'skills', question: 'you', subagent: 'agents', task: 'other', mcp: 'mcp', permission: 'git', error: 'err', notification: 'agents', compact: 'context', context: 'context', lifecycle: 'other', env: 'other' };
// hidden from the Details list: MessageDisplay repeats the model's text, PostToolBatch repeats the tool rows
const FEED_HIDE = new Set(['MessageDisplay', 'PostToolBatch']);
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor']);

// ---------------------------------------------------------------- helpers
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDur = ms => ms == null || isNaN(ms) ? '' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : ms < 3600000 ? `${Math.floor(ms / 60000)}m ${String(Math.round(ms % 60000 / 1000)).padStart(2, '0')}s` : `${Math.floor(ms / 3600000)}h ${String(Math.floor(ms % 3600000 / 60000)).padStart(2, '0')}m`;
const fmtAgo = ts => { const ms = Date.now() - Date.parse(ts); if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))}s ago`; if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`; if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ${Math.floor(ms % 3600000 / 60000)}m ago`; return `${Math.floor(ms / 86400000)}d ago`; };
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n ?? 0);
const clean = s => String(s ?? '').replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?>/gi, ' ').replace(/\s+/g, ' ').trim();
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p || '';
const spaced = s => String(s || '').replace(/_/g, ' '); // hook enum values (user_settings, add_dir…) as words
const icon = (id, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[id] || ICONS.other}</svg>`;
const tms = ev => ev._t ?? (ev._t = Date.parse(ev.ts));
const ls = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
