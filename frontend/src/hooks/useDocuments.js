import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const EMPTY = { status: 'empty' };

// CV and JD analysis starts as soon as a file is chosen, so it is usually finished
// by the time the candidate has picked their interview settings.
export function useDocuments() {
  const [docs, setDocs] = useState({ cv: EMPTY, jd: EMPTY });
  const jobs = useRef({});
  const controllers = useRef({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(controllers.current).forEach((controller) => controller.abort());
    };
  }, []);

  const update = (kind, value) => {
    if (mounted.current) setDocs((current) => ({ ...current, [kind]: value }));
  };

  const analyze = useCallback((kind, input) => {
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    const label = input.file ? input.file.name : 'Pasted text';
    update(kind, { status: 'analyzing', label });

    const job = api.analyzeDocument(kind, input, { signal: controller.signal }).then(
      (result) => {
        if (jobs.current[kind] === job) update(kind, { status: 'ready', label, ...result });
        return result.profile;
      },
      (err) => {
        if (jobs.current[kind] === job && err.name !== 'AbortError') update(kind, { status: 'error', label, error: err.message, input });
        throw err;
      },
    );
    job.catch(() => {}); // handled through state; callers that await it get the error
    jobs.current[kind] = job;
  }, []);

  const clear = useCallback((kind) => {
    controllers.current[kind]?.abort();
    delete controllers.current[kind];
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
