// Attachments: what Claude Code adds to the conversation besides your prompts and the model's replies.
//
// They are of three kinds. Most reach the model as text (a system-reminder or a system message): 'sent'.
// Some are lists the view pins on top (instructions, skills, subagent types, deferred tools, MCP instructions): 'pinned'.
// And some are records Claude Code keeps for itself and never sends: 'meta' (bookkeeping).
'use strict';
const { clipText } = require('./transcript-rows');

const BOOKKEEPING_TYPES = new Set(['prompt_snapshot', 'credential_org', 'deferred_tools_record', 'command_permissions', 'thinking_drop']);
const PINNED_TYPES = new Set(['instructions', 'skill_listing', 'agent_listing_delta', 'deferred_tools_delta', 'mcp_instructions_delta']);

function attachmentRole(type) {
  if (BOOKKEEPING_TYPES.has(type)) return 'meta';
  if (PINNED_TYPES.has(type)) return 'pinned';
  return 'sent';
}

// CLAUDE.md, AGENTS.md (pulled in by an @import), rules and auto-memory reach the model as an 'instructions'
// attachment: a list of { path, type: User | Project | Local | AutoMem | …, content }
const instructionsText = files => files.map(file => `Contents of ${file.path} (${file.type}):\n\n${file.content || ''}`).join('\n\n');

const asText = value => (typeof value === 'string' ? value : JSON.stringify(value));
const withoutType = attachment => Object.fromEntries(Object.entries(attachment).filter(([key]) => key !== 'type'));

// Some attachments are stored as data and turned into text when sent; this is a readable form of that data, not the
// exact wording (the "As sent" view has the exact text when the transcript records the request).
const TEXT_OF_ATTACHMENT = {
  environment: attachment => Object.entries(attachment.snapshot || {}).map(([key, value]) => `${key}: ${asText(value)}`).join('\n'),
  session_context: attachment => Object.entries(attachment.context || {}).map(([key, value]) => `# ${key}\n${asText(value)}`).join('\n\n'),
  date: attachment => `Today's date is ${attachment.date}.`,
  remote_session_change: attachment => [
    attachment.commit && `End git commit messages with:\n${attachment.commit}`,
    attachment.pr && `End pull request descriptions with:\n${attachment.pr}`,
  ].filter(Boolean).join('\n\n'),
  auto_mode: attachment => `Auto mode is active. Settings: ${JSON.stringify(withoutType(attachment))}`,
  hook_non_blocking_error: attachment => `${attachment.hookName || 'hook'} error: ${attachment.stderr || attachment.stdout || ''}`,
  file: attachment => `Contents of ${attachment.filename || attachment.displayPath}:\n\n${asText(attachment.content?.file?.content ?? attachment.content ?? '')}`,
  edited_text_file: attachment => `${attachment.filename} changed on disk since it was last read${attachment.snippet ? `:\n\n${attachment.snippet}` : ''}`,
  compact_file_reference: attachment => `${attachment.displayPath || attachment.filename} was read before the compaction`,
  task_status: attachment => `Background task ${attachment.taskId}${attachment.description ? ` (${attachment.description})` : ''}: ${attachment.status}`,
};

const rendererOf = type => (Object.hasOwn(TEXT_OF_ATTACHMENT, type) ? TEXT_OF_ATTACHMENT[type] : null);

function attachmentText(attachment) {
  if (attachment.type === 'instructions' && Array.isArray(attachment.files)) return instructionsText(attachment.files);
  const render = rendererOf(attachment.type);
  if (render) return render(attachment);
  if (attachment.type === 'hook_success' && attachment.hookName && typeof attachment.content === 'string') {
    return `${attachment.hookName} hook success: ${attachment.content}`;
  }
  return attachment.content ?? attachment.prompt ?? attachment.text;
}

function attachmentItem(attachment, ts) {
  const text = attachmentText(attachment);
  return {
    kind: 'attachment', ts, type: attachment.type || null,
    role: attachmentRole(attachment.type),
    rendered: !!rendererOf(attachment.type),
    label: [attachment.type, attachment.hookName].filter(Boolean).join(' · '),
    text: clipText(typeof text === 'string' ? text : JSON.stringify(attachment, null, 2)),
  };
}

module.exports = { attachmentRole, attachmentItem };
