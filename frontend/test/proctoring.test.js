import test from 'node:test';
import assert from 'node:assert/strict';
import { createProctoringEngine, INTEGRITY_KEYS } from '../src/proctoring/engine.js';
import { normalizeFaces, normalizeObjects, createVisionMonitor } from '../src/proctoring/vision.js';

function harness() {
  let time = 0;
  const engine = createProctoringEngine({ now: () => time });
  function update(overrides = {}, elapsed = 500) {
    time += elapsed;
    return engine.update({ visionStatus: 'ready', objectStatus: 'ready', timestamp: time, objectsObservedAt: time,
      faceCount: 1, facePresent: true, faceConfidence: 0.92, cameraAvailable: true, microphoneAvailable: true,
      lookingAway: false, tooFar: false, movement: 0, phoneDetected: false, phoneConfidence: 0, suspiciousObjects: [], ...overrides }, time);
  }
  function persist(overrides, duration) { let state; for (let n = 0; n <= duration; n += 500) state = update(overrides); return state; }
  return { engine, update, persist, now: () => time };
}
const has = (state, type) => state.events.some((event) => event.type === type);

test('one visible face starts successful face and object coverage without events', () => {
  const h = harness(); const state = h.persist({}, 6000);
  assert.equal(state.faceCount, 1); assert.equal(state.facePresent, true); assert.equal(state.suspicionScore, 0);
  assert.equal(state.events.length, 0); assert.equal(state.faceChecks, true); assert.equal(state.phoneChecks, true);
  assert.ok(state.coverage.faceAvailableMs > 0);
});

test('one missing frame and a temporary disappearance do not produce a warning', () => {
  const h = harness(); h.update(); h.update({ faceCount: 0, facePresent: false });
  h.persist({}, 1000); h.persist({ faceCount: 0, facePresent: false }, 1500); const state = h.update();
  assert.equal(state.events.length, 0); assert.equal(h.engine.snapshot().noFaceSeconds, 0);
});

test('an extended disappearance warns, then raises review severity', () => {
  const h = harness(); const warning = h.persist({ faceCount: 0, facePresent: false }, 3500);
  assert.equal(warning.events.find((event) => event.type === 'NO_FACE').severity, 'WARNING');
  assert.ok(warning.counters.noFaceSeconds >= 3);
  const state = h.persist({ faceCount: 0, facePresent: false }, 10000);
  assert.equal(state.events.at(-1).severity, 'SUSPICIOUS'); assert.equal(state.counters.faceDisappearances, 1);
});

test('three sustained face disappearances in a rolling window aggregate for review', () => {
  const h = harness();
  for (let n = 0; n < 3; n++) { h.persist({ faceCount: 0, facePresent: false }, 3000); h.persist({}, 1000); }
  const state = h.engine.getState();
  assert.equal(state.counters.faceDisappearances, 3); assert.ok(has(state, 'FACE_DISAPPEARANCES'));
  assert.equal(state.events.find((event) => event.type === 'FACE_DISAPPEARANCES').occurrences, 3);
});

test('continuous multiple faces requires persistence and escalates to serious review', () => {
  const h = harness(); h.persist({ faceCount: 2 }, 1500); assert.equal(h.engine.getState().events.length, 0);
  const state = h.persist({ faceCount: 2 }, 6500);
  assert.equal(state.events.at(-1).severity, 'SERIOUS_VIOLATION'); assert.equal(state.counters.multipleFaceEvents, 1);
});

test('low confidence multiple faces and uncertain frames do not accuse the candidate', () => {
  const h = harness(); const state = h.persist({ faceCount: 2, faceConfidence: 0.45 }, 8000);
  assert.equal(state.events.length, 0);
  assert.equal(h.persist({ faceCount: null, facePresent: null }, 8000).events.length, 0);
});

test('a short look away is ignored, persistent and repeated looks produce graded events', () => {
  const h = harness(); h.persist({ lookingAway: true }, 1500); h.update(); assert.equal(h.engine.getState().events.length, 0);
  for (let n = 0; n < 3; n++) { h.persist({ lookingAway: true }, 4500); h.persist({}, 1000); }
  assert.equal(h.engine.getState().events.at(-1).severity, 'SUSPICIOUS');
  assert.ok(h.engine.snapshot().lookAwaySeconds >= 12);
});

test('a small face warns about framing after five seconds', () => {
  const h = harness(); h.persist({ tooFar: true }, 2500); assert.equal(h.engine.getState().events.length, 0);
  const state = h.persist({ tooFar: true }, 3000); assert.ok(has(state, 'TOO_FAR')); assert.ok(state.counters.tooFarSeconds >= 5);
});

test('excessive motion needs persistence', () => {
  const h = harness(); h.update({ movement: 0.7 }); h.update(); assert.equal(h.engine.getState().events.length, 0);
  assert.ok(has(h.persist({ movement: 0.7 }, 5000), 'EXCESSIVE_HEAD_MOVEMENT'));
});

test('phone thresholds ignore weak and isolated detections; sustained medium confidence stays advisory', () => {
  const h = harness(); h.persist({ phoneDetected: true, phoneConfidence: 0.4 }, 6000);
  h.update({ phoneDetected: true, phoneConfidence: 0.92 }); h.update(); assert.equal(h.engine.getState().events.length, 0);
  const state = h.persist({ phoneDetected: true, phoneConfidence: 0.63 }, 18000);
  assert.equal(state.events.at(-1).severity, 'WARNING'); assert.equal(state.counters.phoneEvents, 1);
});

test('high confidence phones need several seconds, repeated high confidence escalates', () => {
  const h = harness();
  for (let n = 0; n < 3; n++) { h.persist({ phoneDetected: true, phoneConfidence: 0.91 }, 4500); h.persist({}, 1000); }
  const state = h.engine.getState(); assert.equal(state.counters.phoneEvents, 3);
  assert.equal(state.events.at(-1).severity, 'SERIOUS_VIOLATION');
  assert.match(state.events.at(-1).message, /potential phone.*review/i);
});

test('a continuously visible high confidence phone escalates without duplicate counts', () => {
  const h = harness(); const state = h.persist({ phoneDetected: true, phoneConfidence: 0.91 }, 18000);
  assert.equal(state.counters.phoneEvents, 1); assert.equal(state.events.at(-1).severity, 'SERIOUS_VIOLATION');
});

test('an isolated high confidence score cannot upgrade a persistent medium confidence phone', () => {
  const h = harness(); h.persist({ phoneDetected: true, phoneConfidence: 0.6 }, 18000);
  const observedAt = h.now() + 500;
  for (let n = 0; n < 10; n++) h.update({ phoneDetected: true, phoneConfidence: 0.92, objectsObservedAt: observedAt });
  assert.equal(h.engine.getState().events.at(-1).severity, 'WARNING');
});

test('repeated medium confidence phones do not count as repeated high confidence detections', () => {
  const h = harness();
  for (let n = 0; n < 3; n++) { h.persist({ phoneDetected: true, phoneConfidence: 0.6 }, 4500); h.persist({}, 1000); }
  const state = h.persist({ phoneDetected: true, phoneConfidence: 0.93 }, 5000);
  assert.equal(state.events.at(-1).severity, 'SUSPICIOUS');
});

test('reference object observations stay advisory and include the known category', () => {
  const h = harness(); const state = h.persist({ suspiciousObjects: [{ label: 'book', confidence: 0.84 }] }, 6000);
  const event = state.events.find((item) => item.type === 'OBJECT_DETECTED');
  assert.equal(event.severity, 'WARNING'); assert.equal(event.label, 'book');
});

test('brief blur is ignored and sustained window blur records one event and duration', () => {
  const h = harness(); h.update({ tabFocused: false }); h.update({ tabFocused: true }); assert.equal(h.engine.getState().events.length, 0);
  const state = h.persist({ tabFocused: false }, 3500);
  assert.equal(state.counters.awayEvents, 1); assert.ok(state.counters.awaySeconds >= 3); assert.ok(has(state, 'TAB_AWAY'));
});

test('fullscreen exits count actual transitions and cooldown avoids warning spam', () => {
  const h = harness(); h.update({ fullscreen: true, fullscreenExpected: true });
  h.engine.record('FULLSCREEN_EXIT'); h.engine.record('FULLSCREEN_EXIT');
  assert.equal(h.engine.snapshot().fullscreenExits, 2); assert.equal(h.engine.getState().events.length, 1);
  h.engine.record('FULLSCREEN_EXIT'); assert.equal(h.engine.getState().events.at(-1).severity, 'SUSPICIOUS');
});

test('camera failure has a grace period, records interruption, and never invents a missing face', () => {
  const h = harness(); h.persist({ cameraAvailable: false }, 500); assert.equal(h.engine.getState().events.length, 0);
  const state = h.persist({ cameraAvailable: false }, 6000);
  assert.equal(state.counters.cameraInterruptions, 1); assert.equal(state.counters.noFaceSeconds, 0);
  assert.equal(state.events.at(-1).severity, 'WARNING'); assert.equal(state.facePresent, null);
});

test('unknown media permission and deliberate microphone mute are not failures', () => {
  const h = harness(); const state = h.persist({ cameraAvailable: null, microphoneAvailable: null, microphoneMuted: true }, 8000);
  assert.equal(state.events.length, 0);
});

test('microphone disconnection warns and camera mute tracks a camera interruption', () => {
  const h = harness(); const state = h.persist({ microphoneAvailable: false, cameraMuted: true }, 6000);
  assert.equal(state.counters.microphoneInterruptions, 1); assert.equal(state.counters.cameraInterruptions, 1);
  assert.ok(has(state, 'MICROPHONE_UNAVAILABLE')); assert.equal(state.counters.noFaceSeconds, 0);
});

test('failed vision and object models are explicit unavailable coverage, not clean monitoring', () => {
  const h = harness(); const state = h.persist({ visionStatus: 'unavailable', objectStatus: 'unavailable' }, 5000);
  assert.equal(state.faceChecks, false); assert.equal(state.phoneChecks, false); assert.equal(state.counters.noFaceSeconds, 0);
  assert.ok(has(state, 'VISION_UNAVAILABLE')); assert.ok(has(state, 'OBJECT_MODEL_UNAVAILABLE')); assert.equal(state.suspicionScore, 0);
});

test('stale inference does not keep counting an old phone observation', () => {
  const h = harness(); h.update({ phoneDetected: true, phoneConfidence: 0.92 });
  const observedAt = h.now();
  for (let n = 0; n < 30; n++) h.update({ objectsObservedAt: observedAt, phoneDetected: true, phoneConfidence: 0.92 });
  const state = h.engine.getState(); assert.equal(state.phoneDetected, false); assert.equal(state.objectStatus, 'unavailable');
  assert.equal(state.counters.phoneSeconds, 0); assert.equal(has(state, 'PHONE_DETECTED'), false);
});

test('a single cached missing face does not become a violation between inferences', () => {
  const h = harness(); h.update({ faceCount: 0, facePresent: false }); const observedAt = h.now();
  for (let n = 0; n < 10; n++) h.update({ timestamp: observedAt, faceCount: 0, facePresent: false });
  assert.equal(has(h.engine.getState(), 'NO_FACE'), false);
});

test('pausing an interview preserves counts and starts a fresh temporal streak on resume', () => {
  const h = harness(); h.persist({ faceCount: 0, facePresent: false }, 2000); h.engine.record('PASTE_ATTEMPT');
  h.engine.pause(); h.update({ faceCount: 0, facePresent: false }, 60000);
  assert.equal(h.engine.snapshot().pasteAttempts, 1); assert.equal(has(h.engine.getState(), 'NO_FACE'), false);
  assert.ok(has(h.persist({ faceCount: 0, facePresent: false }, 3500), 'NO_FACE'));
});

test('question deltas, bounded privacy metadata and completion are stable', () => {
  const h = harness(); h.persist({}, 1000); h.engine.markQuestion(); h.persist({ lookingAway: true }, 5000);
  const delta = h.engine.sinceMark(); assert.ok(delta.lookAwaySeconds >= 4); assert.equal(delta.awayEvents, 0);
  assert.ok(delta.events.length); assert.equal(delta.coverage.faceSamples, 11);
  for (const key of INTEGRITY_KEYS) assert.ok(Number.isFinite(delta[key]) && delta[key] >= 0);
  assert.ok(delta.events.every((event) => !('faceBox' in event) && !('landmarks' in event) && !('image' in event)));
  h.engine.record('INTERVIEW_COMPLETED'); const before = h.engine.snapshot(); h.persist({ faceCount: 0 }, 10000);
  assert.deepEqual(h.engine.snapshot(), before); assert.equal(h.engine.getState().completed, true);
});

test('event buffers and counters have bounds even under adversarial browser events', () => {
  let time = 0; const engine = createProctoringEngine({ now: () => time, maxEvents: 4 });
  for (let n = 0; n < 50; n++) { time += 20000; engine.record('PASTE_ATTEMPT', { source: 'x'.repeat(100) }); engine.update({}, time); }
  assert.equal(engine.getState().events.length, 4); assert.equal(engine.snapshot().pasteAttempts, 50);
  assert.ok(engine.getState().events.every((event) => event.source.length <= 40));
});

function detection({ x = 120, y = 80, width = 180, height = 220, score = 0.92, nose = 200 } = {}) {
  const positions = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  positions[36] = { x: 160, y: 130 }; positions[45] = { x: 240, y: 130 }; positions[30] = { x: nose, y: 170 };
  return { detection: { score, box: { x, y, width, height } }, landmarks: { positions } };
}

test('face normalization deduplicates overlapping boxes and uses strong separate faces', () => {
  const one = normalizeFaces([detection(), detection({ x: 130, score: 0.85 })], 640, 480);
  assert.equal(one.faceCount, 1); assert.equal(one.lookingAway, false);
  assert.equal(normalizeFaces([detection(), detection({ x: 390, score: 0.88 })], 640, 480).faceCount, 2);
  assert.equal(normalizeFaces([detection(), detection({ x: 390, score: 0.6 })], 640, 480).faceCount, 1);
  assert.equal(normalizeFaces([detection({ score: 0.3 })], 640, 480).faceCount, null);
  assert.equal(normalizeFaces([], 640, 480).faceCount, 0);
});

test('face normalization calculates yaw, framing and movement without identity descriptors', () => {
  assert.equal(normalizeFaces([detection({ nose: 235 })], 640, 480).lookingAway, true);
  assert.equal(normalizeFaces([detection({ width: 50, height: 60 })], 640, 480).tooFar, true);
  const original = normalizeFaces([detection()], 640, 480);
  assert.ok(normalizeFaces([detection({ x: 240 })], 640, 480, original).movement > 0.24);
  assert.equal('descriptor' in original, false);
});

test('object normalization uses the real COCO phone class and excludes ordinary desk objects', () => {
  const predictions = [{ class: 'cell phone', score: 0.93, bbox: [240, 180, 50, 100] },
    { class: 'laptop', score: 0.95, bbox: [10, 10, 400, 200] }, { class: 'book', score: 0.82, bbox: [10, 10, 80, 80] }];
  const result = normalizeObjects(predictions, 640, 480, { x: 0.2, y: 0.1, width: 0.3, height: 0.5 });
  assert.equal(result.phoneDetected, true); assert.equal(result.phoneConfidence, 0.93); assert.equal(result.phoneNearFace, true);
  assert.deepEqual(result.suspiciousObjects, [{ label: 'book', confidence: 0.82 }]);
  assert.equal(normalizeObjects([{ class: 'cell phone', score: 0.45, bbox: [0, 0, 80, 80] }], 640, 480).phoneDetected, false);
});

test('vision monitor has independent model availability, bounded inference and cleanup', async () => {
  let time = 0; let objectCalls = 0; let faceCalls = 0; const scheduled = []; const statuses = []; const samples = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  const api = { TinyFaceDetectorOptions: class {}, detectAllFaces() { faceCalls++; return { withFaceLandmarks: async () => [detection()] }; } };
  const monitor = createVisionMonitor({ getVideo: () => ({ readyState: 3, videoWidth: 1280, videoHeight: 720 }),
    onSample: (value) => samples.push(value), onStatus: (value) => statuses.push(value), now: () => time,
    isHidden: () => false, makeCanvas: () => canvas, loadModels: async () => ({ api, detector: { detect: async () => { objectCalls++; return []; } }, fast: true }),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; }, cancel: (id) => { scheduled[id - 1].cancelled = true; } });
  await monitor.start(); await monitor.start();
  assert.equal(faceCalls, 1); assert.equal(objectCalls, 1); assert.equal(canvas.width, 640);
  time = 750; await scheduled[0].callback(); assert.equal(faceCalls, 2); assert.equal(objectCalls, 1);
  assert.ok(scheduled.every((entry) => entry.delay >= 200)); assert.equal('faceBox' in samples[0], false);
  monitor.stop(); assert.equal(canvas.width, 0); assert.equal(scheduled.at(-1).cancelled, true);
  const count = samples.length; await scheduled.at(-1).callback(); assert.equal(samples.length, count);
  assert.deepEqual(statuses.at(-1), { visionStatus: 'ready', objectStatus: 'ready' });
});

test('object model failure leaves face checks running and explicit retry can recover', async () => {
  const statuses = []; const samples = []; let attempts = 0;
  const monitor = createVisionMonitor({ getVideo: () => ({ readyState: 3, videoWidth: 640, videoHeight: 480 }),
    onStatus: (value) => statuses.push(value), onSample: (value) => samples.push(value), isHidden: () => false,
    loadModels: async () => { attempts++; return { api: { TinyFaceDetectorOptions: class {}, detectAllFaces: () => ({ withFaceLandmarks: async () => [] }) }, detector: null, fast: true }; },
    schedule: () => 1, cancel: () => {} });
  await monitor.start(); assert.equal(samples[0].visionStatus, 'ready'); assert.equal(samples[0].objectStatus, 'unavailable');
  await monitor.retry(); assert.equal(attempts, 2); monitor.stop();
  assert.equal(statuses.some((status) => status.objectStatus === 'unavailable'), true);
});
