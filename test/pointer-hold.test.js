// Pointer hold (server/dashboard/app/rendering.js): while a mouse button is down nothing is redrawn, so a live update
// cannot swap the button under the pointer and lose the click. Runs rendering.js in a vm with a fake window.
// Zero dependencies — run with `node --test test/pointer-hold.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RENDERING = path.join(__dirname, '..', 'server', 'dashboard', 'app', 'rendering.js');

function loadRendering() {
  const listeners = {};
  const rendered = [];
  const frames = [];
  const context = vm.createContext({
    addEventListener: (name, listener) => { (listeners[name] ||= []).push(listener); },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    state: { events: [] },
    buildTurns: () => [],
    renderHeader: () => rendered.push('header'),
    renderSessions: () => rendered.push('sessions'),
    renderCategoryChips: () => {}, renderOverview: () => {}, renderDetails: () => {}, renderReplayBar: () => {},
    markViewDirty: () => {},
    viewNeedsDrawing: false,
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(RENDERING, 'utf8'), context, { filename: RENDERING });
  vm.runInContext('initPointerHold()', context);
  const window = vm.runInContext('window', context);
  return {
    window,
    held: () => vm.runInContext('pointerHeld', context),
    fire: (name, target = window) => { for (const listener of listeners[name] || []) listener({ type: name, target }); },
    runFrames: () => { while (frames.length) frames.shift()(); },
    rendered,
    schedule: part => vm.runInContext(`scheduleRender(${JSON.stringify(part)})`, context),
  };
}

test('a press holds redraws until the button is released', () => {
  const page = loadRendering();
  page.fire('pointerdown');
  assert.equal(page.held(), true);
  page.schedule('header');
  page.runFrames();
  assert.deepEqual(page.rendered, [], 'nothing is drawn while the button is down');
  page.fire('pointerup');
  assert.equal(page.held(), false);
  page.runFrames();
  assert.deepEqual(page.rendered, ['header'], 'what waited is drawn after the release');
});

test('a focused control losing focus does not end the hold', () => {
  // pressing the mouse moves focus: the button or input that had it fires blur, which reaches window's capture listener
  const page = loadRendering();
  page.fire('pointerdown');
  page.fire('blur', { tagName: 'INPUT' });
  assert.equal(page.held(), true, 'an element blur must not release the hold while the button is down');
  page.fire('pointerup');
  assert.equal(page.held(), false);
});

test('the window losing focus ends the hold', () => {
  // the release may never arrive (alt-tab with the button down), so the window blur lets redraws resume
  const page = loadRendering();
  page.fire('pointerdown');
  page.fire('blur', page.window);
  assert.equal(page.held(), false);
});

test('a cancelled pointer ends the hold', () => {
  const page = loadRendering();
  page.fire('pointerdown');
  page.fire('pointercancel');
  assert.equal(page.held(), false);
});
