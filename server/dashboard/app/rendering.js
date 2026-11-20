'use strict';
// Session Observer dashboard — render scheduling: parts of the page are rendered once per animation frame, and the
// view in the stage is drawn when something changed.
// Parts of the page to render on the next animation frame.
const RENDERERS = {
  turns: () => { allTurns = buildTurns(state.events); },
  header: renderHeader,
  sessions: renderSessions,
  cats: renderCategoryChips,
  mid: () => renderOverview(),
  detail: renderDetails,
  replay: renderReplayBar,
  map: markViewDirty,
};
const ALL_PARTS = Object.keys(RENDERERS);
const partsToRender = new Set();
let renderFrame = 0;

function scheduleRender(...parts) {
  for (const part of parts) partsToRender.add(part);
  if (!renderFrame) renderFrame = requestAnimationFrame(renderScheduledParts);
}

function renderScheduledParts() {
  renderFrame = 0;
  for (const [part, render] of Object.entries(RENDERERS)) if (partsToRender.has(part)) render();
  partsToRender.clear();
  viewNeedsDrawing = true;
}

// every frame: the replay moves on and the view in #alt is drawn when something changed
function animationLoop(now) {
  requestAnimationFrame(animationLoop);
  if (document.hidden) return;
  if (state.replaying) advanceReplay(now);
  if (activityChanged) {
    activityChanged = false;
    viewNeedsDrawing = true;
  }
  drawView(now);
}
