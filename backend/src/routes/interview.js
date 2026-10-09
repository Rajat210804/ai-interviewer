import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { cvSchema, jdSchema } from '../ai/schemas.js';
import { createInterviewEngine } from '../interview/engine.js';
import { integritySchema } from '../interview/integrity.js';

export const MAX_ANSWER_PART_CHARS = 64000;
const uploadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const expectedTurnSchema = z.number().int().min(1).max(160);

const cleanLine = (max) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u001f<>]/g, ''));

const startSchema = z.object({
  setup: z.object({
    company: cleanLine(80).default(''),
    role: cleanLine(80).pipe(z.string().min(2, 'Please enter the job role.')),
    candidateName: cleanLine(60).default(''),
    type: z.enum(['hr', 'technical', 'mixed']),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    length: z.number().int().min(5).max(40),
    proctored: z.boolean().default(false),
    panel: z.array(z.object({
      role: z.enum(['hr', 'tech', 'manager']),
      name: cleanLine(40).pipe(z.string().min(1)),
      avatarId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    })).min(1).max(3)
      .refine((panel) => new Set(panel.map((p) => p.role)).size === panel.length, 'Each interviewer needs a different role.'),
  }),
  // The profiles come back from /api/documents and are validated again, since the client can change them.
  cv: cvSchema.nullable().default(null),
  jd: jdSchema.nullable().default(null),
});

// Individual requests stay bounded; the assembled answer has no application
// length limit. Raw answer text is preserved, including whitespace and Unicode.
const answerSchema = z.object({
  expectedTurn: expectedTurnSchema.optional(),
  text: z.string().optional(),
  uploadId: uploadIdSchema.optional(),
  totalParts: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  answerCharacters: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  skipped: z.boolean().default(false),
  integrity: integritySchema.optional().catch(undefined),
}).refine((answer) => !answer.uploadId || (answer.expectedTurn !== undefined && answer.totalParts !== undefined && answer.answerCharacters !== undefined && answer.text === undefined && !answer.skipped),
  'A staged answer needs its question number and cannot also contain direct text or a skip.');

const answerPartSchema = z.object({
  uploadId: uploadIdSchema,
  expectedTurn: expectedTurnSchema,
  index: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  text: z.string().min(1).max(MAX_ANSWER_PART_CHARS),
});

const endSchema = z.object({
  integrity: integritySchema.extend({ faceChecks: z.boolean().catch(false) }).optional().catch(undefined),
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(400, `Some interview details are invalid: ${issue.message} (${issue.path.join('.')}).`);
  }
  return result.data;
}

export function interviewRouter(ai, engineOptions) {
  const router = Router();
  const engine = createInterviewEngine(ai, engineOptions);

  router.post('/start', async (req, res) => {
    res.json(await engine.start(parse(startSchema, req.body)));
  });

  router.post('/:id/answer', async (req, res) => {
    res.json(await engine.answer(req.params.id, parse(answerSchema, req.body)));
  });

  router.post('/:id/answer-parts', (req, res) => {
    res.json(engine.answerPart(req.params.id, parse(answerPartSchema, req.body)));
  });

  router.post('/:id/keep-alive', (req, res) => {
    res.json(engine.keepAlive(req.params.id));
  });

  router.post('/:id/end', async (req, res) => {
    res.json(await engine.end(req.params.id, parse(endSchema, req.body ?? {}).integrity));
  });

  return router;
}
