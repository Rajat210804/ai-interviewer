import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Mic,
  Monitor,
  RotateCcw,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { useInterviewPreparation } from '../hooks/useInterviewPreparation';
import { enterFullscreen, useVisionCheck } from '../hooks/useProctoring';
import { useMicLevel } from '../hooks/useMedia';
import { Button, ErrorBanner, Portrait, Spinner } from './ui';
import { ROLE_INFO, avatarById } from '../data/panel';

export const FACE_LABEL = {
  idle: 'Waiting for camera',
  loading: 'Loading camera checks',
  ok: 'One face clearly visible',
  no_face: 'Move into the camera frame',
  looking_away: 'Face the screen for the check',
  multiple_faces: 'More than one face visible',
  too_far: 'Move a little closer to the camera',
  excessive_movement: 'Keep a steady camera position',
  unavailable: 'Face analysis is unavailable',
};
const RULES = [
  'Sit alone in a well-lit space and keep your face in view.',
  'Stay in this tab. Fullscreen is requested where your browser supports it.',
  'Answer in your own words. Clipboard activity and sustained camera events may be noted.',
];

// Camera checks here are a preview. Report monitoring begins inside the interview.
export default function WaitingRoom({
  setup,
  docs,
  ready,
  camera,
  onReady,
  onBack,
}) {
  const { stage, interview, error, retry } = useInterviewPreparation(
    setup,
    ready,
  );
  const [joining, setJoining] = useState(false);
  const mounted = useRef(false);
  const video = useRef(null);
  const mic = useMicLevel(true);
  const cameraReady =
    Boolean(camera.stream) &&
    !['muted', 'disconnected', 'denied', 'unavailable', 'error'].includes(
      camera.status,
    );
  const vision = useVisionCheck(video, setup.proctored && cameraReady);
  const faceStatus = vision.status;
  const micReady = mic.status === 'ready';
  const cameraDetail = cameraReady
    ? 'Connected. Your preview stays on this device.'
    : camera.error ||
      (camera.status === 'muted'
        ? 'The camera is temporarily paused. Check your device or browser settings.'
        : 'Allow camera access when your browser asks.');
  const micDetail =
    mic.error ||
    (micReady
      ? 'Say a few words. The level should move.'
      : mic.status === 'muted'
        ? 'Microphone input is paused. Unmute your device, or type your answers.'
        : 'Allow microphone access when your browser asks.');
  const faceDetail =
    vision.visionStatus === 'ready' && faceStatus === 'loading'
      ? 'Checking the camera frame. Adjust your lighting if this persists.'
      : FACE_LABEL[faceStatus] || 'Checking the camera frame';

  useEffect(() => {
    camera.start();
  }, [camera.start]);
  useEffect(() => {
    if (video.current) video.current.srcObject = camera.stream;
  }, [camera.stream]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function join() {
    if (!interview || joining) return;
    setJoining(true);
    if (setup.proctored) await enterFullscreen();
    if (mounted.current) onReady(interview);
  }

  const steps = [
    {
      id: 'documents',
      label:
        docs.cv.status !== 'empty' || docs.jd.status !== 'empty'
          ? 'Read your documents'
          : 'Confirm the role and interview settings',
    },
    { id: 'planning', label: 'Prepare questions and brief your panel' },
    { id: 'done', label: 'Ready to begin' },
  ];
  const order = ['documents', 'planning', 'done'];
  const stepState = (id) =>
    order.indexOf(id) < order.indexOf(stage) || stage === 'done'
      ? 'done'
      : id === stage
        ? error
          ? 'failed'
          : 'active'
        : 'waiting';
  const faceOk = faceStatus === 'ok';
  const phoneStatus = vision.objectStatus;
  const possiblePhone =
    cameraReady &&
    phoneStatus === 'ready' &&
    vision.latest?.phoneDetected &&
    vision.latest.phoneConfidence >= 0.55;
  const phoneDetail = !cameraReady
    ? 'Waiting for camera'
    : phoneStatus === 'ready'
      ? possiblePhone
        ? 'Potential phone visible in the preview. Move it out of view before you begin.'
        : 'Model ready. Potential visible phones can be noted.'
      : phoneStatus === 'loading'
        ? 'Loading object detection'
        : 'Object detection unavailable. This check will not run.';

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:pt-10">
      <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        Back to setup
      </Button>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-accent">
            Device check
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Get comfortable before you begin.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Check your camera and microphone while your AI panel prepares.
            Nothing is recorded in the practice report until the interview
            starts.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
          <Monitor className="size-3.5" aria-hidden />
          Desktop or laptop recommended
        </span>
      </div>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section
          className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5"
          aria-labelledby="device-heading"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="device-heading" className="text-sm font-semibold text-ink">
              Your device preview
            </h2>
            <span className="text-xs text-muted">Local only</span>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-canvas">
            {camera.stream ? (
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                aria-label="Your camera preview"
                className="size-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 p-5 text-center">
                <Video className="size-7 text-muted" aria-hidden />
                <p className="max-w-xs text-sm leading-relaxed text-ink-soft">
                  {camera.error ||
                    (camera.checking
                      ? 'Waiting for camera permission…'
                      : 'Starting your camera…')}
                </p>
              </div>
            )}
            {camera.stream && (
              <span className="absolute bottom-3 left-3 rounded-md bg-canvas/90 px-2.5 py-1.5 text-xs text-ink-soft">
                {setup.candidateName.trim() || 'You'} · Preview
              </span>
            )}
            {setup.proctored && cameraReady && (
              <span
                className={`absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-md bg-canvas/90 px-2.5 py-1.5 text-xs ${faceOk ? 'text-good' : 'text-ink-soft'}`}
              >
                {faceStatus === 'loading' ? (
                  <Spinner className="size-3" />
                ) : (
                  <ShieldCheck className="size-3" aria-hidden />
                )}
                {faceDetail}
              </span>
            )}
          </div>
          <ul className="mt-5 divide-y divide-line">
            <CheckRow
              ok={cameraReady}
              loading={camera.checking}
              icon={Video}
              label="Camera"
              detail={cameraDetail}
              action={
                !cameraReady &&
                !camera.checking && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={camera.retry || camera.start}
                    aria-label="Retry camera"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Retry
                  </Button>
                )
              }
            />
            <li className="py-4">
              <div className="flex items-start gap-3">
                <Mic
                  className="mt-0.5 size-4 shrink-0 text-muted"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink">Microphone</span>
                    {micReady ? (
                      <Check
                        className="size-3.5 text-good"
                        aria-label="Ready"
                      />
                    ) : mic.status === 'requesting' ? (
                      <Spinner className="size-3.5 text-muted" />
                    ) : (
                      <AlertTriangle
                        className="size-3.5 text-warning"
                        aria-label="Needs attention"
                      />
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {micDetail}
                  </p>
                  {micReady && (
                    <span
                      role="meter"
                      aria-label="Microphone input level"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.min(100, mic.level * 160))}
                      className="mt-3 block h-1.5 overflow-hidden rounded-full bg-line"
                    >
                      <span
                        className="block h-full rounded-full bg-good transition-[width] duration-100"
                        style={{ width: `${Math.min(100, mic.level * 160)}%` }}
                      />
                    </span>
                  )}
                </div>
                {!micReady && mic.status !== 'requesting' && mic.retry && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={mic.retry}
                    aria-label="Retry microphone"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Retry
                  </Button>
                )}
              </div>
            </li>
            {setup.proctored && (
              <CheckRow
                ok={faceOk}
                loading={faceStatus === 'loading'}
                icon={ShieldCheck}
                label="Face visibility"
                detail={faceDetail}
                action={
                  faceStatus === 'unavailable' &&
                  vision.retry && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={vision.retry}
                      aria-label="Retry face analysis"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                    </Button>
                  )
                }
              />
            )}
            {setup.proctored && (
              <CheckRow
                ok={phoneStatus === 'ready'}
                loading={phoneStatus === 'loading'}
                icon={ShieldCheck}
                label="Visible phone check"
                detail={phoneDetail}
                action={
                  phoneStatus === 'unavailable' &&
                  cameraReady &&
                  vision.retry && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={vision.retry}
                      aria-label="Retry phone detection"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                    </Button>
                  )
                }
              />
            )}
          </ul>
          <p className="mt-1 rounded-lg border border-line bg-raised/30 p-3 text-xs leading-relaxed text-muted">
            {setup.proctored
              ? 'A clear, front-facing view improves camera checks. Unsupported checks are marked unavailable, and you can continue. You can always type if your microphone or speech recognition is unavailable.'
              : 'The camera is optional in relaxed practice. If microphone access is unavailable, you can type every answer.'}
          </p>
        </section>

        <div className="min-w-0 space-y-5">
          <section
            className="rounded-xl border border-line bg-surface p-5"
            aria-labelledby="panel-heading"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="panel-heading" className="text-sm font-semibold text-ink">
                Your AI panel
              </h2>
              <span
                className={`text-xs ${stage === 'done' ? 'text-good' : 'text-muted'}`}
              >
                {stage === 'done'
                  ? 'Ready'
                  : error
                    ? 'Needs attention'
                    : 'Preparing'}
              </span>
            </div>
            <ul className="mt-4 space-y-3">
              {setup.panel.map((seat) => (
                <li key={seat.role} className="flex items-center gap-3">
                  <Portrait
                    avatar={avatarById(seat.avatarId)}
                    className="size-10 shrink-0 rounded-lg"
                  />
                  <div>
                    <p className="text-sm text-ink">
                      {avatarById(seat.avatarId).name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {ROLE_INFO[seat.role].title}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <ol
              className="mt-5 space-y-3 border-t border-line pt-5"
              aria-live="polite"
            >
              {steps.map((step) => {
                const state = stepState(step.id);
                return (
                  <li key={step.id} className="flex items-center gap-3 text-sm">
                    <span className="grid size-4 shrink-0 place-items-center">
                      {state === 'done' ? (
                        <Check className="size-4 text-good" />
                      ) : state === 'active' ? (
                        <Spinner className="size-4 text-accent" />
                      ) : state === 'failed' ? (
                        <AlertTriangle className="size-4 text-critical" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-line-strong" />
                      )}
                    </span>
                    <span
                      className={
                        state === 'waiting' ? 'text-muted' : 'text-ink-soft'
                      }
                    >
                      {step.label}
                    </span>
                    <span className="sr-only">{state}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section
            className="rounded-xl border border-line bg-surface p-5"
            aria-labelledby="conditions-heading"
          >
            <h2
              id="conditions-heading"
              className="flex items-center gap-2 text-sm font-semibold text-ink"
            >
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              {setup.proctored ? 'Monitored practice' : 'Relaxed practice'}
            </h2>
            {setup.proctored ? (
              <>
                <ul className="mt-4 space-y-3 text-xs leading-relaxed text-ink-soft">
                  {RULES.map((rule) => (
                    <li key={rule} className="flex gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted" />
                      {rule}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">
                  Camera analysis runs locally. Only event summaries go into
                  your report. Face and object detection can make mistakes;
                  signals are observations, not proof of misconduct or identity.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                There are no monitoring events in this session. Use the camera
                if it helps you practise, and answer by voice or by typing.
              </p>
            )}
          </section>

          {error && <ErrorBanner message={error} />}
          <div>
            {error ? (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={retry}
              >
                <RotateCcw className="size-4" aria-hidden />
                Retry preparation
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={!interview || joining}
                onClick={join}
              >
                {joining ? (
                  <>
                    <Spinner />
                    Opening your interview…
                  </>
                ) : interview ? (
                  <>
                    Begin interview
                    <ArrowRight className="size-4" aria-hidden />
                  </>
                ) : (
                  <>
                    <Spinner />
                    Preparing your panel…
                  </>
                )}
              </Button>
            )}
            <p className="mt-3 text-center text-xs leading-relaxed text-muted">
              {error
                ? 'Your settings and documents are preserved.'
                : setup.proctored
                  ? 'Fullscreen is requested when you begin. Camera checks continue during the session.'
                  : 'Start when you are ready. You control your camera and microphone.'}
            </p>
            {setup.proctored && interview && !cameraReady && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-relaxed text-warning">
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                Your camera is unavailable. You can continue, but camera
                monitoring will be limited and the interruption may appear in
                your report.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ ok, loading, icon: Icon, label, detail, action }) {
  return (
    <li className="flex items-start gap-3 py-4">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink">{label}</span>
          {loading ? (
            <Spinner className="size-3.5 text-muted" />
          ) : ok ? (
            <Check className="size-3.5 text-good" aria-label="Ready" />
          ) : (
            <AlertTriangle
              className="size-3.5 text-warning"
              aria-label="Needs attention"
            />
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
      </div>
      {action}
    </li>
  );
}
