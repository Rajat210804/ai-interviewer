import crypto from 'node:crypto';
import { AppError } from '../errors.js';
import { planPrompt, reportPrompt, turnPrompt } from '../ai/prompts.js';
import { planSchema, reportSchema, turnSchema } from '../ai/schemas.js';
import { ROLES, buildSlots, openingTurn } from './flow.js';
import { describeIntegrity, reminderWorthy, summarizeIntegrity } from './integrity.js';

const FOLLOW_UPS = { easy: 1, medium: 2, hard: 3 };
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const WEAK_VERDICTS = new Set(['weak', 'incorrect', 'vague', 'no_answer', 'off_topic']);
const MAX_REMINDERS = 2; // a real interviewer mentions it once or twice, not after every answer
const REPORT_RETRY_MS = 5 * 60 * 1000;

// Sessions live in memory only: CV details are never written to disk and disappear
// when the interview ends, expires, or the server restarts.
export function createInterviewEngine(ai, { random = Math.random, now = () => Date.now(), sessionTtlMs = SESSION_TTL_MS } = {}) {
  const sessions = new Map();
  const completedReports = new Map();

  setInterval(() => {
    for (const [id, session] of sessions) {
      if (!session.busy && now() - session.touchedAt > sessionTtlMs) sessions.delete(id);
    }
    for (const [id, result] of completedReports) {
      if (result.expiresAt <= now()) completedReports.delete(id);
    }
  }, 10 * 60 * 1000).unref();

  function load(id, { allowBusy = false } = {}) {
    const session = sessions.get(id);
    if (!session || (!session.busy && now() - session.touchedAt > sessionTtlMs)) {
      sessions.delete(id);
      throw new AppError(404, 'This interview session has expired. Please start a new interview.');
    }
    if (session.busy && !allowBusy) throw new AppError(409, 'The interviewer is still responding. Please wait a moment.');
    session.touchedAt = now();
    return session;
  }

  async function start({ setup, cv, jd }) {
    const plan = await ai.generate({
      route: 'analysis', label: 'plan', ...planPrompt(setup, cv, jd),
      schema: planSchema, maxTokens: 2500, timeoutMs: 25000,
    });

    const panel = setup.panel.map((seat, i) => ({ id: `i${i + 1}`, ...seat }));
    const session = {
      id: crypto.randomUUID(),
      setup, cv, jd, plan, panel,
      slots: buildSlots(setup.type, setup.length, panel, random),
      slotIndex: 0,
      followUps: 0,
      maxFollowUps: FOLLOW_UPS[setup.difficulty],
      turns: [],
      covered: [],
      strong: [],
      weak: [],
      done: false,
      closing: null,
      reminders: 0,
      startedAt: now(),
      touchedAt: now(),
      answerUpload: null,
    };

    const firstName = (setup.candidateName || cv?.name || '').trim().split(/\s+/)[0];
    addTurn(session, { ...openingTurn({ panel, setup, firstName }, random), isFollowUp: false });

    sessions.set(session.id, session);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    return publicState(session);
  }

  function keepAlive(id) {
    load(id, { allowBusy: true });
    return { ok: true };
  }

  const fingerprint = (text) => crypto.createHash('sha256').update(text, 'utf16le').digest('hex');
  function answerPart(id, { uploadId, expectedTurn, index, text }) {
    const session = load(id);
    const previous = session.turns.find((turn) => turn.number === expectedTurn);
    if (previous?.assessment) {
      const part = previous.answerUpload?.parts[index];
      if (previous.answerUpload?.uploadId === uploadId && part?.hash === fingerprint(text) && part.characters === text.length) {
        return { uploadId, expectedTurn, index, nextIndex: previous.answerUpload.parts.length, acceptedCharacters: previous.answer.length, duplicate: true };
      }
      throw new AppError(409, 'That question has already been answered. Please continue with the current question.');
    }
    if (session.done || expectedTurn !== session.turns.at(-1)?.number) {
      throw new AppError(409, 'The interview has moved to a different question. Please refresh your interview state.');
    }
    let upload = session.answerUpload;
    if (!upload || upload.uploadId !== uploadId) {
      if (index !== 0) throw new AppError(409, 'Start this answer upload with its first part.');
      upload = { uploadId, expectedTurn, parts: [], fingerprints: [], characters: 0 };
      // Only one unfinished answer is held per session. A new first part replaces
      // abandoned staging while completed raw answers remain on their turns.
      session.answerUpload = upload;
    }
    if (upload.expectedTurn !== expectedTurn || index > upload.parts.length) {
      throw new AppError(409, 'Answer parts arrived out of order. Retry the next expected part.');
    }
    const hash = fingerprint(text);
    const duplicate = index < upload.parts.length;
    if (duplicate && (upload.fingerprints[index].hash !== hash || upload.parts[index] !== text)) {
      throw new AppError(409, 'That answer part has already been accepted with different text. Start a new upload to change your answer.');
    }
    if (!duplicate) {
      upload.parts.push(text);
      upload.fingerprints.push({ hash, characters: text.length });
      upload.characters += text.length;
    }
    return { uploadId, expectedTurn, index, nextIndex: upload.parts.length, acceptedCharacters: upload.characters, duplicate };
  }

  async function answer(id, { text = '', uploadId, totalParts, answerCharacters, skipped = false, integrity, expectedTurn }) {
    const session = load(id);
    // A response may be lost after the model finishes. Replaying that exact turn
    // returns the current state instead of submitting the answer to the next question.
    if (expectedTurn !== undefined) {
      const previous = session.turns.find((turn) => turn.number === expectedTurn);
      if (previous?.assessment) {
        if (uploadId ? previous.answerUpload?.uploadId === uploadId && previous.answerUpload.parts.length === totalParts && previous.answer.length === answerCharacters : skipped ? previous.answer === null : previous.answer === text) return publicState(session);
        throw new AppError(409, 'That question has already been answered. Please continue with the current question.');
      }
      if (expectedTurn !== session.turns.at(-1)?.number) {
        throw new AppError(409, 'The interview has moved to a different question. Please refresh your interview state.');
      }
    }
    if (session.done) throw new AppError(409, 'This interview has already finished.');
    const upload = uploadId ? session.answerUpload : null;
    if (uploadId && (!upload || upload.uploadId !== uploadId || upload.expectedTurn !== expectedTurn)) {
      throw new AppError(409, 'This answer upload is unavailable. Upload the answer parts again before submitting.');
    }
    if (upload && (upload.parts.length !== totalParts || upload.characters !== answerCharacters)) {
      throw new AppError(409, 'The answer upload is incomplete. Retry the missing parts before submitting.');
    }
    if (upload) text = upload.parts.join('');
    if (!skipped && !text.trim()) throw new AppError(400, 'Please give an answer or skip the question.');

    const turn = session.turns.at(-1);
    const slot = session.slots[session.slotIndex];
    const nextSlot = session.slots[session.slotIndex + 1];
    const allowedMoves = movesFor(session, slot, nextSlot);
    const proctoring = session.setup.proctored && session.reminders < MAX_REMINDERS && reminderWorthy(integrity)
      ? describeIntegrity(integrity)
      : [];

    session.busy = true;
    try {
      const { answerContext, ...prompt } = turnPrompt({ session, turn, answer: text, skipped, slot, nextSlot, allowedMoves, proctoring });
      const result = await ai.generate({
        route: 'live', label: 'turn',
        ...prompt,
        schema: turnSchema(allowedMoves), maxTokens: 1800, timeoutMs: 25000, effort: 'medium',
      });
      // Only record the answer once the model has responded, so a failed call can simply be retried.
      turn.answer = skipped ? null : text;
      turn.answerContext = answerContext;
      if (upload) turn.answerUpload = { uploadId: upload.uploadId, parts: upload.fingerprints };
      session.answerUpload = null;
      turn.assessment = result.assessment;
      turn.integrity = session.setup.proctored ? integrity || null : null;
      if (proctoring.length) session.reminders++;
      track(session, turn);
      applyMove(session, result);
    } finally {
      session.busy = false;
      session.touchedAt = now();
    }
    return publicState(session);
  }

  async function end(id, finalIntegrity) {
    const cached = completedReports.get(id);
    if (cached?.expiresAt > now()) return cached.report;
    completedReports.delete(id);
    const session = load(id);
    const answered = session.turns.filter((t) => t.assessment);
    const meta = reportMeta(session, answered, now());
    if (session.setup.proctored) {
      meta.integrity = summarizeIntegrity({ turns: answered, finalTotals: finalIntegrity, faceChecks: finalIntegrity?.faceChecks });
    }

    if (!answered.some((t) => t.answer)) {
      sessions.delete(id);
      return saveReport(id, { ...meta, insufficient: true });
    }

    session.busy = true;
    let report;
    const { evaluationCoverage, ...prompt } = reportPrompt(session, answered);
    try {
      report = await ai.generate({
        route: 'report', label: 'report', ...prompt,
        schema: reportSchema, maxTokens: Math.min(16000, 3000 + answered.length * 500), timeoutMs: 120000, effort: 'medium',
      });
    } finally {
      session.busy = false;
      session.touchedAt = now();
    }
    sessions.delete(id);
    return saveReport(id, { ...meta, ...buildReport(session, answered, report, evaluationCoverage) });
  }

  function saveReport(id, report) {
    completedReports.set(id, { report, expiresAt: now() + REPORT_RETRY_MS });
    if (completedReports.size > MAX_SESSIONS) completedReports.delete(completedReports.keys().next().value);
    return report;
  }

  return { start, answer, answerPart, keepAlive, end };
}

function movesFor(session, slot, nextSlot) {
  if (slot.category === 'candidate_questions' || !nextSlot) return ['close'];
  return session.followUps < session.maxFollowUps ? ['follow_up', 'next_question'] : ['next_question'];
}

function addTurn(session, turn) {
  session.turns.push({ number: session.turns.length + 1, answer: null, assessment: null, ...turn });
}

function track(session, turn) {
  const { verdict, score, topics } = turn.assessment;
  const topic = turn.topic || turn.category;
  const remember = (list, value) => {
    if (value && !list.includes(value)) list.push(value);
  };
  remember(session.covered, topic);
  topics.forEach((t) => remember(session.covered, t));
  if (verdict === 'strong' || score >= 8) remember(session.strong, topic);
  if (WEAK_VERDICTS.has(verdict) || score <= 4) remember(session.weak, topic);
}

function applyMove(session, result) {
  const current = session.turns.at(-1);
  const spoken = { reaction: result.reaction, question: result.question };

  if (result.move === 'follow_up') {
    session.followUps++;
    addTurn(session, { ...spoken, interviewer: current.interviewer, category: current.category, topic: result.topic || current.topic, isFollowUp: true });
  } else if (result.move === 'next_question') {
    session.slotIndex++;
    session.followUps = 0;
    const slot = session.slots[session.slotIndex];
    addTurn(session, { ...spoken, interviewer: slot.interviewer, category: slot.category, topic: result.topic, isFollowUp: false });
  } else {
    session.done = true;
    session.closing = { interviewer: current.interviewer, reaction: result.reaction, message: result.question };
  }
}

function publicState(session) {
  const turn = session.done ? null : session.turns.at(-1);
  return {
    sessionId: session.id,
    panel: session.panel.map(({ id, role, name, avatarId }) => ({ id, role, name, avatarId, title: ROLES[role].title })),
    turn: turn && {
      number: turn.number,
      interviewer: turn.interviewer,
      category: turn.category,
      isFollowUp: turn.isFollowUp,
      reaction: turn.reaction,
      question: turn.question,
    },
    closing: session.closing,
    progress: { current: session.slotIndex + 1, total: session.slots.length },
    done: session.done,
  };
}

function reportMeta(session, answered, at) {
  const { company, role, type, difficulty } = session.setup;
  return {
    company, role, type, difficulty,
    durationSeconds: Math.round((at - session.startedAt) / 1000),
    questionsAnswered: answered.filter((t) => t.answer).length,
    questionsSkipped: answered.filter((t) => !t.answer).length,
    panel: session.panel.map(({ id, name, role }) => ({ id, name, title: ROLES[role].title })),
  };
}

function buildReport(session, answered, report, evaluationCoverage) {
  const reviews = new Map(report.question_review.map((r) => [r.index, r]));
  const examples = new Map(report.example_answers.map((e) => [e.index, e.answer]));
  const { question_review, example_answers, ...rest } = report;
  const contexts = new Map(evaluationCoverage.questions.map((context) => [context.number, context]));
  const { questions: _contexts, ...coverage } = evaluationCoverage;

  return {
    ...rest,
    contextLimited: coverage.contextLimited,
    evaluationCoverage: coverage,
    matches: {
      strong: session.plan.strong_matches,
      partial: session.plan.partial_matches,
      missing: session.plan.missing_skills,
    },
    questions: answered.map((t) => ({
      number: t.number,
      category: t.category,
      isFollowUp: t.isFollowUp,
      interviewer: t.interviewer,
      question: t.question,
      answer: t.answer,
      answerCharacters: t.answer?.length || 0,
      contextCharacters: contexts.get(t.number)?.contextCharacters || 0,
      reportContextCharacters: contexts.get(t.number)?.contextCharacters || 0,
      liveContextCharacters: t.answerContext?.contextCharacters || 0,
      contextLimited: Boolean(t.answerContext?.contextLimited || contexts.get(t.number)?.contextLimited),
      integrityFlags: describeIntegrity(t.integrity),
      score: t.assessment.score,
      verdict: t.assessment.verdict,
      review: reviews.get(t.number) || null,
      exampleAnswer: examples.get(t.number) || null,
    })),
  };
}
