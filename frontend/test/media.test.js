import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaCaptureController, createRecorderController, createSpeechRecognitionController, speak, stopSpeaking, voicesReady } from '../src/hooks/useMedia.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const stream = () => {
  const track = { readyState: 'live', stops: 0, stop() { this.readyState = 'ended'; this.stops++; } };
  return { track, getTracks: () => [track] };
};
const turn = () => new Promise((resolve) => setImmediate(resolve));

class FakeRecognition {
  static instances = [];
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.starts = (this.starts || 0) + 1; this.onstart?.(); }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  result(entries) { this.onresult?.({ resultIndex: 0, results: entries.map(([text, final]) => Object.assign([{ transcript: text }], { isFinal: final })) }); }
  end() { this.onend?.(); }
}

test('capture coalesces concurrent starts and closes late permission results after dispose', async () => {
  const permission = deferred();
  let requests = 0;
  const seen = [];
  const capture = createMediaCaptureController({ getUserMedia: () => { requests++; return permission.promise; }, onStream: (value) => seen.push(value) });
  const first = capture.acquire({ video: true });
  assert.equal(capture.acquire({ video: true }), first);
  await turn();
  assert.equal(requests, 1);
  capture.dispose();
  const late = stream(); permission.resolve(late);
  assert.equal(await first, null);
  assert.equal(late.track.stops, 1);
  assert.deepEqual(seen, []);
});

test('stop then retry never installs a stale camera stream over the new request', async () => {
  const first = deferred(); const second = deferred();
  let requests = 0;
  const capture = createMediaCaptureController({ getUserMedia: () => ++requests === 1 ? first.promise : second.promise });
  const oldRequest = capture.acquire({ video: true }); await turn();
  capture.release();
  const newRequest = capture.acquire({ video: true }); await turn();
  const newStream = stream(); second.resolve(newStream); await newRequest;
  const oldStream = stream(); first.resolve(oldStream); await oldRequest;
  assert.equal(capture.stream, newStream);
  assert.equal(oldStream.track.stops, 1);
  assert.equal(newStream.track.stops, 0);
  capture.dispose();
  assert.equal(newStream.track.stops, 1);
});

test('recognition deduplicates repeated finals and retains pending words across automatic restarts', async () => {
  FakeRecognition.instances = [];
  const updates = [];
  const controller = createSpeechRecognitionController({ Recognition: FakeRecognition, restartMs: 0, onState: (state) => updates.push(state) });
  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  const first = FakeRecognition.instances[0];
  first.result([['I would', true], ['partition', false]]);
  first.result([['I would', true], ['partition by region', false]]);
  first.end();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = FakeRecognition.instances[1];
  second.result([['and rank products', true]]);
  assert.equal(controller.stop(), 'I would partition by region and rank products');
  assert.ok(updates.some((state) => state.status === 'reconnecting'));
  controller.dispose();
});

test('recognition finish accepts final results from stop and coalesces callers', async () => {
  FakeRecognition.instances = [];
  const controller = createSpeechRecognitionController({ Recognition: FakeRecognition, finishMs: 30 });
  controller.start();
  const rec = FakeRecognition.instances[0];
  rec.result([['I would use', false]]);
  const finishing = controller.finish();
  assert.equal(controller.finish(), finishing);
  assert.equal(controller.start(), false);
  rec.result([['I would use a window function', true]]);
  rec.end();
  assert.equal(await finishing, 'I would use a window function');
  controller.dispose();
});

test('recognition cancellation and unmount invalidate restart timers and stale callbacks', async () => {
  FakeRecognition.instances = [];
  const updates = [];
  const controller = createSpeechRecognitionController({ Recognition: FakeRecognition, restartMs: 0, onState: (state) => updates.push(state) });
  controller.start();
  const old = FakeRecognition.instances[0];
  const staleResult = old.onresult;
  old.result([['kept draft', false]]);
  old.end();
  assert.equal(controller.stop(), 'kept draft');
  controller.start();
  const newRec = FakeRecognition.instances[1];
  staleResult({ results: [Object.assign([{ transcript: 'stale' }], { isFinal: true })] });
  newRec.result([['new answer', true]]);
  assert.equal(controller.stop(), 'new answer');
  controller.start();
  controller.dispose();
  const count = updates.length;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(FakeRecognition.instances.length, 3);
  assert.equal(updates.length, count);
});

class FakeRecorder {
  static instances = [];
  constructor(media) { this.stream = media; this.state = 'inactive'; this.mimeType = 'audio/webm'; FakeRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.stopCalls = (this.stopCalls || 0) + 1; }
  data(text) { this.ondataavailable?.({ data: new Blob([text]) }); }
  end() { this.onstop?.(); }
}

test('recorder concurrent stops resolve the same complete blob and close tracks once', async () => {
  FakeRecorder.instances = [];
  const media = stream();
  const controller = createRecorderController({ getUserMedia: async () => media, MediaRecorder: FakeRecorder });
  await controller.start();
  const rec = FakeRecorder.instances[0];
  rec.data('first');
  const one = controller.stop();
  assert.equal(controller.stop(), one);
  rec.data(' last'); rec.end();
  const blob = await one;
  assert.equal(await blob.text(), 'first last');
  assert.equal(rec.stopCalls, 1);
  assert.equal(media.track.stops, 1);
  controller.dispose();
});

test('recorder cancelling a pending capture closes its late stream and never starts recording', async () => {
  FakeRecorder.instances = [];
  const permission = deferred();
  const states = [];
  const controller = createRecorderController({ getUserMedia: () => permission.promise, MediaRecorder: FakeRecorder, onState: (state) => states.push(state) });
  const beginning = controller.start(); await turn();
  controller.dispose();
  const count = states.length;
  const media = stream(); permission.resolve(media); await beginning;
  assert.equal(FakeRecorder.instances.length, 0);
  assert.equal(media.track.stops, 1);
  assert.equal(states.length, count);
});

test('recorder waits for previous stop before starting another session and isolates audio chunks', async () => {
  FakeRecorder.instances = [];
  const streams = [stream(), stream()]; let calls = 0;
  const controller = createRecorderController({ getUserMedia: async () => streams[calls++], MediaRecorder: FakeRecorder });
  await controller.start();
  const first = FakeRecorder.instances[0]; first.data('old');
  const stopping = controller.stop();
  const starting = controller.start();
  assert.equal(FakeRecorder.instances.length, 1);
  first.end();
  assert.equal(await (await stopping).text(), 'old');
  await starting;
  const second = FakeRecorder.instances[1]; second.data('new');
  const nextStop = controller.stop(); second.end();
  assert.equal(await (await nextStop).text(), 'new');
  controller.dispose();
});

test('voicesReady removes its listener after timeout and successful loading', async () => {
  const original = globalThis.window;
  const synth = new EventTarget(); let loaded = false;
  synth.getVoices = () => loaded ? [{}] : [];
  let additions = 0; let removals = 0;
  const add = synth.addEventListener.bind(synth); const remove = synth.removeEventListener.bind(synth);
  synth.addEventListener = (...args) => { additions++; add(...args); };
  synth.removeEventListener = (...args) => { removals++; remove(...args); };
  globalThis.window = { speechSynthesis: synth };
  try {
    await voicesReady(1);
    const ready = voicesReady(1000);
    loaded = true; synth.dispatchEvent(new Event('voiceschanged'));
    await ready;
    assert.equal(additions, 2); assert.equal(removals, 2);
  } finally { globalThis.window = original; }
});

test('speech cancellation settles immediately and reports only actual utterance starts', async () => {
  const original = globalThis.window;
  const utterances = [];
  const synth = { cancel() {}, speak(value) { utterances.push(value); } };
  globalThis.window = { speechSynthesis: synth, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
  let starts = 0; const ends = [];
  try {
    const speaking = speak('Explain your approach.', { onStart: () => starts++, onEnd: (result) => ends.push(result.reason) });
    assert.equal(starts, 0);
    utterances[0].onstart(); assert.equal(starts, 1);
    stopSpeaking();
    assert.deepEqual(await speaking, { reason: 'cancelled' });
    assert.deepEqual(ends, ['cancelled']);
    assert.equal(utterances[0].onend, null);
  } finally { stopSpeaking(); globalThis.window = original; }
});

function fakeClock() {
  let time = 0; let id = 0; const jobs = new Map();
  return {
    now: () => time,
    schedule(callback, delay) { const key = ++id; jobs.set(key, { callback, at: time + delay }); return key; },
    cancel(key) { jobs.delete(key); },
    advance(duration) {
      const until = time + duration;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]); time = next[1].at; next[1].callback();
      }
      time = until;
    },
    pending: () => jobs.size,
  };
}

test('long recording rotates independent encoders and keeps one capture live until explicit finish', async () => {
  FakeRecorder.instances = [];
  const clock = fakeClock(); const media = stream(); const emitted = []; const states = []; let captures = 0;
  const controller = createRecorderController({ ...clock, getUserMedia: async () => { captures++; return media; }, MediaRecorder: FakeRecorder, onSegment: (segment) => emitted.push(segment), onState: (patch) => states.push(patch) });
  await controller.start();
  FakeRecorder.instances[0].data('first-file-header:first words');
  clock.advance(45000);
  assert.equal(FakeRecorder.instances.length, 2);
  assert.equal(media.track.stops, 0);
  assert.equal(states.at(-1).recording, true);
  FakeRecorder.instances[0].end();
  FakeRecorder.instances[1].data('second-file-header:second words');
  clock.advance(45000);
  assert.equal(FakeRecorder.instances.length, 3);
  FakeRecorder.instances[1].end();
  FakeRecorder.instances[2].data('third-file-header:final words');
  const stopped = controller.stopSegments();
  assert.equal(controller.stopSegments(), stopped);
  FakeRecorder.instances[2].end();
  const segments = await stopped;
  assert.equal(captures, 1);
  assert.equal(media.track.stops, 1);
  assert.deepEqual(emitted.map((segment) => segment.sequence), [1, 2, 3]);
  assert.deepEqual(await Promise.all(segments.map((segment) => segment.blob.text())), ['first-file-header:first words', 'second-file-header:second words', 'third-file-header:final words']);
  assert.equal(segments[0].blob.type, 'audio/webm');
  assert.equal(clock.pending(), 0);
  controller.dispose();
});

test('recording byte threshold rotates segments without imposing an answer cutoff', async () => {
  FakeRecorder.instances = [];
  const clock = fakeClock(); const media = stream();
  const controller = createRecorderController({ ...clock, maxSegmentBytes: 5, getUserMedia: async () => media, MediaRecorder: FakeRecorder });
  await controller.start();
  FakeRecorder.instances[0].data('12345');
  assert.equal(FakeRecorder.instances.length, 2);
  assert.equal(FakeRecorder.instances[1].state, 'recording');
  FakeRecorder.instances[0].end();
  FakeRecorder.instances[1].data('more');
  const finished = controller.stopSegments(); FakeRecorder.instances[1].end();
  assert.deepEqual(await Promise.all((await finished).map((segment) => segment.blob.text())), ['12345', 'more']);
  controller.dispose();
});

test('failed segment callbacks retain original audio for retry while acknowledgements free successful segments', async () => {
  FakeRecorder.instances = [];
  const clock = fakeClock();
  const controller = createRecorderController({ ...clock, getUserMedia: async () => stream(), MediaRecorder: FakeRecorder, onSegment: () => Promise.reject(new Error('transcription unavailable')) });
  await controller.start();
  FakeRecorder.instances[0].data('preserved');
  clock.advance(45000); FakeRecorder.instances[0].end();
  await turn();
  const pending = controller.pendingSegments();
  assert.equal(pending.length, 1);
  assert.equal(await pending[0].blob.text(), 'preserved');
  controller.acknowledgeSegment(pending[0].id);
  assert.equal(controller.pendingSegments().length, 0);
  FakeRecorder.instances[1].data('remaining');
  const finished = controller.stopSegments(); FakeRecorder.instances[1].end(); await finished;
  assert.equal(controller.pendingSegments().length, 1);
  controller.discardSegments();
  assert.deepEqual(controller.pendingSegments(), []);
  controller.dispose();
});

test('segment callbacks remain chronological even when later recorder stop finishes first', async () => {
  FakeRecorder.instances = [];
  const clock = fakeClock(); const emitted = [];
  const controller = createRecorderController({ ...clock, getUserMedia: async () => stream(), MediaRecorder: FakeRecorder, onSegment: (segment) => emitted.push(segment) });
  await controller.start(); FakeRecorder.instances[0].data('earlier');
  clock.advance(45000); FakeRecorder.instances[1].data('later');
  const finished = controller.stopSegments();
  FakeRecorder.instances[1].end(); assert.equal(emitted.length, 0);
  FakeRecorder.instances[0].end();
  assert.deepEqual((await finished).map((segment) => segment.sequence), [1, 2]);
  assert.deepEqual(emitted.map((segment) => segment.sequence), [1, 2]);
  controller.dispose();
});

test('disposing segmented recording removes timers and never emits late segment callbacks', async () => {
  FakeRecorder.instances = [];
  const clock = fakeClock(); const emitted = []; const media = stream();
  const controller = createRecorderController({ ...clock, getUserMedia: async () => media, MediaRecorder: FakeRecorder, onSegment: (segment) => emitted.push(segment) });
  await controller.start(); FakeRecorder.instances[0].data('abandoned');
  clock.advance(45000); FakeRecorder.instances[1].data('late');
  controller.dispose();
  assert.equal(clock.pending(), 0);
  FakeRecorder.instances[0].end(); FakeRecorder.instances[1].end();
  await turn();
  assert.deepEqual(emitted, []);
  assert.deepEqual(controller.pendingSegments(), []);
  assert.equal(media.track.stops, 1);
  assert.equal(clock.pending(), 0);
});

test('speech pauses restart indefinitely without finalizing or losing earlier text', async () => {
  FakeRecognition.instances = [];
  const states = [];
  const controller = createSpeechRecognitionController({ Recognition: FakeRecognition, restartMs: 0, onState: (patch) => states.push(patch) });
  controller.start();
  for (let index = 0; index < 12; index++) {
    const rec = FakeRecognition.instances.at(-1);
    rec.result([[`part ${index}`, true]]);
    rec.onerror?.({ error: 'no-speech' });
    rec.end();
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(FakeRecognition.instances.length, 13);
  assert.ok(!states.some((state) => state.listening === false));
  assert.equal(controller.stop(), Array.from({ length: 12 }, (_, index) => `part ${index}`).join(' '));
  controller.dispose();
});
