import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider, GroqProvider } from '../src/ai/providers.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(responses) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: next.headers });
  };
  return requests;
}

const completion = (content) => ({ body: { choices: [{ message: { content } }] } });
const messages = [{ role: 'user', content: 'Return JSON' }];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const geminiReply = (...parts) => ({ body: { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] } });

test('Gemini requests use its own API with JSON output and room for thinking tokens', async () => {
  const requests = mockFetch([geminiReply({ text: 'thinking...', thought: true }, { text: '{"ok":true}' })]);
  const gemini = new GeminiProvider({ apiKey: 'test-key', baseUrl: GEMINI_BASE, model: 'gemini-3.8-flash' });
  const reply = await gemini.chat({
    messages: [
      { role: 'system', content: 'Be an interviewer.' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: '{"bad":1}' },
      { role: 'user', content: 'Fix it' },
    ],
    maxTokens: 1000,
  });
  assert.equal(reply, '{"ok":true}', 'thought parts are not part of the answer');

  const [{ url, init, body }] = requests;
  assert.equal(url, `${GEMINI_BASE}/models/gemini-3.8-flash:generateContent`);
  assert.equal(init.headers['x-goog-api-key'], 'test-key');
  assert.equal('Authorization' in init.headers, false);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Be an interviewer.' }] });
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.maxOutputTokens > 1000);
});

test('Gemini receives images inline and reports blocked or empty replies', async () => {
  const requests = mockFetch([geminiReply({ text: '{"text":"JD"}' })]);
  const gemini = new GeminiProvider({ apiKey: 'k', baseUrl: GEMINI_BASE, model: 'gemini-3.8-flash' });
  await gemini.chat({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Read this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }],
    vision: true,
  });
  assert.deepEqual(requests[0].body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } });

  mockFetch([{ body: { promptFeedback: { blockReason: 'SAFETY' } } }]);
  await assert.rejects(gemini.chat({ messages }), (err) => err.kind === 'empty' && /SAFETY/.test(err.message));

  mockFetch([{ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } }]);
  await assert.rejects(gemini.chat({ messages }), (err) => err.kind === 'auth');

  mockFetch([
    { status: 429, body: { error: { code: 429, message: 'You exceeded your current quota. Please retry in 30s.', status: 'RESOURCE_EXHAUSTED' } } },
    { status: 429, body: { error: { code: 429, message: 'You exceeded your current quota. Please retry in 30s.', status: 'RESOURCE_EXHAUSTED' } } },
  ]);
  await assert.rejects(gemini.chat({ messages }), (err) => err.kind === 'rate_limit', 'a free-tier quota is a rate limit, not an empty account');
});

test('Groq requests set reasoning effort for gpt-oss and use the vision model for images', async () => {
  const requests = mockFetch([completion('{}'), completion('{}')]);
  const groq = new GroqProvider({ apiKey: 'k', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', visionModel: 'qwen/qwen3.8-27b' });
  await groq.chat({ messages, effort: 'medium' });
  await groq.chat({ messages, vision: true });

  assert.equal(requests[0].body.reasoning_effort, 'medium');
  assert.equal(requests[0].body.include_reasoning, false);
  assert.equal(requests[1].body.model, 'qwen/qwen3.8-27b');
  assert.equal(requests[1].body.reasoning_format, 'hidden');
  assert.equal('reasoning_effort' in requests[1].body, false);
});

test('a short rate limit is retried once, other errors are classified', async () => {
  mockFetch([{ status: 429, body: {}, headers: { 'retry-after': '0.01' } }, completion('{"ok":1}')]);
  const groq = new GroqProvider({ apiKey: 'k', baseUrl: 'https://x', model: 'llama-3.3-70b-versatile' });
  assert.equal(await groq.chat({ messages }), '{"ok":1}');

  for (const [status, kind] of [[401, 'auth'], [404, 'model'], [503, 'server'], [400, 'bad_request']]) {
    mockFetch([{ status, body: { error: { message: 'nope' } } }]);
    await assert.rejects(groq.chat({ messages }), (err) => err.kind === kind);
  }
});

test('an empty account is reported as billing, not retried as a rate limit', async () => {
  const requests = mockFetch([{ status: 429, headers: { 'retry-after': '1' }, body: { error: { message: 'Your account org-x is suspended due to insufficient balance, please recharge your account', type: 'exceeded_current_quota_error' } } }]);
  const groq = new GroqProvider({ apiKey: 'k', baseUrl: 'https://x', model: 'openai/gpt-oss-120b' });
  await assert.rejects(groq.chat({ messages }), (err) => err.kind === 'billing');
  assert.equal(requests.length, 1);

  // Groq's ordinary rate-limit message mentions its billing page; that is still just a rate limit.
  mockFetch([{ status: 429, headers: { 'retry-after': '30' }, body: { error: { message: 'Rate limit reached on tokens per minute (TPM). Upgrade at https://console.groq.com/settings/billing' } } }]);
  await assert.rejects(groq.chat({ messages }), (err) => err.kind === 'rate_limit');

  mockFetch([{ status: 413, body: { error: { message: 'Request too large for model on tokens per minute (TPM)' } } }]);
  await assert.rejects(groq.chat({ messages }), (err) => err.kind === 'too_large');
});

test('timeouts and empty completions surface as provider errors', async () => {
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const groq = new GroqProvider({ apiKey: 'k', baseUrl: 'https://x', model: 'openai/gpt-oss-120b' });
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout doesn't hold the event loop open
  await assert.rejects(groq.chat({ messages, timeoutMs: 20 }), (err) => err.kind === 'timeout');
  clearInterval(keepAlive);

  mockFetch([completion('   ')]);
  await assert.rejects(groq.chat({ messages }), (err) => err.kind === 'empty');
});

test('Whisper transcription sends the audio as a multipart upload', async () => {
  const requests = mockFetch([{ body: { text: ' Hello there. ' } }]);
  const groq = new GroqProvider({ apiKey: 'k', baseUrl: 'https://api.groq.com/openai/v1', model: 'm', whisperModel: 'whisper-large-v3-turbo' });
  assert.equal(await groq.transcribe(Buffer.from('audio'), 'audio/webm', 'answer.webm'), 'Hello there.');
  const form = requests[0].body;
  assert.equal(requests[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  assert.equal(form.get('file').name, 'answer.webm');
});
