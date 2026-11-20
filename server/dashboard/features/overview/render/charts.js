'use strict';
// Session Observer dashboard — Overview charts: turn durations, context window use, and activity by tool group.
const CHART_TURNS_MAX = 150;
let contextChartGeometry = null; // the context chart's points and scale, for the crosshair (overview/controls.js)

const chartSvg = (key, width, height, label, body, extraClass = '') =>
  `<svg class="vchart${extraClass}" data-k="${key}" data-w="${width}" viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="${escapeHtml(label)}">${body}</svg>`;

// ---- turns: one column per turn, height = how long it ran; click opens the turn
function turnChartHtml(matchingTurns, width, filterNote) {
  const turns = matchingTurns.slice(-CHART_TURNS_MAX), count = turns.length;
  const plotHeight = 120, left = 46, bottom = 18, top = 12;
  if (!count) return overviewCardHtml(TEXT.turns, filterNote, `<div class="none">${escapeHtml(TEXT.noTurnsMatch)}</div>`, true);
  const now = displayTime();
  const durationOf = turn => (isTurnRunning(turn) ? now : Date.parse(turn.end)) - Date.parse(turn.start);
  const longest = Math.max(1000, ...turns.map(durationOf));
  const columnWidth = (width - left) / count, barWidth = Math.max(1, Math.min(28, columnWidth - 2));
  const yOf = duration => top + (plotHeight - top) * (1 - duration / longest);

  let svg = '';
  for (const share of [0.5, 1]) {
    const y = yOf(longest * share);
    svg += `<line class="grid" x1="${left}" x2="${width}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="ax" x="${left - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatDuration(longest * share))}</text>`;
  }
  svg += `<line class="base" x1="${left}" x2="${width}" y1="${plotHeight}" y2="${plotHeight}"/>`;
  turns.forEach((turn, index) => {
    const duration = durationOf(turn), x = left + index * columnWidth + (columnWidth - barWidth) / 2;
    const barTop = Math.min(plotHeight - 2, yOf(duration)), running = isTurnRunning(turn), selected = state.selectedTurnKey === turn.key;
    const tooltip = `${shorten(stripTags(turn.prompt) || TEXT.sessionStartParen, 140)}\n${formatTime(turn.start)} · ${formatDuration(duration)}${running ? ' · ' + TEXT.running : ''}\n`
      + `${countOf(turn.stepCount, 'modelStep')} · ${countOf(turn.toolCount, 'toolCall')}${turn.problemCount ? ` · ✕ ${countOf(turn.problemCount, 'problem')}` : ''}`;
    svg += `<g class="col ${selected ? 'sel' : ''}" data-key="${escapeHtml(turn.key)}" ${tooltipAttribute(tooltip)}><rect class="hit" x="${(left + index * columnWidth).toFixed(1)}" y="0" width="${columnWidth.toFixed(1)}" height="${plotHeight}"/>
      <rect class="bar ${running ? 'run' : ''} ${selected ? 'sel' : ''}" x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(plotHeight - barTop).toFixed(1)}" rx="${Math.min(3, barWidth / 2)}"/>
      ${turn.problemCount ? `<text class="x" x="${(x + barWidth / 2).toFixed(1)}" y="${(barTop - 3).toFixed(1)}">✕</text>` : ''}</g>`;
  });
  svg += `<text class="ax" x="${left}" y="${plotHeight + 14}">${escapeHtml(formatTime(turns[0].start))}</text><text class="ax" x="${width}" y="${plotHeight + 14}" text-anchor="end">${escapeHtml(formatTime(turns[count - 1].start))}</text>`;
  const note = `${matchingTurns.length}${count < matchingTurns.length ? ' ' + escapeHtml(TEXT.lastNShown(count)) : ''}${filterNote} · ${escapeHtml(TEXT.turnChartHint)}`;
  return overviewCardHtml(TEXT.turns, note, chartSvg('turns', width, plotHeight + bottom, TEXT.turnChartAria, svg), true);
}

// ---- context window use over the session (the main agent's model steps); compactions show as drops
function contextPoints(session) {
  return state.events
    .filter(event => event.event === 'ModelStep' && event.session_id === session.id && !event.data?.subagent && event.data?.tokens?.context && eventTime(event) <= replayLimit())
    .map(event => ({ time: eventTime(event), tokens: event.data.tokens.context, seq: event.seq }));
}

function contextChartHtml(session, width) {
  const points = contextPoints(session);
  if (points.length < 2) {
    contextChartGeometry = null;
    return overviewCardHtml(TEXT.groups.context, '', `<div class="none">${escapeHtml(TEXT.notEnoughSteps)}</div>`);
  }
  const window = session.context?.window || (Math.max(...points.map(point => point.tokens)) > DEFAULT_CONTEXT_WINDOW ? ONE_MILLION_WINDOW : DEFAULT_CONTEXT_WINDOW);
  const plotHeight = 120, left = 40, bottom = 18, top = 8;
  const firstTime = points[0].time, lastTime = Math.max(firstTime + 1, points[points.length - 1].time);
  const highest = Math.max(window, ...points.map(point => point.tokens));
  const xOf = time => left + (width - left) * (time - firstTime) / (lastTime - firstTime);
  const yOf = tokens => top + (plotHeight - top) * (1 - tokens / highest);
  for (const point of points) { point.x = xOf(point.time); point.y = yOf(point.tokens); }
  contextChartGeometry = { points, window, width, height: plotHeight };

  let svg = `<line class="grid" x1="${left}" x2="${width}" y1="${yOf(window / 2)}" y2="${yOf(window / 2)}"/><text class="ax" x="${left - 6}" y="${yOf(window / 2) + 4}" text-anchor="end">${formatCompactNumber(window / 2)}</text>
    <line class="warn" x1="${left}" x2="${width}" y1="${yOf(window * 0.8)}" y2="${yOf(window * 0.8)}"/>
    <line class="win" x1="${left}" x2="${width}" y1="${yOf(window)}" y2="${yOf(window)}"/><text class="ax" x="${left - 6}" y="${yOf(window) + 4}" text-anchor="end">${formatCompactNumber(window)}</text>
    <line class="base" x1="${left}" x2="${width}" y1="${plotHeight}" y2="${plotHeight}"/>`;
  svg += `<path class="ln" d="M${points.map(point => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}"/>`;
  const last = points[points.length - 1];
  svg += `<circle class="dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4"/>`;
  svg += `<g class="xhair" style="display:none"><line class="xh" y1="${top}" y2="${plotHeight}"/><circle class="dot" r="4.5"/></g>`;
  svg += `<text class="ax" x="${left}" y="${plotHeight + 14}">${escapeHtml(formatTime(firstTime))}</text><text class="ax" x="${width}" y="${plotHeight + 14}" text-anchor="end">${escapeHtml(formatTime(lastTime))}</text>`;
  svg += `<rect class="ov" x="${left}" y="0" width="${width - left}" height="${plotHeight}"/>`;
  const percent = Math.round(100 * last.tokens / window);
  const note = escapeHtml(`${TEXT.nowLc} ${TEXT.ofPct(formatCompactNumber(last.tokens), formatCompactNumber(window), percent)} · ${TEXT.ctxChartKey}`);
  return overviewCardHtml(TEXT.groups.context, note, chartSvg('ctx', width, plotHeight + bottom, TEXT.ctxChartAria, svg, ' vctx'));
}

// ---- activity by tool group
const SPARK_BINS = 30;
const SPARK_SPAN_MS = 15 * 60000;
// the events a group's sparkline counts
const COUNTED_IN_SPARKLINE = new Set(['PreToolUse', 'ModelStep', 'UserPromptSubmit', 'SubagentStart', 'PermissionRequest', 'InstructionsLoaded', 'PreCompact', 'TaskCreated']);

function sparklineSvg(bins, highest) {
  const count = bins.length;
  let bars = '';
  bins.forEach((value, index) => {
    if (!value) return;
    const height = 1 + 11 * Math.sqrt(value / highest);
    bars += `<rect x="${index + 0.15}" y="${(12 - height).toFixed(2)}" width=".7" height="${height.toFixed(2)}"/>`;
  });
  return `<svg class="spark" viewBox="0 0 ${count} 12" preserveAspectRatio="none"><line x1="0" y1="12" x2="${count}" y2="12"/>${bars}</svg>`;
}

// per group: sparkline bins of the last 15 minutes, problem counts and the latest event, up to the replay cursor
function groupStatistics(now) {
  const binsByGroup = {}, problemsByGroup = {}, latestByGroup = {};
  const spanStart = now - SPARK_SPAN_MS;
  for (let index = 0; index < shownEventCount(); index++) {
    const event = state.events[index], group = toolGroupOfEvent(event);
    if (!group) continue;
    if (isProblemEvent(event)) problemsByGroup[group] = (problemsByGroup[group] || 0) + 1;
    latestByGroup[group] = event;
    const time = eventTime(event);
    if (COUNTED_IN_SPARKLINE.has(event.event) && time >= spanStart) {
      const bin = Math.min(SPARK_BINS - 1, Math.floor((time - spanStart) / SPARK_SPAN_MS * SPARK_BINS));
      (binsByGroup[group] ||= new Array(SPARK_BINS).fill(0))[bin]++;
    }
  }
  return { binsByGroup, problemsByGroup, latestByGroup };
}

// per group: how many tool calls (or subagents) are running, and since when
function runningByGroup() {
  const running = {};
  for (const tool of activity.runningTools.values()) {
    const entry = (running[tool.group] ||= { count: 0, start: tool.start });
    entry.count++;
    entry.start = Math.min(entry.start, tool.start);
  }
  const subagents = activity.runningSubagents;
  if (subagents.size && !running.agents) running.agents = { count: subagents.size, start: Math.min(...[...subagents.values()].map(subagent => subagent.start)) };
  return running;
}

function toolGroupCardHtml(group, statistics, running, now) {
  const count = activity.countsByGroup[group.id] || 0, problems = statistics.problemsByGroup[group.id] || 0, latest = statistics.latestByGroup[group.id];
  const latestText = latest ? escapeHtml(shorten(describeEvent(latest)[1] || describeEvent(latest)[0], 80)) : '';
  const footer = running
    ? `● ${running.count > 1 ? '×' + running.count + ' ' : ''}${formatDuration(now - running.start)} · ${latestText}`
    : latest ? `${escapeHtml(TEXT.ago(formatAge(now - eventTime(latest))))} · ${latestText}` : '';
  const classes = ['used', running && 'hot', state.group === group.id && 'sel', state.group && state.group !== group.id && 'dim'].filter(Boolean).join(' ');
  const tooltip = `${group.label}: ${count}${problems ? ` · ✕ ${countOf(problems, 'problem')}` : ''}\n${latest ? TEXT.lastX(shorten(describeEvent(latest).join(' '), 200)) : ''}\n${TEXT.barsHint(group.label)}`;
  return `<div class="bcard ${classes}" data-st="${group.id}" style="--c:var(--s-${group.id});--d:${ANIMATION_PHASE}" ${tooltipAttribute(tooltip)}>
      <div class="bh2">${iconSvg(group.id)}<span class="nm">${group.label}</span>${problems ? `<span class="x">✕${problems}</span>` : ''}<span class="n">${count}</span></div>
      ${sparklineSvg(statistics.binsByGroup[group.id] || new Array(SPARK_BINS).fill(0), statistics.highestBin)}<div class="ft ${running ? 'run' : ''}">${footer}</div></div>`;
}

// Tool-group cards: count, problems, last-15-min sparkline, what is running right now or what ran last; click a
// card to filter everything to that group.
function toolGroupCardsHtml() {
  const now = displayTime();
  const statistics = groupStatistics(now);
  statistics.highestBin = Math.max(1, ...Object.values(statistics.binsByGroup).flat());
  const running = runningByGroup();
  const usedGroups = TOOL_GROUPS.filter(group => activity.countsByGroup[group.id] || running[group.id])
    .sort((a, b) => (activity.countsByGroup[b.id] || 0) - (activity.countsByGroup[a.id] || 0));
  if (!usedGroups.length) return overviewCardHtml(TEXT.activityByGroup, '', `<div class="none">${TEXT.noActivity}</div>`);
  const cards = usedGroups.map(group => toolGroupCardHtml(group, statistics, running[group.id], now)).join('');
  const idle = TOOL_GROUPS.length - usedGroups.length;
  return overviewCardHtml(TEXT.activityByGroup, escapeHtml(TEXT.groupSub(usedGroups.length, idle)), '<div class="sgrid">' + cards + '</div>');
}
