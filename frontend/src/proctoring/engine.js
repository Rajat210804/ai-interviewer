// Browser observations are evidence for review, never a determination of cheating.
// This module has no DOM or model dependencies so its timing rules can be tested.
export const SEVERITIES = ['INFO', 'WARNING', 'SUSPICIOUS', 'SERIOUS_VIOLATION'];
export const INTEGRITY_KEYS = [
  'awayEvents', 'awaySeconds', 'noFaceSeconds', 'lookAwaySeconds', 'multipleFaceEvents', 'pasteAttempts', 'fullscreenExits',
  'phoneEvents', 'phoneSeconds', 'objectEvents', 'faceDisappearances', 'tooFarSeconds', 'headMovementEvents',
  'cameraInterruptions', 'cameraUnavailableSeconds', 'microphoneInterruptions', 'microphoneUnavailableSeconds',
  'copyAttempts', 'shortcutAttempts', 'visionUnavailableSeconds', 'objectUnavailableSeconds',
];

export const EVENT_TYPES = [
  'NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'TOO_FAR', 'EXCESSIVE_HEAD_MOVEMENT', 'PHONE_DETECTED',
  'OBJECT_DETECTED', 'FACE_DISAPPEARANCES', 'CAMERA_UNAVAILABLE', 'MICROPHONE_UNAVAILABLE', 'TAB_AWAY',
  'FULLSCREEN_EXIT', 'FULLSCREEN_REQUIRED', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'SHORTCUT_ATTEMPT',
  'VISION_UNAVAILABLE', 'OBJECT_MODEL_UNAVAILABLE', 'CAMERA_PERMISSION_DENIED', 'MICROPHONE_PERMISSION_DENIED',
  'CAMERA_INTERRUPTION', 'MICROPHONE_INTERRUPTION', 'INTERVIEW_COMPLETED',
];

const EMPTY_COUNTS = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, 0]));
const MAX_COUNT = 86400;
const WINDOW_MS = 60000;
const COOLDOWN_MS = 15000;
const severityRank = (severity) => Math.max(0, SEVERITIES.indexOf(severity));
const bounded = (value, maximum = MAX_COUNT) => Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0));

const RULES = {
  NO_FACE: { after: 3000, seriousAfter: 12000, seconds: 'noFaceSeconds', count: 'faceDisappearances', repeat: 3,
    message: 'Your face is not visible. Please return to the camera.', repeated: 'Your face has repeatedly left the camera view. This needs review.' },
  MULTIPLE_FACES: { after: 3000, seriousAfter: 7000, serious: 'SERIOUS_VIOLATION', count: 'multipleFaceEvents',
    message: 'More than one person appears to be in view. Please take the interview alone.' },
  LOOKING_AWAY: { after: 4500, seriousAfter: 12000, seconds: 'lookAwaySeconds', repeat: 3,
    message: 'Please look towards the interview screen.', repeated: 'Repeated looking away has been recorded for review.' },
  TOO_FAR: { after: 5000, seconds: 'tooFarSeconds',
    message: 'Please move closer to the camera so your face is clear.' },
  EXCESSIVE_HEAD_MOVEMENT: { after: 4000, seriousAfter: 12000, count: 'headMovementEvents', repeat: 3,
    message: 'Camera movement is making face checks difficult. Please keep a steady position.' },
  PHONE_DETECTED: { after: 4000, seriousAfter: 16000, count: 'phoneEvents', seconds: 'phoneSeconds', repeat: 3,
    message: 'A potential mobile phone is visible. Please put it away.', repeated: 'A potential phone has been detected repeatedly. This needs review.' },
  OBJECT_DETECTED: { after: 5000, count: 'objectEvents',
    message: 'An additional reference object appears to be in view. Please keep your interview space clear.' },
  CAMERA_UNAVAILABLE: { after: 1500, initial: 'INFO', warningAfter: 4000, seconds: 'cameraUnavailableSeconds', count: 'cameraInterruptions',
    message: 'Camera monitoring is interrupted. Check your camera connection and permission.' },
  MICROPHONE_UNAVAILABLE: { after: 2000, initial: 'INFO', warningAfter: 5000, seconds: 'microphoneUnavailableSeconds', count: 'microphoneInterruptions',
    message: 'The microphone is unavailable. Check its connection and permission, or type your answer.' },
  TAB_AWAY: { after: 2000, seriousAfter: 20000, seconds: 'awaySeconds', count: 'awayEvents', repeat: 3,
    message: 'The interview window lost focus. Please return to the interview.' },
  FULLSCREEN_REQUIRED: { after: 4000,
    message: 'Full screen has been exited. You can return to full screen when ready.' },
  VISION_UNAVAILABLE: { after: 2000, initial: 'INFO', seconds: 'visionUnavailableSeconds',
    message: 'Face checks are unavailable. Browser and media events are still monitored.' },
  OBJECT_MODEL_UNAVAILABLE: { after: 2000, initial: 'INFO', seconds: 'objectUnavailableSeconds',
    message: 'Object checks are unavailable. Potential phones cannot be checked right now.' },
};

const RECORDS = {
  FULLSCREEN_EXIT: { key: 'fullscreenExits', severity: 'WARNING', message: 'Full screen was exited.' },
  COPY_ATTEMPT: { key: 'copyAttempts', severity: 'INFO', message: 'A copy action was recorded.' },
  PASTE_ATTEMPT: { key: 'pasteAttempts', severity: 'WARNING', message: 'A paste action was recorded. Please answer in your own words.' },
  SHORTCUT_ATTEMPT: { key: 'shortcutAttempts', severity: 'INFO', message: 'A browser shortcut was observed. Its destination cannot be determined.' },
  CAMERA_PERMISSION_DENIED: { severity: 'INFO', message: 'Camera permission is unavailable.' },
  MICROPHONE_PERMISSION_DENIED: { severity: 'INFO', message: 'Microphone permission is unavailable.' },
  CAMERA_INTERRUPTION: { severity: 'INFO', message: 'The camera track was interrupted.' },
  MICROPHONE_INTERRUPTION: { severity: 'INFO', message: 'The microphone track was interrupted.' },
  INTERVIEW_COMPLETED: { severity: 'INFO', message: 'Interview monitoring has ended.' },
};

export function createProctoringEngine({ now = () => Date.now(), maxEvents = 120 } = {}) {
  const eventLimit = Math.max(1, Math.min(120, Math.floor(maxEvents) || 120));
  let counts, coverage, live, events, streaks, histories, strongPhoneHistory, lastEmitted, sequence, lastAt, mark, complete;

  function reset() {
    counts = { ...EMPTY_COUNTS };
    coverage = { activeMs: 0, faceAvailableMs: 0, objectAvailableMs: 0, faceSamples: 0, objectSamples: 0 };
    live = { facePresent: null, faceCount: null, multiplePeople: false, phoneDetected: false, lookingAway: false,
      cameraAvailable: null, microphoneAvailable: null, cameraMuted: false, microphoneMuted: false,
      tabFocused: true, fullscreen: null, fullscreenExpected: false, visionStatus: 'idle', objectStatus: 'idle' };
    events = []; streaks = new Map(); histories = new Map(); lastEmitted = new Map();
    strongPhoneHistory = [];
    sequence = 0; lastAt = null; complete = false;
    mark = { counts: { ...counts }, coverage: { ...coverage }, sequence: 0 };
  }
  reset();

  function emit(type, details, at) {
    const previous = lastEmitted.get(type);
    const escalation = previous && severityRank(details.severity) > severityRank(previous.severity);
    if (previous && !escalation && at - previous.at < COOLDOWN_MS) return null;
    const event = {
      id: ++sequence, type, severity: details.severity,
      confidence: bounded(details.confidence ?? 1, 1), timestamp: new Date(at).toISOString(),
      duration: Math.round(bounded(details.duration ?? 0, MAX_COUNT * 1000)),
      occurrences: Math.max(1, Math.floor(bounded(details.occurrences ?? 1, 1000))), message: details.message,
      ...(details.source ? { source: String(details.source).slice(0, 40) } : {}),
      ...(details.label ? { label: String(details.label).slice(0, 30) } : {}),
    };
    events.push(event);
    if (events.length > eventLimit) events.splice(0, events.length - eventLimit);
    lastEmitted.set(type, { at, severity: event.severity });
    return event;
  }

  function observe(type, condition, at, details = {}) {
    const rule = RULES[type];
    const streak = streaks.get(type);
    if (!condition) { streaks.delete(type); return; }
    const current = streak || { since: at, countedUntil: at, level: -1, occurrence: false, observations: 0, observedAt: null };
    streaks.set(type, current);
    if (Number.isFinite(details.observedAt) && details.observedAt !== current.observedAt) {
      current.observations += 1;
      current.observedAt = details.observedAt;
      if (type === 'PHONE_DETECTED') {
        if (details.confidence >= 0.75) {
          current.strongSince ??= at;
          current.strongObservations = (current.strongObservations || 0) + 1;
        } else { current.strongSince = null; current.strongObservations = 0; }
      }
    }
    const duration = at - current.since;
    // A cached bad detection must not turn into a persistent event merely
    // because the browser timer keeps ticking between independent inferences.
    if (duration < rule.after || (Number.isFinite(details.observedAt) && current.observations < 2)) return;

    let history = (histories.get(type) || []).filter((time) => at - time <= WINDOW_MS);
    if (!current.occurrence) {
      current.occurrence = true;
      history.push(at);
      if (rule.count) counts[rule.count] = bounded(counts[rule.count] + 1);
    }
    histories.set(type, history.slice(-30));
    if (rule.seconds) {
      counts[rule.seconds] = bounded(counts[rule.seconds] + (at - current.countedUntil) / 1000);
      current.countedUntil = at;
    }

    let severity = rule.initial || 'WARNING';
    if (rule.warningAfter && duration >= rule.warningAfter) severity = 'WARNING';
    if (rule.seriousAfter && duration >= rule.seriousAfter) severity = rule.serious || 'SUSPICIOUS';
    if (rule.repeat && history.length >= rule.repeat) severity = 'SUSPICIOUS';
    if (type === 'PHONE_DETECTED') {
      // A medium-confidence detection stays advisory even when persistent.
      const strongDuration = current.strongSince == null ? 0 : at - current.strongSince;
      const strong = details.confidence >= 0.75 && current.strongObservations >= 2 && strongDuration >= rule.after;
      strongPhoneHistory = strongPhoneHistory.filter((time) => at - time <= WINDOW_MS);
      if (strong && !current.strongOccurrence) { strongPhoneHistory.push(at); current.strongOccurrence = true; }
      severity = strong ? 'SUSPICIOUS' : 'WARNING';
      if (strong && (strongPhoneHistory.length >= 3 || strongDuration >= rule.seriousAfter)) severity = 'SERIOUS_VIOLATION';
      if (strong) history = strongPhoneHistory;
    }
    const rank = severityRank(severity);
    if (rank > current.level) {
      const event = emit(type, { ...details, severity, duration, occurrences: history.length,
        message: history.length >= (rule.repeat || Infinity) ? rule.repeated || rule.message : rule.message }, at);
      if (event) current.level = rank;
    }
    if (type === 'NO_FACE' && history.length >= 3 && current.level >= 2) {
      emit('FACE_DISAPPEARANCES', { severity: 'SUSPICIOUS', duration, occurrences: history.length,
        confidence: details.confidence, message: 'Your face has repeatedly disappeared from view. This needs review.' }, at);
    }
  }

  function effective(at) {
    const faceFresh = Number.isFinite(live.timestamp) && at - live.timestamp <= 6500;
    const objectFresh = Number.isFinite(live.objectsObservedAt) && at - live.objectsObservedAt <= 8000;
    const cameraWorking = live.cameraAvailable !== false && !live.cameraMuted;
    return {
      ...live, facePresent: faceFresh && cameraWorking ? live.facePresent : null,
      faceCount: faceFresh && cameraWorking ? live.faceCount : null,
      multiplePeople: faceFresh && cameraWorking && live.faceCount > 1,
      phoneDetected: objectFresh && cameraWorking && live.phoneDetected,
      visionStatus: live.visionStatus === 'ready' && !faceFresh ? 'unavailable' : live.visionStatus,
      objectStatus: live.objectStatus === 'ready' && !objectFresh ? 'unavailable' : live.objectStatus,
    };
  }

  function update(sample = {}, time = now()) {
    if (complete) return getState();
    const at = Math.max(lastAt ?? time, Number.isFinite(time) ? time : now());
    const previous = effective(lastAt ?? at);
    const delta = lastAt === null ? 0 : Math.min(2500, at - lastAt);
    // Suspension of the browser must not invent hours of observations.
    if (lastAt !== null && at - lastAt > 10000) streaks.clear();
    coverage.activeMs = bounded(coverage.activeMs + delta, MAX_COUNT * 1000);
    if (previous.visionStatus === 'ready' && previous.tabFocused && previous.cameraAvailable !== false && !previous.cameraMuted) {
      coverage.faceAvailableMs = bounded(coverage.faceAvailableMs + delta, MAX_COUNT * 1000);
    }
    if (previous.objectStatus === 'ready' && previous.tabFocused && previous.cameraAvailable !== false && !previous.cameraMuted) {
      coverage.objectAvailableMs = bounded(coverage.objectAvailableMs + delta, MAX_COUNT * 1000);
    }
    const faceObservation = Number.isFinite(sample.timestamp) && sample.timestamp !== live.timestamp && sample.visionStatus === 'ready';
    const objectObservation = Number.isFinite(sample.objectsObservedAt) && sample.objectsObservedAt !== live.objectsObservedAt && sample.objectStatus === 'ready';
    if (faceObservation) coverage.faceSamples = bounded(coverage.faceSamples + 1);
    if (objectObservation) coverage.objectSamples = bounded(coverage.objectSamples + 1);
    live = { ...live, ...sample };
    lastAt = at;
    const state = effective(at);
    const canSee = state.visionStatus === 'ready' && state.cameraAvailable !== false && !state.cameraMuted && state.tabFocused;
    const canDetectObjects = state.objectStatus === 'ready' && state.cameraAvailable !== false && !state.cameraMuted && state.tabFocused;
    const faceEvidence = { confidence: state.faceConfidence, observedAt: state.timestamp };
    observe('NO_FACE', canSee && state.faceCount === 0, at, { ...faceEvidence, confidence: 1 });
    observe('MULTIPLE_FACES', canSee && state.faceCount > 1 && (state.faceConfidence ?? 0) >= 0.6, at, faceEvidence);
    observe('LOOKING_AWAY', canSee && state.faceCount === 1 && state.lookingAway, at, faceEvidence);
    observe('TOO_FAR', canSee && state.faceCount === 1 && state.tooFar, at, faceEvidence);
    observe('EXCESSIVE_HEAD_MOVEMENT', canSee && state.faceCount === 1 && state.movement > 0.24, at, faceEvidence);
    observe('PHONE_DETECTED', canDetectObjects && state.phoneDetected && state.phoneConfidence >= 0.55, at,
      { confidence: state.phoneConfidence, observedAt: state.objectsObservedAt });
    const object = canDetectObjects && state.suspiciousObjects?.find((item) => item.confidence >= 0.7);
    observe('OBJECT_DETECTED', Boolean(object), at, object ? { confidence: object.confidence, label: object.label, observedAt: state.objectsObservedAt } : {});
    observe('CAMERA_UNAVAILABLE', state.cameraAvailable === false || state.cameraMuted, at, { source: state.cameraMuted ? 'muted' : 'track' });
    observe('MICROPHONE_UNAVAILABLE', state.microphoneAvailable === false, at, { source: 'track' });
    observe('TAB_AWAY', state.tabFocused === false, at);
    observe('FULLSCREEN_REQUIRED', state.fullscreenExpected && state.fullscreen === false, at);
    observe('VISION_UNAVAILABLE', state.visionStatus === 'unavailable' && state.cameraAvailable !== false && state.tabFocused, at);
    observe('OBJECT_MODEL_UNAVAILABLE', state.objectStatus === 'unavailable' && state.cameraAvailable !== false && state.tabFocused, at);
    return getState();
  }

  function record(type, details = {}, time = now()) {
    if (complete || !RECORDS[type]) return getState();
    const rule = RECORDS[type];
    if (rule.key) counts[rule.key] = bounded(counts[rule.key] + 1);
    const history = (histories.get(type) || []).filter((at) => time - at <= WINDOW_MS);
    history.push(time); histories.set(type, history.slice(-30));
    const severity = rule.key && history.length >= 3 ? 'SUSPICIOUS' : rule.severity;
    emit(type, { ...details, severity, message: rule.message, occurrences: history.length }, time);
    if (type === 'INTERVIEW_COMPLETED') { complete = true; streaks.clear(); }
    return getState();
  }

  function getState() {
    const at = lastAt ?? now();
    const recent = events.filter((event) => at - Date.parse(event.timestamp) <= WINDOW_MS);
    const score = recent.reduce((sum, event) => sum + [0, 3, 12, 25][severityRank(event.severity)], 0);
    const activeTypes = new Set([...streaks].filter(([, streak]) => streak.level >= 0).map(([type]) => type));
    const warnings = events.filter((event) => activeTypes.has(event.type) || at - Date.parse(event.timestamp) < 7000)
      .filter((event, index, all) => all.findLastIndex((other) => other.type === event.type) === index).slice(-6);
    const severity = recent.reduce((current, event) => severityRank(event.severity) > severityRank(current) ? event.severity : current, 'INFO');
    return { ...effective(at), completed: complete, suspicionScore: bounded(score, 100), severity,
      warnings: warnings.map((event) => ({ ...event })), violations: events.filter((event) => severityRank(event.severity) >= 2).map((event) => ({ ...event })),
      events: events.map((event) => ({ ...event })), counters: roundedCounts(), coverage: { ...coverage },
      faceChecks: coverage.faceSamples > 0, phoneChecks: coverage.objectSamples > 0 };
  }
  function roundedCounts() { return Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, Math.round(counts[key])])); }
  function metadata(eventSubset = events, selectedCoverage = coverage) {
    return { faceChecks: selectedCoverage.faceSamples > 0, phoneChecks: selectedCoverage.objectSamples > 0,
      suspicionScore: getState().suspicionScore, coverage: { ...selectedCoverage }, events: eventSubset.map((event) => ({ ...event })) };
  }
  function snapshot() { return { ...roundedCounts(), ...metadata() }; }
  function markQuestion() { mark = { counts: { ...counts }, coverage: { ...coverage }, sequence }; }
  function sinceMark() {
    const difference = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, Math.max(0, Math.round(counts[key] - mark.counts[key]))]));
    const selectedCoverage = Object.fromEntries(Object.keys(coverage).map((key) => [key, Math.max(0, coverage[key] - mark.coverage[key])]));
    return { ...difference, ...metadata(events.filter((event) => event.id > mark.sequence), selectedCoverage) };
  }
  function pause() { streaks.clear(); lastAt = null; return getState(); }
  return { update, record, getState, snapshot, markQuestion, sinceMark, reset, pause };
}
