'use strict';
// Session Observer dashboard — the context badge: a bar, the size, % of the window and the change, as HTML or SVG.
const percentOf = size => Math.round(size.fraction * 100);
const contextBadgeTooltip = size => TEXT.ctxEndTip(TEXT.ofPct(formatCompactNumber(size.tokens), formatCompactNumber(size.window), percentOf(size)))
  + (size.change == null ? '' : '\n' + TEXT.ctxChangeTip(size.changeText, size.change < 0));

// the context badge as HTML (route header, Context view)
function contextBadgeHtml(size) {
  if (!size) return '';
  const change = size.changeText ? `<span class="cd ${size.tone}">${size.changeText}</span>` : '';
  return `<span class="ctxb" title="${escapeHtml(contextBadgeTooltip(size))}"><span class="cbar"><i style="width:${(size.fraction * 100).toFixed(1)}%"></i></span>`
    + `<b>${formatCompactNumber(size.tokens)}</b><span class="muted">${percentOf(size)}%</span>${change}</span>`;
}

// the context badge in SVG, right-aligned at rightX on a turn divider (baseline y)
function contextBadgeSvg(size, rightX, y) {
  if (!size) return '';
  const charWidth = 7.2, barWidth = 46;
  const changeWidth = size.changeText ? size.changeText.length * charWidth + 16 : 0;
  const valueText = `${formatCompactNumber(size.tokens)} · ${percentOf(size)}%`, valueWidth = valueText.length * charWidth + 12;
  const width = 10 + barWidth + 8 + valueWidth + changeWidth, left = rightX - width;
  return `<g class="ctxs"><title>${escapeHtml(contextBadgeTooltip(size))}</title><rect class="cbg" x="${left}" y="${y - 15}" width="${width}" height="22" rx="11"/>`
    + `<rect class="ctrk" x="${left + 10}" y="${y - 7}" width="${barWidth}" height="6" rx="3"/><rect class="cfil" x="${left + 10}" y="${y - 7}" width="${(barWidth * size.fraction).toFixed(1)}" height="6" rx="3"/>`
    + `<text class="cv" x="${left + 10 + barWidth + 8}" y="${y}">${escapeHtml(valueText)}</text>`
    + (size.changeText ? `<text class="cd ${size.tone}" x="${rightX - 10}" y="${y}" text-anchor="end">${escapeHtml(size.changeText)}</text>` : '') + '</g>';
}
