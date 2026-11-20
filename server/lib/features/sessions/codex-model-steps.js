// Model steps for Codex sessions. Codex reports every model request in a PostModelRequest hook event, so its
// sessions need no transcript reading (Codex's transcript format is not a stable interface): each such event is
// turned into the same ModelStep the transcript reader makes for Claude Code, and its token counts are added up.
'use strict';
const { CODEX_CONTEXT_WINDOW } = require('../../building-blocks/config');

const CODEX = 'codex';
const isCodexModelRequest = event => event.agent === CODEX && event.event === 'PostModelRequest';

const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Codex's token_usage, in the ModelStep's terms. The hook docs don't spell its fields out: these are the OpenAI names
// (input_tokens includes the cached part), with Anthropic-style names accepted too.
function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return { input: 0, output: 0, cache_read: 0, cache_write: 0, context: 0 };
  const cacheRead = count(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.input_tokens_details?.cached_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const inputWithCache = usage.cached_input_tokens != null || usage.input_tokens_details != null;
  const input = inputWithCache ? Math.max(0, count(usage.input_tokens) - cacheRead) : count(usage.input_tokens);
  return { input, output: count(usage.output_tokens), cache_read: cacheRead, cache_write: cacheWrite, context: input + cacheRead + cacheWrite };
}

// rewrites a Codex PostModelRequest event, in place, into a ModelStep (the request's own fields stay in data)
function toCodexModelStep(event) {
  const data = event.data || {};
  event.event = 'ModelStep';
  event.data = {
    ...data,
    model: data.model || null,
    stop_reason: data.status || null, // completed, failed or cancelled
    subagent: data.agent_id != null,
    agent_id: data.agent_id ?? null,
    msg_id: null,
    tools: [], tool_ids: [], // Codex doesn't say which tool calls a request asked for; they show up as their own events
    tokens: tokensOf(data.token_usage),
  };
  return event;
}

// adds a Codex step's tokens to the session's totals and, for the main agent, its context window use
function addCodexUsage(session, step) {
  const { tokens, model, subagent, token_usage: usage } = step.data;
  const totals = session.usage;
  totals.input += tokens.input;
  totals.output += tokens.output;
  totals.cache_read += tokens.cache_read;
  totals.cache_write += tokens.cache_write;
  totals.turns++;
  if (model) totals.models[model] = (totals.models[model] || 0) + 1;
  if (subagent || !tokens.context) return;
  const window = count(usage?.model_context_window ?? step.data.model_context_window) || CODEX_CONTEXT_WINDOW;
  session.context = { tokens: tokens.context, window, pct: Math.min(1, tokens.context / window), ts: step.ts };
}

module.exports = { CODEX, isCodexModelRequest, toCodexModelStep, addCodexUsage };
