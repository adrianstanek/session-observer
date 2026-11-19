'use strict';
// Session Observer dashboard — Details panel: tool, event and model-step cards, and the turn's event list.
function toolCard(e, t) {
  const id = e.data?.tool_use_id, same = x => x.data?.tool_use_id === id;
  const pre = e.event === 'PreToolUse' ? e : t.events.find(x => x.event === 'PreToolUse' && same(x));
  const post = e.event !== 'PreToolUse' ? e : t.events.find(x => x.event.startsWith('PostToolUse') && same(x));
  const d = (pre || post).data, name = d.tool_name, st = toolStation(name, d.tool_input);
  const fail = post?.event === 'PostToolUseFailure';
  const res = fail ? `<span class="err">✕ ${esc(TX.failedLc)}</span>` : post ? `<span style="color:var(--ok)">✓</span> ${esc(fmtDur(post.data.duration_ms ?? post.duration_ms ?? (pre ? tms(post) - tms(pre) : null)))}` : esc(TX.runningEll);
  const by = t.events.find(x => x.event === 'ModelStep' && x.data?.tool_ids?.includes(id));
  // both hook events behind this one row: PreToolUse (the call) and PostToolUse / PostToolUseFailure (the result)
  const hook = (x, missing) => x
    ? `<details class="hev"><summary><b>${esc(x.event)}</b> · ${esc(fmtTime(x.ts))} · #${x.seq}${x !== pre && pre ? ` · +${esc(fmtDur(tms(x) - tms(pre)))}` : ''}</summary>${rawPre(x)}</details>`
    : `<div class="hev muted">${missing}</div>`;
  const hooks = `<div class="hevs"><div class="k">${esc(TX.hookEvents)}</div>${hook(pre, 'PreToolUse · ' + esc(TX.notReceived))}${hook(post, fail ? '' : 'PostToolUse · ' + esc(TX.notYet))}</div>`;
  const tks = techsOf(name, d.tool_input).map(k => `${techIcon(k)} ${esc(TECH[k][0])}`);
  return evCard(e, evHead(st, toolLabel(name), ...tks, res, by && `<span class="muted">${esc(TX.askedByModel(fmtTime(by.ts)))}</span>`)
    + evSec(esc(TX.input), toolInputHtml(name, d.tool_input)) + (post ? evSec(esc(fail ? TX.error : TX.output), toolOutputHtml(name, post)) : ''), hooks);
}
const NOTE_TYPE = TX.note;
// the Agent call that started a subagent: the latest one before it asking for that agent type
const agentCallFor = (e, t) => t.events.filter(x => x.event === 'PreToolUse' && (x.data?.tool_name === 'Agent' || x.data?.tool_name === 'Task') && tms(x) <= tms(e) && (!e.data?.agent_type || x.data.tool_input?.subagent_type === e.data.agent_type)).pop();
function evOpenHtml(e, t) {
  const d = e.data || {}, K = TX.kv;
  switch (e.event) {
    case 'ModelStep': return stepCard(e, t);
    case 'PreToolUse': case 'PostToolUse': case 'PostToolUseFailure': return toolCard(e, t);
    case 'ModelText': return evCard(e, evHead('model', d.subagent ? TX.subagent : TX.mainAgent, esc(d.kind === 'thinking' ? TX.thinking : TX.wrote)) + evText(d.text, d.kind === 'thinking' ? 'th' : ''));
    case 'UserPromptSubmit': return evCard(e, evHead('you', TX.st.you, esc(TX.sentPrompt)) + evText(d.prompt, 'you'));
    case 'UserPromptExpansion': return evCard(e, evHead('you', TX.promptExpanded) + evSec(esc(TX.typed), evText(d.prompt, 'you')) + evSec(esc(TX.expandedTo), evText(d.expanded_prompt)) + evKv(d, new Set([...EV_COMMON, 'prompt', 'expanded_prompt'])));
    case 'Stop': case 'StopFailure': {
      const start = t.events[0], dur = start ? tms(e) - tms(start) : null;
      return evCard(e, evHead(e.event === 'Stop' ? 'you' : 'you', e.event === 'Stop' ? TX.turnFinished : TX.turnFailed, dur != null && esc(fmtDur(dur)), d.stop_hook_active && esc(TX.stopHookActive))
        + evSec(esc(TX.finalReply), evText(d.last_assistant_message)) + evSec(esc(TX.stillRunning), evKv({ [K.tasks]: d.background_tasks, [K.crons]: d.session_crons }, new Set()))
        + evKv(d, new Set([...EV_COMMON, 'last_assistant_message', 'background_tasks', 'session_crons', 'stop_hook_active'])));
    }
    case 'SubagentStart': {
      const call = agentCallFor(e, t);
      return evCard(e, evHead('agents', d.agent_type || TX.subagent, esc(TX.ev.started), d.agent_id && `<span class="muted">${esc(d.agent_id)}</span>`)
        + (call ? evSec(esc(TX.taskGiven), toolInputHtml(call.data.tool_name, call.data.tool_input)) : ''));
    }
    case 'SubagentStop': {
      const st0 = t.events.find(x => x.event === 'SubagentStart' && x.data?.agent_id === d.agent_id);
      return evCard(e, evHead('agents', d.agent_type || TX.subagent, esc(TX.ev.finished), st0 && esc(fmtDur(tms(e) - tms(st0))), d.agent_id && `<span class="muted">${esc(d.agent_id)}</span>`)
        + evSec(esc(TX.finalMessage), evText(d.last_assistant_message)) + evSec(esc(TX.stillRunning), evKv({ [K.tasks]: d.background_tasks, [K.crons]: d.session_crons }, new Set()))
        + evKv({ [K.transcript]: d.agent_transcript_path }, new Set()));
    }
    case 'PermissionRequest': case 'PermissionDenied':
      return evCard(e, evHead('you', e.event === 'PermissionRequest' ? TX.permissionAsked : TX.permissionDenied, esc(toolLabel(d.tool_name)), d.reason && esc(d.reason))
        + evSec(esc(TX.forThisCall), toolInputHtml(d.tool_name, d.tool_input)) + evKv(d, new Set([...EV_COMMON, 'tool_name', 'tool_input', 'reason'])));
    case 'Notification': return evCard(e, evHead('you', TX.notification, esc(NOTE_TYPE[d.notification_type] || d.notification_type || '')) + evText(d.message) + evKv(d, new Set([...EV_COMMON, 'message', 'notification_type'])));
    case 'SessionStart': return evCard(e, evHead('context', TX.sessionStarted, esc(d.source || ''), d.model && `<span class="muted">${esc(d.model)}</span>`) + evKv(d, new Set([...EV_COMMON, 'source', 'model'])));
    case 'SessionEnd': return evCard(e, evHead('context', TX.sessionEnded, esc(d.reason || '')) + evKv(d, new Set([...EV_COMMON, 'reason'])));
    case 'PostToolBatch': return evCard(e, evHead('other', TX.toolBatch, esc(nw((d.tool_calls || []).length, 'call'))) + (d.tool_calls || []).map(c => { const st = toolStation(c.tool_name, c.tool_input); return `<div class="tu"><span class="n" style="color:var(--s-${st})">${toolIcon(c.tool_name, c.tool_input, st)}${esc(toolLabel(c.tool_name))}</span><span class="a">${esc(toolArg(c))}</span><span></span></div>`; }).join(''));
    case 'MessageDisplay': return evCard(e, evHead('model', TX.messageShown, esc(d.final ? TX.final : TX.partX(d.index ?? ''))) + evText(d.delta));
    case 'ConfigChange': return evCard(e, evHead('context', TX.configChanged, esc(spaced(d.source))) + evKv({ [K.file]: d.file_path }, new Set()) + evKv(d, new Set([...EV_COMMON, 'source', 'file_path'])));
    case 'DirectoryAdded': return evCard(e, evHead('files', TX.dirAdded, d.source && esc(TX.viaX(spaced(d.source)))) + evKv({ [K.directory]: d.directory }, new Set()) + evKv(d, new Set([...EV_COMMON, 'source', 'directory'])));
    case 'WorktreeCreate': return evCard(e, evHead('files', TX.worktreeCreated, d.name && esc(d.name)) + evKv(d, new Set([...EV_COMMON, 'name'])));
    case 'WorktreeRemove': return evCard(e, evHead('files', TX.worktreeRemoved) + evKv({ [K.path]: d.worktree_path }, new Set()) + evKv(d, new Set([...EV_COMMON, 'worktree_path'])));
    case 'CwdChanged': return evCard(e, evHead('context', TX.cwdChanged) + evKv({ [K.from]: d.old_cwd, [K.to]: d.new_cwd }, new Set()) + evKv(d, new Set([...EV_COMMON, 'old_cwd', 'new_cwd'])));
    case 'PreModelSwitch': case 'PostModelSwitch': {
      const cost = d.estimated_cache_write_usd != null ? TX.resendCost(dec(Number(d.estimated_cache_write_usd).toFixed(2))) : '';
      return evCard(e, evHead('model', e.event === 'PreModelSwitch' ? TX.switchingModel : TX.modelSwitched, esc(`${d.from_model || '?'} → ${d.to_model || '?'}`), d.source && esc(d.source))
        + evKv({ [K.requested]: d.requested_model, [K.contextTokens]: d.context_tokens != null ? fmtN(d.context_tokens) : null, [K.cacheWarm]: d.prompt_cache_warm == null ? null : d.prompt_cache_warm ? TX.yes : TX.no, [K.cost]: cost }, new Set())
        + evKv(d, new Set([...EV_COMMON, 'from_model', 'to_model', 'source', 'requested_model', 'context_tokens', 'prompt_cache_warm', 'estimated_cache_write_usd'])));
    }
    default: {
      const [label, sub] = describe(e);
      return evCard(e, evHead(stationOf(e) || 'other', label || e.event, sub && esc(short(sub, 160))) + evKv(d));
    }
  }
}
const STOP_WHY = TX.stopWhy;
// the events that belong to one model step: by message id (tool_use ids for tools), or — for steps logged
// before those ids were recorded — the events of the same agent that follow it, up to its next step
function stepParts(e, t) {
  const d = e.data || {}, evs = t.events, sameAgent = x => (x.data?.agent_id ?? null) === (d.agent_id ?? null);
  const i = evs.indexOf(e), after = [];
  for (let j = i + 1; j < evs.length; j++) { const x = evs[j]; if (x.event === 'ModelStep' && sameAgent(x)) break; if (sameAgent(x)) after.push(x); }
  const byId = new Map(); for (const x of evs) if ((x.event === 'PreToolUse' || x.event.startsWith('PostToolUse')) && x.data?.tool_use_id) { const o = byId.get(x.data.tool_use_id) || {}; o[x.event === 'PreToolUse' ? 'pre' : 'post'] = x; byId.set(x.data.tool_use_id, o); }
  let calls;
  if (d.tool_ids?.length) calls = d.tool_ids.map((id, k) => ({ name: d.tools[k], ...(byId.get(id) || {}) }));
  else calls = after.filter(x => x.event === 'PreToolUse').map(x => ({ name: x.data.tool_name, guess: true, ...(byId.get(x.data.tool_use_id) || { pre: x }) }));
  const texts = d.msg_id ? evs.filter(x => x.event === 'ModelText' && x.data?.msg_id === d.msg_id) : after.filter(x => x.event === 'ModelText');
  return { calls, texts };
}
function stepCard(e, t) {
  const d = e.data || {}, k = d.tokens || {}, ctx = k.context || 0;
  const win = ctx > 200000 || /\[1m\]|-1m/i.test(d.model || '') ? 1000000 : (state.sessions.get(e.session_id)?.context?.window || 200000);
  const { calls, texts } = stepParts(e, t);
  const why = STOP_WHY[d.stop_reason] || (d.stop_reason ? d.stop_reason : TX.noStopReason);
  const head = `<div class="hd"><b>${esc(d.subagent ? TX.subagent : TX.mainAgent)}</b><span class="muted">${esc(d.model || '?')}</span><span>${esc(why)}</span></div>`;
  const tools = calls.length ? `<div><div class="k">${esc(TX.toolsAsked)}${calls.some(c => c.guess) ? ` <span style="text-transform:none;letter-spacing:0">${esc(TX.matchedByOrder)}</span>` : ''}</div>${calls.map(c => {
      const st = toolStation(c.name, c.pre?.data?.tool_input), x = c.post || c.pre, fail = c.post?.event === 'PostToolUseFailure';
      const res = fail ? `<span class="err">✕ ${esc(TX.failedLc)}</span>` : c.post ? `✓ ${esc(fmtDur(c.post.duration_ms ?? tms(c.post) - tms(c.pre || c.post)))}` : c.pre ? `<span class="busy">${esc(TX.runningEll)}</span>` : `<span class="muted">${esc(TX.noHookEvent)}</span>`;
      return `<div class="tu"><span class="n" style="color:var(--s-${st})">${toolIcon(c.name, c.pre?.data?.tool_input, st)}${esc(toolLabel(c.name))}</span><span class="a" title="${esc(short(toolArg(x?.data || {}), 400))}">${esc(toolArg(x?.data || {}) || '')}</span><span class="r">${res}</span></div>`;
    }).join('')}</div>` : d.stop_reason === 'tool_use' ? `<div class="muted">${esc(TX.toolNotLogged)}</div>` : '';
  const said = texts.length ? `<div><div class="k">${esc(TX.whatItWrote)}</div><div class="said">${texts.map(x => x.data.kind === 'thinking' ? `<span class="th">${esc(TX.thinking)}: ${esc(x.data.text)}</span>` : esc(x.data.text)).join('\n\n')}</div></div>` : '';
  const seg = [['cache_read', TX.cacheRead, 'var(--s-context)'], ['cache_write', TX.cacheWrite, 'var(--s-model)'], ['input', TX.uncached, 'var(--accent)']];
  const bar = `<div><div class="k">${esc(TX.st.context)} · ${esc(TX.ofPct(fmtN(ctx), fmtN(win), Math.round(100 * ctx / win)))}</div><div class="tokbar">${seg.map(([f, , c]) => k[f] ? `<i style="width:${(100 * k[f] / win).toFixed(2)}%;background:${c}"></i>` : '').join('')}</div>
    <div class="toklg">${seg.map(([f, l, c]) => `<span><i style="background:${c}"></i>${l} <b>${fmtN(k[f] || 0)}</b></span>`).join('')}<span>${esc(TX.outputLc)} <b>${fmtN(k.output || 0)}</b></span></div></div>`;
  return evCard(e, head + tools + said + bar);
}

function renderDetail() {
  const el = $('detail'); const top = el.scrollTop;
  const t = state.turnSel && TURNS.find(x => x.key === state.turnSel);
  if (!t) {
    el.innerHTML = `<div class="dh"><h2>${esc(TX.details)}</h2></div><p class="muted">${TX.pickTurn}</p>${colourKey(t)}`;
    return;
  }
  // a finished tool call is one row, built from its result (PostToolUse) but placed where the call started,
  // so the list keeps the order things began in (as the Route and the Chat do), not the order they finished
  const posts = new Map(t.events.filter(e => (e.event === 'PostToolUse' || e.event === 'PostToolUseFailure') && e.data?.tool_use_id).map(e => [e.data.tool_use_id, e]));
  const done = new Set(posts.keys());
  const started = new Set(t.events.filter(e => e.event === 'PreToolUse' && e.data?.tool_use_id).map(e => e.data.tool_use_id));
  const running = turnRunning(t);
  const fa = filtersActive();
  // one API response is a ModelStep plus a ModelText per text block: show them as one row (the step's card lists the text)
  const steps = new Map(t.events.filter(e => e.event === 'ModelStep' && e.data?.msg_id).map(e => [e.data.msg_id, e])), said = new Map();
  for (const e of t.events) if (e.event === 'ModelText' && steps.has(e.data?.msg_id)) {
    const k = e.data.msg_id, txt = (e.data.kind === 'thinking' ? TX.thinking + ': ' : '') + e.data.text, o = said.get(k);
    // written text wins over thinking
    said.set(k, !o ? { txt, th: e.data.kind === 'thinking' } : o.th && e.data.kind !== 'thinking' ? { txt, th: false } : o.th === (e.data.kind === 'thinking') ? { txt: o.txt + ' ' + txt, th: o.th } : o);
  }
  const cxSide = state.layout === 'context';
  const rows = t.events.filter(e => !((e.event === 'PostToolUse' || e.event === 'PostToolUseFailure') && started.has(e.data?.tool_use_id)) && !FEED_HIDE.has(e.event) && !(e.event === 'Stop' && t.answer)
    && !(e.event === 'ModelText' && steps.has(e.data?.msg_id))).map(e => {
    const post = e.event === 'PreToolUse' ? posts.get(e.data?.tool_use_id) : null, r = post || e;
    const isRun = running && e.event === 'PreToolUse' && !post;
    const open = state.evOpen.has(r.seq) || state.evOpen.has(e.seq);
    // a tool row says what was called; its result is in the row's card
    const sub = e.event === 'PreToolUse' ? describe(e)[1] : null;
    const row = feedRow(r, isRun, { dur: true, ts: e.ts, sub, said: e.event === 'ModelStep' ? said.get(e.data?.msg_id)?.txt : null });
    // beside the Context view a row click shows its message there; the arrow only opens and closes the row
    const head = cxSide ? `<div class="erh"><button class="etog" title="${esc(open ? TX.collapse : TX.expand)}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>${row}</div>` : row;
    return `<div class="erow ${open ? 'open' : ''} ${fa && (evMatches(e) || evMatches(r)) ? 'hit' : ''}" id="ev-${r.seq}" data-pre="${e.seq}">${head}${open ? evOpenHtml(r, t) : ''}</div>`;
  });
  // beside the Context view, the events follow its order (newest first unless switched); elsewhere they read top down
  const newest = cxSide && ctxOrder !== 'old';
  if (newest) rows.reverse();
  const s = state.sessions.get(t.sid);
  const dur = Date.parse(t.end) - Date.parse(t.start);
  el.innerHTML = `<div class="dh"><h2>${esc(TX.turn)} · ${fmtTime(t.start)}</h2><span><button id="prevTurn" title="${esc(TX.prevTitle)}">${esc(TX.prev)}</button> <button id="nextTurn" title="${esc(TX.nextTitle)}">${esc(TX.next)}</button> <button id="closeTurn" title="${esc(TX.closeTitle)}">${esc(TX.close)}</button></span></div>
    <p class="lead">${esc(base(s?.cwd))} · ${esc(running ? TX.running : t.failed ? TX.failedLc : t.done ? TX.ev.done : TX.unfinished)} · ${fmtDur(dur)} · ${esc(nw(t.steps, 'modelStep'))} · ${esc(nw(t.tools, 'toolCall'))} (${fmtDur(t.toolMs)}) · ${esc(TX.outTokens(fmtN(t.out)))}${t.errors ? ` · <span class="err">${esc(nw(t.errors, 'problem'))}</span>` : ''}</p>
    ${dsec('prompt', esc(TX.prompt), `<div class="q">${t.prompt !== null ? esc(t.prompt) : `<span class="muted">${esc(TX.noPrompt)}</span>`}</div>`)}
    ${t.answer ? dsec('reply', esc(TX.reply), `<div class="q ans">${esc(t.answer)}</div>`) : ''}
    ${dsec('events', `${esc(TX.events)} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${newest ? esc(TX.newestFirst) + ' · ' : ''}${esc(cxSide ? TX.eventsCtxHint : TX.eventsHint)}</span>`, `<div>${rows.join('')}</div>`)}${colourKey(t)}`;
  el.scrollTop = top;
  applyHover(); // keep the row lit for the chat item / route stop under the mouse
}
function selectTurn(key, seq) {
  state.turnSel = key; state.evOpen = new Set(seq ? [seq] : []);
  renderDetail(); renderMid();
  const d = $('detail');
  const r = seq && ($('ev-' + seq) || $('detail').querySelector(`.erow[data-pre="${seq}"]`));
  // scroll only the panel (scrollIntoView would also scroll the page)
  d.scrollTop = r ? d.scrollTop + r.getBoundingClientRect().top - d.getBoundingClientRect().top - d.clientHeight / 3 : 0;
}
function stepTurn(dir) {
  const list = TURNS.filter(turnMatches);
  if (!list.length) return;
  const i = list.findIndex(t => t.key === state.turnSel);
  const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
  selectTurn(list[n].key);
}
