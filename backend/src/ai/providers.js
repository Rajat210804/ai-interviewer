// The base class speaks the OpenAI chat-completions protocol (used by Groq) and handles HTTP errors.
// GeminiProvider swaps in Gemini's own API; the rest of the app only ever calls chat().

export class ProviderError extends Error {
  constructor(provider, kind, message, retryAfterMs) {
    super(`${provider}: ${message}`);
    this.provider = provider;
    this.kind = kind; // auth | billing | rate_limit | too_large | model | bad_request | server | timeout | network | empty | truncated | invalid_json
    this.retryAfterMs = retryAfterMs;
  }
}

// Some providers report an empty account as HTTP 429, so the message decides before the status code.
// (Groq's normal rate-limit message links to its billing page, hence no plain "billing" match.)
const NO_CREDIT = /insufficient[ _]balance|insufficient_quota|exceeded_current_quota|suspended/i;
// Gemini answers a bad key with HTTP 400 rather than 401.
const BAD_KEY = /api key not valid|api_key_invalid/i;

function kindForStatus(status, body) {
  if (NO_CREDIT.test(body)) return 'billing';
  if (status === 401 || status === 403 || BAD_KEY.test(body)) return 'auth';
  if (status === 413 || /request too large/i.test(body)) return 'too_large';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server'; // includes Gemini's 503 "model is experiencing high demand"
  if (status === 404 || /model/i.test(body)) return 'model';
  return 'bad_request';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AIProvider {
  constructor({ name, apiKey, baseUrl, model, visionModel }) {
    Object.assign(this, { name, apiKey, baseUrl, model, visionModel: visionModel || model });
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  authHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  // Provider specific request fields (temperature rules, reasoning switches).
  tuning() {
    return {};
  }

  async chat({ messages, maxTokens = 2000, timeoutMs = 30000, vision = false, effort = 'low', json = true }) {
    const body = {
      model: vision ? this.visionModel : this.model,
      messages,
      max_tokens: maxTokens,
      ...this.tuning({ effort, vision }),
    };
    if (json) body.response_format = { type: 'json_object' };

    const res = await this.request('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content?.trim()) throw new ProviderError(this.name, 'empty', 'empty completion');
    return content;
  }

  async request(path, init, timeoutMs) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(this.baseUrl + path, {
          ...init,
          headers: { ...init.headers, ...this.authHeaders() },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const kind = err.name === 'TimeoutError' ? 'timeout' : 'network';
        throw new ProviderError(this.name, kind, err.message);
      }
      if (res.ok) return res;

      const body = await res.text().catch(() => '');
      const kind = kindForStatus(res.status, body);
      const retryAfterMs = Number(res.headers.get('retry-after')) * 1000 || 2000;
      // A short rate-limit pause is worth waiting for once; anything longer goes to the other provider.
      if (kind === 'rate_limit' && attempt === 1 && retryAfterMs <= 5000) {
        await sleep(retryAfterMs);
        continue;
      }
      throw new ProviderError(this.name, kind, `HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 300)}`, retryAfterMs);
    }
  }
}

// Gemini thinks before answering and those tokens count towards the output limit,
// so each request gets extra room on top of what the task itself needs.
const THINKING_HEADROOM = 8192;

// Uses Gemini's own generateContent API rather than its OpenAI-compatible layer, because
// responseMimeType is the documented way to guarantee a JSON reply.
export class GeminiProvider extends AIProvider {
  constructor({ fallbackModel, ...options }) {
    super({ name: 'gemini', ...options });
    this.fallbackModel = fallbackModel;
  }

  authHeaders() {
    return { 'x-goog-api-key': this.apiKey };
  }

  // Google's newest models are sometimes overloaded (HTTP 503 "high demand") or not enabled for a key.
  // A lighter Gemini model usually still answers, which is cheaper than falling back to another provider.
  async chat(options) {
    const models = [...new Set([this.model, this.fallbackModel].filter(Boolean))];
    for (const [i, model] of models.entries()) {
      try {
        return await this.generateWith(model, options);
      } catch (err) {
        const next = models[i + 1];
        if (!next || !['server', 'model'].includes(err.kind)) throw err;
        console.warn(`[ai] gemini ${model} unavailable (${err.kind}), trying ${next}`);
      }
    }
  }

  async generateWith(model, { messages, maxTokens = 2000, timeoutMs = 30000, json = true, effort = 'low' }) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const body = {
      contents: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content) })),
      generationConfig: {
        maxOutputTokens: maxTokens + THINKING_HEADROOM,
        ...(json && { responseMimeType: 'application/json' }),
        // Gemini 3 models think at "medium" by default, which can take a minute on a long CV.
        // Reading documents only needs "low"; the report asks for "medium".
        ...(model.startsWith('gemini-3') && { thinkingConfig: { thinkingLevel: effort } }),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await this.request(`/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new ProviderError(this.name, 'truncated', 'the reply hit the output limit before finishing');
    }
    const text = (candidate?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!text.trim()) {
      const reason = candidate?.finishReason || data.promptFeedback?.blockReason || 'no candidates';
      throw new ProviderError(this.name, 'empty', `no text in reply (${reason})`);
    }
    return text;
  }
}

// OpenAI-style message content (a string, or text and image_url parts) in Gemini's format.
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((part) => {
    if (part.type === 'text') return { text: part.text };
    const [, mimeType, data] = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/s);
    return { inlineData: { mimeType, data } };
  });
}

export class GroqProvider extends AIProvider {
  constructor({ whisperModel, ...options }) {
    super({ name: 'groq', ...options });
    this.whisperModel = whisperModel;
  }

  tuning({ effort, vision }) {
    const model = vision ? this.visionModel : this.model;
    if (model.startsWith('openai/gpt-oss')) {
      return { temperature: 0.6, reasoning_effort: effort, include_reasoning: false };
    }
    // Qwen models can think out loud; JSON mode needs that reasoning kept out of the content.
    if (model.includes('qwen')) return { temperature: 0.6, reasoning_format: 'hidden' };
    return { temperature: 0.6 };
  }

  async transcribe(audio, mimeType, fileName = 'answer.webm') {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), fileName);
    form.append('model', this.whisperModel);
    form.append('response_format', 'json');
    const res = await this.request('/audio/transcriptions', { method: 'POST', body: form }, 60000);
    const data = await res.json();
    return (data.text || '').trim();
  }
}
