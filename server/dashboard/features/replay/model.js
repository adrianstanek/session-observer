'use strict';
// Session Observer dashboard — the replay bar: play the loaded events back over time, or seek to a moment.
const REPLAY_FRAME_MAX_MS = 250;   // a long frame (a hidden tab) never jumps further than this
const IDLE_GAP_MS = 1500;          // a gap longer than this (at replay speed) is skipped
const IDLE_GAP_LEAD_MS = 400;      // …to just before the next event
const REPLAY_BAR_REDRAW_MS = 200;
let lastReplayBarDraw = 0;

// the time span of the loaded events [first, last] (at least a second), or null with no events
function replayTimeRange() {
  const events = state.events;
  if (!events.length) return null;
  const first = eventTime(events[0]);
  return [first, Math.max(eventTime(events[events.length - 1]), first + 1000)];
}

const fractionOfRange = (time, [first, last]) => (time - first) / (last - first);
const latestTurnBy = limit => { let latest = null; for (const turn of allTurns) if (Date.parse(turn.start) <= limit) latest = turn; return latest; };

// a tick per turn on the track, as tall as the turn was busy
function replayTicksHtml(range, currentTurn) {
  const busiest = Math.max(1, ...allTurns.map(turn => turn.toolCount + turn.stepCount));
  return allTurns.filter(turn => turn.prompt !== null).map(turn => {
    const left = fractionOfRange(Date.parse(turn.start), range) * 100;
    const height = 5 + 15 * Math.sqrt((turn.toolCount + turn.stepCount) / busiest);
    const title = escapeHtml(formatTime(turn.start) + ' · ' + shorten(turn.prompt, 80));
    return `<div class="tick ${turn.problemCount ? 'err' : ''} ${turn === currentTurn ? 'cur' : ''}" style="left:${left.toFixed(3)}%;height:${height.toFixed(1)}px" title="${title}"></div>`;
  }).join('');
}

function renderReplayBar() {
  const range = replayTimeRange();
  const position = !range || state.replayCursor == null ? 1 : Math.max(0, Math.min(1, fractionOfRange(state.replayCursor, range)));
  elementById('fill').style.width = (position * 100) + '%';
  elementById('thumb').style.left = (position * 100) + '%';
  elementById('live').classList.toggle('on', state.replayCursor == null);
  elementById('play').textContent = state.replaying ? TEXT.pauseBtn : TEXT.replayBtn;
  const currentTurn = latestTurnBy(replayLimit());
  elementById('ticks').innerHTML = range ? replayTicksHtml(range, currentTurn) : '';
  const mode = state.replayCursor == null
    ? `<b>${escapeHtml(TEXT.liveBtn)}</b>`
    : `<b>${escapeHtml(state.replaying ? TEXT.replaying : TEXT.paused)}</b> · ${formatTime(state.replayCursor)}`;
  const turnNote = currentTurn && currentTurn.prompt ? ` · ${escapeHtml(TEXT.turnLc)} ${formatTime(currentTurn.start)} · ${escapeHtml(shorten(currentTurn.prompt, 60))}` : '';
  elementById('rlabel').innerHTML = mode + turnNote;
  for (const column of document.querySelectorAll('#mid .col')) {
    column.classList.toggle('cur', !!currentTurn && column.dataset.key === currentTurn.key && state.replayCursor != null);
  }
}

function setReplayCursor(time) {
  state.replayCursor = time;
  rebuildActivity();
  renderReplayBar();
  markViewDirty();
}

function goLive() {
  state.replaying = false;
  state.replayCursor = null;
  if (state.frozenEvents.length && !state.frozen) applyFrozenEvents();
  rebuildActivity();
  renderReplayBar();
  markViewDirty();
}

// from the selected turn's start, else from the first event
function startReplay() {
  if (!state.events.length) return;
  if (state.replayCursor == null) {
    const turn = selectedTurn();
    const start = turn ? Date.parse(turn.start) : eventTime(state.events[0]);
    state.replayCursor = start - 1;
    rebuildActivity();
  }
  state.replaying = true;
  state.lastReplayTick = performance.now();
  renderReplayBar();
  markViewDirty();
}

// one animation frame of the replay: move the cursor on and apply the events it passed
function advanceReplay(now) {
  const elapsed = Math.min(REPLAY_FRAME_MAX_MS, now - state.lastReplayTick);
  state.lastReplayTick = now;
  const events = state.events;
  let index = state.replayIndex;
  if (index >= events.length) return goLive();
  let cursor = state.replayCursor + elapsed * state.replaySpeed;
  const nextEventTime = eventTime(events[index]);
  if (nextEventTime - state.replayCursor > IDLE_GAP_MS * state.replaySpeed) cursor = Math.max(cursor, nextEventTime - IDLE_GAP_LEAD_MS * state.replaySpeed);
  let applied = false;
  while (index < events.length && eventTime(events[index]) <= cursor) {
    applyEventToActivity(events[index]);
    index++;
    applied = true;
  }
  state.replayIndex = index;
  state.replayCursor = cursor;
  if (index >= events.length) return goLive();
  if (applied) markViewDirty();
  if (now - lastReplayBarDraw > REPLAY_BAR_REDRAW_MS) {
    lastReplayBarDraw = now;
    renderReplayBar();
  }
}

// a click or drag on the track: the right end goes live
function seekReplayTrack(clientX) {
  const range = replayTimeRange();
  if (!range) return;
  const track = elementById('track').getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (clientX - track.left) / track.width));
  state.replaying = false;
  if (fraction > 0.995) goLive();
  else setReplayCursor(range[0] + fraction * (range[1] - range[0]));
}
