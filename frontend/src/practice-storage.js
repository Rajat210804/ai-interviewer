import { reportText } from './report-export.js';

export const HISTORY_KEY = 'interview-room:reports:v1';
export const PRACTICE_KEY = 'interview-room:practice:v1';
export const MAX_REPORTS = 20;
const MAX_REPORT_CHARS = 1_000_000;
const validScore = (score) => score === null || (Number.isFinite(score) && score >= 0 && score <= 100);
const validEntry = (entry) => entry && typeof entry.id === 'string' &&
  typeof entry.savedAt === 'string' && Number.isFinite(Date.parse(entry.savedAt)) &&
  typeof entry.role === 'string' && typeof entry.company === 'string' &&
  ['mixed', 'technical', 'hr'].includes(entry.type) &&
  ['easy', 'medium', 'hard'].includes(entry.difficulty) &&
  validScore(entry.score) && typeof entry.text === 'string' && entry.text.length <= MAX_REPORT_CHARS;

function read(storage, key, fallback) {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error('Saved data could not be read. Use the clear control to remove it, or keep using the app without saving.'); }
}

export function readReports(storage) {
  const entries = read(storage, HISTORY_KEY, []);
  if (!Array.isArray(entries) || entries.length > MAX_REPORTS || !entries.every(validEntry)) {
    throw new Error('Saved reports could not be read. Clear saved reports to start again. Existing data has not been overwritten.');
  }
  return entries;
}

export function saveReport(storage, report, id, savedAt = new Date().toISOString()) {
  const entries = readReports(storage);
  const existing = entries.find((entry) => entry.id === id);
  if (existing) return entries;
  if (entries.length >= MAX_REPORTS) throw new Error('You have 20 saved reports. Download and delete an older report before saving another.');
  const text = reportText(report);
  if (text.length > MAX_REPORT_CHARS) throw new Error('This report is too large for browser history. Download the text or PDF instead; your full answers are preserved there.');
  const entry = {
    id, savedAt, role: report.role || 'Interview', company: report.company || '',
    type: report.type, difficulty: report.difficulty,
    score: validScore(report.scores?.overall) ? report.scores.overall : null, text,
  };
  if (!validEntry(entry)) throw new Error('This report could not be saved. Download a copy instead.');
  const next = [entry, ...entries];
  // A failed write leaves the previous value intact; never prune reports to make space.
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function deleteReport(storage, id) {
  const next = readReports(storage).filter((entry) => entry.id !== id);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function readPractice(storage) {
  const value = read(storage, PRACTICE_KEY, { bookmarks: [], completed: [] });
  if (!value || !['bookmarks', 'completed'].every((key) =>
    Array.isArray(value[key]) && value[key].length <= 100 && value[key].every((id) => typeof id === 'string'))) {
    throw new Error('Practice progress could not be read. Clear practice progress to start again.');
  }
  return value;
}

export function togglePractice(storage, field, id) {
  if (!['bookmarks', 'completed'].includes(field)) throw new Error('Unknown practice setting.');
  const value = readPractice(storage);
  const ids = new Set(value[field]);
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  const next = { ...value, [field]: [...ids] };
  storage.setItem(PRACTICE_KEY, JSON.stringify(next));
  return next;
}

export function storageError(error) {
  if (error?.name === 'QuotaExceededError') return 'Browser storage is full. Download a copy and delete older saved reports to free space.';
  if (error?.name === 'SecurityError') return 'This browser blocks local storage. You can still practise and download reports.';
  return error?.message || 'Could not save to this browser. Download a copy instead.';
}
