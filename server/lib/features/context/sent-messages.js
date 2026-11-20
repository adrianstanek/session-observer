// The exact messages of the latest API request ("As sent"), when this Claude Code version records them.
//
// Each 'api-request' row keeps the first `keep` messages of the request before it (same querySource) and adds `tail`,
// a list of message hashes; 'api-request-blob' rows hold messages by hash. Messages the transcript already has (the
// model's replies and tool results) are mostly not stored as blobs: those are rebuilt from the transcript and marked
// recorded: false.
'use strict';
const { clipText, clipDeep, contentText, textLength } = require('./transcript-rows');

// one content block in the form the page shows
function sentBlock(block) {
  switch (block?.type) {
    case 'text': return { type: 'text', text: clipText(block.text || '') };
    case 'thinking': return { type: 'thinking', text: clipText(block.thinking || ''), signature: String(block.signature || '').length };
    case 'redacted_thinking': return { type: 'thinking', text: '', signature: String(block.data || '').length };
    case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: clipDeep(block.input) };
    case 'tool_result': return { type: 'tool_result', id: block.tool_use_id, error: !!block.is_error, text: clipText(contentText(block.content)) };
    case 'tool_addition': {
      const definition = block.tool?.definition || block.tool || {};
      return { type: 'tool_addition', name: definition.name || '?', description: clipText(String(definition.description || '')), schema: definition.input_schema || null };
    }
    case 'image': return { type: 'image' };
    default: return { type: block?.type || '?', text: clipText(JSON.stringify(block)) };
  }
}

function sentBlocksOf(message) {
  if (typeof message.content === 'string') return [{ type: 'text', text: clipText(message.content) }];
  return (Array.isArray(message.content) ? message.content : []).map(sentBlock);
}

const HAS_TEXT = new Set(['text', 'thinking', 'tool_result']);
const blockCharacters = block => (HAS_TEXT.has(block.type) ? textLength(block.text) : JSON.stringify(block).length);
const messageCharacters = message => sentBlocksOf(message).reduce((sum, block) => sum + blockCharacters(block), 0);

// What the transcript has that a request may refer to without storing it: the model's replies (one per API response,
// its blocks spread over several rows), tool results by tool_use id, and your prompts.
function transcriptMessages(rows) {
  const replies = [], replyById = new Map(), toolResults = new Map(), prompts = [];
  for (const row of rows) {
    const message = row.message;
    if (!message || (row.type !== 'user' && row.type !== 'assistant')) continue;
    const isToolResultMessage = row.type === 'user' && Array.isArray(message.content) && message.content.some(block => block?.type === 'tool_result');
    if (row.type === 'assistant' && message.usage) {
      const id = message.id || row.uuid;
      let reply = replyById.get(id);
      if (!reply) {
        reply = { role: 'assistant', content: [], ts: row.timestamp || '' };
        replyById.set(id, reply);
        replies.push(reply);
      }
      if (Array.isArray(message.content)) reply.content.push(...message.content);
    } else if (isToolResultMessage) {
      for (const block of message.content) if (block?.type === 'tool_result') toolResults.set(block.tool_use_id, block);
    } else if (row.type === 'user' && !row.isMeta && !row.isCompactSummary) {
      prompts.push({ role: 'user', content: message.content, ts: row.timestamp || '' });
    }
  }
  return { replies, toolResults, prompts };
}

// hands out messages in order: the first one not handed out yet at or after a time
function inOrderPicker(messages) {
  const taken = new Set();
  return since => {
    const message = messages.find(candidate => !taken.has(candidate) && candidate.ts >= (since || ''));
    if (message) taken.add(message);
    return message;
  };
}

function sentMessagesOf(rows) {
  const blobs = new Map(), requests = [];
  for (const row of rows) {
    if (row.type === 'api-request-blob' && row.hash && row.message) blobs.set(row.hash, row.message);
    else if (row.type === 'api-request' && Array.isArray(row.tail)) requests.push(row);
  }
  if (!requests.length) return null;
  const chain = requests.filter(request => request.querySource === requests.at(-1).querySource);

  const { replies, toolResults, prompts } = transcriptMessages(rows);
  const nextReply = inOrderPicker(replies);
  const nextPrompt = inOrderPicker(prompts);

  // a message the request only names by hash: a recorded blob, else rebuilt from the transcript
  function rebuildMessage(hash, isFirstOfTail, previousRequest, messagesSoFar) {
    if (blobs.has(hash)) return { ...blobs.get(hash), recorded: true };
    // the reply to the request before
    if (isFirstOfTail && previousRequest) {
      const reply = nextReply(previousRequest.timestamp);
      if (reply) return reply;
    }
    const lastMessage = messagesSoFar.at(-1);
    if (lastMessage?.role !== 'assistant') return null;
    // the results of the calls in the message before
    const results = (lastMessage.content || [])
      .filter(block => block?.type === 'tool_use')
      .map(block => toolResults.get(block.id))
      .filter(Boolean);
    if (results.length) return { role: 'user', content: results };
    // a reply with no calls: your next prompt
    return nextPrompt(lastMessage.ts) || null;
  }

  const messageByHash = new Map();
  let messages = [], firstRequestCharacters = null;
  chain.forEach((request, requestIndex) => {
    const requestMessages = messages.slice(0, request.keep || 0);
    request.tail.forEach((hash, tailIndex) => {
      let message = messageByHash.get(hash);
      if (!message) message = rebuildMessage(hash, tailIndex === 0, requestIndex > 0 ? chain[requestIndex - 1] : null, requestMessages);
      if (message) messageByHash.set(hash, message);
      requestMessages.push(message || { role: '?', missing: true, content: [] });
    });
    if (requestIndex === 0) firstRequestCharacters = requestMessages.reduce((sum, message) => sum + messageCharacters(message), 0);
    messages = requestMessages;
  });

  const lastRequest = chain.at(-1);
  return {
    ts: lastRequest.timestamp || null,
    requests: chain.length,
    model: lastRequest.params?.model || null,
    edits: (lastRequest.params?.context_management?.edits || []).map(edit => edit?.type || '?'),
    firstChars: firstRequestCharacters,
    messages: messages.map(message => ({ role: message.role, recorded: !!message.recorded, missing: !!message.missing, blocks: sentBlocksOf(message) })),
  };
}

module.exports = { sentMessagesOf };
