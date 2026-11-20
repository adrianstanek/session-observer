'use strict';
// Session Observer dashboard — Overview, the controls: clicks on turns, rows and group cards, chart tooltips and the
// context chart's crosshair.
function initOverviewClicks() {
  elementById('mid').onclick = event => {
    const turnLink = event.target.closest('[data-key]');
    if (turnLink) {
      selectTurn(turnLink.dataset.key);
      viewNeedsDrawing = true;
      renderOverview();
      return;
    }
    const eventLink = event.target.closest('[data-seq]');
    if (eventLink) {
      if (selectTurnOfSeq(Number(eventLink.dataset.seq))) { viewNeedsDrawing = true; renderOverview(); }
      return;
    }
    const groupCard = event.target.closest('[data-st]');
    if (groupCard) {
      state.group = state.group === groupCard.dataset.st ? '' : groupCard.dataset.st;
      elementById('station').value = state.group;
      refilter();
    }
  };
}

// chart tooltips (one floating box for every [data-tip]) and the context chart's crosshair
function initChartTooltips() {
  const tooltip = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'vtip' }));
  const showTooltip = (text, x, y) => {
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.min(innerWidth - box.width - 8, x + 14) + 'px';
    tooltip.style.top = (y + 16 + box.height > innerHeight ? y - box.height - 10 : y + 16) + 'px';
  };
  const hideCrosshairs = () => { for (const crosshair of elementById('mid').querySelectorAll('.xhair')) crosshair.style.display = 'none'; };

  // the context chart: the step nearest the mouse, with its time and context size
  const showCrosshair = (chart, event) => {
    const geometry = contextChartGeometry, bounds = chart.getBoundingClientRect();
    const mouseX = (event.clientX - bounds.left) * geometry.width / bounds.width;
    const nearest = geometry.points.reduce((best, point) => (Math.abs(point.x - mouseX) < Math.abs(best.x - mouseX) ? point : best));
    const crosshair = chart.querySelector('.xhair'), line = crosshair.querySelector('line'), dot = crosshair.querySelector('circle');
    crosshair.style.display = '';
    line.setAttribute('x1', nearest.x);
    line.setAttribute('x2', nearest.x);
    dot.setAttribute('cx', nearest.x);
    dot.setAttribute('cy', nearest.y);
    const size = TEXT.ofPct(formatCompactNumber(nearest.tokens), formatCompactNumber(geometry.window), Math.round(100 * nearest.tokens / geometry.window));
    showTooltip(`${formatTime(nearest.time)}\n${TEXT.ctxLc} ${size}`, event.clientX, event.clientY);
  };

  elementById('mid').addEventListener('mousemove', event => {
    const chart = event.target.closest('svg.vctx');
    if (chart && contextChartGeometry && event.target.classList.contains('ov')) return showCrosshair(chart, event);
    hideCrosshairs();
    const withTooltip = event.target.closest('[data-tip]');
    if (withTooltip) showTooltip(withTooltip.dataset.tip, event.clientX, event.clientY);
    else tooltip.style.display = 'none';
  });
  elementById('mid').addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hideCrosshairs(); });
}

function initOverviewControls() {
  initOverviewClicks();
  initChartTooltips();
}
