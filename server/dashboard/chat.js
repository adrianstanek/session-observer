'use strict';
// Session Observer dashboard — Chat view: the conversation as a messenger.
// ---- chat: the conversation as a messenger
let chatScroll = { key: null, atBottom: true, top: 0 };
// a little markdown for the agent's replies: fenced code, `inline code`, **bold**
function mdLite(src) {
  const parts = String(src ?? '').split(/```[\w-]*\n?([\s\S]*?)(?:```|$)/);
  return parts.map((p, i) => i % 2 ? `<pre>${esc(p.replace(/\n$/, ''))}</pre>`
    : esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')).join('').trim();
}
function chatHtml() {
  const lim = state.cursor ?? Infinity, multi = state.scope === 'all';
  const turns = TURNS.filter(t => tms(t.events[0]) <= lim).slice(-150);
  if (!turns.length) return '<div class="chat"><div class="cempty">No conversation yet</div></div>';
  let h = '<div class="chat">', lastSid = null;
  for (const t of turns) {
    if (multi && t.sid !== lastSid) {
      const s = state.sessions.get(t.sid);
      h += `<div class="csess">${esc(trunc(clean(s?.title) || base(s?.cwd) || t.sid.slice(0, 8), 60))}</div>`;
    }
    lastSid = t.sid;
    const evs = t.events.filter(e => tms(e) <= lim && (!e.data?.subagent && e.data?.agent_id == null || e.event === 'SubagentStart' || e.event === 'SubagentStop'));
    const cls = [state.turnSel === t.key && 'sel', filtersActive() && !turnMatches(t) && 'dim'].filter(Boolean).join(' ');
    h += `<div class="cturn ${cls}" data-tk="${esc(t.key)}"><div class="cth" data-key="${esc(t.key)}" title="Open this turn">${fmtTime(t.start)}${t.tools ? ' · ' + t.tools + ' tools' : ''}${t.errors ? ' · ✕' + t.errors : ''}</div>`;
    let tools = [], said = false, stop = null;
    // a text bubble belongs to the model step it came from: hovering / clicking it reaches that step's row in Details
    const stepSeq = new Map(t.events.filter(e => e.event === 'ModelStep' && e.data?.msg_id).map(e => [e.data.msg_id, e.seq]));
    const seqsOf = ev => [ev.seq, stepSeq.get(ev.data?.msg_id)].filter(x => x != null).join(' ');
    const open = new Map();
    const flush = () => { if (tools.length) h += `<div class="ctools">${tools.join('')}</div>`; tools = []; };
    for (const ev of evs) {
      const d = ev.data || {};
      switch (ev.event) {
        case 'UserPromptSubmit': flush(); h += `<div class="bub me" data-seq="${ev.seq}" data-seqs="${ev.seq}">${esc(d.prompt)}<span class="bt">${fmtTime(ev.ts)}</span></div>`; break;
        case 'ModelText': {
          const txt = String(d.text || '').trim(); if (!txt) break;
          flush();
          if (d.kind === 'thinking') h += `<div class="bub think" data-seq="${stepSeq.get(d.msg_id) ?? ev.seq}" data-seqs="${seqsOf(ev)}">${esc(txt)}</div>`;
          else { said = true; h += `<div class="bub ai" data-seq="${stepSeq.get(d.msg_id) ?? ev.seq}" data-seqs="${seqsOf(ev)}">${mdLite(txt)}<span class="bt">${fmtTime(ev.ts)}</span></div>`; }
          break;
        }
        case 'PreToolUse': {
          // __R<id>__ becomes "run" / "fail" / nothing, __S<id>__ the result's seq, once they are known
          const st = stationOf(ev) || 'other';
          tools.push(`<span class="ctool __R${d.tool_use_id || ''}__" data-seq="${ev.seq}" data-seqs="${ev.seq}__S${d.tool_use_id || ''}__" style="--c:var(--s-${st})" title="${evTip(ev)}">${evIcon(ev, st)}<span><b>${esc(toolLabel(d.tool_name))}</b> ${esc(trunc(st === 'files' ? base(String(toolArg(d) || '')) : short(toolArg(d), 60), 40))}</span></span>`);
          if (d.tool_use_id) open.set(d.tool_use_id, true);
          break;
        }
        case 'PostToolUse': case 'PostToolUseFailure':
          if (d.tool_use_id) { open.delete(d.tool_use_id); const k = `__S${d.tool_use_id}__`; tools = tools.map(x => x.replace(k, ' ' + ev.seq)); h = h.replace(k, ' ' + ev.seq); }
          if (ev.event === 'PostToolUseFailure') { const k = `__R${d.tool_use_id}__`; tools = tools.map(x => x.replace(k, 'fail')); h = h.replace(k, 'fail'); }
          break;
        case 'SubagentStart': tools.push(`<span class="ctool" data-seq="${ev.seq}" data-seqs="${ev.seq}" style="--c:var(--s-agents)" title="${evTip(ev)}">${icon('agents')}<span><b>${esc(d.agent_type || 'subagent')}</b> started</span></span>`); break;
        case 'SubagentStop': tools.push(`<span class="ctool" data-seq="${ev.seq}" data-seqs="${ev.seq}" style="--c:var(--s-agents)" title="${evTip(ev)}">${icon('agents')}<span><b>${esc(d.agent_type || 'subagent')}</b> done</span></span>`); break;
        case 'PermissionDenied': tools.push(`<span class="ctool fail" data-seq="${ev.seq}" data-seqs="${ev.seq}" title="${evTip(ev)}">${icon('you')}<span>denied ${esc(toolLabel(d.tool_name))}</span></span>`); break;
        case 'Stop': case 'StopFailure': stop = ev; break;
      }
    }
    flush();
    // the hook's final message, when the transcript text never arrived
    if (stop && !said && (stop.data?.last_assistant_message || stop.event === 'StopFailure'))
      h += `<div class="bub ai ${stop.event === 'StopFailure' ? 'fail' : ''}" data-seq="${stop.seq}" data-seqs="${stop.seq}">${mdLite(stop.data?.last_assistant_message || stop.data?.error || 'turn failed')}<span class="bt">${fmtTime(stop.ts)}</span></div>`;
    if (!stop && turnRunning(t) && state.cursor == null) h += `<div class="ctyping"><span class="dot busy"></span>Claude is working…</div>`;
    h += '</div>';
    // tool chips still open are running; the rest are plain
    for (const id of open.keys()) h = h.replace(`__R${id}__`, 'run');
  }
  return h.replace(/__R\S*?__(?=[\s"])/g, '').replace(/__S\S*?__(?=")/g, '') + '</div>';
}
