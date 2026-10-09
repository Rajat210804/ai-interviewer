// All calls go to our own backend; API keys never reach the browser.
// Timeouts are long enough for the server to try one provider and then fall back to the other.

const FALLBACK_MESSAGES = {
  404: 'That interview session has expired. Please start a new one.',
  413: 'That file is too large. Please upload a file under 5 MB.',
  429: 'Too many requests right now. Wait a few seconds and try again.',
  504: 'The interviewer took too long to respond. Please try again.',
};

async function request(path, { body, form, timeoutMs = 90000, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: body || form ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body && JSON.stringify(body)),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (signal?.aborted) {
      const canceled = new Error('The request was canceled.');
      canceled.name = 'AbortError';
      throw canceled;
    }
    throw new Error(err.name === 'TimeoutError'
      ? 'The interviewer took too long to respond. Please try again.'
      : "We couldn't reach the server. Check your connection and try again.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.error || FALLBACK_MESSAGES[res.status] || "We couldn't connect to the interviewer right now. Please try again.");
    error.status = res.status;
    const seconds = Number(res.headers.get('retry-after'));
    error.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
    throw error;
  }
  if (!data || typeof data !== 'object') {
    throw new Error('The server returned an unreadable response. Please try again.');
  }
  return data;
}

// The server protects individual requests without limiting a whole answer.
// Even six-byte JSON escapes fit comfortably below its 300 KB request budget.
const PART_CHARS = 32000;
const DIRECT_BYTES = 250000;
const uploads = new Map();
const encodedBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function waitForRateLimit(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => {
      clearTimeout(timer);
      const error = new Error('The request was canceled.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) return abort();
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function sendAnswer(sessionId, answer, options = {}) {
  if (answer.skipped || encodedBytes(answer) <= DIRECT_BYTES) {
    const result = await request(`/interview/${sessionId}/answer`, { body: answer, timeoutMs: 60000, ...options });
    uploads.delete(sessionId);
    return result;
  }
  let upload = uploads.get(sessionId);
  if (!upload || upload.expectedTurn !== answer.expectedTurn || upload.text !== answer.text) {
    upload = { uploadId: crypto.randomUUID(), expectedTurn: answer.expectedTurn, text: answer.text, index: 0 };
    uploads.set(sessionId, upload);
  }
  const total = Math.ceil(upload.text.length / PART_CHARS);
  options.onProgress?.({ uploadedCharacters: Math.min(upload.index * PART_CHARS, upload.text.length), totalCharacters: upload.text.length });
  while (upload.index < total) {
    const body = {
      uploadId: upload.uploadId, expectedTurn: upload.expectedTurn, index: upload.index,
      text: upload.text.slice(upload.index * PART_CHARS, (upload.index + 1) * PART_CHARS),
    };
    let result;
    try {
      result = await request(`/interview/${sessionId}/answer-parts`, { body, timeoutMs: 30000, ...options });
    } catch (error) {
      if (error.status !== 429) throw error;
      await waitForRateLimit(error.retryAfterMs, options.signal);
      continue;
    }
    if (result.uploadId !== upload.uploadId || result.index !== upload.index || result.nextIndex !== upload.index + 1) {
      throw new Error('The answer upload could not be confirmed. Your answer is retained; please try again.');
    }
    upload.index++;
    options.onProgress?.({ uploadedCharacters: Math.min(upload.index * PART_CHARS, upload.text.length), totalCharacters: upload.text.length });
  }
  const { text: _fullText, ...metadata } = answer;
  const result = await request(`/interview/${sessionId}/answer`, {
    body: { ...metadata, uploadId: upload.uploadId, totalParts: total, answerCharacters: upload.text.length }, timeoutMs: 60000, ...options,
  });
  if (uploads.get(sessionId) === upload) uploads.delete(sessionId);
  return result;
}

export const api = {
  health: (options = {}) => request('/health', { timeoutMs: 10000, ...options }),

  analyzeDocument(kind, { file, text }, options = {}) {
    const form = new FormData();
    if (file) form.append('file', file);
    else form.append('text', text);
    return request(`/documents/${kind}`, { form, timeoutMs: 200000, ...options });
  },

  startInterview: (payload, options = {}) => request('/interview/start', { body: payload, timeoutMs: 100000, ...options }),
  // answer: { text, skipped, integrity? }. Integrity is a set of counts from the browser checks, never video.
  answer: sendAnswer,
  keepAlive: (sessionId, options = {}) => request(`/interview/${sessionId}/keep-alive`, { body: {}, timeoutMs: 10000, ...options }),
  clearAnswerUploads: (sessionId) => uploads.delete(sessionId),
  async endInterview(sessionId, integrity, options = {}) {
    const report = await request(`/interview/${sessionId}/end`, { body: integrity ? { integrity } : {}, timeoutMs: 250000, ...options });
    uploads.delete(sessionId);
    return report;
  },

  transcribe(blob, options = {}) {
    // Whisper decodes by file extension, and Safari records mp4 rather than webm.
    const extension = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `answer.${extension}`);
    return request('/transcribe', { form, timeoutMs: 60000, ...options });
  },
};
