// Quick check that the configured keys and models work: npm run check:ai
import { config } from '../src/config.js';
import { GeminiProvider, GroqProvider } from '../src/ai/providers.js';

const HINTS = {
  auth: 'the API key was rejected. Check the key and that it belongs to this provider.',
  billing: 'the account has no credit left. Top it up in the provider console, or remove this key and the app will run on the other provider alone.',
  model: 'the model is not available to this key. Set a different model in the environment (see README).',
  rate_limit: 'rate limited or over the free-tier quota. Wait a minute and try again.',
  timeout: 'no response in time. Check your network.',
  network: 'could not reach the API. Check your network or base URL.',
};

const providers = [new GeminiProvider(config.gemini), new GroqProvider(config.groq)];

for (const provider of providers) {
  if (!provider.configured) {
    console.log(`${provider.name}: skipped (no API key set)`);
    continue;
  }
  const started = Date.now();
  try {
    const reply = await provider.chat({
      messages: [
        { role: 'system', content: 'Reply with a JSON object only.' },
        { role: 'user', content: 'Return {"ok": true}.' },
      ],
      maxTokens: 200,
      timeoutMs: 30000,
    });
    console.log(`${provider.name}: OK in ${Date.now() - started} ms using ${provider.model}. Reply: ${reply.trim().slice(0, 80)}`);
  } catch (err) {
    console.log(`${provider.name}: FAILED, ${HINTS[err.kind] || err.message}`);
    console.log(`  details: ${err.message}`);
  }
}
