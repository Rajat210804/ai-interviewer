import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const browser = () => globalThis.window;
const stopTracks = (stream) => stream?.getTracks().forEach((track) => track.stop());
const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();
const mediaError = (err, device) => {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return `${device} access is blocked. Allow it in your browser settings${device === 'Microphone' ? ', or type your answer' : ''}.`;
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') return `No ${device.toLowerCase()} was found. Connect one and try again.`;
  if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') return `${device} is busy or disconnected. Close other apps using it and try again.`;
  return `${device} could not start. Check your device and try again.`;
};
const failureStatus = (err) => ['NotAllowedError', 'SecurityError'].includes(err?.name) ? 'denied' : ['NotFoundError', 'DevicesNotFoundError'].includes(err?.name) ? 'unavailable' : 'error';

// Owns an asynchronous capture request. A late permission response after stop/unmount is
// discarded and its tracks are closed before it can become visible to a component.
export function createMediaCaptureController({ getUserMedia, onStream = () => {}, onError = () => {} }) {
  let stream = null;
  let pending = null;
  let generation = 0;
  let disposed = false;
  const release = () => {
    generation++;
    pending = null;
    const previous = stream;
    stream = null;
    stopTracks(previous);
    if (!disposed) onStream(null);
  };
  return {
    acquire(constraints) {
      if (disposed) return Promise.resolve(null);
      if (stream?.getTracks().some((track) => track.readyState === 'live')) return Promise.resolve(stream);
      if (pending) return pending;
      const token = ++generation;
      pending = Promise.resolve().then(() => getUserMedia(constraints)).then((next) => {
        if (disposed || token !== generation) { stopTracks(next); return null; }
        stream = next;
        onStream(next);
        return next;
      }, (err) => {
        if (!disposed && token === generation) onError(err);
        throw err;
      }).finally(() => { if (token === generation) pending = null; });
      return pending;
    },
    release,
    dispose() { disposed = true; release(); },
    activate() { disposed = false; },
    get stream() { return stream; },
    get pending() { return Boolean(pending); },
  };
}

// ---------- Interviewer voices (browser text-to-speech) ----------
const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|sonia|libby|natasha|susan|serena|allison|ava|heera|neerja|google us english/i;
const MALE = /\bmale\b|\bman\b|daniel|\balex\b|fred|david|guy|ryan|thomas|george|arthur|oliver|rishi|ravi|prabhat|aaron|mark|google uk english male/i;
const NATURAL = /natural|neural|online|google|premium|enhanced/i;

export function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const synth = browser()?.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')).sort((a, b) => NATURAL.test(b.name) - NATURAL.test(a.name)));
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

export function assignVoices(voices, interviewers) {
  const used = new Set();
  return Object.fromEntries(interviewers.map(({ id, gender }) => {
    const matches = voices.filter((v) => gender === 'female' ? FEMALE.test(v.name) : MALE.test(v.name) && !FEMALE.test(v.name));
    const voice = matches.find((v) => !used.has(v.name)) || matches[0] || voices.find((v) => !used.has(v.name)) || voices[0] || null;
    if (voice) used.add(voice.name);
    return [id, voice];
  }));
}

export function voicesReady(timeoutMs = 1200) {
  const synth = browser()?.speechSynthesis;
  if (!synth || synth.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let readyTimer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(readyTimer);
      synth.removeEventListener('voiceschanged', changed);
      resolve();
    };
    const changed = () => { if (!readyTimer) readyTimer = setTimeout(done, 50); };
    const timeout = setTimeout(done, timeoutMs);
    synth.addEventListener('voiceschanged', changed);
    // Cover voices loading between the initial check and listener installation.
    if (synth.getVoices().length) changed();
  });
}

let activeSpeech = null;
export function stopSpeaking() {
  const current = activeSpeech;
  activeSpeech = null;
  current?.finish('cancelled');
  browser()?.speechSynthesis?.cancel();
}

export function speak(text, { voice, rate = 1, pitch = 1, onStart, onEnd } = {}) {
  stopSpeaking();
  const synth = browser()?.speechSynthesis;
  const Utterance = browser()?.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance;
  if (!synth || !Utterance || !text?.trim()) {
    const result = { reason: 'unavailable' };
    onEnd?.(result);
    return Promise.resolve(result);
  }
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = sentences.reduce((all, sentence) => {
    const last = all.at(-1);
    if (last && last.length + sentence.length < 220) all[all.length - 1] = last + sentence;
    else all.push(sentence);
    return all;
  }, []);
  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    const utterances = [];
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      utterances.forEach((utterance) => { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; });
      if (activeSpeech?.finish === finish) activeSpeech = null;
      const result = { reason };
      onEnd?.(result);
      resolve(result);
    };
    const safety = setTimeout(() => { finish('timeout'); synth.cancel(); }, (text.split(/\s+/).length / (2.2 * Math.max(0.5, rate))) * 1000 + 4000);
    activeSpeech = { finish };
    try {
      chunks.forEach((chunk, index) => {
        const utterance = new Utterance(chunk.trim());
        Object.assign(utterance, { voice: voice || null, rate, pitch, lang: voice?.lang || 'en-US' });
        utterance.onstart = () => { if (!started && !settled) { started = true; onStart?.(); } };
        utterance.onerror = () => { finish('error'); synth.cancel(); };
        if (index === chunks.length - 1) utterance.onend = () => finish('ended');
        utterances.push(utterance);
        synth.speak(utterance);
      });
    } catch { finish('error'); }
  });
}

// ---------- Candidate voice (browser speech recognition) ----------
const RECOGNITION_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'audio-capture': 'No microphone was found. Connect one or type your answer.',
  network: "Your browser's speech service can't be reached. Type your answer instead.",
};

// Result indices belong to one browser session. Replacing each result rather than appending
// repeated callbacks prevents duplicate final words; the committed prefix survives restarts.
export function createSpeechRecognitionController({ Recognition, language = 'en-US', onState = () => {}, restartMs = 150, finishMs = 900 }) {
  let rec = null;
  let wanted = false;
  let disposed = false;
  let prefix = '';
  let results = [];
  let networkFailures = 0;
  let generation = 0;
  let restartTimer;
  let finishTimer;
  let finishing = null;
  const text = () => normalizeText([prefix, ...results.map((result) => result.text)].join(' '));
  const publish = (extra = {}) => {
    if (disposed) return;
    onState({ transcript: [prefix, ...results.filter((result) => result.final).map((result) => result.text)].filter(Boolean).join(' '), interim: results.filter((result) => !result.final).map((result) => result.text).join(' '), ...extra });
  };
  const detach = (instance) => { if (instance) { instance.onstart = null; instance.onresult = null; instance.onerror = null; instance.onend = null; } };
  const clear = () => {
    prefix = ''; results = [];
    publish({ listening: false, status: 'idle' });
  };
  const settleFinish = () => {
    if (!finishing) return;
    clearTimeout(finishTimer);
    const resolve = finishing.resolve;
    const captured = text();
    finishing = null;
    const previous = rec;
    rec = null;
    detach(previous);
    try { previous?.abort(); } catch { /* already ended */ }
    clear();
    resolve(captured);
  };
  const begin = () => {
    if (!wanted || disposed || !Recognition) return;
    const token = generation;
    const instance = new Recognition();
    rec = instance;
    results = [];
    Object.assign(instance, { continuous: true, interimResults: true, lang: language.startsWith('en') ? language : 'en-US' });
    const current = () => !disposed && generation === token && rec === instance;
    instance.onstart = () => { if (current()) publish({ listening: true, status: 'listening' }); };
    instance.onresult = (event) => {
      if (!current()) return;
      networkFailures = 0;
      results = Array.from(event.results, (result) => ({ text: result[0].transcript.trim(), final: result.isFinal }));
      publish();
    };
    instance.onerror = (event) => {
      if (!current() || event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'network' && ++networkFailures <= 3 && wanted) return;
      wanted = false;
      publish({ error: RECOGNITION_ERRORS[event.error] || 'Voice input stopped unexpectedly. You can type your answer instead.', listening: false, status: 'error' });
    };
    instance.onend = () => {
      if (!current()) return;
      prefix = text(); results = [];
      detach(instance); rec = null;
      if (finishing) { settleFinish(); return; }
      if (!wanted) { publish({ listening: false }); return; }
      publish({ status: 'reconnecting' });
      restartTimer = setTimeout(() => { if (wanted && token === generation && !disposed) begin(); }, restartMs);
    };
    try { instance.start(); }
    catch {
      wanted = false; detach(instance); rec = null;
      publish({ listening: false, status: 'error', error: 'Voice input could not start. You can type your answer instead.' });
    }
  };
  const stop = () => {
    wanted = false;
    generation++;
    clearTimeout(restartTimer);
    const captured = text();
    if (finishing) { clearTimeout(finishTimer); finishing.resolve(captured); finishing = null; }
    const previous = rec; rec = null; detach(previous);
    try { previous?.abort(); } catch { /* browser already stopped */ }
    clear();
    return captured;
  };
  return {
    start() {
      if (!Recognition || disposed || wanted || finishing) return false;
      clearTimeout(restartTimer);
      const previous = rec; rec = null; detach(previous);
      try { previous?.abort(); } catch { /* browser already stopped */ }
      wanted = true; generation++; prefix = ''; results = []; networkFailures = 0;
      publish({ listening: true, status: 'starting', error: '' });
      begin();
      return wanted;
    },
    stop,
    finish() {
      if (finishing) return finishing.promise;
      wanted = false; clearTimeout(restartTimer);
      if (!rec) { const captured = text(); clear(); return Promise.resolve(captured); }
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      finishing = { promise, resolve };
      publish({ status: 'stopping' });
      finishTimer = setTimeout(settleFinish, finishMs);
      try { rec.stop(); } catch { settleFinish(); }
      return promise;
    },
    cancel() { stop(); },
    dispose() { disposed = true; stop(); },
    activate() { disposed = false; },
  };
}

export function useSpeechRecognition() {
  const Recognition = browser()?.SpeechRecognition || browser()?.webkitSpeechRecognition;
  const [state, setState] = useState({ listening: false, transcript: '', interim: '', error: '', status: 'idle' });
  const controller = useRef(null);
  if (!controller.current) controller.current = createSpeechRecognitionController({ Recognition, language: globalThis.navigator?.language || 'en-US', onState: (patch) => setState((previous) => ({ ...previous, ...patch })) });
  useEffect(() => { controller.current.activate(); return () => controller.current.dispose(); }, []);
  return { supported: Boolean(Recognition), ...state, start: controller.current.start, stop: controller.current.stop, finish: controller.current.finish, cancel: controller.current.cancel };
}

// ---------- Fallback: record audio and transcribe on the server ----------
// Each MediaRecorder instance creates a complete, independently decodable file.
// Timeslice chunks are only joined within that instance; joining files from separate
// instances would not create a reliable upload. Rotate on a live stream so the
// candidate can keep speaking while completed segments are transcribed elsewhere.
export function createRecorderController({ getUserMedia, MediaRecorder, onState = () => {}, onSegment = () => {}, stopMs = 2000,
  segmentMs = 45000, maxSegmentBytes = 2 * 1024 * 1024, now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay), cancel = (timer) => clearTimeout(timer) }) {
  let disposed = false;
  let generation = 0;
  let starting = null;
  let stopping = null;
  let legacyStopping = null;
  let wanted = false;
  let current = null;
  let lastBlob = null;
  let lastBlobSequence = 0;
  let sequence = 0;
  let nextDelivery = 1;
  let failure = '';
  const sessions = new Set();
  const retained = new Map();
  const finalized = new Map();
  const publish = (patch) => { if (!disposed) onState(patch); };
  const capture = createMediaCaptureController({ getUserMedia });
  const pendingSegments = () => [...retained.values()].sort((a, b) => a.sequence - b.sequence);
  const releaseIfIdle = () => {
    if (wanted || sessions.size) return;
    capture.release();
    publish({ recording: false, stream: null, status: failure ? 'error' : 'idle', ...(failure && { error: failure }) });
  };
  const deliver = () => {
    // A late final-data event must not reorder the candidate's spoken answer.
    while (finalized.has(nextDelivery)) {
      const segment = finalized.get(nextDelivery);
      finalized.delete(nextDelivery++);
      if (segment && !disposed) {
        retained.set(segment.id, segment);
        publish({ segmentCount: retained.size });
        // The consumer owns network work and acknowledgement. A failure must leave
        // the original blob in retained; no hook upload or automatic retry occurs.
        try { const result = onSegment(segment); result?.catch?.(() => {}); } catch { /* retained for explicit retry */ }
      }
    }
  };
  const close = (session) => {
    if (session.settled || session.closing) return;
    session.closing = true;
    cancel(session.rotation);
    session.safety = schedule(session.finish, stopMs);
    if (session.rec.state === 'inactive') session.finish();
    else { try { session.rec.stop(); } catch { session.finish(); } }
  };
  const interrupt = (message) => {
    wanted = false; failure = message;
    const previous = current; current = null;
    if (previous) close(previous);
    sessions.forEach(close);
    publish({ recording: false, status: 'error', error: message });
    releaseIfIdle();
  };
  const makeSession = (stream) => {
    // 64kbps Opus/AAC speech keeps ordinary segments well below the server's
    // transport limit. A byte threshold also rotates if a browser ignores bitrate.
    const rec = new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
    let resolve;
    const session = { rec, sequence: ++sequence, chunks: [], bytes: 0, startedAt: now(), settled: false, closing: false, rotation: null, safety: null };
    session.promise = new Promise((done) => { resolve = done; });
    session.finish = () => {
      if (session.settled) return;
      session.settled = true; cancel(session.rotation); cancel(session.safety);
      const blob = session.chunks.length ? new Blob(session.chunks, { type: rec.mimeType || 'audio/webm' }) : null;
      session.chunks = [];
      const segment = blob && !session.discarded ? { id: `audio-${session.sequence}`, sequence: session.sequence, blob, startedAt: session.startedAt, endedAt: now() } : null;
      finalized.set(session.sequence, segment);
      if (session.sequence >= lastBlobSequence) { lastBlob = blob; lastBlobSequence = session.sequence; }
      rec.ondataavailable = null; rec.onstop = null; rec.onerror = null;
      sessions.delete(session);
      if (current === session) current = null;
      deliver();
      releaseIfIdle();
      resolve(segment);
    };
    rec.ondataavailable = (event) => {
      if (session.settled || !event.data?.size) return;
      session.chunks.push(event.data); session.bytes += event.data.size;
      if (wanted && current === session && !session.closing && session.bytes >= maxSegmentBytes) rotate();
    };
    rec.onstop = () => {
      if (!session.closing && current === session && wanted) {
        interrupt('Audio recording stopped unexpectedly. Captured segments are saved; try again or continue typing.');
      }
      session.finish();
    };
    rec.onerror = () => {
      interrupt('Audio recording stopped unexpectedly. Captured segments are saved; try again or continue typing.');
      close(session);
    };
    sessions.add(session); current = session;
    try { rec.start(1000); }
    catch (err) { session.finish(); throw err; }
    session.rotation = schedule(rotate, segmentMs);
    return session;
  };
  function rotate() {
    const previous = current;
    if (!wanted || disposed || !previous || previous.closing || previous.rec.state !== 'recording') return;
    cancel(previous.rotation);
    try {
      // Start the next encoder before stopping the old one in the same task. This
      // keeps capture live; browser encoder handover can slightly overlap a boundary.
      makeSession(capture.stream);
      close(previous);
    } catch {
      close(previous);
      interrupt('The next recording segment could not start. Captured segments are saved; try again or continue typing.');
    }
  }
  const stopSegments = () => {
    if (stopping) return stopping;
    generation++; starting = null; wanted = false;
    current = null;
    const unfinished = [...sessions];
    unfinished.forEach(close);
    if (!unfinished.length) {
      releaseIfIdle();
      return Promise.resolve(pendingSegments());
    }
    publish({ recording: false, status: 'stopping' });
    const operation = Promise.all(unfinished.map((session) => session.promise)).then(() => pendingSegments()).finally(() => { if (stopping === operation) stopping = null; });
    stopping = operation;
    return operation;
  };
  // Compatibility for short recordings. Long-answer consumers use stopSegments:
  // returning one concatenated file would silently break independently encoded audio.
  const stop = () => {
    if (legacyStopping) return legacyStopping;
    const operation = stopSegments().then(() => lastBlob).finally(() => { if (legacyStopping === operation) legacyStopping = null; });
    legacyStopping = operation;
    return operation;
  };
  const start = () => {
    if (disposed) return Promise.resolve();
    if (starting) return starting;
    if (wanted && current?.rec.state === 'recording') return Promise.resolve();
    if (stopping) return stopping.then(start);
    if (!MediaRecorder) return Promise.reject(new Error('Audio recording is unavailable in this browser. Type your answer instead.'));
    const token = ++generation;
    wanted = true; failure = ''; lastBlob = null;
    publish({ status: 'requesting', error: '' });
    const request = (async () => {
      const stream = await capture.acquire({ audio: true });
      if (!stream || disposed || generation !== token || !wanted) return;
      try { makeSession(stream); publish({ recording: true, stream, status: 'recording' }); }
      catch (err) { wanted = false; current = null; capture.release(); throw err; }
    })().catch((err) => {
      if (!disposed && generation === token) { wanted = false; publish({ recording: false, stream: null, status: failureStatus(err), error: mediaError(err, 'Microphone') }); }
      throw err;
    }).finally(() => { if (starting === request) starting = null; });
    starting = request;
    return request;
  };
  const acknowledgeSegment = (id) => { retained.delete(id); publish({ segmentCount: retained.size }); };
  const discardSegments = () => { retained.clear(); publish({ segmentCount: 0 }); };
  return {
    start, stop, stopSegments, pendingSegments, acknowledgeSegment, discardSegments,
    dispose() {
      disposed = true; sessions.forEach((session) => { session.discarded = true; });
      stopSegments(); capture.dispose();
      // Navigation abandons this recording. Detach handlers/timers immediately;
      // any final browser events after unmount belong to the discarded session.
      [...sessions].forEach((session) => session.finish());
      retained.clear(); finalized.clear();
    },
    activate() { disposed = false; capture.activate(); },
  };
}

export function useRecorder({ onSegment } = {}) {
  const supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && browser()?.MediaRecorder);
  const [state, setState] = useState({ recording: false, stream: null, error: '', status: 'idle', segmentCount: 0 });
  const segmentCallback = useRef(onSegment);
  segmentCallback.current = onSegment;
  const controller = useRef(null);
  if (!controller.current) controller.current = createRecorderController({
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    MediaRecorder: browser()?.MediaRecorder,
    onSegment: (segment) => segmentCallback.current?.(segment),
    onState: (patch) => setState((previous) => ({ ...previous, ...patch })),
  });
  useEffect(() => { controller.current.activate(); return () => controller.current.dispose(); }, []);
  return { supported, ...state, start: controller.current.start, stop: controller.current.stop, stopSegments: controller.current.stopSegments,
    pendingSegments: controller.current.pendingSegments, acknowledgeSegment: controller.current.acknowledgeSegment, discardSegments: controller.current.discardSegments, cancel: controller.current.stopSegments };
}

// ---------- Candidate camera (local preview only, never uploaded) ----------
export function useCamera() {
  const supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);
  const [state, setState] = useState({ stream: null, error: '', status: 'idle', permission: 'unknown' });
  const mounted = useRef(true);
  const listeners = useRef(() => {});
  const capture = useRef(null);
  const update = (patch) => { if (mounted.current) setState((previous) => ({ ...previous, ...patch })); };
  if (!capture.current) capture.current = createMediaCaptureController({
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    onStream: (stream) => {
      listeners.current();
      if (!stream) { update({ stream: null, status: 'idle' }); return; }
      const tracks = stream.getVideoTracks();
      const ended = () => { update({ stream: null, status: 'disconnected', error: 'Camera disconnected. Reconnect it and try again.' }); capture.current.release(); update({ status: 'disconnected' }); };
      const changed = () => update({ status: tracks.some((track) => track.muted) ? 'muted' : 'ready' });
      for (const track of tracks) { track.addEventListener('ended', ended); track.addEventListener('mute', changed); track.addEventListener('unmute', changed); }
      listeners.current = () => { for (const track of tracks) { track.removeEventListener('ended', ended); track.removeEventListener('mute', changed); track.removeEventListener('unmute', changed); } };
      update({ stream, error: '', status: tracks.some((track) => track.muted) ? 'muted' : 'ready', permission: 'granted' });
    },
    onError: (err) => update({ stream: null, error: mediaError(err, 'Camera'), status: failureStatus(err), ...(failureStatus(err) === 'denied' && { permission: 'denied' }) }),
  });
  const start = useCallback(async () => {
    if (!supported) { update({ status: 'unavailable', error: 'Camera capture is unavailable in this browser.' }); return null; }
    if (!capture.current.stream) update({ status: 'requesting', error: '' });
    try { return await capture.current.acquire({ video: { width: 640, height: 480, facingMode: 'user' } }); }
    catch { return null; }
  }, [supported]);
  const stop = useCallback(() => { listeners.current(); capture.current.release(); update({ stream: null, error: '', status: 'idle' }); }, []);
  const toggle = useCallback(() => capture.current.stream || capture.current.pending ? stop() : start(), [start, stop]);
  const retry = useCallback(() => { stop(); return start(); }, [start, stop]);
  useLayoutEffect(() => {
    mounted.current = true; capture.current.activate();
    let permission;
    let disposed = false;
    const changed = () => {
      update({ permission: permission.state });
      if (permission.state === 'denied') { capture.current.release(); update({ status: 'denied', error: 'Camera access is blocked. Allow it in your browser settings.' }); }
    };
    navigator.permissions?.query({ name: 'camera' }).then((result) => { if (disposed) return; permission = result; permission.addEventListener('change', changed); update({ permission: permission.state }); }).catch(() => {});
    return () => { disposed = true; mounted.current = false; permission?.removeEventListener('change', changed); listeners.current(); capture.current.dispose(); };
  }, []);
  return { ...state, supported, checking: state.status === 'requesting', start, stop, toggle, retry };
}

// ---------- Microphone level (local analysis; no audio upload) ----------
export function useMicLevel(enabled, existingStream) {
  const supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && (browser()?.AudioContext || browser()?.webkitAudioContext));
  const [state, setState] = useState({ level: 0, error: '', status: 'idle', stream: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) { setState({ level: 0, error: '', status: 'idle', stream: null }); return; }
    if (!supported) { setState({ level: 0, error: 'Microphone level checks are unavailable in this browser.', status: 'unavailable', stream: null }); return; }
    let stream;
    let context;
    let frame;
    let stopped = false;
    let permission;
    let removeTracks = () => {};
    let removeContext = () => {};
    const ownsStream = existingStream === undefined;
    const update = (patch) => { if (!stopped) setState((previous) => ({ ...previous, ...patch })); };
    const cleanupMedia = () => { cancelAnimationFrame(frame); removeTracks(); removeContext(); if (ownsStream) stopTracks(stream); context?.close().catch(() => {}); context = null; };
    update({ level: 0, error: '', status: ownsStream ? 'requesting' : existingStream ? 'starting' : 'idle', stream: null });
    const attach = async (next) => {
      if (stopped) { if (ownsStream) stopTracks(next); return; }
      if (!next) return;
      stream = next;
      try {
        const AudioContext = browser().AudioContext || browser().webkitAudioContext;
        context = new AudioContext();
        // resume() can remain pending until another user gesture. Attach tracks
        // immediately and show that the meter is paused rather than hanging setup.
        if (context.state === 'suspended') context.resume().catch(() => {});
        if (stopped) { cleanupMedia(); return; }
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const tracks = stream.getAudioTracks();
        if (!tracks.some((track) => track.readyState === 'live')) throw new Error('Microphone stream has ended.');
        const ended = () => { cleanupMedia(); update({ level: 0, stream: null, status: 'disconnected', error: 'Microphone disconnected. Reconnect it and try again, or type your answer.' }); };
        const changed = () => update({ status: tracks.some((track) => track.muted) ? 'muted' : context?.state === 'suspended' ? 'paused' : 'ready', error: context?.state === 'suspended' ? 'Microphone is connected, but the browser paused its level meter. Click Retry to enable the meter.' : '' });
        tracks.forEach((track) => { track.addEventListener('ended', ended); track.addEventListener('mute', changed); track.addEventListener('unmute', changed); });
        removeTracks = () => tracks.forEach((track) => { track.removeEventListener('ended', ended); track.removeEventListener('mute', changed); track.removeEventListener('unmute', changed); });
        const contextChanged = () => changed();
        context.addEventListener('statechange', contextChanged);
        const currentContext = context;
        removeContext = () => currentContext.removeEventListener('statechange', contextChanged);
        update({ stream });
        changed();
        const samples = new Uint8Array(analyser.fftSize);
        const read = () => {
          if (stopped || !context) return;
          analyser.getByteTimeDomainData(samples);
          const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value - 128)), 0) / 128;
          setState((previous) => ({ ...previous, level: Math.max(peak, previous.level * 0.85) }));
          frame = requestAnimationFrame(read);
        };
        read();
      } catch (err) { cleanupMedia(); update({ level: 0, stream: null, status: failureStatus(err), error: mediaError(err, 'Microphone') }); }
    };
    (ownsStream ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.resolve(existingStream)).then(attach).catch((err) => update({ level: 0, stream: null, status: failureStatus(err), error: mediaError(err, 'Microphone') }));
    const permissionChanged = () => {
      if (permission.state === 'denied') { cleanupMedia(); update({ level: 0, stream: null, status: 'denied', error: 'Microphone access is blocked. Allow it in your browser settings, or type your answer.' }); }
    };
    if (ownsStream) navigator.permissions?.query({ name: 'microphone' }).then((result) => { if (stopped) return; permission = result; permission.addEventListener('change', permissionChanged); }).catch(() => {});
    return () => { stopped = true; permission?.removeEventListener('change', permissionChanged); cleanupMedia(); };
  }, [enabled, existingStream, attempt, supported]);
  return { ...state, supported, retry, checking: ['requesting', 'starting'].includes(state.status) };
}
