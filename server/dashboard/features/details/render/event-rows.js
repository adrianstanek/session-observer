'use strict';
// Session Observer dashboard — one event as a row (the Details list), and the event-type chips under the stage.
function eventRowMarker(event, running) {
  if (running) return '<span class="mk run">●</span>';
  if (isProblemEvent(event) || event.event === 'StopFailure') return '<span class="mk fail">✕</span>';
  if (event.event === 'ModelStep') return '<span class="mk model">◆</span>';
  if (event.event === 'Stop') return '<span class="mk">›</span>';
  return '<span class="mk">·</span>';
}

// options: detail (instead of the event's own), written (what the model wrote, before the detail), ts (the time
// shown), project (a project name in front), duration (show how long it took)
function eventRowHtml(event, running, options = {}) {
  const group = toolGroupOfEvent(event) || (event.event === 'Stop' ? 'turn' : 'other');
  const [label, ownDetail] = describeEvent(event);
  const detail = options.detail != null ? options.detail : options.written ? `${options.written}  → ${ownDetail}` : ownDetail;
  const color = event.event === 'Stop' ? 'var(--ok)' : `var(--s-${group})`;
  const project = options.project ? `<span class="proj">${escapeHtml(options.project)}</span>` : '';
  const duration = options.duration ? `<span class="dur">${running ? escapeHtml(TEXT.runningEll) : escapeHtml(formatDuration(event.duration_ms))}</span>` : '';
  return `<div class="frow ${isProblemEvent(event) ? 'fail' : ''}" data-seq="${event.seq}">${eventRowMarker(event, running)}<span class="t">${formatTime(options.ts || event.ts)}</span>
    <span class="who" style="color:${color}">${eventIconHtml(event, group, 2)}<span>${escapeHtml(label)}</span></span><span class="what">${project}${escapeHtml(shorten(detail, 300))}</span>${duration}</div>`;
}

