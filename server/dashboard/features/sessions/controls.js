'use strict';
// Session Observer dashboard — Sessions panel, the controls: a click picks the scope, hovering shows the hover card.
function initSessionsControls() {
  elementById('sessions').onclick = event => {
    const card = event.target.closest('.card');
    if (card) selectScope(card.dataset.id);
  };
  elementById('sessions').addEventListener('mouseover', event => hoverSession(event.target.closest('.sess-list .card')?.dataset.id ?? null));
  elementById('sessions').addEventListener('mouseleave', () => hoverSession(null));
  elementById('sessions').addEventListener('scroll', () => { if (hoveredSessionId) hoverSession(null); });
}
