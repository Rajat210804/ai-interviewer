import test from 'node:test';
import assert from 'node:assert/strict';
import { reportText } from '../src/report-export.js';

test('text export preserves full Unicode answers, review details and context limitations', () => {
  const answer = 'My approach — उदाहरण 😀\n'.repeat(20000);
  const text = reportText({
    role: 'Data Analyst', scores: { overall: 0, technical: null },
    study_plan: [{ topic: 'SQL', why: 'Practise joins', how: 'Compare two queries' }],
    questions: [{ number: 1, question: 'How would you investigate?', answer,
      review: { good: 'Clear approach', missing: 'Evidence', improve: 'Show a result', ideal_structure: 'Problem, action, result' },
      exampleAnswer: 'I would validate the source.', contextLimited: true }],
    contextLimited: true,
  });
  assert.ok(text.includes(answer));
  for (const expected of ['overall: 0', 'technical: Not assessed', 'Practise joins', 'Compare two queries',
    'Clear approach', 'Evidence', 'Show a result', 'Problem, action, result', 'I would validate the source.',
    'AI assessment used excerpts', 'final AI assessment used excerpts']) {
    assert.ok(text.includes(expected), expected);
  }
});

test('incomplete reports export without inventing scores or answers', () => {
  const text = reportText({ insufficient: true, questions: [{ question: 'Introduce yourself.' }] });
  assert.match(text, /Not enough responses to assess/);
  assert.match(text, /No answer submitted/);
  assert.doesNotMatch(text, /undefined|NaN/);
});
