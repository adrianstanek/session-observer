'use strict';
// Session Observer dashboard — alerts: which sessions newly need you, or newly finished a turn, since the last look.
//   off      — no alerts
//   needsYou — a session starts waiting on you (a permission, a question, an MCP server asking)
//   alsoDone — that, and a running turn ends (the session waits for your next prompt)
// The sessions seen at the first look are only recorded, so opening the page does not alert for old waits.
const ALERT_MODES = ['off', 'needsYou', 'alsoDone'];
const TURN_RUNNING = ['working', 'needsYou']; // a wait answered and a turn ended between two looks is still a finished turn

let alertMode = ALERT_MODES.includes(storage.get(SETTING_KEYS.alerts)) ? storage.get(SETTING_KEYS.alerts) : 'off';
let alertsPrimed = false;
let alertedWaitKeys = new Set();     // the waits already seen, so each one alerts once
const lastAlertActivity = new Map(); // session id → its activity at the last look

const alertWaitKey = (session, wait) => [session.id, wait.kind, wait.tool || '', wait.agentId ?? '', wait.since || ''].join('|');

// the alerts due now: [{ session, kind: 'needsYou', waits } | { session, kind: 'done' }]
function newAlerts(sessions) {
  const due = [];
  const waitKeys = new Set();
  for (const session of sessions) {
    const activity = sessionActivity(session);
    const waits = waitsOf(session);
    const fresh = waits.filter(wait => !alertedWaitKeys.has(alertWaitKey(session, wait)));
    for (const wait of waits) waitKeys.add(alertWaitKey(session, wait));
    if (fresh.length) due.push({ session, kind: 'needsYou', waits: fresh });
    else if (TURN_RUNNING.includes(lastAlertActivity.get(session.id)) && activity === 'yourTurn') due.push({ session, kind: 'done' });
    lastAlertActivity.set(session.id, activity);
  }
  // only the waits still open are kept, so the set stays small
  alertedWaitKeys = waitKeys;
  if (!alertsPrimed) {
    alertsPrimed = true;
    return [];
  }
  return due.filter(alert => alert.kind === 'needsYou' || alertMode === 'alsoDone');
}
