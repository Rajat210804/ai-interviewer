import { z } from 'zod';

// Proctoring runs in the candidate's browser. The server receives metadata, never video,
// and treats them as untrusted hints: bad values become 0 instead of failing the request.

const count = z.number().int().min(0).max(1_000_000).catch(0);

export const INTEGRITY_KEYS = [
  'awayEvents', 'awaySeconds', 'noFaceSeconds', 'lookAwaySeconds', 'multipleFaceEvents', 'pasteAttempts', 'fullscreenExits',
  'phoneEvents', 'phoneSeconds', 'objectEvents', 'faceDisappearances', 'tooFarSeconds', 'headMovementEvents',
  'cameraInterruptions', 'cameraUnavailableSeconds', 'microphoneInterruptions', 'microphoneUnavailableSeconds',
  'copyAttempts', 'shortcutAttempts', 'visionUnavailableSeconds', 'objectUnavailableSeconds',
];

export const EVENT_TYPES = [
  'NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'TOO_FAR', 'EXCESSIVE_HEAD_MOVEMENT', 'PHONE_DETECTED', 'OBJECT_DETECTED',
  'FACE_DISAPPEARANCES', 'CAMERA_UNAVAILABLE', 'MICROPHONE_UNAVAILABLE', 'TAB_AWAY', 'FULLSCREEN_EXIT', 'FULLSCREEN_REQUIRED',
  'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'SHORTCUT_ATTEMPT', 'VISION_UNAVAILABLE', 'OBJECT_MODEL_UNAVAILABLE',
  'CAMERA_PERMISSION_DENIED', 'MICROPHONE_PERMISSION_DENIED', 'CAMERA_INTERRUPTION', 'MICROPHONE_INTERRUPTION', 'INTERVIEW_COMPLETED',
];
export const SEVERITIES = ['INFO', 'WARNING', 'SUSPICIOUS', 'SERIOUS_VIOLATION'];
const safeText = (max) => z.string().transform((s) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max));
const eventSchema = z.object({
  id: z.union([safeText(80), z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]),
  type: z.enum(EVENT_TYPES),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1).catch(0),
  timestamp: z.string().datetime({ offset: true }),
  duration: z.number().int().min(0).max(86_400_000).catch(0),
  occurrences: z.number().int().min(1).max(10000).catch(1),
  message: safeText(240).catch('Monitoring observation'),
  source: safeText(40).optional(),
  label: safeText(40).optional(),
});
const duration = z.number().int().min(0).max(86_400_000).catch(0);
const coverageSchema = z.object({
  activeMs: duration, faceAvailableMs: duration, objectAvailableMs: duration, faceSamples: count, objectSamples: count,
});
// Discard malformed entries independently, rather than losing a whole valid log to one bad frame.
const eventsSchema = z.array(z.unknown()).max(1000).transform((events) => events
  .map((event) => eventSchema.safeParse(event)).filter((event) => event.success).map((event) => event.data).slice(-120)).catch([]);
export const integritySchema = z.object({
  ...Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, count])),
  faceChecks: z.boolean().catch(false),
  phoneChecks: z.boolean().catch(false),
  suspicionScore: z.number().min(0).max(100).catch(0),
  coverage: coverageSchema.catch({ activeMs: 0, faceAvailableMs: 0, objectAvailableMs: 0, faceSamples: 0, objectSamples: 0 }),
  events: eventsSchema,
});

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
  if (c.phoneEvents) notes.push(`Potential mobile phone observed ${times(c.phoneEvents)} (${c.phoneSeconds || 0} s in total)`);
  if (c.objectEvents) notes.push(`An object requiring attention was observed ${times(c.objectEvents)}`);
  if (c.faceDisappearances >= 3) notes.push(`Face repeatedly left the frame (${c.faceDisappearances} episodes)`);
  if (c.tooFarSeconds >= 8) notes.push(`Face was too small for reliable checks for about ${c.tooFarSeconds} s`);
  if (c.headMovementEvents >= 3) notes.push(`Repeated large head movements (${c.headMovementEvents} observations)`);
  if (c.cameraInterruptions) notes.push(`Camera interrupted ${times(c.cameraInterruptions)}; this can be a device or permission issue`);
  if (c.microphoneInterruptions) notes.push(`Microphone interrupted ${times(c.microphoneInterruptions)}; typed answers remain available`);
  if (c.copyAttempts) notes.push(`Used copy controls ${times(c.copyAttempts)}`);
  if (c.shortcutAttempts) notes.push(`Used a monitored browser shortcut ${times(c.shortcutAttempts)}`);
  return notes;
}

// What the interviewer is told about the latest answer, so they can react like a real one would.
export function reminderWorthy(counts) {
  if (!counts) return false;
  return counts.awayEvents > 0 || counts.multipleFaceEvents > 0 || counts.pasteAttempts > 0
    || counts.fullscreenExits > 0 || counts.noFaceSeconds >= 10 || counts.phoneEvents > 0;
}

// Looking away while thinking is normal, so it needs far more time than leaving the window does.
const REVIEW = { awayEvents: 3, awaySeconds: 30, noFaceSeconds: 30, lookAwaySeconds: 90, multipleFaceEvents: 1, pasteAttempts: 2, fullscreenExits: 2, phoneEvents: 3, phoneSeconds: 16, objectEvents: 3 };
const MINOR = { awayEvents: 1, awaySeconds: 2, noFaceSeconds: 5, lookAwaySeconds: 20, multipleFaceEvents: 1, pasteAttempts: 1, fullscreenExits: 1, phoneEvents: 1, tooFarSeconds: 8, faceDisappearances: 3, headMovementEvents: 3, copyAttempts: 1 };

export function summarizeIntegrity({ turns, finalTotals, faceChecks }) {
  const samples = turns.map((turn) => integritySchema.parse(turn.integrity || {}));
  const final = integritySchema.parse(finalTotals || {});
  // The browser's running totals also cover the time after the last answer; per-answer counts
  // are the fallback if the final totals never arrived.
  const summed = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, samples.reduce((sum, item) => sum + item[key], 0)]));
  const totals = Object.fromEntries(INTEGRITY_KEYS.map((key) => [key, Math.min(1_000_000, Math.max(summed[key], final[key]))]));
  const eventMap = new Map();
  for (const event of [...samples.flatMap((sample) => sample.events), ...final.events]) {
    const previous = eventMap.get(event.id);
    if (!previous || event.duration >= previous.duration) eventMap.set(event.id, event);
  }
  const events = [...eventMap.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-120);
  const severityCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, events.filter((event) => event.severity === severity).length]));
  const coverage = Object.fromEntries(Object.keys(final.coverage).map((key) => [key,
    Math.min(86_400_000, Math.max(final.coverage[key], samples.reduce((sum, sample) => sum + sample.coverage[key], 0))),
  ]));

  const over = (limits) => Object.entries(limits).some(([key, limit]) => totals[key] >= limit);
  const level = over(REVIEW) || severityCounts.SERIOUS_VIOLATION ? 'review' : over(MINOR) || severityCounts.SUSPICIOUS ? 'minor' : 'clean';

  return {
    level,
    faceChecks: Boolean(faceChecks || final.faceChecks || samples.some((sample) => sample.faceChecks)),
    phoneChecks: Boolean(final.phoneChecks || samples.some((sample) => sample.phoneChecks)),
    coverage,
    events,
    severityCounts,
    // This index summarizes observations, never ability, identity, or proof of misconduct.
    suspicionScore: Math.min(100, (level === 'review' ? 40 : level === 'minor' ? 10 : 0)
      + severityCounts.WARNING * 2 + severityCounts.SUSPICIOUS * 8 + severityCounts.SERIOUS_VIOLATION * 15),
    totals,
    notes: describeIntegrity(totals),
    flaggedQuestions: turns.filter((t) => describeIntegrity(t.integrity).length).map((t) => t.number),
  };
}
