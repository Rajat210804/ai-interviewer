import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Captions, CaptionsOff, Keyboard, Maximize, Mic, PhoneOff, ShieldCheck, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { api } from '../api';
import { assignVoices, speak, stopSpeaking, useRecorder, useSpeechRecognition, useVoices, voicesReady } from '../hooks/useMedia';
import { enterFullscreen, useFaceCheck, useIntegrity } from '../hooks/useProctoring';
import { CATEGORY_LABEL, DIFFICULTIES, INTERVIEW_TYPES, ROLE_INFO, avatarById } from '../data/panel';
import AnswerPanel from './AnswerPanel';
import { CandidateTile, InterviewerTile } from './VideoTiles';
import { Button, ErrorBanner } from './ui';

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const FACE_RAN = new Set(['ok', 'no_face', 'looking_away', 'multiple_faces']);

export default function InterviewRoom({ initialState, setup, health, camera, onFinished }) {
  const [interview, setInterview] = useState(initialState);
  const [phase, setPhase] = useState('speaking'); // speaking | answering | thinking | ended | ending
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [windowed, setWindowed] = useState(false); // chose to carry on without full screen

  const recognition = useSpeechRecognition();
  const recorder = useRecorder();
  const voices = useVoices();

  const voiceSupport = recognition.supported ? 'browser' : recorder.supported && health?.providers.groq ? 'recorder' : 'none';
  const [inputMode, setInputMode] = useState(voiceSupport === 'none' ? 'text' : 'voice');

  const people = useMemo(() => interview.panel.map((p) => ({ ...p, avatar: avatarById(p.avatarId), gender: avatarById(p.avatarId).gender })), [interview.panel]);
  const voiceMap = useMemo(() => assignVoices(voices, people), [voices, people]);

  const line = interview.done ? interview.closing : interview.turn; // what the panel is currently saying
  const speaker = people.find((p) => p.id === line?.interviewer) || people[0];
  const spokenText = line ? [line.reaction, line.question ?? line.message].filter(Boolean).join(' ') : '';

  const lineKey = interview.done ? 'closing' : interview.turn?.number;

  // Latest values for use inside async callbacks without re-running effects.
  const latest = useRef({});
  latest.current = { voiceMap, muted, speaker, spokenText, done: interview.done };

  // Every new utterance (and every "stop") bumps the token, so speech that was still waiting
  // for voices to load is dropped if the candidate skipped ahead in the meantime.
  const speechToken = useRef(0);
  const say = useCallback(async (text, person) => {
    const token = ++speechToken.current;
    if (latest.current.muted) return;
    await voicesReady();
    if (token !== speechToken.current) return;
    await speak(text, { voice: latest.current.voiceMap[person.id], ...ROLE_INFO[person.role].voice });
  }, []);
  const silence = useCallback(() => {
    speechToken.current++;
    stopSpeaking();
  }, []);

  // Each new question (or the closing remarks) is spoken, then it's the candidate's turn.
  useEffect(() => {
    const { spokenText: text, speaker: person, done } = latest.current;
    if (!text) return;
    let cancelled = false;
    setPhase('speaking');
    say(text, person).then(() => {
      if (!cancelled) setPhase(done ? 'ended' : 'answering');
    });
    return () => { cancelled = true; };
  }, [lineKey, say]);

  const voice = voiceSupport === 'recorder'
    ? {
      kind: 'recorder',
      active: recorder.recording,
      transcript: '',
      interim: '',
      start: recorder.start,
      cancel: () => recorder.stop(),
      async stop() {
        const blob = await recorder.stop();
        if (!blob) return '';
        setTranscribing(true);
        try {
          return (await api.transcribe(blob)).text;
        } finally {
          setTranscribing(false);
        }
      },
    }
    : {
      kind: 'browser',
      active: recognition.listening,
      transcript: recognition.transcript,
      interim: recognition.interim,
      start: recognition.start,
      cancel: async () => recognition.stop(),
      stop: async () => recognition.stop(),
    };

  const startVoice = useCallback(async () => {
    try {
      await voice.start();
    } catch {
      setError('Microphone access is blocked. Allow it in your browser settings, or type your answer.');
      setInputMode('text');
    }
  }, [voice]);

  // Start listening as soon as the interviewer finishes speaking.
  useEffect(() => {
    if (phase === 'answering' && inputMode === 'voice' && !voice.active) startVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, inputMode]);

  useEffect(() => {
    if (recognition.error) {
      setError(recognition.error);
      // Keep whatever was already said, so a dropped connection never loses an answer.
      const spoken = recognition.stop();
      if (spoken) setDraft((current) => [current, spoken].filter(Boolean).join(' '));
      setInputMode('text');
    }
  }, [recognition.error, recognition.stop]);

  const finished = phase === 'ended' || phase === 'ending';

  // ---------- Real interview conditions (all checks run in this browser) ----------
  const proctored = Boolean(setup.proctored);
  const selfView = useRef(null);
  const faceCheck = useFaceCheck(selfView, proctored && Boolean(camera.stream) && !finished);
  const faceStatus = proctored && !camera.stream ? 'no_camera' : faceCheck;
  const faceRan = useRef(false);
  if (FACE_RAN.has(faceCheck)) faceRan.current = true;
  const integrity = useIntegrity({ active: proctored && !finished, faceStatus, fullscreen: proctored });
  const { markQuestion } = integrity;

  useEffect(() => { if (!camera.stream) camera.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { markQuestion(); }, [lineKey, markQuestion]); // counts are kept per question
  useEffect(() => { if (!integrity.outOfFullscreen) setWindowed(false); }, [integrity.outOfFullscreen]);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    const warn = (event) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); silence(); };
  }, [silence]);

  async function submit({ text = '', skipped = false }) {
    const answer = text.trim();
    if (!skipped && !answer) {
      setError("We didn't catch an answer. Try again, type it, or skip the question.");
      return;
    }
    setError('');
    setPhase('thinking');
    try {
      const next = await api.answer(interview.sessionId, {
        text: answer,
        skipped,
        ...(proctored && { integrity: integrity.sinceMark() }),
      });
      setDraft('');
      setInterview(next);
    } catch (err) {
      setError(err.message);
      setDraft(answer); // keep what they said so they can resend it
      setInputMode('text');
      setPhase('answering');
    }
  }

  async function sendVoiceAnswer() {
    try {
      const spoken = await voice.stop();
      submit({ text: [draft, spoken].filter(Boolean).join(' ') });
    } catch (err) {
      setError(err.message);
      setInputMode('text');
    }
  }

  async function switchToText() {
    const spoken = voice.active ? await voice.stop().catch(() => '') : '';
    setDraft((current) => [current, spoken].filter(Boolean).join(' '));
    setInputMode('text');
  }

  function toggleInputMode() {
    if (inputMode === 'voice') switchToText();
    else if (voiceSupport !== 'none') setInputMode('voice');
  }

  function toggleMute() {
    if (!muted) silence();
    setMuted(!muted);
  }

  async function finish() {
    setConfirmingEnd(false);
    silence();
    if (voice.active) voice.cancel();
    setPhase('ending');
    setError('');
    try {
      onFinished(await api.endInterview(interview.sessionId, proctored ? { ...integrity.snapshot(), faceChecks: faceRan.current } : undefined));
    } catch (err) {
      setError(err.message);
      setPhase('ended');
    }
  }

  const tileState = (person) => {
    if (person.id !== speaker.id) return 'idle';
    if (phase === 'speaking') return 'speaking';
    if (phase === 'thinking') return 'thinking';
    if (phase === 'answering') return 'listening';
    return 'idle';
  };

  const others = people.filter((p) => p.id !== speaker.id);
  const { current, total } = interview.progress;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">
            {setup.role}{setup.company && <span className="text-muted"> · {setup.company}</span>}
          </p>
        </div>
        {proctored && (
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft sm:inline-flex" title="Camera, window focus and pasting are checked in your browser. Video is never uploaded.">
            <ShieldCheck className="size-3.5 text-accent" aria-hidden /> Integrity checks on
          </span>
        )}
        <span className="hidden text-xs text-muted md:inline">
          {INTERVIEW_TYPES.find((t) => t.id === setup.type).label} · {DIFFICULTIES.find((d) => d.id === setup.difficulty).label}
        </span>
        <div className="w-36 sm:w-48">
          <div className="flex justify-between text-[11px] text-muted">
            <span>Question {Math.min(current, total)} of {total}</span>
            <span className="tabular-nums">{formatTime(elapsed)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(Math.min(current, total) / total) * 100}%` }} />
          </div>
        </div>
      </header>

      <main className="grid flex-1 gap-4 p-4 sm:p-5 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-3 lg:min-h-0">
          <div className="aspect-[4/3] sm:aspect-video lg:aspect-auto lg:min-h-0 lg:flex-1">
            <InterviewerTile person={speaker} state={tileState(speaker)} />
          </div>

          {captions && line && (
            <div
              className={`rounded-xl border border-line bg-surface/80 px-4 py-3 animate-rise ${proctored ? 'select-none' : ''}`}
              key={spokenText}
              onCopy={proctored ? (e) => e.preventDefault() : undefined}
            >
              <p className="text-xs text-muted">
                {speaker.name}
                {interview.turn && !interview.done && <> · {CATEGORY_LABEL[interview.turn.category]}{interview.turn.isFollowUp ? ' follow-up' : ''}</>}
              </p>
              <p className="mt-1 text-[15px] leading-relaxed text-ink">
                {line.reaction && <span className="text-ink-soft">{line.reaction} </span>}
                {line.question ?? line.message}
              </p>
            </div>
          )}

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <AnswerPanel
            phase={phase}
            speakerName={speaker.name.split(' ')[0]}
            inputMode={inputMode}
            voice={voice}
            draft={draft}
            setDraft={setDraft}
            transcribing={transcribing}
            onSend={(text) => submit({ text })}
            onSkip={() => { if (voice.active) voice.cancel(); submit({ skipped: true }); }}
            onRepeat={() => {
              if (voice.active) voice.cancel(); // don't let the microphone pick up the interviewer
              setPhase('speaking');
              say(spokenText, speaker).then(() => setPhase('answering'));
            }}
            onStopVoice={sendVoiceAnswer}
            onResumeVoice={startVoice}
            onTypeInstead={switchToText}
            onSkipListening={() => { silence(); setPhase(interview.done ? 'ended' : 'answering'); }}
            onFinish={finish}
            questionKey={lineKey}
            onPasteBlocked={proctored ? integrity.flagPaste : undefined}
          />
        </div>

        <aside className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">
          {others.map((person) => <InterviewerTile key={person.id} person={person} state="idle" size="small" />)}
          <CandidateTile
            stream={camera.stream}
            videoRef={selfView}
            cameraError={camera.error}
            listening={voice.active}
            name={setup.candidateName}
            faceStatus={proctored ? faceStatus : null}
          />
        </aside>
      </main>

      <footer className="sticky bottom-0 flex shrink-0 items-center justify-center gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:gap-3">
        <ControlButton
          on={inputMode === 'voice'}
          onClick={toggleInputMode}
          disabled={voiceSupport === 'none'}
          label={voiceSupport === 'none' ? 'Voice answers need Chrome or Edge' : inputMode === 'voice' ? 'Answering by voice (switch to typing)' : 'Answering by typing (switch to voice)'}
          iconOn={Mic}
          iconOff={Keyboard}
        />
        <ControlButton
          on={Boolean(camera.stream)}
          onClick={proctored && camera.stream ? undefined : camera.toggle}
          disabled={proctored && Boolean(camera.stream)}
          label={proctored && camera.stream ? 'Your camera stays on in a real interview' : camera.stream ? 'Turn camera off' : 'Turn camera on'}
          iconOn={Video}
          iconOff={VideoOff}
        />
        <ControlButton on={captions} onClick={() => setCaptions(!captions)} label={captions ? 'Hide captions' : 'Show captions'} iconOn={Captions} iconOff={CaptionsOff} />
        <ControlButton on={!muted} onClick={toggleMute} label={muted ? 'Unmute interviewers' : 'Mute interviewers'} iconOn={Volume2} iconOff={VolumeX} />
        <Button variant="danger" className="ml-2 rounded-full" onClick={() => (interview.done ? finish() : setConfirmingEnd(true))} disabled={phase === 'ending'}>
          <PhoneOff className="size-4" /> <span className="hidden sm:inline">End interview</span>
        </Button>
      </footer>

      {integrity.warnings.length > 0 && !finished && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
          {integrity.warnings.map((warning) => (
            <p key={warning} className="flex max-w-lg items-start gap-2 rounded-xl border border-warning/50 bg-[#2a2415]/95 px-4 py-2.5 text-sm text-ink shadow-lg backdrop-blur animate-rise">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {warning}
            </p>
          ))}
        </div>
      )}

      {integrity.outOfFullscreen && !windowed && !finished && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="fullscreen-title">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center animate-rise">
            <Maximize className="mx-auto size-6 text-accent" aria-hidden />
            <h2 id="fullscreen-title" className="mt-3 text-lg font-semibold text-ink">You left full screen</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">This interview runs under real conditions. Leaving full screen is noted in your integrity summary.</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button variant="primary" onClick={enterFullscreen}>Return to full screen</Button>
              <Button variant="ghost" onClick={() => setWindowed(true)}>Continue in the window</Button>
            </div>
          </div>
        </div>
      )}

      {confirmingEnd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 animate-rise">
            <h2 id="end-title" className="text-lg font-semibold text-ink">End the interview now?</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">You'll get feedback on the questions you've answered so far.</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmingEnd(false)}>Keep going</Button>
              <Button variant="danger" onClick={finish}>End and get feedback</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton({ on, onClick, label, iconOn: IconOn, iconOff: IconOff, disabled }) {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`grid size-11 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'border-line bg-raised text-ink hover:border-line-strong' : 'border-transparent bg-[#2a2f3a] text-ink-soft hover:bg-[#333946]'
      }`}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
