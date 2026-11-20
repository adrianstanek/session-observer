'use strict';
// Session Observer dashboard — Replay, the bar: the track with a tick per turn, the thumb, and the mode label.
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
