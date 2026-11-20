'use strict';
// Session Observer dashboard — the event model's vocabulary: tool groups, event categories, and tool families.
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

// an event's time in ms, parsed once
const eventTime = event => event._t ?? (event._t = Date.parse(event.ts));
const isSubagentCall = toolName => SUBAGENT_CALL_TOOLS.has(toolName);
