import { useCallback, useEffect, useRef, useState } from 'react';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---------- Interviewer voices (browser text-to-speech) ----------

const FEMALE = /female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|sonia|libby|natasha|susan|serena|allison|ava|heera|neerja|google us english/i;
const MALE = /\bmale\b|\bman\b|daniel|\balex\b|fred|david|guy|ryan|thomas|george|arthur|oliver|rishi|ravi|prabhat|aaron|mark|google uk english male/i;
const NATURAL = /natural|neural|online|google|premium|enhanced/i;

export function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => {
      const english = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
      // Natural-sounding voices first; they are far less robotic than the defaults.
      setVoices(english.sort((a, b) => NATURAL.test(b.name) - NATURAL.test(a.name)));
    };
    load();
    synth.addEventListener('voiceschanged', load);
    return () => synth.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

// A different voice per interviewer, matching the avatar's gender when the browser offers one.
export function assignVoices(voices, interviewers) {
  const used = new Set();
  const entries = interviewers.map(({ id, gender }) => {
    const matches = voices.filter((v) => (gender === 'female' ? FEMALE.test(v.name) : MALE.test(v.name) && !FEMALE.test(v.name)));
    const voice = matches.find((v) => !used.has(v.name)) || matches[0] || voices.find((v) => !used.has(v.name)) || voices[0] || null;
    if (voice) used.add(voice.name);
    return [id, voice];
  });
  return Object.fromEntries(entries);
}

// Browsers load their voice list asynchronously; the first question shouldn't use the fallback voice.
export function voicesReady(timeoutMs = 1200) {
  const synth = window.speechSynthesis;
  if (!synth || synth.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 50); // let React pick up the new voice list first
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(resolve, timeoutMs);
  });
}

export function speak(text, { voice, rate = 1, pitch = 1 } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return Promise.resolve();
  synth.cancel();

  // Chrome silently stops long utterances, so the text is spoken a sentence or two at a time.
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = sentences.reduce((all, sentence) => {
    const last = all.at(-1);
    if (last && last.length + sentence.length < 220) all[all.length - 1] = last + sentence;
    else all.push(sentence);
    return all;
  }, []);

  return new Promise((resolve) => {
    // Some browsers never fire onend, so never wait much longer than the speech should take.
    const words = text.split(/\s+/).length;
    const safety = setTimeout(resolve, (words / 2.2) * 1000 + 4000);
    const done = () => { clearTimeout(safety); resolve(); };

    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk.trim());
      Object.assign(utterance, { voice, rate, pitch, lang: voice?.lang || 'en-US' });
      if (i === chunks.length - 1) {
        utterance.onend = done;
        utterance.onerror = done;
      }
      synth.speak(utterance);
    });
  });
}

export const stopSpeaking = () => window.speechSynthesis?.cancel();

// ---------- Candidate voice (browser speech recognition) ----------

const RECOGNITION_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'audio-capture': 'No microphone was found. Connect one or type your answer.',
  network: "Your browser's speech service can't be reached. Type your answer instead.",
};

export function useSpeechRecognition() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recognition = useRef(null);
  const wanted = useRef(false);
  const finalText = useRef('');
  const interimText = useRef('');

  const start = useCallback(() => {
    if (!Recognition || wanted.current) return;
    wanted.current = true;
    finalText.current = '';
    interimText.current = '';
    setTranscript('');
    setInterim('');
    setError('');

    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
    rec.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText.current += `${result[0].transcript.trim()} `;
        else pending += result[0].transcript;
      }
      interimText.current = pending;
      setTranscript(finalText.current);
      setInterim(pending);
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      wanted.current = false;
      setError(RECOGNITION_ERRORS[event.error] || 'Voice input stopped unexpectedly. You can type your answer instead.');
    };
    // Chrome ends recognition after a pause; keep going until the candidate says they are done.
    rec.onend = () => {
      if (wanted.current) {
        try { rec.start(); } catch { wanted.current = false; setListening(false); }
      } else {
        setListening(false);
      }
    };
    recognition.current = rec;
    rec.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    recognition.current?.stop();
    setListening(false);
    return `${finalText.current} ${interimText.current}`.replace(/\s+/g, ' ').trim();
  }, []);

  useEffect(() => () => { wanted.current = false; recognition.current?.abort(); }, []);

  return { supported: Boolean(Recognition), listening, transcript, interim, error, start, stop };
}

// ---------- Fallback: record audio and transcribe on the server ----------

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const recorder = useRef(null);
  const chunks = useRef([]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (event) => chunks.current.push(event.data);
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }, []);

  const stop = useCallback(() => new Promise((resolve) => {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return resolve(null);
    rec.onstop = () => {
      rec.stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      resolve(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.stop();
  }), []);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);

  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  return { supported, recording, start, stop };
}

// ---------- Candidate camera (local preview only, never uploaded) ----------

export function useCamera() {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');

  const toggle = useCallback(async () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      return;
    }
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } }));
      setError('');
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Camera access is blocked in your browser.' : 'No camera is available.');
    }
  }, [stream]);

  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);

  return { stream, error, toggle };
}
