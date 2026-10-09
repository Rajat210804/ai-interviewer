import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaAvailability, observeFullscreen, observeWindowFocus } from '../src/hooks/useProctoring.js';

function fixture() {
  const page = new EventTarget(); const viewport = new EventTarget();
  page.hidden = false; page.focused = true; page.hasFocus = () => page.focused;
  return { page, viewport };
}

test('intentionally paused microphone tracks are not reported as device failures', () => {
  const stream = { getTracks: () => [{ kind: 'audio', readyState: 'ended' }] };
  assert.equal(mediaAvailability({ stream, status: 'idle', expected: false }, 'audio'), null);
  assert.equal(mediaAvailability({ stream, status: 'recording', expected: true }, 'audio'), false);
  assert.equal(mediaAvailability({ status: 'denied', expected: false }, 'audio'), false);
  assert.equal(mediaAvailability({ status: 'idle' }, 'video'), false);
});

test('blur and visibility describe one away period, and hidden-window focus cannot end it', () => {
  const { page, viewport } = fixture(); const changes = [];
  const cleanup = observeWindowFocus({ page, viewport, onChange: (value) => changes.push(value) });
  page.focused = false; viewport.dispatchEvent(new Event('blur'));
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
  viewport.dispatchEvent(new Event('focus')); // a prompt can focus the hidden browser window
  assert.deepEqual(changes, [true, false]);
  page.hidden = false; page.focused = true; page.dispatchEvent(new Event('visibilitychange'));
  viewport.dispatchEvent(new Event('focus'));
  assert.deepEqual(changes, [true, false, true]);
  cleanup();
  viewport.dispatchEvent(new Event('blur'));
  assert.deepEqual(changes, [true, false, true]);
});

test('fullscreen counts actual entered-to-exited transitions once with cooldown and cleanup', () => {
  const { page } = fixture(); let time = 0; let exits = 0; const changes = [];
  page.fullscreenElement = null;
  const cleanup = observeFullscreen({ page, now: () => time, onExit: () => exits++, onChange: (value) => changes.push(value) });
  page.dispatchEvent(new Event('fullscreenchange')); assert.equal(exits, 0);
  page.fullscreenElement = {}; page.dispatchEvent(new Event('fullscreenchange'));
  page.fullscreenElement = null; page.dispatchEvent(new Event('fullscreenchange')); page.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(exits, 1);
  time = 100; page.fullscreenElement = {}; page.dispatchEvent(new Event('fullscreenchange'));
  page.fullscreenElement = null; page.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(exits, 1);
  time = 2000; page.fullscreenElement = {}; page.dispatchEvent(new Event('fullscreenchange'));
  page.fullscreenElement = null; page.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(exits, 2);
  cleanup();
  const length = changes.length; page.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(changes.length, length);
});
