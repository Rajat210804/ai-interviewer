import { useCallback, useRef, useState } from 'react';
import { api } from '../api';

const EMPTY = { status: 'empty' };

// CV and JD analysis starts as soon as a file is chosen, so it is usually finished
// by the time the candidate has picked their interview settings.
export function useDocuments() {
  const [docs, setDocs] = useState({ cv: EMPTY, jd: EMPTY });
  const jobs = useRef({});

  const update = (kind, value) => setDocs((current) => ({ ...current, [kind]: value }));

  const analyze = useCallback((kind, input) => {
    const label = input.file ? input.file.name : 'Pasted text';
    update(kind, { status: 'analyzing', label });

    const job = api.analyzeDocument(kind, input).then(
      (result) => {
        if (jobs.current[kind] === job) update(kind, { status: 'ready', label, ...result });
        return result.profile;
      },
      (err) => {
        if (jobs.current[kind] === job) update(kind, { status: 'error', label, error: err.message, input });
        throw err;
      },
    );
    job.catch(() => {}); // handled through state; callers that await it get the error
    jobs.current[kind] = job;
  }, []);

  const clear = useCallback((kind) => {
    jobs.current[kind] = null;
    update(kind, EMPTY);
  }, []);

  // Resolves with both profiles (null when not provided) once any analysis still running is done.
  const ready = useCallback(async () => {
    const [cv, jd] = await Promise.all(['cv', 'jd'].map((kind) => jobs.current[kind] || null));
    return { cv, jd };
  }, []);

  return { docs, analyze, clear, ready };
}
