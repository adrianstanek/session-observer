'use strict';
// Session Observer dashboard — Home, the controls: a session or a wait opens that session on its Route.
const pendingSessionPins = new Set();

async function toggleSessionPin(button) {
  const id = button.dataset.pinSession;
  if (pendingSessionPins.has(id)) return;
  pendingSessionPins.add(id);
  button.setAttribute('aria-disabled', 'true');
  const method = button.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT';
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/pin`, { method });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    if (!state.connected || state.frozen) {
      await loadSessions();
      scheduleRender('mid');
    }
  } catch (error) {
    alert(TEXT.home.pinFailed(error.message));
  } finally {
    pendingSessionPins.delete(id);
    button.removeAttribute('aria-disabled');
  }
}

function initHomeControls() {
  viewBox().addEventListener('click', event => {
    const pinButton = event.target.closest('[data-pin-session]');
    if (pinButton) return toggleSessionPin(pinButton);
    const deleteButton = event.target.closest('[data-delete-session]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      return deleteSessionFromDashboard(deleteButton);
    }
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
