// All calls go to our own backend; API keys never reach the browser.
// Timeouts are long enough for the server to try one provider and then fall back to the other.

const FALLBACK_MESSAGES = {
  404: 'That interview session has expired. Please start a new one.',
  413: 'That file is too large. Please upload a file under 5 MB.',
  429: 'Too many requests right now. Wait a few seconds and try again.',
  504: 'The interviewer took too long to respond. Please try again.',
};

async function request(path, { body, form, timeoutMs = 90000 } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: body || form ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body && JSON.stringify(body)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError'
      ? 'The interviewer took too long to respond. Please try again.'
      : "We couldn't reach the server. Check your connection and try again.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || FALLBACK_MESSAGES[res.status] || "We couldn't connect to the interviewer right now. Please try again.");
  }
  return data;
}

export const api = {
  health: () => request('/health', { timeoutMs: 10000 }),

  analyzeDocument(kind, { file, text }) {
    const form = new FormData();
    if (file) form.append('file', file);
    else form.append('text', text);
    return request(`/documents/${kind}`, { form, timeoutMs: 200000 });
  },

  startInterview: (payload) => request('/interview/start', { body: payload, timeoutMs: 100000 }),
  // answer: { text, skipped, integrity? }. Integrity is a set of counts from the browser checks, never video.
  answer: (sessionId, answer) => request(`/interview/${sessionId}/answer`, { body: answer, timeoutMs: 60000 }),
  endInterview: (sessionId, integrity) => request(`/interview/${sessionId}/end`, { body: integrity ? { integrity } : {}, timeoutMs: 250000 }),

  transcribe(blob) {
    // Whisper decodes by file extension, and Safari records mp4 rather than webm.
    const extension = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `answer.${extension}`);
    return request('/transcribe', { form, timeoutMs: 60000 });
  },
};
