'use strict';
// Session Observer dashboard — Context view: one session's whole conversation in one scrolling page: every prompt,
// reply, thinking block, tool call with its full input and result, subagent and compaction.
const CONTEXT_REFETCH_MS = 1500;

const segmentButton = (attribute, value, isCurrent, label, extra = '') => `<button ${attribute}="${value}" class="${isCurrent ? 'cur' : ''}" ${extra}>${escapeHtml(label)}</button>`;

function contextToolbarHtml(data, items, compacted) {
  const toolCalls = items.filter(item => item.kind === 'call').length;
  const bookkeeping = items.filter(item => item.kind === 'attachment' && item.role === 'meta').length;
  const prompts = items.filter(item => item.kind === 'user').length;
  // context now: the session's latest model step, and its change from the one before (the subagents' don't count)
  const steps = data.items.filter(item => item.kind === 'step'), lastStep = steps.at(-1);
  const contextNow = lastStep ? contextSizeInfo(lastStep.ctx, steps.length > 1 ? lastStep.ctx - steps.at(-2).ctx : null) : null;
  return `<div class="cxbar">
    <div class="seg"><button data-cxm="all" class="${contextRange === 'all' ? 'cur' : ''}">${escapeHtml(TEXT.wholeSession)}</button><button data-cxm="now" class="${contextRange === 'now' ? 'cur' : ''}" ${compacted ? '' : `disabled title="${escapeHtml(TEXT.notCompacted)}"`}>${escapeHtml(TEXT.sinceCompaction)}</button></div>
    <div class="seg" title="${escapeHtml(TEXT.msgOrder)}"><button data-cxo="new" class="${contextOrder !== 'old' ? 'cur' : ''}">${escapeHtml(TEXT.newestFirstBtn)}</button><button data-cxo="old" class="${contextOrder === 'old' ? 'cur' : ''}">${escapeHtml(TEXT.oldestFirstBtn)}</button></div>
    <label class="check" title="${escapeHtml(TEXT.bookkeepingTitle)}"><input type="checkbox" data-cxa ${showBookkeeping ? 'checked' : ''}> ${escapeHtml(TEXT.bookkeeping)} (${bookkeeping})</label>
    <span class="grow"></span>
    <span class="muted">${escapeHtml(countOf(prompts, 'prompt'))} · ${escapeHtml(countOf(toolCalls, 'toolCall'))}</span>${contextNow ? `<span class="muted">${escapeHtml(TEXT.ctxNow)}</span>${contextBadgeHtml(contextNow)}` : ''}
    <div class="seg" title="${escapeHtml(TEXT.turns)}"><button data-cxx="topen">${escapeHtml(TEXT.expandTurns)}</button><button data-cxx="tclose">${escapeHtml(TEXT.collapseTurns)}</button></div>
    <button data-cxx="open">${escapeHtml(TEXT.expandAll)}</button><button data-cxx="close">${escapeHtml(TEXT.collapseAll)}</button><button data-cxx="copy" title="${escapeHtml(TEXT.copyTitle)}">${escapeHtml(TEXT.copy)}</button></div>`;
}

function contextBodyHtml(data, searchText) {
  const { items, compacted } = itemsInRange(data);
  const conversation = contextMessagesHtml(items, 'i', searchText);
  const searchNote = searchText ? contextNoteHtml(TEXT.showingMatches(searchText)) : '';
  return `<div class="ctxv">${contextToolbarHtml(data, items, compacted)}<div class="cxs">${contextUsageHtml(data, '')}${contextPreludeHtml(data, '', true)}${searchNote}${conversation || `<div class="cempty">${escapeHtml(TEXT.nothingYet)}</div>`}</div></div>`;
}

const contextMessage = text => `<div class="ctxv"><div class="cempty">${escapeHtml(text)}</div></div>`;

function contextViewHtml() {
  const sessionId = contextSessionId();
  if (!sessionId) return contextMessage(TEXT.pickSession);
  const session = state.sessions.get(sessionId);
  const version = session ? `${session.eventCount}:${session.usage?.turns}:${session.last}` : '';
  const isStale = contextView.version !== version && Date.now() - contextView.fetchedAt > CONTEXT_REFETCH_MS;
  if (contextView.sessionId !== sessionId || isStale) fetchContext(sessionId, version);
  if (contextView.sessionId !== sessionId) return contextMessage(TEXT.readingTranscript);
  if (!contextView.data) return contextMessage(TEXT.cantRead(contextView.error));
  const renderKey = [contextView.fetchedAt, contextRange, contextOrder, showBookkeeping, state.searchText, state.selectedTurnKey, allTurns.length,
    [...openContextCards].join(','), [...collapsedContextTurns].join(',')].join('|');
  if (renderKey !== contextView.renderKey) {
    contextView.renderKey = renderKey;
    contextView.html = contextBodyHtml(contextView.data, state.searchText);
  }
  return contextView.html;
}

// ---- controls (the cards themselves open and close as plain <details>)
function scrollToUsageCard(target) {
  const box = viewBox();
  const card = target === '@msgs' ? box.querySelector('.cxs > .cxturn') : box.querySelector(`.cxs > details.cx[data-cx="${target}"]`);
  if (!card) return;
  if (card.tagName === 'DETAILS') card.open = true;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyContextAsMarkdown(button) {
  navigator.clipboard?.writeText(contextMarkdown()).then(
    () => { button.textContent = TEXT.copied; setTimeout(() => { button.textContent = TEXT.copy; }, 1200); },
    () => { button.textContent = TEXT.copyFailed; });
}

function handleContextToolbarAction(button) {
  const action = button.dataset.cxx;
  if (action === 'copy') return copyContextAsMarkdown(button);
  if (action === 'topen' || action === 'tclose') {
    for (const section of viewBox().querySelectorAll('.cxs > .cxturn')) setContextTurnCollapsed(section, action === 'tclose');
    contextView.renderKey = '';
    return;
  }
  const open = action === 'open';
  for (const card of viewBox().querySelectorAll('details.cx')) card.open = open;
}

viewBox().addEventListener('click', event => {
  const rangeButton = event.target.closest('[data-cxm]');
  if (rangeButton && !rangeButton.disabled) {
    contextRange = rangeButton.dataset.cxm;
    storage.set('so.ctxMode', contextRange);
    viewNeedsDrawing = true;
    return;
  }
  const orderButton = event.target.closest('[data-cxo]');
  if (orderButton) {
    contextOrder = orderButton.dataset.cxo;
    storage.set('so.ctxOrder', contextOrder);
    viewNeedsDrawing = true;
    renderDetails();
    return;
  }
  const bookkeepingBox = event.target.closest('[data-cxa]');
  if (bookkeepingBox) {
    showBookkeeping = bookkeepingBox.checked;
    storage.set('so.ctxMeta', showBookkeeping ? '1' : '0');
    viewNeedsDrawing = true;
    return;
  }
  const usageRow = event.target.closest('[data-cxgo]');
  if (usageRow) return scrollToUsageCard(usageRow.dataset.cxgo);
  const actionButton = event.target.closest('[data-cxx]');
  if (actionButton) handleContextToolbarAction(actionButton);
});

// remember which cards are open ('toggle' does not bubble); "-id" marks a card that starts open but was closed
viewBox().addEventListener('toggle', event => {
  const id = event.target.dataset?.cx;
  if (id == null) return;
  if (event.target.open) {
    openContextCards.add(id);
    openContextCards.delete('-' + id);
  } else {
    openContextCards.delete(id);
    openContextCards.add('-' + id);
  }
}, true);
