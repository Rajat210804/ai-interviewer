import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { Button, ErrorBanner, Portrait, Spinner } from './ui';
import { ROLE_INFO, avatarById } from '../data/panel';

export default function PreparingScreen({ setup, docs, ready, onReady, onBack }) {
  const [stage, setStage] = useState('documents'); // documents -> planning -> done
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

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
        const state = await api.startInterview({
          setup: {
            company: setup.company.trim(),
            role: setup.role.trim(),
            candidateName: setup.candidateName.trim(),
            type: setup.type,
            difficulty: setup.difficulty,
            length: setup.length,
            panel: setup.panel.map((seat) => ({ ...seat, name: avatarById(seat.avatarId).name })),
          },
          cv,
          jd,
        });
        setStage('done');
        setTimeout(() => onReady(state), 700);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [attempt, ready, setup, onReady]);

  const steps = [
    docs.cv.status !== 'empty' && { id: 'documents', label: 'Reading your CV' },
    docs.jd.status !== 'empty' && { id: 'documents', label: 'Reading the job description' },
    { id: 'planning', label: 'Matching your profile to the role and planning questions' },
    { id: 'done', label: 'Briefing the panel' },
  ].filter(Boolean);
  const order = ['documents', 'planning', 'done'];
  const status = (stepId) => {
    const current = order.indexOf(stage);
    const index = order.indexOf(stepId);
    if (index < current || stage === 'done') return 'done';
    return index === current ? (error ? 'failed' : 'active') : 'waiting';
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <div className="flex justify-center -space-x-4">
        {setup.panel.map((seat) => (
          <Portrait key={seat.role} avatar={avatarById(seat.avatarId)} className="size-20 rounded-full ring-4 ring-canvas" />
        ))}
      </div>
      <h1 className="mt-6 text-center text-2xl font-semibold text-ink">Getting your panel ready</h1>
      <p className="mt-2 text-center text-sm text-muted">
        {setup.panel.map((seat) => `${avatarById(seat.avatarId).name.split(' ')[0]} (${ROLE_INFO[seat.role].title})`).join(', ')}
      </p>

      <ol className="mt-10 space-y-3">
        {steps.map((step) => {
          const state = status(step.id);
          return (
            <li key={step.label} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
              <span className="grid size-5 place-items-center">
                {state === 'done' && <Check className="size-4 text-good" />}
                {state === 'active' && <Spinner className="size-4 text-accent" />}
                {state === 'waiting' && <span className="size-1.5 rounded-full bg-line-strong" />}
                {state === 'failed' && <span className="size-2 rounded-full bg-critical" />}
              </span>
              <span className={`text-sm ${state === 'waiting' ? 'text-muted' : 'text-ink'}`}>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mt-6 space-y-3">
          <ErrorBanner message={error} />
          <div className="flex justify-center gap-2">
            <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" /> Back to setup</Button>
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}><RotateCcw className="size-4" /> Try again</Button>
          </div>
        </div>
      )}
    </div>
  );
}
