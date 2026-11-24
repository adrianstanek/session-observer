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
  map: markViewDirty,
};
const ALL_PARTS = Object.keys(RENDERERS);
const partsToRender = new Set();
let renderFrame = 0;
// a mouse button or finger is down on the page: nothing is redrawn until it is released, or a redraw between press and
// release would swap the button under the pointer and the click would be lost (initPointerHold)
let pointerHeld = false;

function scheduleRender(...parts) {
  for (const part of parts) partsToRender.add(part);
  if (!renderFrame) renderFrame = requestAnimationFrame(renderScheduledParts);
}

function renderScheduledParts() {
  renderFrame = 0;
  if (pointerHeld) return; // the parts wait for the release
  for (const [part, render] of Object.entries(RENDERERS)) if (partsToRender.has(part)) render();
  partsToRender.clear();
  viewNeedsDrawing = true;
}

function initPointerHold() {
  addEventListener('pointerdown', () => { pointerHeld = true; }, true);
  const release = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    if (partsToRender.size) scheduleRender(); // what waited is drawn now (the view catches up on its own)
  };
  for (const name of ['pointerup', 'pointercancel']) addEventListener(name, release, true);
  // only the window losing focus ends the hold: a button or input losing it (the press moves focus) must not
  addEventListener('blur', event => { if (event.target === window) release(); }, true);
}

// every frame: the view in #alt is drawn when something changed
function animationLoop(now) {
  requestAnimationFrame(animationLoop);
  if (document.hidden) return;
  if (activityChanged) {
    activityChanged = false;
    viewNeedsDrawing = true;
  }
  drawView(now);
}
