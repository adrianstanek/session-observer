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

const categoryColor = category => (CATEGORY_COLOR[category] === 'err' ? 'var(--err)' : `var(--s-${CATEGORY_COLOR[category]})`);

// a chip per event category in the loaded events, with its count and problems; a click filters to it
function renderCategoryChips() {
  const counts = {}, problems = {};
  for (const event of state.events) {
    counts[event.category] = (counts[event.category] || 0) + 1;
    if (isProblemEvent(event)) problems[event.category] = (problems[event.category] || 0) + 1;
  }
  const chips = Object.entries(CATEGORY_LABELS).filter(([category]) => counts[category]).map(([category, label]) => {
    const problemCount = problems[category] && category !== 'error' ? ` <span class="x">✕${problems[category]}</span>` : '';
    return `<span class="chip click ${state.category === category ? 'sel' : ''}" data-cat="${category}"><i style="background:${categoryColor(category)}"></i>${label} <b>${counts[category]}</b>${problemCount}</span>`;
  });
  elementById('cats').innerHTML = `<span class="ttl">${iconSvg('core')} ${escapeHtml(TEXT.eventTypes)}</span>` + chips.join('');
}
