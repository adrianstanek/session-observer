'use strict';
// Session Observer dashboard — hover links between the views and Details: a row hovered in Details lights its stop on
// the Route or its message in the Chat, and a stop or message under the mouse lights its rows in Details.
let hoveredLineKey = null;   // a Route line (a turn's main line or one subagent's branch) under the mouse
let hoveredDetailSeq = null; // an event row hovered in the Details panel
let hoveredViewSeqs = null;  // the seqs of the chat item / route stop under the mouse

const stopForSeq = (svg, seq) => svg.querySelector(`[data-seqs~="${CSS.escape(String(seq))}"]`);
const detailRowForSeq = seq => elementById('ev-' + seq) || elementById('detail').querySelector(`.erow[data-pre="${seq}"]`);

// route: the hovered line lit, and the hovered Details row's stop pinned; everything else fades
function highlightRoute(box) {
  const svg = box.querySelector('svg.metro');
  if (!svg) return;
  const pinnedStop = hoveredDetailSeq != null ? stopForSeq(svg, hoveredDetailSeq) : null;
  svg.classList.toggle('hl', !!hoveredLineKey || !!pinnedStop);
  for (const element of svg.querySelectorAll('.on, .pin')) element.classList.remove('on', 'pin');
  if (hoveredLineKey) for (const element of svg.querySelectorAll(`[data-ln~="${CSS.escape(hoveredLineKey)}"]`)) element.classList.add('on');
  if (pinnedStop) pinnedStop.classList.add('on', 'pin');
}

// chat: the items for the hovered Details row lit, the rest faded
function highlightChat(box) {
  const chat = box.querySelector('.chat');
  if (!chat) return;
  for (const element of chat.querySelectorAll('.pin')) element.classList.remove('pin');
  const matches = hoveredDetailSeq != null ? [...chat.querySelectorAll(`[data-seqs~="${hoveredDetailSeq}"]`)] : [];
  for (const element of matches) element.classList.add('pin');
  chat.classList.toggle('hl', matches.length > 0);
}

// details: the rows for the chat item / route stop under the mouse lit
function highlightDetailRows() {
  for (const row of elementById('detail').querySelectorAll('.erow.pin')) row.classList.remove('pin');
  if (hoveredViewSeqs) for (const seq of hoveredViewSeqs) detailRowForSeq(seq)?.classList.add('pin');
}

function applyHoverHighlights() {
  const box = viewBox();
  highlightRoute(box);
  highlightChat(box);
  highlightDetailRows();
}

// bring the lit item into view inside its scroll box, if it is outside it
function scrollIntoBox(scroller, element) {
  if (!scroller || !element) return;
  const box = scroller.getBoundingClientRect(), item = element.getBoundingClientRect();
  if (item.top < box.top + 20 || item.bottom > box.bottom - 20) scroller.scrollTop += item.top - box.top - box.height / 2 + item.height / 2;
}

// route stop / chat item / details row
function revealHighlighted() {
  const routeScroller = viewBox().querySelector('.mscroll'), svg = routeScroller?.querySelector('svg.metro');
  if (svg && hoveredDetailSeq != null) scrollIntoBox(routeScroller, stopForSeq(svg, hoveredDetailSeq));
  const chat = viewBox().querySelector('.chat');
  if (chat && hoveredDetailSeq != null) scrollIntoBox(chat, chat.querySelector('.pin'));
  if (hoveredViewSeqs) scrollIntoBox(elementById('detail'), elementById('detail').querySelector('.erow.pin'));
}
