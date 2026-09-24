import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './errors.js';
import { documentsRouter } from './routes/documents.js';
import { interviewRouter } from './routes/interview.js';
import { transcribeRouter } from './routes/transcribe.js';

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export function createApp({ ai, requestsPerMinute = 60 }) {
  const app = express();
  app.set('trust proxy', 1); // Render terminates TLS in front of the app
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }));

  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: requestsPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a minute and try again.' },
  }));
  app.use(express.json({ limit: '300kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, providers: ai.status() }));
  app.use('/api/documents', documentsRouter(ai));
  app.use('/api/interview', interviewRouter(ai));
  app.use('/api/transcribe', transcribeRouter(ai));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // In production the backend also serves the built React app.
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false, maxAge: '1d' }));
    app.get(/.*/, (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
