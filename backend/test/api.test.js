import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { createFakeAI } from './fake-ai.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
let server;
let base;
const ai = createFakeAI();

before(async () => {
  server = createApp({ ai, requestsPerMinute: 1000 }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function upload(kind, fileName, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(fixture(fileName))], { type }), fileName);
  const res = await fetch(`${base}/documents/${kind}`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('health reports which providers are configured', async () => {
  const res = await fetch(`${base}/health`);
  assert.deepEqual(await res.json(), { ok: true, providers: { gemini: true, groq: true } });
});

for (const file of ['cv.pdf', 'cv.docx', 'cv.txt']) {
  test(`reads a CV from ${file}`, async () => {
    ai.calls.length = 0;
    const { status, body } = await upload('cv', file);
    assert.equal(status, 200);
    assert.equal(body.profile.name, 'Rajat Sample');
    assert.match(ai.calls[0].user, /JBM Green/, 'the extracted text reaches the model');
  });
}

test('reads a job description from an image through OCR', async () => {
  ai.calls.length = 0;
  const { status } = await upload('jd', 'scan.png', 'image/png');
  assert.equal(status, 200);
  assert.deepEqual(ai.calls.map((c) => c.label), ['ocr', 'jd analysis']);
  assert.match(ai.calls[0].images[0], /^data:image\/png;base64,/);
});

test('accepts pasted text', async () => {
  const form = new FormData();
  form.append('text', 'Data Analyst. We need SQL, Python and Excel. You will build dashboards for the sales team.');
  const res = await fetch(`${base}/documents/jd`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
});

test('rejects unsupported, disguised and empty files with a readable message', async () => {
  const unsupported = await upload('cv', 'unsupported.bin');
  assert.equal(unsupported.status, 415);
  assert.match(unsupported.body.error, /PDF, DOCX, TXT/);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('MZ not really a pdf')]), 'cv.pdf');
  const fake = await fetch(`${base}/documents/cv`, { method: 'POST', body: form });
  assert.equal(fake.status, 415);

  const empty = new FormData();
  empty.append('text', '   ');
  const none = await fetch(`${base}/documents/cv`, { method: 'POST', body: empty });
  assert.equal(none.status, 400);
});

test('rejects files over 5 MB', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(6 * 1024 * 1024, 65)]), 'huge.txt');
  const res = await fetch(`${base}/documents/cv`, { method: 'POST', body: form });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /under 5 MB/);
});

test('runs an interview over HTTP and never leaks internals in errors', async () => {
  const setup = {
    company: 'Acme', role: 'Data Analyst', candidateName: 'Rajat', type: 'technical', difficulty: 'medium', length: 5,
    panel: [{ role: 'tech', name: 'Daniel', avatarId: 'professional-man' }],
  };
  const bad = await post('/interview/start', { setup: { ...setup, length: 500 } });
  assert.equal(bad.status, 400);

  const started = await post('/interview/start', { setup, cv: null, jd: null });
  assert.equal(started.status, 200);
  let state = started.body;
  assert.ok(state.sessionId && state.turn.question);

  while (!state.done) {
    state = (await post(`/interview/${state.sessionId}/answer`, { text: 'A reasonably detailed answer that is long enough to move on to the next question.' })).body;
  }
  const report = await post(`/interview/${state.sessionId}/end`, {});
  assert.equal(report.status, 200);
  assert.ok(report.body.questions.length >= 5);

  const expired = await post(`/interview/${state.sessionId}/answer`, { text: 'hello' });
  assert.equal(expired.status, 404);
  assert.match(expired.body.error, /expired/);
  assert.ok(!('stack' in expired.body));
});

test('transcribes uploaded audio', async () => {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('fake audio')], { type: 'audio/webm' }), 'answer.webm');
  const res = await fetch(`${base}/transcribe`, { method: 'POST', body: form });
  assert.deepEqual(await res.json(), { text: 'This is a transcribed answer.' });
});
