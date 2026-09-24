import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createInterviewEngine } from '../src/interview/engine.js';
import { describeIntegrity, integritySchema, summarizeIntegrity } from '../src/interview/integrity.js';
import { reportPrompt } from '../src/ai/prompts.js';
import { createFakeAI } from './fake-ai.js';

const setup = (overrides = {}) => ({
  company: 'Acme', role: 'Data Analyst', candidateName: '', type: 'technical', difficulty: 'easy', length: 5,
  panel: [{ role: 'tech', name: 'Daniel', avatarId: 'professional-man' }],
  proctored: true,
  ...overrides,
});
const ANSWER = 'I would partition by region, rank products by total revenue with a window function, and keep the top three rows.';
const clean = { awayEvents: 0, awaySeconds: 0, noFaceSeconds: 0, lookAwaySeconds: 0, multipleFaceEvents: 0, pasteAttempts: 0, fullscreenExits: 0 };

test('integrity counts are validated leniently: bad values become 0, unknown keys are dropped', () => {
  const parsed = integritySchema.parse({ awayEvents: 2, awaySeconds: -5, pasteAttempts: 'lots', hacked: true });
  assert.equal(parsed.awayEvents, 2);
  assert.equal(parsed.awaySeconds, 0);
  assert.equal(parsed.pasteAttempts, 0);
  assert.equal(parsed.noFaceSeconds, 0);
  assert.ok(!('hacked' in parsed));
});

test('short glances are not flagged, real events are described in plain words', () => {
  assert.deepEqual(describeIntegrity({ ...clean, lookAwaySeconds: 6, noFaceSeconds: 3 }), []);
  assert.deepEqual(describeIntegrity({ ...clean, awayEvents: 2, awaySeconds: 41, pasteAttempts: 1 }), [
    'Left the interview window twice (41 s in total)',
    'Tried to paste text once',
  ]);
});

test('the summary level goes from clean to minor to needs review', () => {
  const turns = (list) => list.map((integrity, i) => ({ number: i + 1, integrity }));
  assert.equal(summarizeIntegrity({ turns: turns([clean, clean]) }).level, 'clean');
  assert.equal(summarizeIntegrity({ turns: turns([clean, { ...clean, awayEvents: 1, awaySeconds: 4 }]) }).level, 'minor');
  const review = summarizeIntegrity({ turns: turns([{ ...clean, multipleFaceEvents: 1 }, clean]), finalTotals: { ...clean, fullscreenExits: 1 }, faceChecks: true });
  assert.equal(review.level, 'review');
  assert.deepEqual(review.flaggedQuestions, [1]);
  assert.equal(review.totals.fullscreenExits, 1, 'final totals cover time after the last answer');
  assert.equal(review.faceChecks, true);
});

test('the interviewer is told about proctoring events and reminds the candidate at most twice', async () => {
  const ai = createFakeAI();
  const engine = createInterviewEngine(ai);
  let state = await engine.start({ setup: setup(), cv: null, jd: null });
  const away = { ...clean, awayEvents: 1, awaySeconds: 12 };

  const reactions = [];
  for (let i = 0; i < 3; i++) {
    state = await engine.answer(state.sessionId, { text: ANSWER, skipped: false, integrity: away });
    reactions.push(state.turn?.reaction ?? state.closing.reaction);
  }
  const prompts = ai.calls.filter((c) => c.label === 'turn').map((c) => c.system);
  assert.match(prompts[0], /Proctoring during this answer: Left the interview window once \(12 s in total\)/);
  assert.match(prompts[0], /Never accuse the candidate of cheating/);
  assert.equal(prompts.filter((p) => p.includes('Proctoring during this answer')).length, 2);
  assert.match(reactions[0], /^Before we go on, please stay on this screen/);
  assert.doesNotMatch(reactions[2], /stay on this screen/);

  while (!state.done) state = await engine.answer(state.sessionId, { text: ANSWER, skipped: false, integrity: clean });
  const report = await engine.end(state.sessionId, { ...clean, awayEvents: 4, awaySeconds: 50, faceChecks: true });
  assert.equal(report.integrity.level, 'review');
  assert.equal(report.integrity.totals.awayEvents, 4);
  assert.deepEqual(report.integrity.flaggedQuestions, [1, 2, 3]);
  assert.deepEqual(report.questions[0].integrityFlags, ['Left the interview window once (12 s in total)']);
  assert.deepEqual(report.questions.at(-1).integrityFlags, []);
});

test('interviews without proctoring ignore integrity data entirely', async () => {
  const ai = createFakeAI();
  const engine = createInterviewEngine(ai);
  let state = await engine.start({ setup: setup({ proctored: false }), cv: null, jd: null });
  state = await engine.answer(state.sessionId, { text: ANSWER, skipped: false, integrity: { ...clean, pasteAttempts: 3 } });
  assert.ok(!ai.calls.at(-1).system.includes('Proctoring'));
  const report = await engine.end(state.sessionId, { ...clean, pasteAttempts: 3 });
  assert.equal(report.integrity, undefined);
  assert.deepEqual(report.questions[0].integrityFlags, []);
});

test('the debrief prompt keeps very long answers within a fixed budget', () => {
  const long = 'word '.repeat(3000).trim(); // 14,999 characters
  const turn = (number) => ({ number, category: 'technical', isFollowUp: false, interviewer: 'i1', question: 'Q?', answer: long, assessment: { score: 6, verdict: 'adequate', gaps: [], incorrect_points: [] } });
  const session = {
    setup: setup(), cv: null, jd: null,
    plan: { strong_matches: [], partial_matches: [], missing_skills: [] },
    panel: [{ id: 'i1', role: 'tech', name: 'Daniel' }],
  };
  const { user } = reportPrompt(session, Array.from({ length: 12 }, (_, i) => turn(i + 1)));
  assert.ok(user.length < 32000, `report prompt is ${user.length} characters`);
  assert.match(user, /answer continues, cut here for length/);
});

test('answers up to 15,000 characters are accepted over HTTP, and longer ones are trimmed rather than rejected', async () => {
  const server = createApp({ ai: createFakeAI(), requestsPerMinute: 1000 }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    let state = (await post('/interview/start', { setup: setup(), cv: null, jd: null })).body;
    const long = `${'I explained the design in detail. '.repeat(440)}`; // about 15,000 characters
    const first = await post(`/interview/${state.sessionId}/answer`, { text: long, integrity: { awayEvents: 'x' } });
    assert.equal(first.status, 200);
    state = first.body;
    const tooLong = await post(`/interview/${state.sessionId}/answer`, { text: 'a'.repeat(20000), integrity: clean });
    assert.equal(tooLong.status, 200);
    state = tooLong.body;
    while (!state.done) state = (await post(`/interview/${state.sessionId}/answer`, { text: ANSWER, integrity: clean })).body;
    const report = await post(`/interview/${state.sessionId}/end`, { integrity: { ...clean, pasteAttempts: 1, faceChecks: true } });
    assert.equal(report.status, 200);
    assert.equal(report.body.questions[0].answer.length, long.trim().length);
    assert.equal(report.body.questions[1].answer.length, 15000);
    assert.equal(report.body.integrity.level, 'minor');
  } finally {
    server.close();
  }
});
