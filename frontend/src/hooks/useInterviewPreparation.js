import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { avatarById } from '../data/panel';

// Both preparation screens use one lifecycle: read documents, prepare the panel,
// and expose a retry without losing the candidate's settings. Reuse the pending
// request across React StrictMode's effect replay, but cancel a real departure.
export function useInterviewPreparation(setup, ready) {
  const [stage, setStage] = useState('documents');
  const [interview, setInterview] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef(null);
  const mounted = useRef(false);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    const previous = request.current;
    if (
      !previous ||
      previous.attempt !== attempt ||
      previous.setup !== setup ||
      previous.ready !== ready
    ) {
      previous?.controller.abort();
      const task = { attempt, setup, ready, controller: new AbortController() };
      request.current = task;
      const isCurrent = () => mounted.current && request.current === task;
      setInterview(null);
      setError('');
      setStage('documents');
      task.promise = (async () => {
        try {
          const { cv, jd } = await ready().catch(() => {
            throw new Error(
              'A document could not be read. Return to setup to retry it, replace it or remove it.',
            );
          });
          if (!isCurrent()) return;
          setStage('planning');
          const prepared = await api.startInterview(
            {
              setup: {
                company: setup.company.trim(),
                role: setup.role.trim(),
                candidateName: setup.candidateName.trim(),
                type: setup.type,
                difficulty: setup.difficulty,
                length: setup.length,
                proctored: setup.proctored,
                panel: setup.panel.map((seat) => ({
                  ...seat,
                  name: avatarById(seat.avatarId).name,
                })),
              },
              cv,
              jd,
            },
            { signal: task.controller.signal },
          );
          if (!isCurrent()) return;
          if (
            !prepared?.sessionId ||
            !Array.isArray(prepared.panel) ||
            !prepared.turn?.question ||
            !prepared.progress?.total
          ) {
            throw new Error(
              'The panel returned an incomplete session. Please retry preparation.',
            );
          }
          setInterview(prepared);
          setStage('done');
        } catch (err) {
          if (isCurrent() && err.name !== 'AbortError') {
            setError(
              err.message ||
                'Your panel could not be prepared. Please try again.',
            );
          }
        }
      })();
    }
    return () => {
      mounted.current = false;
      // StrictMode repeats effect setup synchronously. A microtask lets that
      // setup retain its pending request while a real unmount cancels it.
      queueMicrotask(() => {
        if (!mounted.current) request.current?.controller.abort();
      });
    };
  }, [attempt, ready, setup]);

  return { stage, interview, error, retry };
}
