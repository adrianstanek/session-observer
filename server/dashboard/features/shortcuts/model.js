'use strict';
// Session Observer dashboard — keyboard shortcuts: the list the shortcuts dialog shows, one section per tab.
// Each row is the keys (each one a <kbd>; a "+" joins keys pressed together) and the TEXT.shortcuts key that says
// what they do. The dashboard's own keys are handled in features/shortcuts/controls.js and features/details/controls.js.
const SHORTCUT_SECTIONS = [
  {
    id: 'dashboard',
    rows: [
      { keys: ['j', ']'], what: 'nextTurn' },
      { keys: ['k', '['], what: 'prevTurn' },
      { keys: ['Esc'], what: 'closeTurn' },
      { keys: ['/'], what: 'search' },
      { keys: ['1 – 5'], what: 'views' },
      { keys: ['?'], what: 'help' },
    ],
  },
];
