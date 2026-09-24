import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Mic, RotateCcw, ShieldCheck, Video } from 'lucide-react';
import { api } from '../api';
import { enterFullscreen, useFaceCheck } from '../hooks/useProctoring';
import { useMicLevel } from '../hooks/useMedia';
import { Button, ErrorBanner, Portrait, Spinner } from './ui';
import { ROLE_INFO, avatarById } from '../data/panel';

export const FACE_LABEL = {
  loading: 'Checking…',
  ok: 'Face clearly visible',
  no_face: 'Face not detected',
  looking_away: 'Please face the screen',
  multiple_faces: 'More than one person in view',
  unavailable: 'Face checks unavailable in this browser',
};

const RULES = [
  'Keep your face in the camera frame and look at the screen.',
  'Stay in this tab and in full screen until the interview ends.',
  'Take the interview alone. Other people in view are flagged.',
  'Pasting into the answer box is turned off.',
];

// The waiting room: the panel is prepared on the server while the candidate checks camera and microphone.
export default function WaitingRoom({ setup, docs, ready, camera, onReady, onBack }) {
  const [stage, setStage] = useState('documents'); // documents -> planning -> done
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  const video = useRef(null);

  const mic = useMicLevel(true);
  const faceStatus = useFaceCheck(video, setup.proctored && Boolean(camera.stream));

  useEffect(() => { camera.start(); }, [camera.start]);
  useEffect(() => { if (video.current) video.current.srcObject = camera.stream; }, [camera.stream]);

  useEffect(() => {
    if (started.current === attempt) return; // React StrictMode runs effects twice in development
    started.current = attempt;

    (async () => {
      try {
        setError('');
        setStage('documents');
        const { cv, jd } = await ready().catch(() => {
          throw new Error("One of your documents couldn't be read. Go back to replace or remove it.");
        });

        setStage('planning');
        setInterview(await api.startInterview({
          setup: {
            company: setup.company.trim(),
            role: setup.role.trim(),
            candidateName: setup.candidateName.trim(),
            type: setup.type,
            difficulty: setup.difficulty,
            length: setup.length,
            proctored: setup.proctored,
            panel: setup.panel.map((seat) => ({ ...seat, name: avatarById(seat.avatarId).name })),
          },
          cv,
          jd,
        }));
        setStage('done');
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [attempt, ready, setup]);

  async function join() {
    if (setup.proctored) await enterFullscreen(); // needs the click, so it happens here
    onReady(interview);
  }

  const steps = [
    docs.cv.status !== 'empty' && { id: 'documents', label: 'Reading your CV' },
    docs.jd.status !== 'empty' && { id: 'documents', label: 'Reading the job description' },
    { id: 'planning', label: 'Matching your profile to the role and planning questions' },
    { id: 'done', label: 'Panel is ready' },
  ].filter(Boolean);
  const order = ['documents', 'planning', 'done'];
  const stepState = (stepId) => {
    const current = order.indexOf(stage);
    const index = order.indexOf(stepId);
    if (index < current || stage === 'done') return 'done';
    return index === current ? (error ? 'failed' : 'active') : 'waiting';
  };

  const faceOk = faceStatus === 'ok';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <p className="text-sm font-medium text-accent">Waiting room</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">Check your setup while the panel gets ready</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-raised">
            {camera.stream ? (
              <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-sm text-muted">{camera.error || 'Starting your camera…'}</div>
            )}
            {setup.proctored && camera.stream && (
              <span className={`absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur ${faceOk ? '' : 'ring-1 ring-warning/60'}`}>
                {FACE_LABEL[faceStatus] || 'Checking…'}
              </span>
            )}
          </div>

          <ul className="mt-5 space-y-3 text-sm">
            <CheckRow ok={Boolean(camera.stream)} icon={Video} label="Camera" detail={camera.stream ? 'On' : camera.error || 'Waiting for permission'} />
            {setup.proctored && (
              <CheckRow ok={faceOk} icon={ShieldCheck} label="Face check" detail={FACE_LABEL[faceStatus] || 'Waiting for camera'} />
            )}
            <li className="flex items-center gap-3">
              <Mic className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="w-24 shrink-0 text-ink-soft">Microphone</span>
              {mic.error ? (
                <span className="text-xs text-warning">{mic.error}</span>
              ) : (
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-label="Microphone level">
                  <span className="block h-full rounded-full bg-good transition-[width] duration-75" style={{ width: `${Math.min(100, mic.level * 160)}%` }} />
                </span>
              )}
            </li>
          </ul>
          {!mic.error && <p className="mt-2 pl-7 text-xs text-muted">Say something; the bar should move.</p>}
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-4">
              <div className="flex -space-x-3">
                {setup.panel.map((seat) => (
                  <Portrait key={seat.role} avatar={avatarById(seat.avatarId)} className="size-11 rounded-full ring-2 ring-surface" />
                ))}
              </div>
              <p className="text-sm text-ink-soft">
                {setup.panel.map((seat) => `${avatarById(seat.avatarId).name.split(' ')[0]} (${ROLE_INFO[seat.role].title})`).join(', ')}
              </p>
            </div>
            <ol className="mt-5 space-y-2.5">
              {steps.map((step) => {
                const state = stepState(step.id);
                return (
                  <li key={step.label} className="flex items-center gap-3 text-sm">
                    <span className="grid size-5 place-items-center">
                      {state === 'done' && <Check className="size-4 text-good" />}
                      {state === 'active' && <Spinner className="size-4 text-accent" />}
                      {state === 'waiting' && <span className="size-1.5 rounded-full bg-line-strong" />}
                      {state === 'failed' && <span className="size-2 rounded-full bg-critical" />}
                    </span>
                    <span className={state === 'waiting' ? 'text-muted' : 'text-ink'}>{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {setup.proctored && (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck className="size-4 text-accent" /> Proctored interview</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
                {RULES.map((rule) => <li key={rule} className="flex gap-2"><span className="text-muted">•</span>{rule}</li>)}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted">Checks run on your device. Video is never uploaded; only counts such as "left the window twice" are recorded for your report.</p>
            </div>
          )}

          {error ? (
            <div className="space-y-3">
              <ErrorBanner message={error} />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" /> Back to setup</Button>
                <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}><RotateCcw className="size-4" /> Try again</Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="primary" size="lg" className="w-full" disabled={!interview} onClick={join}>
                {interview ? 'Join interview' : <><Spinner /> Preparing your panel…</>}
              </Button>
              {setup.proctored && interview && !faceOk && faceStatus !== 'unavailable' && (
                <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" /> Your face check isn't passing yet. You can still join; it will be flagged.
                </p>
              )}
              <p className="mt-2 text-center text-xs text-muted">{setup.proctored ? 'The interview opens in full screen.' : 'You can turn your camera off inside the interview.'}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CheckRow({ ok, icon: Icon, label, detail }) {
  return (
    <li className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="w-24 shrink-0 text-ink-soft">{label}</span>
      {ok ? <Check className="size-4 text-good" aria-label="OK" /> : <AlertTriangle className="size-4 text-warning" aria-label="Needs attention" />}
      <span className="text-xs text-muted">{detail}</span>
    </li>
  );
}
