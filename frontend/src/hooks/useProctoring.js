import { useCallback, useEffect, useRef, useState } from 'react';

// Proctoring runs entirely in the browser: camera frames are analysed on this device and never uploaded.
// Only counts (seconds away, tab switches and so on) are sent to the server with each answer.

let faceApi;
function loadFaceApi() {
  faceApi ??= import('@vladmandic/face-api').then(async (api) => {
    // WebGL runs on the graphics card and is fast. Without it, the CPU is used at a slower pace.
    const webgl = await api.tf.setBackend('webgl').catch(() => false);
    if (!webgl) await api.tf.setBackend('cpu');
    await api.tf.ready();
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri('/models'),
      api.nets.faceLandmark68TinyNet.loadFromUri('/models'),
    ]);
    return api;
  });
  faceApi.catch(() => { faceApi = undefined; }); // allow a retry on the next interview
  return faceApi;
}

// How far the nose may sit from the centre of the eyes (as a share of the eye distance)
// before the head counts as turned away from the screen.
const MAX_YAW = 0.3;

// Share of the smaller box that lies inside the other one.
function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
}

function classify(faces) {
  if (!faces.length) return 'no_face';
  const [main, ...rest] = [...faces].sort((a, b) => b.detection.score - a.detection.score);
  // A second person must be a separate, clearly detected face, not a second box around the same head.
  const others = rest.filter((f) => f.detection.score > 0.6 && overlap(f.detection.box, main.detection.box) < 0.3);
  if (others.length) return 'multiple_faces';
  const points = main.landmarks.positions;
  const [leftEye, rightEye, nose] = [points[36], points[45], points[30]];
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 1;
  const yaw = (nose.x - (leftEye.x + rightEye.x) / 2) / eyeSpan;
  return Math.abs(yaw) > MAX_YAW ? 'looking_away' : 'ok';
}

// Returns: idle | loading | ok | no_face | multiple_faces | looking_away | unavailable
// (the interview room adds no_camera when the camera itself is off)
export function useFaceCheck(videoRef, enabled) {
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    let stopped = false;
    let timer;
    setStatus('loading');

    loadFaceApi().then((api) => {
      const fast = api.tf.getBackend() === 'webgl';
      // Smaller inputs are faster but mistake shoulders for faces, so 320 is the floor.
      const options = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
      const interval = fast ? 700 : 1500; // keep the page responsive when the CPU does the work
      let previous = null;
      const tick = async () => {
        const video = videoRef.current;
        if (!stopped && video?.readyState >= 2 && !document.hidden) {
          try {
            const faces = await api.detectAllFaces(video, options).withFaceLandmarks(true);
            // A status only changes when two checks in a row agree, so a single odd frame is ignored.
            const current = classify(faces);
            if (!stopped && current === previous) setStatus(current);
            previous = current;
          } catch {
            // A dropped frame is not worth reporting; the next tick tries again.
          }
        }
        if (!stopped) timer = setTimeout(tick, interval);
      };
      tick();
    }, () => !stopped && setStatus('unavailable'));

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, videoRef]);

  return status;
}

const EMPTY = { awayEvents: 0, awaySeconds: 0, noFaceSeconds: 0, lookAwaySeconds: 0, multipleFaceEvents: 0, pasteAttempts: 0, fullscreenExits: 0 };

const FACE_WARNINGS = {
  no_camera: 'Your camera is off. Interviewers expect to see you throughout.',
  no_face: "We can't see your face. Please stay in front of the camera.",
  multiple_faces: 'Someone else seems to be in view. Interviews should be taken alone.',
  looking_away: 'Please keep your eyes on the interview screen.',
};
const FACE_SECONDS = { no_camera: 'noFaceSeconds', no_face: 'noFaceSeconds', looking_away: 'lookAwaySeconds' };

// Tracks everything a real proctored interview would notice, and keeps per-question and total counts.
export function useIntegrity({ active, faceStatus, fullscreen }) {
  const totals = useRef({ ...EMPTY });
  const mark = useRef({ ...EMPTY });
  const [faceWarning, setFaceWarning] = useState('');
  const [notice, setNotice] = useState('');
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);
  const noticeTimer = useRef();
  const faceRef = useRef(faceStatus);
  faceRef.current = faceStatus;

  const add = (key, amount = 1) => { totals.current[key] += amount; };

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6000);
  }, []);

  // Face checks: a problem only counts once it lasts two seconds, so glances and dropped frames are ignored.
  useEffect(() => {
    if (!active) return;
    let streakStatus = 'ok';
    let streak = 0;
    const timer = setInterval(() => {
      const status = faceRef.current;
      if (!FACE_WARNINGS[status]) {
        streak = 0;
        streakStatus = status;
        setFaceWarning('');
        return;
      }
      streak = status === streakStatus ? streak + 1 : 1;
      streakStatus = status;
      if (streak < 2) return;
      if (streak === 2) {
        setFaceWarning(FACE_WARNINGS[status]);
        if (status === 'multiple_faces') add('multipleFaceEvents');
      }
      if (FACE_SECONDS[status]) add(FACE_SECONDS[status], streak === 2 ? 2 : 1);
    }, 1000);
    return () => {
      clearInterval(timer);
      setFaceWarning('');
    };
  }, [active]);

  // Leaving the tab or the window. Very short blurs (permission prompts, a stray click) are ignored.
  useEffect(() => {
    if (!active) return;
    let awaySince = null;
    const leave = () => { awaySince ??= Date.now(); };
    const back = () => {
      if (awaySince === null) return;
      const seconds = Math.round((Date.now() - awaySince) / 1000);
      awaySince = null;
      if (seconds < 2) return;
      add('awayEvents');
      add('awaySeconds', seconds);
      flash(`You left the interview window for ${seconds} seconds. This has been noted.`);
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, flash]);

  // Full screen, where the browser supports it.
  useEffect(() => {
    if (!active || !fullscreen || !document.fullscreenEnabled) return;
    const onChange = () => {
      const inFullscreen = Boolean(document.fullscreenElement);
      if (!inFullscreen) add('fullscreenExits');
      setOutOfFullscreen(!inFullscreen);
    };
    setOutOfFullscreen(!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      setOutOfFullscreen(false);
    };
  }, [active, fullscreen]);

  const flagPaste = useCallback(() => {
    add('pasteAttempts');
    flash('Pasting is turned off during the interview. Please answer in your own words.');
  }, [flash]);

  const markQuestion = useCallback(() => { mark.current = { ...totals.current }; }, []);
  const sinceMark = useCallback(
    () => Object.fromEntries(Object.keys(EMPTY).map((key) => [key, totals.current[key] - mark.current[key]])),
    [],
  );
  const snapshot = useCallback(() => ({ ...totals.current }), []);

  const warnings = [faceWarning, notice].filter(Boolean);
  return { warnings, outOfFullscreen, flagPaste, markQuestion, sinceMark, snapshot };
}

export async function enterFullscreen() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    // Some browsers (iOS Safari) refuse; the interview simply continues in the window.
  }
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
