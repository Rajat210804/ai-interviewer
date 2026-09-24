import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { cvSchema, jdSchema } from '../ai/schemas.js';
import { createInterviewEngine } from '../interview/engine.js';

const cleanLine = (max) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u001f<>]/g, ''));

const startSchema = z.object({
  setup: z.object({
    company: cleanLine(80).default(''),
    role: cleanLine(80).pipe(z.string().min(2, 'Please enter the job role.')),
    candidateName: cleanLine(60).default(''),
    type: z.enum(['hr', 'technical', 'mixed']),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    length: z.number().int().min(5).max(40),
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

const answerSchema = z.object({
  text: z.string().trim().max(6000).default(''),
  skipped: z.boolean().default(false),
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(400, `Some interview details are invalid: ${issue.message} (${issue.path.join('.')}).`);
  }
  return result.data;
}

export function interviewRouter(ai) {
  const router = Router();
  const engine = createInterviewEngine(ai);

  router.post('/start', async (req, res) => {
    res.json(await engine.start(parse(startSchema, req.body)));
  });

  router.post('/:id/answer', async (req, res) => {
    res.json(await engine.answer(req.params.id, parse(answerSchema, req.body)));
  });

  router.post('/:id/end', async (req, res) => {
    res.json(await engine.end(req.params.id));
  });

  return router;
}
