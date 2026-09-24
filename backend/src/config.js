const env = process.env;

export const config = {
  port: Number(env.PORT) || 3001,
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: env.GEMINI_MODEL || 'gemini-3.8-flash',
    fallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
  },
  groq: {
    apiKey: env.GROQ_API_KEY,
    baseUrl: 'https://api.groq.com/openai/v1',
    model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    visionModel: env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
    whisperModel: env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
  },
  maxUploadBytes: 5 * 1024 * 1024,
  maxAudioBytes: 10 * 1024 * 1024,
};
