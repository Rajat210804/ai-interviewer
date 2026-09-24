import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots, openingTurn } from '../src/interview/flow.js';

const panels = {
  one: [{ id: 'i1', role: 'tech', name: 'Daniel' }],
  three: [
    { id: 'i1', role: 'hr', name: 'Rachel' },
    { id: 'i2', role: 'tech', name: 'Daniel' },
    { id: 'i3', role: 'manager', name: 'James' },
  ],
};

test('every interview starts with an intro and ends with the candidate questions', () => {
  for (const type of ['hr', 'technical', 'mixed']) {
    for (const length of [5, 10, 20, 30]) {
      const slots = buildSlots(type, length, panels.three);
      assert.equal(slots.length, length);
      assert.equal(slots[0].category, 'intro');
      assert.equal(slots.at(-1).category, 'candidate_questions');
    }
  }
});

test('HR interviews never plan technical questions, technical ones never plan behavioural ones', () => {
  const hr = buildSlots('hr', 20, panels.three).map((s) => s.category);
  const technical = buildSlots('technical', 20, panels.three).map((s) => s.category);
  assert.ok(!hr.includes('technical') && !hr.includes('scenario'));
  assert.ok(!technical.includes('behavioral'));
  assert.ok(technical.filter((c) => c === 'technical').length >= 7);
});

test('questions go to the interviewer whose role fits them', () => {
  const slots = buildSlots('mixed', 20, panels.three);
  for (const slot of slots.filter((s) => s.category === 'technical')) assert.equal(slot.interviewer, 'i2');
  for (const slot of slots.filter((s) => s.category === 'behavioral')) assert.equal(slot.interviewer, 'i1');
  const resumeOwners = new Set(slots.filter((s) => s.category === 'resume').map((s) => s.interviewer));
  assert.deepEqual([...resumeOwners].sort(), ['i2', 'i3']);
});

test('a single interviewer asks everything', () => {
  const slots = buildSlots('mixed', 10, panels.one);
  assert.ok(slots.every((s) => s.interviewer === 'i1'));
});

test('the order varies between interviews', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const orders = new Set(Array.from({ length: 10 }, () => buildSlots('mixed', 20, panels.three, random).map((s) => s.category).join()));
  assert.ok(orders.size > 1);
});

test('the opening introduces the panel and the role', () => {
  const setup = { company: 'Acme', role: 'Data Analyst', type: 'mixed', length: 10 };
  const turn = openingTurn({ panel: panels.three, setup, firstName: 'Rajat' }, () => 0);
  assert.match(turn.reaction, /^Hi Rajat, thanks for joining us\. I'm Rachel, HR Manager at Acme\./);
  assert.match(turn.reaction, /With me today are Daniel, our Technical Lead and James, our Hiring Manager\./);
  assert.match(turn.reaction, /mixed interview for the Data Analyst role, about 10 questions/);
  assert.equal(turn.question, 'To start, tell me a little about yourself.');
});
