'use strict';
// Session Observer dashboard — the page state: what is loaded, selected, filtered, replayed and shown.
const ALL_SESSIONS = 'all';

const state = {
  sessions: new Map(),      // session id → summary from the server
  events: [],               // the events in scope, oldest first
  scope: ALL_SESSIONS,      // a session id, or ALL_SESSIONS
  selectedTurnKey: null,    // the turn the Details panel shows
  openEventSeqs: new Set(), // the event rows opened in Details
  // filters
  rangeMs: Number(storage.get('so.range', 86400000)), // 0 = everything
  searchText: '',           // lower case
  group: '',                // a tool group id, or '' for all
  category: '',
  onlyProblems: false,
  // replay
  replayCursor: null,       // the replayed time (ms); null while following live
  replaying: false,
  replaySpeed: Number(storage.get('so.speed', 5)),
  replayIndex: 0,           // how many events the replay has applied
  lastReplayTick: 0,
  // live updates
  frozen: false,            // Freeze: new events wait in frozenEvents until resumed
  frozenEvents: [],
  connected: false,
  lastUpdateAt: null,
  theme: storage.get('so.theme', 'auto'),
  view: 'overview',
};

// every turn of the loaded events (turns.js), and the turn each event belongs to
let allTurns = [];
let turnBySeq = new Map();

const rangeCutoffIso = () => (state.rangeMs ? new Date(Date.now() - state.rangeMs).toISOString() : null);
const anyFilterActive = () => !!(state.group || state.category || state.onlyProblems || state.searchText);
// now, or the replayed time
const displayTime = () => state.replayCursor ?? Date.now();
const replayLimit = () => state.replayCursor ?? Infinity;
const findTurn = key => allTurns.find(turn => turn.key === key);
const selectedTurn = () => (state.selectedTurnKey ? findTurn(state.selectedTurnKey) : null);

// an event's text for the search box, built once
const searchTextOfEvent = event => event._search ?? (event._search = (event.event + ' ' + JSON.stringify(event.data)).toLowerCase());

function eventMatchesFilters(event) {
  if (state.group && toolGroupOfEvent(event) !== state.group) return false;
  if (state.category && event.category !== state.category) return false;
  if (state.onlyProblems && !isProblemEvent(event)) return false;
  if (state.searchText && !searchTextOfEvent(event).includes(state.searchText)) return false;
  return true;
}
