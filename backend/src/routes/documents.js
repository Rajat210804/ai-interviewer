import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { cvPrompt, jdPrompt } from '../ai/prompts.js';
import { cvSchema, jdSchema } from '../ai/schemas.js';
import { ALLOWED_EXTENSIONS, extractText, prepareText } from '../documents/extract.js';

const KINDS = {
  cv: { label: 'CV', prompt: cvPrompt, schema: cvSchema, looksRight: (p) => p.is_cv },
  jd: { label: 'job description', prompt: jdPrompt, schema: jdSchema, looksRight: (p) => p.is_jd },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  fileFilter: (req, file, done) => {
    const ok = ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase());
    done(ok ? null : new AppError(415, 'Unsupported file. Please upload a PDF, DOCX, TXT, PNG, JPG or WEBP file.'), ok);
  },
});

// POST /api/documents/cv or /api/documents/jd with either a file or pasted text.
export function documentsRouter(ai) {
  const router = Router();

  router.post('/:kind', upload.single('file'), async (req, res) => {
    const kind = KINDS[req.params.kind];
    if (!kind) throw new AppError(404, 'Unknown document type.');

    let document;
    if (req.file) {
      document = await extractText(req.file, ai, kind.label);
    } else if (req.body?.text?.trim()) {
      document = prepareText(req.body.text, kind.label);
    } else {
      throw new AppError(400, `Please upload your ${kind.label} or paste its text.`);
    }

    const profile = await ai.generate({
      route: 'analysis', label: `${req.params.kind} analysis`, ...kind.prompt(document.text),
      schema: kind.schema, maxTokens: 4000, timeoutMs: 60000,
    });
    if (!kind.looksRight(profile)) {
      throw new AppError(422, `This doesn't look like a ${kind.label}. Please check you uploaded the right document.`);
    }

    res.json({
      fileName: req.file?.originalname || null,
      characters: document.text.length,
      truncated: document.truncated,
      profile,
    });
  });

  return router;
}
