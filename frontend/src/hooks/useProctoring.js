import { useCallback, useEffect, useRef, useState } from 'react';
import { createProctoringEngine } from '../proctoring/engine.js';
import { createVisionMonitor } from '../proctoring/vision.js';

// Models inspect camera frames on this device. Only bounded event metadata/counts
// leave this hook; camera frames are never included in an integrity snapshot.
const EMPTY_VISION = { status: 'idle', faceStatus: 'idle', visionStatus: 'idle', objectStatus: 'idle', latest: null, sample: null, error: '' };
const faceLabel = (sample, modelStatus) => {
  if (modelStatus === 'unavailable') return 'unavailable';
  if (modelStatus !== 'ready' || sample?.faceCount == null) return modelStatus === 'idle' ? 'idle' : 'loading';
  if (sample.faceCount === 0) return 'no_face';
  if (sample.faceCount > 1) return 'multiple_faces';
  if (sample.tooFar) return 'too_far';
  if (sample.movement > 0.24) return 'excessive_movement';
  return sample.lookingAway ? 'looking_away' : 'ok';
};

export function useVisionCheck(videoRef, enabled) {
  const [state, setState] = useState(EMPTY_VISION);
  const monitor = useRef(null);
  useEffect(() => {
    if (!enabled) { setState(EMPTY_VISION); return; }
    let stopped = false;
    setState({ ...EMPTY_VISION, status: 'loading', faceStatus: 'loading', visionStatus: 'loading', objectStatus: 'loading' });
    const current = createVisionMonitor({
      getVideo: () => videoRef.current,
      onStatus: (patch) => {
        if (stopped) return;
        setState((previous) => {
          const next = { ...previous, ...patch };
          const status = faceLabel(next.latest, next.visionStatus);
          return { ...next, status, faceStatus: status, error: patch.error || (next.visionStatus === 'unavailable' ? 'Face monitoring is unavailable. You can retry; other browser checks still run.' : '') };
        });
      },
      onSample: (sample) => {
        if (stopped) return;
        setState((previous) => {
          const next = { ...previous, ...sample, latest: sample, sample, error: '' };
          const status = faceLabel(sample, next.visionStatus);
          return { ...next, status, faceStatus: status };
        });
      },
    });
    monitor.current = current;
    current.start();
    return () => { stopped = true; current.stop(); if (monitor.current === current) monitor.current = null; };
  }, [enabled, videoRef]);
  const retry = useCallback(() => monitor.current?.retry(), []);
  return { ...state, enabled: Boolean(enabled), retry, modelStatus: { face: state.visionStatus, object: state.objectStatus } };
}

export function useMonitoring(videoRef, options = {}) {
  return useVisionCheck(videoRef, typeof options === 'boolean' ? options : options.enabled);
}

// Preserve existing consumers that only need a face-status string.
export function useFaceCheck(videoRef, enabled) { return useVisionCheck(videoRef, enabled).status; }

const rank = { INFO: 0, WARNING: 1, SUSPICIOUS: 2, SERIOUS_VIOLATION: 3 };
const unavailableStatuses = new Set(['denied', 'unavailable', 'disconnected', 'error']);
export const mediaAvailability = (descriptor, kind) => {
  if (!descriptor) return null;
  // Pausing capture or choosing text intentionally leaves an ended microphone
  // stream behind. That is not a device interruption.
  if (kind === 'audio' && descriptor.expected === false && !unavailableStatuses.has(descriptor.status)) return null;
  const tracks = descriptor.stream?.getTracks().filter((track) => track.kind === kind) || [];
  if (tracks.length) return tracks.some((track) => track.readyState === 'live');
  if (unavailableStatuses.has(descriptor.status)) return false;
  if (descriptor.status === 'requesting' || descriptor.status === 'starting') return null;
  if (kind === 'video' && descriptor.status === 'idle') return false;
  return descriptor.expected ? false : null;
};

// Combine the two browser signals before reporting a transition. Browsers often
// send both blur and visibilitychange for the same trip away from the page.
export function observeWindowFocus({ page = document, viewport = window, onChange }) {
  let focused = typeof page.hasFocus === 'function' ? page.hasFocus() : true;
  let previous;
  const publish = () => {
    const current = !page.hidden && focused;
    if (current !== previous) { previous = current; onChange(current); }
  };
  const leave = () => { focused = false; publish(); };
  const back = () => { focused = true; publish(); };
  const visibility = () => {
    if (!page.hidden && typeof page.hasFocus === 'function') focused = page.hasFocus();
    publish();
  };
  viewport.addEventListener('blur', leave);
  viewport.addEventListener('focus', back);
  page.addEventListener('visibilitychange', visibility);
  publish();
  return () => { viewport.removeEventListener('blur', leave); viewport.removeEventListener('focus', back); page.removeEventListener('visibilitychange', visibility); };
}

export function observeFullscreen({ page = document, onChange, onExit, now = () => Date.now(), cooldownMs = 1500 }) {
  let entered = Boolean(page.fullscreenElement);
  let lastExit = -Infinity;
  const changed = () => {
    const next = Boolean(page.fullscreenElement);
    if (entered && !next && now() - lastExit >= cooldownMs) { lastExit = now(); onExit(); }
    entered = next;
    onChange(next);
  };
  page.addEventListener('fullscreenchange', changed);
  return () => page.removeEventListener('fullscreenchange', changed);
}

// The engine owns durations, debouncing, repetition, severity and counters. DOM
// listeners only report observations so focus + visibility do not count twice.
export function useIntegrity(options) {
  const { active, fullscreen } = options;
  const engine = useRef(null);
  if (!engine.current) engine.current = createProctoringEngine();
  const [state, setState] = useState(() => engine.current.getState());
  const latest = useRef(options);
  latest.current = options;
  const activeRef = useRef(Boolean(active));
  activeRef.current = Boolean(active);
  const wasActive = useRef(false);
  const focused = useRef(true);
  const clipboardObserved = useRef({ copy: 0, paste: 0 });
  const publish = useCallback((next) => setState(next || engine.current.getState()), []);
  const record = useCallback((type, details = {}) => {
    if (!activeRef.current) return;
    publish(engine.current.record(type, details));
  }, [publish]);
  const flush = useCallback(() => {
    if (!activeRef.current) return engine.current.getState();
    const current = latest.current;
    const camera = current.camera || (current.cameraStream !== undefined || current.cameraStatus ? { stream: current.cameraStream, status: current.cameraStatus } : null);
    const microphone = current.microphone || (current.microphoneStream !== undefined || current.microphoneStatus ? { stream: current.microphoneStream, status: current.microphoneStatus, expected: current.microphoneExpected } : null);
    const monitoring = current.monitoring || current.vision;
    const sample = current.sample || monitoring?.sample || monitoring?.latest || (Number.isFinite(current.vision?.timestamp) ? current.vision : null);
    const observation = {
      ...(sample || {}),
      ...(monitoring && { visionStatus: monitoring.visionStatus, objectStatus: monitoring.objectStatus }),
      cameraAvailable: camera ? mediaAvailability(camera, 'video') : current.faceStatus === 'no_camera' ? false : null,
      cameraMuted: Boolean(camera?.stream?.getVideoTracks().some((track) => track.muted)),
      microphoneAvailable: mediaAvailability(microphone, 'audio'),
      microphoneMuted: Boolean(microphone?.stream?.getAudioTracks().some((track) => track.muted)),
      tabFocused: !document.hidden && focused.current,
      fullscreen: Boolean(document.fullscreenElement),
      fullscreenExpected: Boolean(current.fullscreen && document.fullscreenEnabled),
    };
    // Compatibility for callers still using the old face-only hook. Rich samples
    // supplied by useVisionCheck always take precedence and carry real timestamps.
    if (!monitoring && !sample && ['ok', 'no_face', 'multiple_faces', 'looking_away'].includes(current.faceStatus)) {
      Object.assign(observation, { timestamp: Date.now(), visionStatus: 'ready', faceCount: current.faceStatus === 'no_face' ? 0 : current.faceStatus === 'multiple_faces' ? 2 : 1, faceConfidence: 0.7, lookingAway: current.faceStatus === 'looking_away' });
    } else if (!monitoring && current.faceStatus === 'unavailable') observation.visionStatus = 'unavailable';
    return engine.current.update(observation);
  }, []);

  useEffect(() => {
    if (!active) {
      if (wasActive.current) { engine.current.pause?.(); publish(); wasActive.current = false; }
      return;
    }
    wasActive.current = true;
    focused.current = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const update = () => publish(flush());
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [active, flush, publish]);

  useEffect(() => { if (options.completed) publish(engine.current.record('INTERVIEW_COMPLETED')); }, [options.completed, publish]);

  useEffect(() => { if (active) publish(flush()); }, [active, options.faceStatus, options.monitoring?.sample, options.monitoring?.visionStatus, options.monitoring?.objectStatus, options.vision?.sample, options.vision?.visionStatus, options.vision?.objectStatus, options.sample, options.camera?.stream, options.camera?.status, options.cameraStream, options.cameraStatus, options.microphone?.stream, options.microphone?.status, options.microphoneStream, options.microphoneStatus, fullscreen, flush, publish]);

  useEffect(() => {
    if (!active) return;
    return observeWindowFocus({ onChange: (value) => { focused.current = value; publish(flush()); } });
  }, [active, flush, publish]);

  useEffect(() => {
    if (!active || !fullscreen || !document.fullscreenEnabled) return;
    return observeFullscreen({ onExit: () => record('FULLSCREEN_EXIT'), onChange: () => publish(flush()) });
  }, [active, fullscreen, record, flush, publish]);

  const cameraStream = options.camera?.stream || options.cameraStream;
  const microphoneStream = options.microphone?.stream || options.microphoneStream;
  useEffect(() => {
    if (!active) return;
    const removers = [];
    const watch = (stream, kind) => {
      const device = kind === 'video' ? 'CAMERA' : 'MICROPHONE';
      for (const track of stream?.getTracks().filter((item) => item.kind === kind) || []) {
        const ended = () => { record(`${device}_INTERRUPTION`, { source: 'track-ended' }); publish(flush()); };
        const mute = () => { record(`${device}_INTERRUPTION`, { source: 'track-muted' }); publish(flush()); };
        const unmute = () => publish(flush());
        track.addEventListener('ended', ended); track.addEventListener('mute', mute); track.addEventListener('unmute', unmute);
        removers.push(() => { track.removeEventListener('ended', ended); track.removeEventListener('mute', mute); track.removeEventListener('unmute', unmute); });
      }
    };
    watch(cameraStream, 'video'); watch(microphoneStream, 'audio');
    let stopped = false;
    for (const [name, type] of [['camera', 'CAMERA_PERMISSION_DENIED'], ['microphone', 'MICROPHONE_PERMISSION_DENIED']]) {
      navigator.permissions?.query({ name }).then((permission) => {
        if (stopped) return;
        const changed = () => { if (permission.state === 'denied') record(type, { source: 'permission-change' }); publish(flush()); };
        permission.addEventListener('change', changed);
        removers.push(() => permission.removeEventListener('change', changed));
        if (permission.state === 'denied') record(type, { source: 'permission' });
      }).catch(() => {});
    }
    return () => { stopped = true; removers.forEach((remove) => remove()); };
  }, [active, cameraStream, microphoneStream, record, flush, publish]);

  useEffect(() => {
    if (!active) return;
    const clipboard = (kind) => {
      clipboardObserved.current[kind] = Date.now();
      record(kind === 'copy' ? 'COPY_ATTEMPT' : 'PASTE_ATTEMPT', { source: 'clipboard-event' });
    };
    const copy = () => clipboard('copy');
    const paste = () => clipboard('paste');
    const shortcut = (event) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      const browserShortcut = ((event.ctrlKey || event.metaKey) && ['t', 'n', 'w', 'l', 'r', 'p'].includes(key)) || ((event.ctrlKey || event.metaKey) && (event.shiftKey || event.altKey) && ['i', 'j', 'c'].includes(key)) || (event.altKey && key === 'tab') || ['F5', 'F11', 'F12'].includes(event.key);
      if (browserShortcut) record('SHORTCUT_ATTEMPT', { source: `key:${event.key}` });
    };
    document.addEventListener('copy', copy, true);
    document.addEventListener('paste', paste, true);
    document.addEventListener('keydown', shortcut);
    return () => { document.removeEventListener('copy', copy, true); document.removeEventListener('paste', paste, true); document.removeEventListener('keydown', shortcut); };
  }, [active, record]);

  const flagPaste = useCallback(() => { if (Date.now() - clipboardObserved.current.paste > 200) record('PASTE_ATTEMPT', { source: 'answer-field' }); }, [record]);
  const flagCopy = useCallback(() => { if (Date.now() - clipboardObserved.current.copy > 200) record('COPY_ATTEMPT', { source: 'question-field' }); }, [record]);
  const flagShortcut = useCallback((source = 'observed') => record('SHORTCUT_ATTEMPT', { source }), [record]);
  const markQuestion = useCallback(() => { flush(); engine.current.markQuestion(); }, [flush]);
  const sinceMark = useCallback(() => { flush(); return engine.current.sinceMark(); }, [flush]);
  const snapshot = useCallback(() => { flush(); return engine.current.snapshot(); }, [flush]);
  const reset = useCallback(() => { engine.current.reset(); publish(); }, [publish]);
  const limited = state.visionStatus === 'unavailable' || state.objectStatus === 'unavailable';
  const status = !active ? 'idle' : rank[state.severity] >= 3 ? 'serious_violation' : rank[state.severity] >= 2 ? 'suspicious' : rank[state.severity] >= 1 ? 'warning' : limited ? 'limited' : 'normal';
  return {
    state, status, severity: state.severity, suspicionScore: state.suspicionScore,
    events: state.events, violations: state.violations, counters: state.counters,
    warnings: state.warnings.map((event) => event.message), warningEvents: state.warnings,
    outOfFullscreen: Boolean(active && fullscreen && document.fullscreenEnabled && !state.fullscreen),
    availability: { face: state.visionStatus, object: state.objectStatus, camera: state.cameraAvailable, microphone: state.microphoneAvailable },
    record, flagPaste, flagCopy, flagShortcut, markQuestion, sinceMark, snapshot, reset,
  };
}

export async function enterFullscreen() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    return Boolean(document.fullscreenElement);
  } catch { return false; }
}
export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
