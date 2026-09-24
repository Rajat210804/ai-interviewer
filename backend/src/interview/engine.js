import crypto from 'node:crypto';
import { AppError } from '../errors.js';
import { planPrompt, reportPrompt, turnPrompt } from '../ai/prompts.js';
import { planSchema, reportSchema, turnSchema } from '../ai/schemas.js';
import { ROLES, buildSlots, openingTurn } from './flow.js';

const FOLLOW_UPS = { easy: 1, medium: 2, hard: 3 };
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const WEAK_VERDICTS = new Set(['weak', 'incorrect', 'vague', 'no_answer', 'off_topic']);

// Sessions live in memory only: CV details are never written to disk and disappear
// when the interview ends, expires, or the server restarts.
export function createInterviewEngine(ai, { random = Math.random } = {}) {
  const sessions = new Map();

  setInterval(() => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.touchedAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 10 * 60 * 1000).unref();

  function load(id) {
    const session = sessions.get(id);
    if (!session) throw new AppError(404, 'This interview session has expired. Please start a new interview.');
    if (session.busy) throw new AppError(409, 'The interviewer is still responding. Please wait a moment.');
    session.touchedAt = Date.now();
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
      startedAt: Date.now(),
      touchedAt: Date.now(),
    };

    const firstName = (setup.candidateName || cv?.name || '').trim().split(/\s+/)[0];
    addTurn(session, { ...openingTurn({ panel, setup, firstName }, random), isFollowUp: false });

    sessions.set(session.id, session);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    return publicState(session);
  }

  async function answer(id, { text, skipped }) {
    const session = load(id);
    if (session.done) throw new AppError(409, 'This interview has already finished.');
    if (!skipped && !text) throw new AppError(400, 'Please give an answer or skip the question.');

    const turn = session.turns.at(-1);
    const slot = session.slots[session.slotIndex];
    const nextSlot = session.slots[session.slotIndex + 1];
    const allowedMoves = movesFor(session, slot, nextSlot);

    session.busy = true;
    try {
      const result = await ai.generate({
        route: 'live', label: 'turn',
        ...turnPrompt({ session, turn, answer: text, skipped, slot, nextSlot, allowedMoves }),
        schema: turnSchema(allowedMoves), maxTokens: 1800, timeoutMs: 25000, effort: 'medium',
      });
      // Only record the answer once the model has responded, so a failed call can simply be retried.
      turn.answer = skipped ? null : text;
      turn.assessment = result.assessment;
      track(session, turn);
      applyMove(session, result);
    } finally {
      session.busy = false;
    }
    return publicState(session);
  }

  async function end(id) {
    const session = load(id);
    const answered = session.turns.filter((t) => t.assessment);
    const meta = reportMeta(session, answered);

    if (!answered.some((t) => t.answer)) {
      sessions.delete(id);
      return { ...meta, insufficient: true };
    }

    session.busy = true;
    let report;
    try {
      report = await ai.generate({
        route: 'report', label: 'report', ...reportPrompt(session, answered),
        schema: reportSchema, maxTokens: Math.min(16000, 3000 + answered.length * 500), timeoutMs: 120000, effort: 'medium',
      });
    } finally {
      session.busy = false;
    }
    sessions.delete(id);
    return { ...meta, ...buildReport(session, answered, report) };
  }

  return { start, answer, end };
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

function reportMeta(session, answered) {
  const { company, role, type, difficulty } = session.setup;
  return {
    company, role, type, difficulty,
    durationSeconds: Math.round((Date.now() - session.startedAt) / 1000),
    questionsAnswered: answered.filter((t) => t.answer).length,
    questionsSkipped: answered.filter((t) => !t.answer).length,
    panel: session.panel.map(({ id, name, role }) => ({ id, name, title: ROLES[role].title })),
  };
}

function buildReport(session, answered, report) {
  const reviews = new Map(report.question_review.map((r) => [r.index, r]));
  const examples = new Map(report.example_answers.map((e) => [e.index, e.answer]));
  const { question_review, example_answers, ...rest } = report;

  return {
    ...rest,
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
      score: t.assessment.score,
      verdict: t.assessment.verdict,
      review: reviews.get(t.number) || null,
      exampleAnswer: examples.get(t.number) || null,
    })),
  };
}
