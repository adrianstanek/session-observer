'use strict';
// Session Observer dashboard — Sessions panel, the controls: a click picks the scope, hovering shows the hover card.
async function deleteSessionFromDashboard(button) {
  const id = button.dataset.deleteSession;
  const session = state.sessions.get(id);
  if (!confirm(TEXT.deleteSessionConfirm(session ? sessionName(session) : id))) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || 'Could not delete session');
    }
  } catch (error) {
    button.title = error.message;
    button.disabled = false;
  }
}

function initSessionsControls() {
  elementById('sessions').onclick = event => {
    const deleteButton = event.target.closest('[data-delete-session]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      return deleteSessionFromDashboard(deleteButton);
    }
    const card = event.target.closest('.card');
    if (card) selectScope(card.dataset.id);
  };
  elementById('sessions').addEventListener('mouseover', event => hoverSession(event.target.closest('.sess-list .card')?.dataset.id ?? null));
  elementById('sessions').addEventListener('mouseleave', () => hoverSession(null));
  elementById('sessions').addEventListener('scroll', () => { if (hoveredSessionId) hoverSession(null); });
}
