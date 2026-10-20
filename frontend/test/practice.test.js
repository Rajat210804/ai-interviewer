import test from 'node:test';
import assert from 'node:assert/strict';
import { filterQuestions, PRACTICE_QUESTIONS } from '../src/data/practice.js';
import { deleteReport, HISTORY_KEY, MAX_REPORTS, PRACTICE_KEY, readPractice, readReports, saveReport, storageError, togglePractice } from '../src/practice-storage.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
const report = {
  role: 'Analyst', company: 'Example', type: 'technical', difficulty: 'medium',
  scores: { overall: 0 }, questions: [{ question: 'Introduce yourself.', answer: 'My answer 😀\nSecond line.', review: { improve: 'Explain impact.' } }],
};

test('question filters combine topic, level, search and bookmarks', () => {
  assert.equal(new Set(PRACTICE_QUESTIONS.map((q) => q.id)).size, PRACTICE_QUESTIONS.length);
  assert.deepEqual(filterQuestions({ category: 'Data analysis', level: 'Foundation', search: 'SQL', savedOnly: true, bookmarks: ['sql', 'experiment'] }).map((q) => q.id), ['sql']);
  assert.equal(filterQuestions({ search: 'no matching question here' }).length, 0);
  assert.equal(filterQuestions({ savedOnly: true }).length, 0);
  assert.equal(filterQuestions({ search: '  TEAMMATE  ' }).length, 2);
});

test('reports survive storage round trips with full answers, zero scores and no duplicate saves', () => {
  const storage = memoryStorage();
  assert.deepEqual(readReports(storage), []);
  saveReport(storage, report, 'one', '2026-10-20T12:00:00.000Z');
  saveReport(storage, report, 'one');
  const [entry] = readReports(storage);
  assert.equal(readReports(storage).length, 1);
  assert.equal(entry.score, 0);
  assert.ok(entry.text.includes(report.questions[0].answer));
  assert.match(entry.text, /Explain impact/);
  saveReport(storage, { ...report, scores: { overall: null } }, 'two');
  assert.equal(readReports(storage)[0].score, null);
  deleteReport(storage, 'one');
  assert.deepEqual(readReports(storage).map((entry) => entry.id), ['two']);
});

test('history limit refuses new reports without silently discarding older ones', () => {
  const storage = memoryStorage();
  for (let i = 0; i < MAX_REPORTS; i++) saveReport(storage, report, `report-${i}`);
  const before = storage.getItem(HISTORY_KEY);
  assert.throws(() => saveReport(storage, report, 'overflow'), /20 saved reports/);
  assert.equal(storage.getItem(HISTORY_KEY), before);
});

test('oversized reports and quota failures preserve previously saved reports', () => {
  const storage = memoryStorage();
  saveReport(storage, report, 'one');
  const before = storage.getItem(HISTORY_KEY);
  assert.throws(() => saveReport(storage, { ...report, questions: [{ answer: 'a'.repeat(1_000_001) }] }, 'large'), /too large/);
  storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  assert.throws(() => saveReport(storage, report, 'two'), { name: 'QuotaExceededError' });
  assert.equal(storage.getItem(HISTORY_KEY), before);
  assert.match(storageError(new DOMException('Full', 'QuotaExceededError')), /storage is full/);
});

test('malformed saved data is reported rather than overwritten', () => {
  const storage = memoryStorage();
  for (const malformed of ['not json', '{}', '[null]', '[{"score":"100"}]']) {
    storage.setItem(HISTORY_KEY, malformed);
    assert.throws(() => readReports(storage));
    assert.throws(() => saveReport(storage, report, 'one'));
    assert.equal(storage.getItem(HISTORY_KEY), malformed);
  }
  storage.removeItem(HISTORY_KEY);
  assert.deepEqual(readReports(storage), []);
});

test('practice toggles persist independently and cannot write unknown settings', () => {
  const storage = memoryStorage();
  togglePractice(storage, 'bookmarks', 'intro');
  togglePractice(storage, 'completed', 'intro');
  togglePractice(storage, 'bookmarks', 'intro');
  assert.deepEqual(readPractice(storage), { bookmarks: [], completed: ['intro'] });
  assert.equal(storage.getItem(HISTORY_KEY), null);
  assert.throws(() => togglePractice(storage, '__proto__', 'intro'));
  storage.setItem(PRACTICE_KEY, '{"bookmarks":null,"completed":[]}');
  assert.throws(() => togglePractice(storage, 'completed', 'intro'));
});

test('blocked local storage remains an explicit, recoverable error', () => {
  const storage = { getItem() { throw new DOMException('Denied', 'SecurityError'); } };
  assert.throws(() => readReports(storage), { name: 'SecurityError' });
  assert.throws(() => readPractice(storage), { name: 'SecurityError' });
  assert.match(storageError(new DOMException('Denied', 'SecurityError')), /still practise and download/);
});
