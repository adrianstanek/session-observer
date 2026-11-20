'use strict';
// Session Observer dashboard — Replay, the controls: play / pause, Live, speed, and seeking on the track.
function initReplayControls() {
  state.replaySpeed = setSelectValue('speed', state.replaySpeed, 5);
  elementById('speed').onchange = event => {
    state.replaySpeed = Number(event.target.value);
    storage.set('so.speed', state.replaySpeed);
  };
  elementById('play').onclick = () => {
    if (!state.replaying) return startReplay();
    state.replaying = false;
    renderReplayBar();
  };
  elementById('live').onclick = () => goLive();
  const track = elementById('track');
  let dragging = false;
  track.addEventListener('pointerdown', event => { dragging = true; track.setPointerCapture(event.pointerId); seekReplayTrack(event.clientX); });
  track.addEventListener('pointermove', event => { if (dragging) seekReplayTrack(event.clientX); });
  track.addEventListener('pointerup', () => { dragging = false; });
}
