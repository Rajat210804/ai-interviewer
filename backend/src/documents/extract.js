import path from 'node:path';
import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { AppError } from '../errors.js';
import { ocrPrompt } from '../ai/prompts.js';
import { ocrSchema } from '../ai/schemas.js';

export const MAX_TEXT_CHARS = 20000;
export const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp'];

const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

// Decide the file type from its first bytes rather than trusting the extension or browser MIME type.
function detectType(buffer, extension) {
  const head = buffer.subarray(0, 12);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (head.subarray(0, 4).toString('latin1') === 'PK\x03\x04' && extension === '.docx') return 'docx';
  if (['.txt', '.md'].includes(extension) && !buffer.includes(0)) return 'txt';
  return null;
}

export async function extractText(file, ai, label) {
  const type = detectType(file.buffer, path.extname(file.originalname).toLowerCase());
  if (!type) {
    throw new AppError(415, 'Unsupported file. Please upload a PDF, DOCX, TXT, PNG, JPG or WEBP file.');
  }

  let text;
  if (type === 'pdf') {
    text = await readPdf(file.buffer);
    if (text.trim().length < 50) {
      throw new AppError(422, `This PDF has no selectable text (it may be a scan). Upload a photo or screenshot of the ${label} instead and we'll read it with OCR.`);
    }
  } else if (type === 'docx') {
    text = await mammoth.extractRawText({ buffer: file.buffer })
      .then((result) => result.value)
      .catch(() => { throw new AppError(422, "We couldn't read that Word document. Try saving it again or upload a PDF."); });
  } else if (type === 'txt') {
    text = file.buffer.toString('utf8');
  } else {
    const dataUrl = `data:${IMAGE_TYPES[type]};base64,${file.buffer.toString('base64')}`;
    const result = await ai.generate({
      route: 'ocr', label: 'ocr', ...ocrPrompt(label), images: [dataUrl],
      schema: ocrSchema, maxTokens: 6000, timeoutMs: 60000,
    });
    text = result.text;
  }

  return prepareText(text, label);
}

async function readPdf(buffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new AppError(422, "We couldn't read that PDF. It may be damaged or password protected.");
  }
}

export function prepareText(raw, label) {
  const text = String(raw || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .trim();
  if (text.length < 30) {
    throw new AppError(422, `The ${label} looks empty. Please check the file and try again.`);
  }
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS };
}
