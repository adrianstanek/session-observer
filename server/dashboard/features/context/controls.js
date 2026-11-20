'use strict';
// Session Observer dashboard — Context view, the controls: the toolbar, usage rows, folding turns, and remembering
// which cards are open (the cards themselves open and close as plain <details>).
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

// Registered before the views' own click handlers (app/view-controls.js), so the turn arrow's handler runs first.
function initContextControls() {
  // The arrow only folds the turn: stop the click before it reaches the header's "show in Details". (Registered before
  // the view's other click handlers, so it runs first.)
  viewBox().addEventListener('click', event => {
    const toggle = event.target.closest('[data-cxtt]');
    if (!toggle) return;
    event.stopImmediatePropagation();
    const section = toggle.closest('.cxturn');
    setContextTurnCollapsed(section, !section.classList.contains('shut'));
    contextView.renderKey = ''; // the cached HTML no longer matches
  });
  viewBox().addEventListener('click', () => { if (state.view === 'context') lastContextClickAt = Date.now(); }, true);
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
}
