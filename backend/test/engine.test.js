import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInterviewEngine } from '../src/interview/engine.js';
import { cvSchema } from '../src/ai/schemas.js';
import { createFakeAI } from './fake-ai.js';

const setup = (overrides = {}) => ({
  company: 'Acme',
  role: 'Data Analyst',
  candidateName: '',
  type: 'mixed',
  difficulty: 'easy',
  length: 5,
  panel: [
    { role: 'hr', name: 'Rachel', avatarId: 'professional-woman' },
    { role: 'tech', name: 'Daniel', avatarId: 'professional-man' },
  ],
  ...overrides,
});

const LONG_ANSWER = 'I would partition by region, rank products by total revenue with a window function, and keep the top three rows.';

test('runs a full interview: opening, follow-up, planned questions, closing and report', async () => {
  const ai = createFakeAI();
  const engine = createInterviewEngine(ai);
  const cv = cvSchema.parse({ name: 'Rajat Sample' });

  let state = await engine.start({ setup: setup(), cv, jd: null });
  assert.match(state.turn.reaction, /^Hi Rajat, thanks for joining us/);
  assert.equal(state.turn.interviewer, 'i1');
  assert.deepEqual(state.progress, { current: 1, total: 5 });

  // A short answer on easy difficulty earns exactly one follow-up.
  state = await engine.answer(state.sessionId, { text: 'I built a tool.', skipped: false });
  assert.equal(state.turn.isFollowUp, true);
  assert.equal(state.progress.current, 1);

  state = await engine.answer(state.sessionId, { text: 'It was fine.', skipped: false });
  assert.equal(state.turn.isFollowUp, false, 'follow-up budget for easy is one');
  assert.equal(state.progress.current, 2);

  while (!state.done) {
    state = await engine.answer(state.sessionId, { text: LONG_ANSWER, skipped: false });
  }
  assert.match(state.closing.message, /recruiter will be in touch/);

  const report = await engine.end(state.sessionId);
  assert.equal(report.questionsAnswered, 6);
  assert.equal(report.scores.overall, 64);
  assert.equal(report.questions.length, 6);
  assert.ok(report.questions.every((q) => q.review && q.question && q.answer));
  assert.ok(report.questions[0].exampleAnswer);

  await assert.rejects(engine.answer(state.sessionId, { text: 'late', skipped: false }), (err) => err.status === 404);
});

test('the model is only offered moves that fit the plan', async () => {
  const ai = createFakeAI();
  const engine = createInterviewEngine(ai);
  const state = await engine.start({ setup: setup({ difficulty: 'hard' }), cv: null, jd: null });
  await engine.answer(state.sessionId, { text: 'Short.', skipped: false });
  const moves = ai.calls.filter((c) => c.label === 'turn').map((c) => c.schema.shape.move.options);
  assert.deepEqual(moves[0], ['follow_up', 'next_question']);
});

test('a skipped question is recorded without an answer', async () => {
  const engine = createInterviewEngine(createFakeAI());
  const state = await engine.start({ setup: setup(), cv: null, jd: null });
  const next = await engine.answer(state.sessionId, { text: '', skipped: true });
  assert.ok(next.turn);
  const report = await engine.end(state.sessionId);
  assert.equal(report.insufficient, true, 'no real answers means no report');
});

test('a failed model call leaves the question open so the candidate can retry', async () => {
  const ai = createFakeAI({ failLabels: ['turn'] });
  const engine = createInterviewEngine(ai);
  const state = await engine.start({ setup: setup(), cv: null, jd: null });
  await assert.rejects(engine.answer(state.sessionId, { text: LONG_ANSWER, skipped: false }), (err) => err.status === 502);
  const report = await engine.end(state.sessionId);
  assert.equal(report.insufficient, true, 'the failed answer was not recorded');
});

test('empty answers are rejected', async () => {
  const engine = createInterviewEngine(createFakeAI());
  const state = await engine.start({ setup: setup(), cv: null, jd: null });
  await assert.rejects(engine.answer(state.sessionId, { text: '', skipped: false }), (err) => err.status === 400);
});
