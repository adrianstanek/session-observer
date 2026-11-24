'use strict';
// Session Observer dashboard — keyboard shortcuts: the dialog, a tab per section of SHORTCUT_SECTIONS.
let shortcutSection = SHORTCUT_SECTIONS[0].id;

const keyHtml = keys => keys.map(key => key.split('+').map(part => `<kbd>${escapeHtml(part.trim())}</kbd>`).join('+'))
  .join(` <span class="muted">${escapeHtml(TEXT.shortcuts.or)}</span> `);

// what a row does; the view keys name the views as the tabs do
const shortcutText = row => (row.what === 'views' ? `${TEXT.shortcuts.views}: ${VIEWS.map(view => view.label).join(', ')}` : TEXT.shortcuts[row.what]);

function shortcutSectionHtml(section) {
  const note = TEXT.shortcuts[section.id + 'Note'];
  const rows = section.rows.map(row => `<tr><td class="kkeys">${keyHtml(row.keys)}</td><td>${escapeHtml(shortcutText(row))}</td></tr>`).join('');
  return (note ? `<p class="muted knote">${escapeHtml(note)}</p>` : '') + `<table class="ktable"><tbody>${rows}</tbody></table>`;
}

function renderShortcutsDialog() {
  const section = SHORTCUT_SECTIONS.find(each => each.id === shortcutSection) || SHORTCUT_SECTIONS[0];
  const tabs = SHORTCUT_SECTIONS.length < 2 ? '' : `<div class="ktabs" role="tablist">${SHORTCUT_SECTIONS.map(each =>
    `<button type="button" role="tab" data-shortcut-section="${each.id}" aria-selected="${each === section}" class="${each === section ? 'cur' : ''}">${escapeHtml(TEXT.shortcuts[each.id])}</button>`).join('')}</div>`;
  elementById('shortcuts').innerHTML = `<div class="kbody"><div class="khead"><h2>${escapeHtml(TEXT.shortcuts.title)}</h2>`
    + `<button type="button" data-close-shortcuts aria-label="${escapeHtml(TEXT.shortcuts.close)}" title="${escapeHtml(TEXT.shortcuts.close)}">×</button></div>`
    + tabs + shortcutSectionHtml(section) + '</div>';
}
