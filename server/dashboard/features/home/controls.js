'use strict';
// Session Observer dashboard — Home, the controls: a session or a wait opens that session on its Route.
function initHomeControls() {
  viewBox().addEventListener('click', event => {
    const row = event.target.closest('[data-home-session]');
    if (!row) return;
    selectScope(row.dataset.homeSession);
    setView('route');
  });
}
