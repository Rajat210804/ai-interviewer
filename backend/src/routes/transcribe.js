import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxAudioBytes, files: 1 } });

// Server-side speech-to-text, used only by browsers without built-in speech recognition.
export function transcribeRouter(ai) {
  const router = Router();
  router.post('/', audioUpload.single('audio'), async (req, res) => {
    if (!req.file || !req.file.mimetype.startsWith('audio/')) {
      throw new AppError(400, 'No recording was received. Please try again.');
    }
    const text = await ai.transcribe(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ text });
  });
  return router;
}
