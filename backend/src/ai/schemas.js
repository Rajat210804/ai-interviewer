import { z } from 'zod';

// Model output is untrusted: everything is validated, trimmed and length-capped before use.
const text = (max = 300) => z.string().transform((s) => s.trim().slice(0, max));
const optionalText = (max = 300) => text(max).default('');
// Models sometimes return [{ "name": "Python" }] where ["Python"] was asked for, so items are flattened to text.
const itemText = (item) =>
  typeof item === 'object' && item !== null
    ? Object.values(item).filter((v) => typeof v === 'string').join(' — ')
    : String(item ?? '');
const list = (maxItems = 25, maxLength = 200) =>
  z.array(z.any())
    .transform((items) => items.map((i) => itemText(i).trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems))
    .default([]);
const clamp = (min, max) => (n) => Math.max(min, Math.min(max, Math.round(n)));

export const CATEGORIES = ['intro', 'motivation', 'resume', 'behavioral', 'role', 'technical', 'scenario', 'candidate_questions'];
export const VERDICTS = ['strong', 'adequate', 'vague', 'weak', 'incorrect', 'no_answer', 'off_topic'];

export const cvSchema = z.object({
  is_cv: z.boolean().default(true),
  name: optionalText(80),
  headline: optionalText(300),
  education: z.array(z.object({
    institution: optionalText(200),
    degree: optionalText(200),
    period: optionalText(60),
    score: optionalText(60),
  })).max(8).default([]),
  skills: list(40),
  programming_languages: list(20),
  frameworks: list(25),
  tools: list(25),
  projects: z.array(z.object({
    name: text(150),
    summary: optionalText(600),
    technologies: list(15),
    claims: list(6, 300),
  })).max(12).default([]),
  experience: z.array(z.object({
    organization: optionalText(150),
    title: optionalText(150),
    period: optionalText(60),
    highlights: list(6, 300),
  })).max(12).default([]),
  certifications: list(15),
  achievements: list(10, 300),
  claims_to_probe: z.array(z.object({ claim: text(300), reason: optionalText(300) })).max(12).default([]),
});

export const jdSchema = z.object({
  is_jd: z.boolean().default(true),
  title: optionalText(150),
  company: optionalText(150),
  summary: optionalText(600),
  required_skills: list(30),
  preferred_skills: list(20),
  responsibilities: list(15, 300),
  qualifications: list(12, 300),
  tools: list(20),
  programming_languages: list(15),
  domain_knowledge: list(12),
  soft_skills: list(12),
  experience_requirements: optionalText(300),
});

export const planSchema = z.object({
  strong_matches: list(20),
  partial_matches: list(20),
  missing_skills: list(20),
  focus_areas: z.array(z.object({
    topic: text(150),
    why: optionalText(300),
    kind: z.enum(['resume', 'technical', 'role', 'behavioral', 'gap']).catch('technical'),
  })).min(1).max(20),
  company_style: optionalText(500),
});

export const ocrSchema = z.object({ text: text(30000) });

// The allowed moves change every turn (no follow-up once the budget is spent, no new question after the
// last slot), so this schema is built per call. A disallowed move fails validation and triggers a repair.
export function turnSchema(allowedMoves) {
  return z.object({
    assessment: z.object({
      score: z.coerce.number().transform(clamp(0, 10)).catch(5),
      verdict: z.enum(VERDICTS).catch('adequate'),
      strengths: list(4, 200),
      gaps: list(4, 200),
      incorrect_points: list(4, 250),
      topics: list(4, 80),
    }),
    move: z.enum(allowedMoves),
    reaction: optionalText(600),
    question: text(900).refine((q) => q.length > 0, 'question must not be empty'),
    category: z.enum(CATEGORIES).catch('technical'),
    topic: optionalText(120),
  });
}

// null means "this interview did not test it", which the report shows as "Not assessed".
const score100 = z
  .preprocess((v) => (v === null || v === undefined || v === '' ? null : Number(v)), z.number().nullable())
  .transform((v) => (v === null ? null : clamp(0, 100)(v)))
  .catch(null);

export const reportSchema = z.object({
  summary: text(1500),
  scores: z.object({
    overall: score100,
    communication: score100,
    technical: score100,
    problem_solving: score100,
    resume_credibility: score100,
    role_knowledge: score100,
    clarity: score100,
  }),
  strengths: list(8, 300),
  weaknesses: list(8, 300),
  technical_analysis: optionalText(1500),
  hr_analysis: optionalText(1500),
  resume_analysis: optionalText(1500),
  study_plan: z.array(z.object({
    topic: text(150),
    why: optionalText(300),
    how: optionalText(300),
  })).max(10).default([]),
  question_review: z.array(z.object({
    index: z.coerce.number().int(),
    good: optionalText(600),
    missing: optionalText(600),
    improve: optionalText(600),
    ideal_structure: optionalText(800),
  })).default([]),
  example_answers: z.array(z.object({
    index: z.coerce.number().int(),
    answer: text(2000),
  })).max(3).default([]),
});
