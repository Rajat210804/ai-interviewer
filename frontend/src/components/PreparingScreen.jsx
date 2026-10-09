import { useEffect, useRef } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { useInterviewPreparation } from '../hooks/useInterviewPreparation';
import { Button, ErrorBanner, Portrait, Spinner } from './ui';
import { ROLE_INFO, avatarById } from '../data/panel';

export default function PreparingScreen({
  setup,
  docs,
  ready,
  onReady,
  onBack,
}) {
  const { stage, interview, error, retry } = useInterviewPreparation(
    setup,
    ready,
  );
  const delivered = useRef(null);
  useEffect(() => {
    if (interview && delivered.current !== interview) {
      delivered.current = interview;
      onReady(interview);
    }
  }, [interview, onReady]);

  const steps = [
    {
      id: 'documents',
      label:
        docs.cv.status !== 'empty' || docs.jd.status !== 'empty'
          ? 'Read your documents'
          : 'Confirm the interview settings',
    },
    { id: 'planning', label: 'Prepare questions and brief your panel' },
    { id: 'done', label: 'Ready to begin' },
  ];
  const order = ['documents', 'planning', 'done'];
  const status = (id) =>
    order.indexOf(id) < order.indexOf(stage) || stage === 'done'
      ? 'done'
      : id === stage
        ? error
          ? 'failed'
          : 'active'
        : 'waiting';

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <Button
        variant="ghost"
        size="sm"
        className="mb-6 self-start"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to setup
      </Button>
      <section className="rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-accent">
          Interview preparation
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          Your panel is getting ready.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Preparing questions for {setup.role.trim()}. Keep this page open while
          the panel is briefed.
        </p>
        <ul className="mt-6 space-y-3">
          {setup.panel.map((seat) => (
            <li key={seat.role} className="flex items-center gap-3">
              <Portrait
                avatar={avatarById(seat.avatarId)}
                className="size-10 rounded-lg"
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
          className="mt-6 space-y-3 border-t border-line pt-5"
          aria-live="polite"
        >
          {steps.map((step) => {
            const state = status(step.id);
            return (
              <li key={step.id} className="flex items-center gap-3">
                <span className="grid size-4 place-items-center">
                  {state === 'done' ? (
                    <Check className="size-4 text-good" />
                  ) : state === 'active' ? (
                    <Spinner className="size-4 text-accent" />
                  ) : (
                    <span
                      className={`size-1.5 rounded-full ${state === 'failed' ? 'bg-critical' : 'bg-line-strong'}`}
                    />
                  )}
                </span>
                <span
                  className={`text-sm ${state === 'waiting' ? 'text-muted' : 'text-ink-soft'}`}
                >
                  {step.label}
                </span>
                <span className="sr-only">{state}</span>
              </li>
            );
          })}
        </ol>
        {error && (
          <div className="mt-6 space-y-3">
            <ErrorBanner message={error} />
            <Button variant="primary" className="w-full" onClick={retry}>
              <RotateCcw className="size-4" aria-hidden />
              Retry preparation
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
