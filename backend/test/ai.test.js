import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createAI, parseAndValidate } from '../src/ai/index.js';
import { ProviderError } from '../src/ai/providers.js';

const schema = z.object({ answer: z.string() });

function fakeProvider(name, replies) {
  const provider = {
    name,
    configured: true,
    calls: 0,
    async chat() {
      const reply = replies[Math.min(provider.calls++, replies.length - 1)];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return provider;
}

const request = (route) => ({ route, system: 's', user: 'u', schema });

test('uses the preferred provider for each route', async () => {
  const gemini = fakeProvider('gemini', ['{"answer":"from gemini"}']);
  const groq = fakeProvider('groq', ['{"answer":"from groq"}']);
  const ai = createAI({ gemini, groq });
  assert.equal((await ai.generate(request('analysis'))).answer, 'from gemini');
  assert.equal((await ai.generate(request('live'))).answer, 'from groq');
});

test('falls back to the other provider when the first one fails', async () => {
  const gemini = fakeProvider('gemini', [new ProviderError('gemini', 'timeout', 'slow')]);
  const groq = fakeProvider('groq', ['{"answer":"rescued"}']);
  const ai = createAI({ gemini, groq });
  assert.equal((await ai.generate(request('report'))).answer, 'rescued');
  assert.equal(gemini.calls, 1);
});

test('asks the same provider to repair malformed JSON once before falling back', async () => {
  const groq = fakeProvider('groq', ['Sure! Here you go: {"wrong": 1}', '```json\n{"answer":"fixed"}\n```']);
  const gemini = fakeProvider('gemini', ['{"answer":"unused"}']);
  const ai = createAI({ gemini, groq });
  assert.equal((await ai.generate(request('live'))).answer, 'fixed');
  assert.equal(groq.calls, 2);
  assert.equal(gemini.calls, 0);
});

test('turns provider failures into a readable message', async () => {
  const limited = new ProviderError('groq', 'rate_limit', 'HTTP 429');
  const auth = new ProviderError('gemini', 'auth', 'HTTP 401');
  const ai = createAI({ gemini: fakeProvider('gemini', [auth]), groq: fakeProvider('groq', [limited]) });
  await assert.rejects(ai.generate(request('live')), (err) => err.status === 429 && /too many requests/.test(err.userMessage));

  const badKeys = createAI({ gemini: fakeProvider('gemini', [auth]), groq: fakeProvider('groq', [auth]) });
  await assert.rejects(badKeys.generate(request('live')), (err) => /API keys/.test(err.userMessage) && !/HTTP/.test(err.userMessage));
});

test('a provider with no credit is skipped for later calls and the other one carries on', async () => {
  const noCredit = new ProviderError('gemini', 'billing', 'HTTP 429 insufficient balance');
  const gemini = fakeProvider('gemini', [noCredit]);
  const groq = fakeProvider('groq', ['{"answer":"groq"}']);
  const ai = createAI({ gemini, groq });
  assert.equal((await ai.generate(request('analysis'))).answer, 'groq');
  assert.equal((await ai.generate(request('report'))).answer, 'groq');
  assert.equal(gemini.calls, 1, 'Gemini is not retried on every call');

  const broke = createAI({ gemini: fakeProvider('gemini', [noCredit]), groq: fakeProvider('groq', [noCredit]) });
  await assert.rejects(broke.generate(request('live')), (err) => /run out of credit/.test(err.userMessage));
});

test('explains when no provider is configured', async () => {
  const ai = createAI({ gemini: { configured: false }, groq: { configured: false } });
  await assert.rejects(ai.generate(request('live')), (err) => err.status === 503);
  assert.deepEqual(ai.status(), { gemini: false, groq: false });
});

test('parseAndValidate finds JSON wrapped in prose and reports schema problems', () => {
  assert.deepEqual(parseAndValidate('Result: {"answer":"x"} done', schema), { ok: true, data: { answer: 'x' } });
  const bad = parseAndValidate('{"answer": 3}', schema);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /answer/);
});
