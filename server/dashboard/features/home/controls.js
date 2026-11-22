'use strict';
// Session Observer dashboard — Home, the controls: a session or a wait opens that session on its Route.
function initHomeControls() {
  viewBox().addEventListener('click', event => {
    // only a click on its summary is your choice: a past-sessions list opened by a search or a selection is not
    const summary = event.target.closest('.harchive details[data-home-project] > summary');
    if (summary) {
      const disclosure = summary.parentElement;
      homePastShown.set(disclosure.dataset.homeProject, !disclosure.open); // (the click toggles it after this)
      return;
    }
    const row = event.target.closest('[data-home-session]');
    if (!row) return;
    // the Route gets a history entry of its own first, so Back returns to Home as it was, without the session
    setView('route');
    selectScope(row.dataset.homeSession);
  });
}
