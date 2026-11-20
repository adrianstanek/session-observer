'use strict';
// Session Observer dashboard — page helpers: elements, the stage box, storage, and animations kept in phase.
const elementById = id => document.getElementById(id);
// the box the Route, Chat and Context views draw into
const viewBox = () => elementById('alt');

// localStorage that never throws (private windows, blocked storage)
const storage = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};

// CSS animations restart when their element is re-rendered: this placeholder becomes a negative delay that keeps
// them in phase across renders
const ANIMATION_PHASE = '__D__';
const ANIMATION_PERIOD_MS = 1400;
const withAnimationPhase = (html, now) => html.replaceAll(ANIMATION_PHASE, `-${Math.round(now % ANIMATION_PERIOD_MS)}ms`);

// a select keeps a stored value only when it is one of its options
function setSelectValue(id, value, fallback) {
  const select = elementById(id);
  select.value = String(value);
  if (select.value) return value;
  select.value = String(fallback);
  return fallback;
}
