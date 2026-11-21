'use strict';
// Session Observer dashboard — Home, the controls: a session or a wait opens that session on its Route.
function initHomeControls() {
  viewBox().addEventListener('toggle', event => {
    const disclosure = event.target.closest('.harchive details[data-home-project]');
    if (!disclosure) return;
    const projectId = disclosure.dataset.homeProject;
    if (disclosure.open) homeExpandedProjects.add(projectId);
    else homeExpandedProjects.delete(projectId);
  }, true);
  viewBox().addEventListener('click', event => {
    const deleteButton = event.target.closest('[data-delete-session]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      return deleteSessionFromDashboard(deleteButton);
    }
    const focus = event.target.closest('[data-focus-session]');
    if (focus) {
      event.preventDefault();
      event.stopPropagation();
      focus.disabled = true;
      fetch(`/api/focus?session=${encodeURIComponent(focus.dataset.focusSession)}`, { method: 'POST' })
        .then(response => response.ok ? null : response.json().then(body => { throw new Error(body.error || 'Could not focus window'); }))
        .catch(error => { focus.title = error.message; })
        .finally(() => { focus.disabled = false; });
      return;
    }
    const row = event.target.closest('[data-home-session]');
    if (!row) return;
    selectScope(row.dataset.homeSession);
    setView('route');
  });
}
