// Both models analyse camera pixels on this device. Only aggregate observations
// leave this module; no images, landmarks or face identity descriptors are stored.
const FACE_THRESHOLD = 0.55;
const SECOND_FACE_THRESHOLD = 0.7;
const PHONE_THRESHOLD = 0.55;
const REFERENCE_OBJECTS = new Set(['book', 'remote']);
let runtimePromise;
let facePromise;
let objectPromise;
let inferenceQueue = Promise.resolve();

function serializeInference(operation) {
  const pending = inferenceQueue.then(operation);
  inferenceQueue = pending.catch(() => {});
  return pending;
}

function loadRuntime() {
  if (!runtimePromise) {
    // The non-bundled entry shares TensorFlow with COCO SSD. Loading the default
    // face-api bundle as well would register a second TensorFlow engine.
    runtimePromise = import('@vladmandic/face-api/dist/face-api.esm-nobundle.js').then(async (api) => {
      const webgl = await api.tf.setBackend('webgl').catch(() => false);
      if (!webgl) await api.tf.setBackend('cpu');
      await api.tf.ready();
      return api;
    });
    runtimePromise.catch(() => { runtimePromise = undefined; });
  }
  return runtimePromise;
}

export async function loadVisionModels() {
  const api = await loadRuntime();
  if (!facePromise) {
    facePromise = serializeInference(async () => {
      const loaded = await Promise.allSettled([
        api.nets.tinyFaceDetector.isLoaded ? Promise.resolve() : api.nets.tinyFaceDetector.loadFromUri('/models'),
        api.nets.faceLandmark68TinyNet.isLoaded ? Promise.resolve() : api.nets.faceLandmark68TinyNet.loadFromUri('/models'),
      ]);
      if (loaded.some((result) => result.status === 'rejected')) throw new Error('Face models are unavailable');
      return api;
    });
    facePromise.catch(() => { facePromise = undefined; });
  }
  if (!objectPromise) {
    objectPromise = import('@tensorflow-models/coco-ssd').then((coco) => serializeInference(async () => {
      const detector = new coco.ObjectDetection('lite_mobilenet_v2', '/models/coco-ssd/model.json');
      try { await detector.load(); return detector; }
      catch (error) { detector.dispose(); throw error; }
    }));
    objectPromise.catch(() => { objectPromise = undefined; });
  }
  const [face, object] = await Promise.allSettled([facePromise, objectPromise]);
  return { api: face.status === 'fulfilled' ? api : null, detector: object.status === 'fulfilled' ? object.value : null,
    faceError: face.status === 'rejected', objectError: object.status === 'rejected',
    fast: api.tf.getBackend() === 'webgl' };
}

function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export function normalizeFaces(detections, width, height, previous = null) {
  const candidates = detections.filter((face) => {
    const box = face.detection?.box;
    return face.detection?.score >= FACE_THRESHOLD && box && box.width > 0 && box.height > 0;
  }).sort((a, b) => b.detection.score - a.detection.score);
  const separate = [];
  for (const face of candidates) {
    if (!separate.some((other) => overlap(face.detection.box, other.detection.box) >= 0.35)) separate.push(face);
  }
  // Additional people require stronger confidence than the primary face.
  const faces = separate.filter((face, index) => index === 0 || face.detection.score >= SECOND_FACE_THRESHOLD);
  if (!faces.length) {
    // Weak face boxes are uncertainty, rather than evidence of an empty frame.
    const uncertain = detections.length > 0;
    return { faceCount: uncertain ? null : 0, facePresent: uncertain ? null : false, faceConfidence: 0,
      lookingAway: false, tooFar: false, movement: 0, yaw: null, faceBox: null };
  }
  const main = faces[0];
  const box = main.detection.box;
  const points = main.landmarks?.positions;
  const [left, right, nose] = [points?.[36], points?.[45], points?.[30]];
  const span = left && right ? Math.hypot(right.x - left.x, right.y - left.y) : 0;
  const yaw = span > 8 && nose ? (nose.x - (left.x + right.x) / 2) / span : null;
  const normalizedBox = { x: box.x / width, y: box.y / height, width: box.width / width, height: box.height / height };
  // This is a framing proxy, not a measured physical distance.
  const tooFar = normalizedBox.width < 0.12 || normalizedBox.height < 0.16;
  const center = { x: normalizedBox.x + normalizedBox.width / 2, y: normalizedBox.y + normalizedBox.height / 2 };
  const oldBox = previous?.faceBox;
  const movement = oldBox ? Math.hypot(center.x - oldBox.x - oldBox.width / 2, center.y - oldBox.y - oldBox.height / 2)
    / Math.max(0.12, normalizedBox.width) : 0;
  return { faceCount: faces.length, facePresent: true,
    faceConfidence: Math.min(...faces.map((face) => face.detection.score)),
    lookingAway: yaw !== null && Math.abs(yaw) > 0.32, tooFar, movement: Math.min(movement, 2), yaw,
    faceBox: normalizedBox };
}

export function normalizeObjects(predictions, width, height, faceBox = null) {
  const valid = predictions.filter((item) => Number.isFinite(item.score) && item.bbox?.length === 4 && item.bbox[2] > 0 && item.bbox[3] > 0);
  const phone = valid.filter((item) => item.class === 'cell phone' && item.score >= PHONE_THRESHOLD)
    .sort((a, b) => b.score - a.score)[0];
  const nearFace = phone && faceBox ? (() => {
    const [x, y, w, h] = phone.bbox;
    const px = (x + w / 2) / width;
    const py = (y + h / 2) / height;
    const fx = faceBox.x + faceBox.width / 2;
    const fy = faceBox.y + faceBox.height / 2;
    return Math.hypot(px - fx, py - fy) < Math.max(0.28, faceBox.height * 1.8);
  })() : false;
  return { phoneDetected: Boolean(phone), phoneConfidence: phone?.score ?? 0, phoneNearFace: Boolean(nearFace),
    suspiciousObjects: valid.filter((item) => REFERENCE_OBJECTS.has(item.class) && item.score >= 0.7)
      .map((item) => ({ label: item.class, confidence: item.score })).slice(0, 3) };
}

// setTimeout is scheduled only after inference finishes: no overlapping work or
// growing backlog even when a CPU takes longer than the desired sampling rate.
export function createVisionMonitor({ getVideo, onSample, onStatus = () => {},
  loadModels = loadVisionModels, now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay), cancel = (timer) => clearTimeout(timer),
  isHidden = () => document.hidden, makeCanvas = () => document.createElement('canvas') }) {
  let generation = 0;
  let timer;
  let running = false;
  let canvas;
  let lastFace = null;
  let objects = { phoneDetected: false, phoneConfidence: 0, suspiciousObjects: [], objectsObservedAt: null };
  function stop() {
    running = false;
    generation += 1;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (canvas) { canvas.width = 0; canvas.height = 0; canvas = undefined; }
    lastFace = null;
    objects = { phoneDetected: false, phoneConfidence: 0, suspiciousObjects: [], objectsObservedAt: null };
  }
  async function start() {
    if (running) return;
    running = true;
    const token = ++generation;
    onStatus({ visionStatus: 'loading', objectStatus: 'loading' });
    let models;
    try { models = await loadModels(); } catch {
      if (running && token === generation) onStatus({ visionStatus: 'unavailable', objectStatus: 'unavailable' });
      return;
    }
    if (!running || token !== generation) return;
    let faceReady = Boolean(models.api);
    let objectReady = Boolean(models.detector);
    let faceErrors = 0;
    let objectErrors = 0;
    let lastObjectAt = -Infinity;
    const interval = models.fast ? 750 : 1500;
    const objectInterval = models.fast ? 2400 : 4000;
    const faceOptions = faceReady ? new models.api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }) : null;
    onStatus({ visionStatus: faceReady ? 'ready' : 'unavailable', objectStatus: objectReady ? 'ready' : 'unavailable' });

    const tick = async () => {
      const startedAt = now();
      const video = getVideo();
      if (running && token === generation && video?.readyState >= 2 && video.videoWidth > 0 && !isHidden()) {
        if (faceReady) {
          try {
            const detected = await serializeInference(() => running && token === generation
              ? models.api.detectAllFaces(video, faceOptions).withFaceLandmarks(true) : null);
            if (detected && running && token === generation) {
              lastFace = { ...normalizeFaces(detected, video.videoWidth, video.videoHeight, lastFace), timestamp: now() };
              faceErrors = 0;
            }
          } catch {
            if (running && token === generation && ++faceErrors >= 3) { faceReady = false; onStatus({ visionStatus: 'unavailable' }); }
          }
        }
        if (running && token === generation && objectReady && startedAt - lastObjectAt >= objectInterval) {
          try {
            canvas ||= makeCanvas();
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Camera frame unavailable');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const detected = await serializeInference(() => running && token === generation ? models.detector.detect(canvas, 12, 0.5) : null);
            if (detected && running && token === generation) {
              objects = { ...normalizeObjects(detected, canvas.width, canvas.height, lastFace?.faceBox), objectsObservedAt: now() };
              lastObjectAt = now(); objectErrors = 0;
            }
          } catch {
            lastObjectAt = now();
            if (running && token === generation && ++objectErrors >= 3) { objectReady = false; onStatus({ objectStatus: 'unavailable' }); }
          }
        }
        if (running && token === generation) {
          // faceBox is only used locally for motion/proximity; hooks never need it.
          const { faceBox: _localBox, ...face } = lastFace || {};
          onSample({ ...face, ...objects, visionStatus: faceReady ? 'ready' : 'unavailable', objectStatus: objectReady ? 'ready' : 'unavailable' });
        }
      }
      if (running && token === generation && (faceReady || objectReady)) timer = schedule(tick, Math.max(200, interval - (now() - startedAt)));
    };
    await tick();
  }
  async function retry() { stop(); return start(); }
  return { start, stop, retry };
}
