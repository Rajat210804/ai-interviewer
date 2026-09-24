import { z } from 'zod';

// Proctoring runs in the candidate's browser. The server only receives counts, never video,
// and treats them as untrusted hints: bad values become 0 instead of failing the request.

const count = z.number().int().min(0).max(1_000_000).catch(0);

export const INTEGRITY_KEYS = [
  'awayEvents', 'awaySeconds', 'noFaceSeconds', 'lookAwaySeconds', 'multipleFaceEvents', 'pasteAttempts', 'fullscreenExits',
];

export const integritySchema = z.object(Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, count])));

const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// Plain-language notes for one answer or a whole interview. Short glances and blips are left out.
export function describeIntegrity(counts) {
  if (!counts) return [];
  const c = { ...Object.fromEntries(INTEGRITY_KEYS.map((k) => [k, 0])), ...counts };
  const notes = [];
  if (c.awayEvents) notes.push(`Left the interview window ${times(c.awayEvents)} (${c.awaySeconds} s in total)`);
  if (c.multipleFaceEvents) notes.push(`Another person appeared on camera ${times(c.multipleFaceEvents)}`);
  if (c.pasteAttempts) notes.push(`Tried to paste text ${times(c.pasteAttempts)}`);
  if (c.fullscreenExits) notes.push(`Left full screen ${times(c.fullscreenExits)}`);
  if (c.noFaceSeconds >= 5) notes.push(`Face not visible for about ${c.noFaceSeconds} s`);
  if (c.lookAwaySeconds >= 10) notes.push(`Looked away from the screen for about ${c.lookAwaySeconds} s`);
  return notes;
}

// What the interviewer is told about the latest answer, so they can react like a real one would.
export function reminderWorthy(counts) {
  if (!counts) return false;
  return counts.awayEvents > 0 || counts.multipleFaceEvents > 0 || counts.pasteAttempts > 0
    || counts.fullscreenExits > 0 || counts.noFaceSeconds >= 10;
}

// Looking away while thinking is normal, so it needs far more time than leaving the window does.
const REVIEW = { awayEvents: 3, awaySeconds: 30, noFaceSeconds: 30, lookAwaySeconds: 90, multipleFaceEvents: 1, pasteAttempts: 2, fullscreenExits: 2 };
const MINOR = { awayEvents: 1, awaySeconds: 2, noFaceSeconds: 5, lookAwaySeconds: 20, multipleFaceEvents: 1, pasteAttempts: 1, fullscreenExits: 1 };

export function summarizeIntegrity({ turns, finalTotals, faceChecks }) {
  // The browser's running totals also cover the time after the last answer; per-answer counts
  // are the fallback if the final totals never arrived.
  const summed = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, turns.reduce((sum, t) => sum + (t.integrity?.[key] || 0), 0)]));
  const totals = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, Math.max(summed[key], finalTotals?.[key] || 0)]));

  const over = (limits) => INTEGRITY_KEYS.some((key) => totals[key] >= limits[key]);
  const level = over(REVIEW) ? 'review' : over(MINOR) ? 'minor' : 'clean';

  return {
    level,
    faceChecks: Boolean(faceChecks),
    totals,
    notes: describeIntegrity(totals),
    flaggedQuestions: turns.filter((t) => describeIntegrity(t.integrity).length).map((t) => t.number),
  };
}
