import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Captions, CaptionsOff, Check, Clock, Keyboard, Maximize, Mic, PhoneOff, RefreshCw, ShieldCheck, Video, VideoOff, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { api } from '../api';
import { assignVoices, speak, stopSpeaking, useMicLevel, useRecorder, useSpeechRecognition, useVoices, voicesReady } from '../hooks/useMedia';
import { enterFullscreen, useIntegrity, useMonitoring } from '../hooks/useProctoring';
import { CATEGORY_LABEL, DIFFICULTIES, INTERVIEW_TYPES, ROLE_INFO, avatarById } from '../data/panel';
import AnswerPanel from './AnswerPanel';
import { CandidateTile, InterviewerTile } from './VideoTiles';
import { Button, ErrorBanner, Spinner } from './ui';

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const joinAnswer = (...parts) => parts.filter((part) => part?.trim()).map((part) => part.trim()).join(' ');
const FACE_RAN = new Set(['ok', 'no_face', 'looking_away', 'multiple_faces', 'too_far', 'excessive_movement']);
function validateNextInterview(next, previous) {
  const validPanel = Array.isArray(next?.panel) && next.panel.length > 0 && next.panel.every((person) =>
    typeof person.id === 'string' && typeof person.name === 'string' && typeof person.title === 'string' && ROLE_INFO[person.role]);
  const validProgress = Number.isFinite(next?.progress?.current) && Number.isFinite(next?.progress?.total) && next.progress.total > 0;
  const validLine = next?.done
    ? typeof next.closing?.message === 'string' && next.closing.message.trim().length > 0
    : Number.isFinite(next?.turn?.number) && next.turn.number > previous.turn?.number && typeof next.turn.question === 'string' && next.turn.question.trim().length > 0;
  if (next?.sessionId !== previous.sessionId || !validPanel || !validProgress || !validLine) {
    throw new Error('The interviewer returned an incomplete response. Your answer is saved; please try again.');
  }
}

export default function InterviewRoom({ initialState, setup, health, camera, onFinished }) {
  const [interview, setInterview] = useState(initialState);
  const [phase, setPhase] = useState('speaking');
  const [audioSpeaking, setAudioSpeaking] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraftState] = useState('');
  const draftRef = useRef('');
  const setDraft = useCallback((value) => {
    const next = typeof value === 'function' ? value(draftRef.current) : value;
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [audioRetry, setAudioRetry] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [requestFailed, setRequestFailed] = useState(false);
  const [requestSeconds, setRequestSeconds] = useState(0);
  const [answerUpload, setAnswerUpload] = useState(null);
  const [micPaused, setMicPaused] = useState(false);
  const [segmentProcessing, setSegmentProcessing] = useState(false);
  const [pendingSegmentCount, setPendingSegmentCount] = useState(0);
  const [heartbeatError, setHeartbeatError] = useState('');
  const audioSegments = useRef(new Map());
  const audioGeneration = useRef(0);
  const segmentWorker = useRef(null);
  const segmentFailure = useRef(null);
  const processSegmentsRef = useRef(null);
  const segmentHandler = useCallback((segment) => {
    if (!mounted.current || !segment?.blob?.size || audioSegments.current.has(segment.id)) return;
    audioSegments.current.set(segment.id, segment);
    setPendingSegmentCount(audioSegments.current.size);
    if (phaseRef.current === 'answering' && !segmentFailure.current) processSegmentsRef.current?.().catch(() => {});
  }, []);

  const recognition = useSpeechRecognition();
  const recorder = useRecorder({ onSegment: segmentHandler });
  const voices = useVoices();
  const voiceSupport = recognition.supported ? 'browser' : recorder.supported && health?.providers?.groq ? 'recorder' : 'none';
  const [inputMode, setInputMode] = useState(voiceSupport === 'none' ? 'text' : 'voice');
  const people = useMemo(() => interview.panel.map((p) => ({ ...p, avatar: avatarById(p.avatarId), gender: avatarById(p.avatarId).gender })), [interview.panel]);
  const voiceMap = useMemo(() => assignVoices(voices, people), [voices, people]);
  const line = interview.done ? interview.closing : interview.turn;
  const speaker = people.find((p) => p.id === line?.interviewer) || people[0];
  const spokenText = line ? [line.reaction, line.question ?? line.message].filter(Boolean).join(' ') : '';
  const lineKey = interview.done ? 'closing' : interview.turn?.number;
  const voiceActive = voiceSupport === 'recorder' ? recorder.recording : recognition.listening;
  const mic = useMicLevel(voiceActive, voiceSupport === 'recorder' ? recorder.stream : undefined);
  const mounted = useRef(true);
  const phaseRef = useRef(phase);
  const operation = useRef(null);
  const requestToken = useRef(0);
  const requestController = useRef(null);
  const transcribeController = useRef(null);
  const speechToken = useRef(0);
  const failedAnswer = useRef(null);
  const latest = useRef({});
  latest.current = { voiceMap, muted, speaker, spokenText, interview, draft: draftRef.current, inputMode, voiceSupport, recognition, recorder, voiceActive };
  phaseRef.current = phase;

  const changePhase = useCallback((next) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }, []);
  const silence = useCallback(() => {
    speechToken.current++;
    stopSpeaking();
    if (mounted.current) setAudioSpeaking(false);
  }, []);

  const playLine = useCallback(async () => {
    const { spokenText: text, speaker: person, interview: state } = latest.current;
    if (!text || !person) { changePhase(state.done ? 'ended' : 'answering'); return; }
    silence();
    const token = ++speechToken.current;
    changePhase('speaking');
    setSpeechNotice('');
    if (!latest.current.muted) {
      await voicesReady();
      if (!mounted.current || token !== speechToken.current) return;
      const result = await speak(text, {
        voice: latest.current.voiceMap[person.id],
        ...ROLE_INFO[person.role]?.voice,
        onStart: () => { if (mounted.current && token === speechToken.current) setAudioSpeaking(true); },
        onEnd: () => { if (mounted.current && token === speechToken.current) setAudioSpeaking(false); },
      });
      if (result?.reason === 'unavailable' || result?.reason === 'error' || result?.reason === 'timeout') {
        if (mounted.current && token === speechToken.current) {
          setSpeechNotice('Interviewer audio is unavailable. Read the question below to continue.');
          setCaptions(true);
        }
      }
    }
    if (mounted.current && token === speechToken.current) {
      setAudioSpeaking(false);
      changePhase(state.done ? 'ended' : 'answering');
    }
  }, [changePhase, silence]);

  useEffect(() => {
    setMicPaused(false);
    playLine();
    return silence;
  }, [lineKey, playLine, silence]);

  const processAudioSegments = useCallback((retry = false) => {
    if (segmentWorker.current) return segmentWorker.current;
    if (segmentFailure.current && !retry) return Promise.reject(segmentFailure.current);
    segmentFailure.current = null;
    const generation = audioGeneration.current;
    setSegmentProcessing(true);
    const task = (async () => {
      while (mounted.current && generation === audioGeneration.current && audioSegments.current.size) {
        const segment = [...audioSegments.current.values()].sort((a, b) => a.sequence - b.sequence)[0];
        const controller = new AbortController();
        transcribeController.current = controller;
        try {
          const result = await api.transcribe(segment.blob, { signal: controller.signal });
          if (!mounted.current || generation !== audioGeneration.current) return;
          if (typeof result?.text !== 'string') throw new Error('The recording response was unreadable. Your audio is saved for retry.');
          if (result.text.trim()) setDraft((current) => joinAnswer(current, result.text));
          latest.current.recorder.acknowledgeSegment(segment.id);
          audioSegments.current.delete(segment.id);
          setPendingSegmentCount(audioSegments.current.size);
        } catch (err) {
          if (!mounted.current || generation !== audioGeneration.current) return;
          segmentFailure.current = err;
          setAudioRetry(true);
          setError(`${err.message || 'A recording segment could not be transcribed.'} Your remaining audio is saved in this tab. You can keep speaking or retry it.`);
          throw err;
        } finally {
          if (transcribeController.current === controller) transcribeController.current = null;
        }
      }
      if (mounted.current && generation === audioGeneration.current) setAudioRetry(false);
    })();
    segmentWorker.current = task;
    task.finally(() => {
      if (segmentWorker.current === task) {
        segmentWorker.current = null;
        if (mounted.current) setSegmentProcessing(false);
      }
    }).catch(() => {});
    return task;
  }, [setDraft]);
  processSegmentsRef.current = processAudioSegments;

  const clearAudioSegments = useCallback(() => {
    audioGeneration.current++;
    transcribeController.current?.abort();
    audioSegments.current.clear();
    segmentFailure.current = null;
    latest.current.recorder.discardSegments?.();
    if (mounted.current) { setPendingSegmentCount(0); setAudioRetry(false); }
  }, []);

  // Recorder segments are transcribed in order during capture. Sending only happens
  // after the candidate explicitly finishes and all remaining segments are decoded.
  const stopCandidate = useCallback(async (transcribe = true) => {
    const { voiceSupport: kind, recognition: rec, recorder: recording } = latest.current;
    if (kind !== 'recorder') return await (rec.finish?.() ?? rec.stop());
    if (!transcribe) {
      audioGeneration.current++;
      transcribeController.current?.abort();
    }
    const segments = await recording.stopSegments();
    if (!mounted.current) return '';
    for (const segment of segments) if (segment.blob?.size) audioSegments.current.set(segment.id, segment);
    setPendingSegmentCount(audioSegments.current.size);
    if (!transcribe) {
      setAudioRetry(audioSegments.current.size > 0);
      return '';
    }
    setTranscribing(true);
    try {
      await processAudioSegments();
      return ''; // successful segment text was appended to the authoritative draft
    } finally {
      if (mounted.current) setTranscribing(false);
    }
  }, [processAudioSegments]);

  const startVoice = useCallback(async () => {
    if (operation.current || phaseRef.current !== 'answering' || latest.current.voiceActive) return;
    if (audioSegments.current.size) {
      setError('Retry or discard your saved recording before starting a new one.');
      return;
    }
    operation.current = 'starting';
    setCapturing(true);
    setMicPaused(false);
    silence();
    try {
      const current = latest.current;
      await (current.voiceSupport === 'recorder' ? current.recorder.start() : current.recognition.start());
      if (!mounted.current || phaseRef.current !== 'answering' || latest.current.inputMode !== 'voice') {
        await stopCandidate(false);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err?.message || 'Microphone access is unavailable. Check your browser permissions or type your answer.');
        setInputMode('text');
      }
    } finally {
      if (operation.current === 'starting') operation.current = null;
      if (mounted.current) setCapturing(false);
    }
  }, [silence, stopCandidate]);

  useEffect(() => {
    if (phase === 'answering' && inputMode === 'voice' && !micPaused && !voiceActive && !audioRetry) startVoice();
  }, [phase, inputMode, micPaused, audioRetry, startVoice]); // capture restart is an explicit user action

  useEffect(() => {
    const message = recognition.error || recorder.error;
    if (!message) return;
    const spoken = recognition.stop();
    if (spoken) setDraft((current) => joinAnswer(current, spoken));
    setError(message);
    setMicPaused(true);
    setInputMode('text');
  }, [recognition.error, recorder.error, recognition.stop]);

  useEffect(() => {
    if (!voiceActive || !['denied', 'disconnected'].includes(mic.status)) return;
    const captured = recognition.stop();
    if (captured) setDraft((current) => joinAnswer(current, captured));
    recorder.stopSegments().then((segments) => {
      if (!mounted.current) return;
      for (const segment of segments) if (segment.blob?.size) audioSegments.current.set(segment.id, segment);
      setPendingSegmentCount(audioSegments.current.size);
      setAudioRetry(audioSegments.current.size > 0);
    }).catch(() => {});
    setError(mic.error || 'Microphone access was interrupted. Your captured answer is saved; you can continue typing.');
    setMicPaused(true);
    setInputMode('text');
  }, [mic.status, mic.error, voiceActive, recognition.stop, recorder.stopSegments]);

  const finished = phase === 'ended' || phase === 'ending';
  const proctored = Boolean(setup.proctored);
  const selfView = useRef(null);
  const monitoring = useMonitoring(selfView, { enabled: proctored && Boolean(camera.stream) && !finished });
  const faceStatus = proctored && !camera.stream ? 'no_camera' : monitoring.faceStatus;
  const faceRan = useRef(false);
  if (FACE_RAN.has(monitoring.faceStatus)) faceRan.current = true;
  const integrity = useIntegrity({
    active: proctored && !finished,
    completed: phase === 'ended',
    faceStatus,
    monitoring,
    vision: monitoring.sample || monitoring.latest,
    cameraStream: camera.stream,
    cameraStatus: camera.status,
    microphoneStream: voiceSupport === 'recorder' ? recorder.stream : mic.stream,
    microphoneStatus: voiceActive ? mic.status : recognition.error || recorder.error ? 'error' : 'idle',
    microphoneExpected: voiceActive,
    fullscreen: proctored,
  });
  const { markQuestion } = integrity;

  useEffect(() => { if (!camera.stream && camera.status !== 'denied') camera.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { markQuestion(); }, [lineKey, markQuestion]);
  useEffect(() => { if (phase === 'ended') camera.stop(); }, [phase, camera.stop]);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [finished]);
  useEffect(() => {
    setRequestSeconds(0);
    if (phase !== 'thinking' && phase !== 'ending') return;
    const start = Date.now();
    const timer = setInterval(() => setRequestSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (phase !== 'speaking' && phase !== 'answering') return;
    let stopped = false;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || stopped) return;
      pending = true;
      try {
        await api.keepAlive(interview.sessionId, { signal: controller.signal });
        if (!stopped) setHeartbeatError('');
      } catch (err) {
        if (!stopped && err.name !== 'AbortError') setHeartbeatError('The session could not be refreshed. Your answer stays in this tab; check your connection before sending.');
      } finally { pending = false; }
    };
    const timer = setInterval(refresh, 60000);
    return () => { stopped = true; clearInterval(timer); controller.abort(); };
  }, [interview.sessionId, phase]);
  useEffect(() => {
    mounted.current = true;
    const warn = (event) => { if (!latest.current.interview.done) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => {
      mounted.current = false;
      requestToken.current++;
      speechToken.current++;
      requestController.current?.abort();
      transcribeController.current?.abort();
      audioGeneration.current++;
      api.clearAnswerUploads(latest.current.interview.sessionId);
      window.removeEventListener('beforeunload', warn);
      stopSpeaking();
      recognition.cancel?.();
      recorder.stopSegments().catch(() => {});
    };
  }, [recognition.cancel, recorder.stopSegments]);

  async function submit({ text = '', skipped = false }, ownsOperation = false) {
    if ((!ownsOperation && operation.current) || phaseRef.current !== 'answering') return;
    const answer = text;
    if (!skipped && !answer.trim()) {
      setError("We didn't catch an answer. Try again, type it, or skip the question.");
      return;
    }
    operation.current = 'answer';
    const token = ++requestToken.current;
    const controller = new AbortController();
    requestController.current = controller;
    setError('');
    setRequestFailed(false);
    setAnswerUpload(null);
    failedAnswer.current = { text: answer, skipped };
    setDraft(skipped ? latest.current.draft : answer);
    silence();
    changePhase('thinking');
    const submittedInterview = latest.current.interview;
    try {
      const next = await api.answer(submittedInterview.sessionId, {
        text: answer, skipped, expectedTurn: submittedInterview.turn.number,
        ...(proctored && { integrity: integrity.sinceMark() }),
      }, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (mounted.current && token === requestToken.current) setAnswerUpload(progress);
        },
      });
      if (!mounted.current || token !== requestToken.current) return;
      validateNextInterview(next, submittedInterview);
      clearAudioSegments();
      failedAnswer.current = null;
      setDraft('');
      setInterview(next);
    } catch (err) {
      if (!mounted.current || token !== requestToken.current) return;
      setError(err.message || 'Your answer could not be sent. It is saved below; try again.');
      setRequestFailed(true);
      setAudioRetry(audioSegments.current.size > 0);
      setInputMode('text');
      setMicPaused(true);
      changePhase('answering');
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (token === requestToken.current) operation.current = null;
    }
  }

  async function sendVoiceAnswer() {
    if (operation.current || phaseRef.current !== 'answering') return;
    operation.current = 'capture';
    setCapturing(true);
    setMicPaused(true);
    try {
      const spoken = await stopCandidate();
      if (!mounted.current) return;
      const answer = joinAnswer(draftRef.current, spoken);
      setDraft(answer);
      await submit({ text: answer }, true);
    } catch (err) {
      if (mounted.current) {
        setError(err.message || 'Your recording could not be transcribed. Retry it or type your answer.');
        setInputMode('text');
      }
    } finally {
      if (operation.current === 'capture') operation.current = null;
      if (mounted.current) setCapturing(false);
    }
  }

  async function switchToText() {
    if (operation.current || phaseRef.current !== 'answering') return;
    operation.current = 'capture';
    setCapturing(true);
    setMicPaused(true);
    try {
      const spoken = await stopCandidate();
      if (mounted.current && spoken) setDraft((current) => joinAnswer(current, spoken));
    } catch (err) {
      if (mounted.current) setError(err.message || 'Transcription failed. Your recording is saved for retry.');
    } finally {
      if (operation.current === 'capture') operation.current = null;
      if (mounted.current) { setCapturing(false); setInputMode('text'); }
    }
  }

  async function retryRecording() {
    if (operation.current || !audioSegments.current.size) return;
    const captureContinues = latest.current.voiceActive;
    if (!captureContinues) { operation.current = 'capture'; setCapturing(true); }
    setError('');
    try {
      await processAudioSegments(true);
      if (mounted.current && !captureContinues) setInputMode('text');
    } catch (err) {
      if (mounted.current) setError(err.message || 'Transcription failed. Your recording is still saved.');
    } finally {
      if (!captureContinues) {
        if (operation.current === 'capture') operation.current = null;
        if (mounted.current) setCapturing(false);
      }
    }
  }

  async function repeatQuestion() {
    if (operation.current || phaseRef.current !== 'answering') return;
    operation.current = 'repeat';
    setCapturing(true);
    setMicPaused(true);
    try {
      const spoken = await stopCandidate();
      if (!mounted.current) return;
      if (spoken) setDraft((current) => joinAnswer(current, spoken));
      operation.current = null;
      setCapturing(false);
      setMicPaused(false);
      await playLine();
    } catch (err) {
      if (mounted.current) { setError(err.message || 'Your recording is saved. Retry transcription before repeating the question.'); setInputMode('text'); }
    } finally {
      if (operation.current === 'repeat') operation.current = null;
      if (mounted.current) setCapturing(false);
    }
  }

  async function skipQuestion() {
    if (operation.current || phaseRef.current !== 'answering') return;
    operation.current = 'capture';
    setCapturing(true);
    setMicPaused(true);
    try {
      await stopCandidate(false);
      if (!mounted.current) return;
      await submit({ skipped: true }, true);
    } catch (err) {
      if (mounted.current) setError(err.message || 'The microphone could not be stopped. Try again or use a typed answer.');
    } finally {
      if (operation.current === 'capture') operation.current = null;
      if (mounted.current) setCapturing(false);
    }
  }

  function toggleInputMode() {
    if (operation.current || phaseRef.current !== 'answering') return;
    if (inputMode === 'voice') switchToText();
    else if (voiceSupport !== 'none') { setMicPaused(false); setInputMode('voice'); }
  }
  function toggleMute() {
    const next = !muted;
    latest.current.muted = next;
    setMuted(next);
    if (next) {
      silence();
      if (phaseRef.current === 'speaking') changePhase(interview.done ? 'ended' : 'answering');
    }
  }
  function skipListening() {
    silence();
    changePhase(interview.done ? 'ended' : 'answering');
  }

  async function finish() {
    if (operation.current || phaseRef.current === 'ending') return;
    const previousPhase = phaseRef.current;
    operation.current = 'ending';
    const token = ++requestToken.current;
    const controller = new AbortController();
    requestController.current = controller;
    setConfirmingEnd(false);
    silence();
    setMicPaused(true);
    const finalIntegrity = proctored ? { ...integrity.snapshot(), faceChecks: faceRan.current } : undefined;
    changePhase('ending');
    setError('');
    try {
      const spoken = await stopCandidate(false);
      if (!mounted.current || token !== requestToken.current) return;
      if (spoken && mounted.current) setDraft((current) => joinAnswer(current, spoken));
      camera.stop();
      const result = await api.endInterview(latest.current.interview.sessionId, finalIntegrity, { signal: controller.signal });
      if (typeof result?.role !== 'string' || !Array.isArray(result.panel) || (!result.insufficient && (!Array.isArray(result.questions) || !Number.isFinite(result.scores?.overall)))) {
        throw new Error('Your feedback response was incomplete. Please try ending the interview again.');
      }
      if (mounted.current && token === requestToken.current) onFinished(result);
    } catch (err) {
      if (!mounted.current || token !== requestToken.current) return;
      setError(err.message || 'Your feedback could not be prepared. Please try ending the interview again.');
      setRequestFailed(true);
      setInputMode('text');
      setAudioRetry(audioSegments.current.size > 0);
      if (!interview.done) camera.start();
      changePhase(previousPhase === 'speaking' ? interview.done ? 'ended' : 'answering' : previousPhase);
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (token === requestToken.current) operation.current = null;
    }
  }

  const voice = {
    kind: voiceSupport,
    active: voiceActive,
    transcript: recognition.transcript,
    interim: recognition.interim,
    level: mic.level,
    levelStatus: mic.status,
    processing: segmentProcessing,
    pendingSegments: pendingSegmentCount,
  };
  const tileState = (person) => {
    if (phase === 'speaking') return person.id === speaker.id ? audioSpeaking ? 'speaking' : 'transition' : 'listening';
    if (phase === 'thinking' || phase === 'ending') return 'thinking';
    if (phase === 'answering') return 'listening';
    return 'idle';
  };
  const { current, total } = interview.progress;
  const busy = capturing || transcribing;
  const activeFaceWarnings = new Set((integrity.warningEvents || []).map((event) => event.type));
  const candidateFaceStatus = ['loading', 'unavailable', 'no_camera'].includes(faceStatus) ? faceStatus
    : faceStatus === 'multiple_faces' && activeFaceWarnings.has('MULTIPLE_FACES') ? 'multiple_faces'
      : faceStatus === 'no_face' && activeFaceWarnings.has('NO_FACE') ? 'no_face'
        : faceStatus === 'looking_away' && activeFaceWarnings.has('LOOKING_AWAY') ? 'looking_away'
          : monitoring.sample?.tooFar && activeFaceWarnings.has('TOO_FAR') ? 'too_far'
            : monitoring.sample?.excessiveMovement && activeFaceWarnings.has('EXCESSIVE_HEAD_MOVEMENT') ? 'excessive_movement' : null;
  const typeLabel = INTERVIEW_TYPES.find((t) => t.id === setup.type)?.label || 'Interview';
  const difficultyLabel = DIFFICULTIES.find((d) => d.id === setup.difficulty)?.label || setup.difficulty;
  const connectionIssue = !online || requestFailed || Boolean(heartbeatError);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Interview room · {typeLabel}</p>
          <h1 className="mt-1 truncate text-sm font-semibold text-ink sm:text-base">{setup.role}{setup.company && <span className="font-normal text-ink-soft"> · {setup.company}</span>}</h1>
        </div>
        <div className={`hidden items-center gap-1.5 text-xs sm:flex ${connectionIssue ? 'text-warning' : 'text-muted'}`} title={!online ? 'Your browser reports that you are offline.' : requestFailed ? 'The last request failed. Your answer is saved for retry.' : heartbeatError || 'Your browser is online. Server availability is checked when requests run.'}>
          {connectionIssue ? <WifiOff className="size-3.5" /> : <Wifi className="size-3.5" />}
          {!online ? 'Offline' : requestFailed ? 'Retry needed' : heartbeatError ? 'Connection interrupted' : 'Online'}
        </div>
        <div className="w-36 sm:w-48">
          <div className="flex justify-between gap-3 text-xs text-ink-soft">
            <span>{interview.done ? 'Questions complete' : `Question ${Math.min(current, total)} of ${total}`}</span>
            <span className="inline-flex items-center gap-1 tabular-nums" title="Interview duration"><Clock className="size-3" />{formatTime(elapsed)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(current, total)}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${total ? (Math.min(current, total) / total) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1520px] flex-1 gap-5 p-4 sm:p-6 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0 space-y-4 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0 lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <span>{typeLabel} interview · {difficultyLabel} difficulty</span>
            <span className="hidden sm:inline">{people.length === 1 ? '1 interviewer' : `${people.length} interviewers`} · {inputMode === 'voice' ? 'Voice answers' : 'Typed answers'}</span>
          </div>
          <div className="aspect-[4/3] max-h-[58vh] min-h-[240px] sm:aspect-video lg:aspect-auto lg:min-h-[160px] lg:flex-1">
            <InterviewerTile key={speaker.id} person={speaker} state={tileState(speaker)} muted={muted} />
          </div>
          {(captions || speechNotice) && line && (
            <div className={`rounded-xl border border-line bg-surface px-5 py-4 ${proctored ? 'select-none' : ''}`} key={spokenText} onCopy={proctored ? (e) => { e.preventDefault(); integrity.flagCopy?.(); } : undefined}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-ink-soft">{speaker.name}</span>
                {interview.turn && !interview.done && <span className="text-muted">{CATEGORY_LABEL[interview.turn.category]}{interview.turn.isFollowUp ? ' · Follow-up' : ''}</span>}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink">{line.reaction && <span className="text-ink-soft">{line.reaction} </span>}{line.question ?? line.message}</p>
              {speechNotice && <p className="mt-2 text-xs text-warning">{speechNotice}</p>}
            </div>
          )}
          {!online && <p className="flex items-center gap-2 text-sm text-warning" role="status"><WifiOff className="size-4" />You are offline. Your answer stays here while you reconnect.</p>}
          {online && heartbeatError && <p className="text-sm text-warning" role="status">{heartbeatError}</p>}
          <ErrorBanner message={error} onDismiss={() => setError('')} action={requestFailed && failedAnswer.current && phase === 'answering' ? <Button size="sm" onClick={() => submit(failedAnswer.current.skipped ? failedAnswer.current : { text: draft })} disabled={busy}><RefreshCw className="size-3.5" />Retry</Button> : undefined} />
          {audioRetry && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              <p className="text-ink-soft">{pendingSegmentCount} {pendingSegmentCount === 1 ? 'audio segment is' : 'audio segments are'} saved in this tab. Transcribed words remain in your answer.</p>
              <div className="flex gap-2"><Button size="sm" onClick={retryRecording} disabled={busy || segmentProcessing}>{transcribing || segmentProcessing ? <Spinner /> : <RefreshCw className="size-3.5" />}Retry transcription</Button><Button size="sm" variant="ghost" disabled={busy || voiceActive} onClick={clearAudioSegments}>Discard pending audio</Button></div>
            </div>
          )}
          <AnswerPanel phase={phase} audioSpeaking={audioSpeaking} speakerName={speaker.name.split(' ')[0]} inputMode={inputMode} voice={voice} draft={draft} setDraft={setDraft} transcribing={transcribing} busy={busy} requestSeconds={requestSeconds} answerUpload={answerUpload} onSend={(text) => submit({ text })} onSkip={skipQuestion} onRepeat={repeatQuestion} onStopVoice={sendVoiceAnswer} onResumeVoice={startVoice} onTypeInstead={switchToText} onSkipListening={skipListening} onFinish={finish} questionKey={lineKey} onPasteBlocked={proctored ? integrity.flagPaste : undefined} />
        </div>
        <aside className="min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto">
          <div><p className="mb-2 text-xs font-medium text-muted">Your camera · Local preview</p><CandidateTile stream={camera.stream} videoRef={selfView} cameraError={camera.error} cameraStatus={camera.status} listening={voiceActive} microphoneLevel={mic.level} microphoneStatus={mic.status} name={setup.candidateName} faceStatus={proctored ? candidateFaceStatus : null} onRetry={finished ? undefined : camera.retry || camera.start} /></div>
          {people.filter((p) => p.id !== speaker.id).length > 0 && <div><p className="mb-2 text-xs font-medium text-muted">Interview panel</p><div className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">{people.filter((p) => p.id !== speaker.id).map((person) => <InterviewerTile key={person.id} person={person} state={tileState(person)} size="small" />)}</div></div>}
          {proctored ? <MonitoringPanel integrity={integrity} monitoring={monitoring} camera={camera} finished={finished} onFullscreen={enterFullscreen} /> : <div className="rounded-xl border border-line bg-surface p-4"><p className="text-sm font-medium text-ink-soft">Practice session</p><p className="mt-1 text-xs leading-relaxed text-muted">Monitoring is off. You can use notes and switch tabs while you practise.</p></div>}
        </aside>
      </main>

      <footer className="sticky bottom-0 z-20 flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-line bg-canvas px-4 py-3 sm:gap-3">
        <ControlButton on={inputMode === 'voice'} onClick={toggleInputMode} disabled={voiceSupport === 'none' || phase !== 'answering' || busy} label={voiceSupport === 'none' ? 'Voice answers are unavailable; use typing' : inputMode === 'voice' ? 'Switch to typed answers' : 'Switch to voice answers'} iconOn={Mic} iconOff={Keyboard} />
        <ControlButton on={Boolean(camera.stream)} onClick={camera.toggle} disabled={finished || camera.status === 'requesting' || proctored && Boolean(camera.stream)} label={proctored && camera.stream ? 'Camera stays on while monitoring is active' : camera.stream ? 'Turn camera off' : 'Turn camera on'} iconOn={Video} iconOff={VideoOff} />
        <ControlButton on={captions} onClick={() => setCaptions(!captions)} label={captions ? 'Hide question captions' : 'Show question captions'} iconOn={Captions} iconOff={CaptionsOff} />
        <ControlButton on={!muted} onClick={toggleMute} label={muted ? 'Enable interviewer audio for the next question' : 'Mute interviewer audio'} iconOn={Volume2} iconOff={VolumeX} />
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        <Button variant="danger" onClick={() => (interview.done ? finish() : setConfirmingEnd(true))} disabled={phase === 'ending'}><PhoneOff className="size-4" /><span>End interview</span></Button>
      </footer>

      {confirmingEnd && <EndDialog busy={phase === 'thinking' || busy} onCancel={() => setConfirmingEnd(false)} onConfirm={finish} />}
    </div>
  );
}

const SEVERITY_STYLE = { info: 'text-accent', warning: 'text-warning', suspicious: 'text-serious', serious: 'text-critical', serious_violation: 'text-critical', critical: 'text-critical', high: 'text-critical' };
const eventLabel = (type = '') => type.toLowerCase().replaceAll('_', ' ');

function MonitoringPanel({ integrity, monitoring, camera, finished, onFullscreen }) {
  const unavailable = !camera.stream || camera.status === 'muted' || monitoring.visionStatus === 'unavailable' || monitoring.status === 'unavailable' || monitoring.faceStatus === 'unavailable';
  const starting = monitoring.visionStatus === 'loading' || monitoring.faceStatus === 'loading';
  const warnings = integrity.warnings || [];
  const events = (integrity.events || []).slice(-3).reverse();
  const objectUnavailable = monitoring.objectStatus === 'unavailable' || monitoring.objectStatus === 'error';
  const limited = unavailable || objectUnavailable;
  const monitoringLabel = finished ? 'Monitoring stopped' : limited ? 'Monitoring limited' : starting ? 'Starting monitoring' : 'Monitoring active';
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Session monitoring">
      <div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${limited ? 'text-warning' : 'text-accent'}`} /><h2 className="text-sm font-medium text-ink">Session monitoring</h2></div>
      <p className={`mt-2 text-xs ${limited ? 'text-warning' : 'text-ink-soft'}`} role="status">{monitoringLabel}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">Camera checks run on this device. Observations provide context for review; they do not establish cheating.</p>
      {!finished && <dl className="mt-3 space-y-1.5 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted">Face checks</dt><dd className={unavailable ? 'text-warning' : 'text-ink-soft'}>{!camera.stream ? 'Camera unavailable' : monitoring.visionStatus === 'ready' ? 'Running' : monitoring.visionStatus === 'unavailable' ? 'Unavailable' : 'Preparing'}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">Object checks</dt><dd className={objectUnavailable ? 'text-warning' : 'text-ink-soft'}>{!camera.stream ? 'Camera unavailable' : monitoring.objectStatus === 'ready' ? 'Running' : objectUnavailable ? 'Unavailable' : 'Preparing'}</dd></div></dl>}
      {!finished && (unavailable || objectUnavailable) && <div className="mt-3 border-t border-line pt-3"><p className="text-xs leading-relaxed text-warning">{!camera.stream ? 'Camera is unavailable. Face and object checks cannot run.' : unavailable ? 'Face checks are unavailable. Browser activity checks continue.' : 'Object checks are unavailable. Phone detection cannot run.'}</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => { if (!camera.stream) (camera.retry || camera.start)(); else monitoring.retry?.(); }}><RefreshCw className="size-3.5" />Retry checks</Button></div>}
      {!finished && integrity.outOfFullscreen && <div className="mt-3 border-t border-line pt-3"><p className="text-xs leading-relaxed text-warning">This session is running outside full screen. Recorded exits appear in the session summary.</p><Button size="sm" className="mt-2" onClick={onFullscreen}><Maximize className="size-3.5" />Return to full screen</Button></div>}
      {warnings.length > 0 && !finished && <div className="mt-3 space-y-2 border-t border-line pt-3" role="status" aria-live="polite">{warnings.map((warning, index) => <p key={`${warning}-${index}`} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft"><AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${SEVERITY_STYLE[String(integrity.warningEvents?.[index]?.severity || 'warning').toLowerCase()] || 'text-warning'}`} />{typeof warning === 'string' ? warning : warning.message}</p>)}</div>}
      {events.length > 0 && <div className="mt-3 border-t border-line pt-3"><p className="text-[10px] font-medium uppercase tracking-wider text-muted">Recent observations</p><ol className="mt-2 space-y-2">{events.map((event, index) => <li key={event.id || `${event.type}-${event.timestamp}-${index}`} className="flex items-start justify-between gap-2 text-xs"><span className="text-ink-soft">{event.message || eventLabel(event.type)}</span><span className={`shrink-0 text-[10px] capitalize ${SEVERITY_STYLE[String(event.severity).toLowerCase()] || 'text-muted'}`}>{eventLabel(event.severity)}</span></li>)}</ol></div>}
      {warnings.length === 0 && !unavailable && !starting && !finished && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Check className="size-3 text-good" />No active warnings</p>}
    </section>
  );
}

function EndDialog({ busy, onCancel, onConfirm }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus?.(); };
  }, []); // callbacks only close this dialog; preserve focus across busy state updates
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="end-title" onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const buttons = event.currentTarget.querySelectorAll('button:not(:disabled)');
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h2 id="end-title" className="text-lg font-semibold text-ink">End this interview?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">Your feedback will cover the answers you have submitted. An unsent answer will not be evaluated.</p>
        {busy && <p className="mt-3 text-xs text-warning">Wait for the current answer to finish processing before ending.</p>}
        <div className="mt-6 flex justify-end gap-2"><Button ref={cancelRef} variant="ghost" onClick={onCancel}>Keep going</Button><Button variant="danger" onClick={onConfirm} disabled={busy}>End and get feedback</Button></div>
      </div>
    </div>
  );
}

function ControlButton({ on, onClick, label, iconOn: IconOn, iconOff: IconOff, disabled }) {
  const Icon = on ? IconOn : IconOff;
  return <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={on} className={`grid size-10 place-items-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-line bg-raised text-ink hover:border-line-strong' : 'border-line bg-surface text-muted hover:text-ink'}`}><Icon className="size-[18px]" /></button>;
}
