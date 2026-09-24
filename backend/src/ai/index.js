import { config } from '../config.js';
import { AppError } from '../errors.js';
import { GeminiProvider, GroqProvider } from './providers.js';

const BENCH_MS = 10 * 60 * 1000;

// Which provider goes first for each kind of work. The second one is only used if the first fails.
// Gemini reads long documents and images and writes the final report; Groq keeps the live conversation fast.
const ROUTES = {
  analysis: ['gemini', 'groq'],
  ocr: ['gemini', 'groq'],
  live: ['groq', 'gemini'],
  report: ['gemini', 'groq'],
};

export function createAI(providers = {
  gemini: new GeminiProvider(config.gemini),
  groq: new GroqProvider(config.groq),
}) {
  // A rejected key or an empty account won't fix itself in seconds, so that provider is skipped
  // for a while instead of adding a failed round trip to every call.
  const benchedUntil = new Map();

  async function generate({ route, system, user, schema, images = [], maxTokens, timeoutMs, effort, label = route }) {
    const configured = ROUTES[route].map((name) => providers[name]).filter((p) => p?.configured);
    if (!configured.length) {
      throw new AppError(503, "The AI interviewer isn't configured yet. Add GEMINI_API_KEY or GROQ_API_KEY on the server.");
    }
    const available = configured.filter((p) => !(benchedUntil.get(p.name) > Date.now()));
    const candidates = available.length ? available : configured;

    const failures = [];
    for (const provider of candidates) {
      try {
        return await generateWith(provider, { system, user, schema, images, maxTokens, timeoutMs, effort });
      } catch (err) {
        console.warn(`[ai] ${label} via ${provider.name} failed (${err.kind || 'error'}): ${err.message}`);
        if (err.kind === 'auth' || err.kind === 'billing') benchedUntil.set(provider.name, Date.now() + BENCH_MS);
        failures.push(err);
      }
    }
    throw userFacingError(failures);
  }

  async function transcribe(audio, mimeType, fileName) {
    if (!providers.groq?.configured) {
      throw new AppError(503, "Voice transcription isn't available right now. Please type your answer.");
    }
    try {
      return await providers.groq.transcribe(audio, mimeType, fileName);
    } catch (err) {
      console.warn(`[ai] transcription failed (${err.kind || 'error'}): ${err.message}`);
      throw new AppError(502, "We couldn't transcribe that recording. Please try again or type your answer.");
    }
  }

  const status = () => ({ gemini: Boolean(providers.gemini?.configured), groq: Boolean(providers.groq?.configured) });

  return { generate, transcribe, status };
}

async function generateWith(provider, { system, user, schema, images, maxTokens, timeoutMs, effort }) {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : user;
  const messages = [{ role: 'system', content: system }, { role: 'user', content }];
  const options = { maxTokens, timeoutMs, effort, vision: images.length > 0 };

  let raw = await provider.chat({ messages, ...options });
  let result = parseAndValidate(raw, schema);
  if (result.ok) return result.data;

  // One repair round on the same provider: show the model its answer and what was wrong with it.
  messages.push(
    { role: 'assistant', content: raw },
    { role: 'user', content: `That JSON is not valid for this task: ${result.error}. Reply with the corrected JSON object only.` },
  );
  raw = await provider.chat({ messages, ...options });
  result = parseAndValidate(raw, schema);
  if (result.ok) return result.data;

  const err = new Error(result.error);
  err.kind = 'invalid_json';
  throw err;
}

export function parseAndValidate(raw, schema) {
  let value;
  try {
    value = JSON.parse(stripFences(raw));
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    try {
      value = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { ok: false, error: 'the response was not parseable JSON' };
    }
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`);
  return { ok: false, error: issues.join('; ') };
}

const stripFences = (text) => text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

function userFacingError(failures) {
  const kinds = failures.map((f) => f.kind);
  if (kinds.includes('rate_limit')) {
    return new AppError(429, 'The interviewer is handling too many requests right now. Wait a few seconds and try again.');
  }
  if (kinds.includes('timeout')) {
    return new AppError(504, 'The interviewer took too long to respond. Please try again.');
  }
  if (kinds.every((k) => k === 'auth' || k === 'billing')) {
    return new AppError(502, kinds.includes('billing')
      ? 'The AI service account behind this app has run out of credit. Please try again later.'
      : 'The AI service rejected the server credentials. Check the API keys configured on the server.');
  }
  if (kinds.includes('too_large')) {
    return new AppError(502, "This is more than the AI service's current plan allows in one request. Try a shorter document or interview.");
  }
  if (kinds.includes('invalid_json')) {
    return new AppError(502, 'The interviewer gave an unreadable response. Please try again.');
  }
  return new AppError(502, "We couldn't connect to the interviewer right now. Please try again.");
}
