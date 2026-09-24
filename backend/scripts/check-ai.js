// Checks that the configured keys and models work, and how long a real CV analysis takes:
//   npm run check:ai
import { config } from '../src/config.js';
import { GeminiProvider, GroqProvider } from '../src/ai/providers.js';
import { parseAndValidate } from '../src/ai/index.js';
import { cvPrompt } from '../src/ai/prompts.js';
import { cvSchema } from '../src/ai/schemas.js';

const HINTS = {
  auth: 'the API key was rejected. Check the key and that it belongs to this provider.',
  billing: 'the account has no credit left. Top it up in the provider console, or remove this key and the app will run on the other provider alone.',
  model: 'the model is not available to this key. Set a different model in the environment (see README).',
  rate_limit: 'rate limited or over the free-tier quota. Wait a minute and try again.',
  server: 'the provider is overloaded right now. Try again later or pick a lighter model.',
  timeout: 'no response in time. The provider is very slow right now.',
  truncated: 'the reply ran past the output limit (the model may be repeating itself).',
  network: 'could not reach the API. Check your network or base URL.',
};

const SAMPLE_CV = `Aarav Mehta
Final-year B.Tech, Computer Science, Example Institute of Technology (2023-2027), CGPA 8.1/10
Experience: Data Engineering Intern, Example Analytics (May-Jul 2026). Built Python ETL jobs that load
sales data into PostgreSQL, cutting the daily report time from 3 hours to 20 minutes. Wrote SQL window-function
queries for monthly cohort retention.
Projects: Resume Screener - a Flask app that ranks resumes against a job description using TF-IDF and cosine
similarity; deployed on Render. Traffic Sign Classifier - a CNN in PyTorch with 97% validation accuracy on GTSRB.
Skills: Python, SQL, C++, pandas, scikit-learn, PyTorch, Flask, Git, Docker, Power BI, Excel.
Certifications: AWS Cloud Practitioner. Achievements: Top 5 in the college hackathon (2025).`;

const seconds = (start) => ((Date.now() - start) / 1000).toFixed(1);
const providers = [new GeminiProvider(config.gemini), new GroqProvider(config.groq)];

for (const provider of providers) {
  if (!provider.configured) {
    console.log(`${provider.name}: skipped (no API key set)`);
    continue;
  }

  let started = Date.now();
  try {
    await provider.chat({
      messages: [
        { role: 'system', content: 'Reply with a JSON object only.' },
        { role: 'user', content: 'Return {"ok": true}.' },
      ],
      maxTokens: 200,
      timeoutMs: 30000,
    });
    console.log(`${provider.name}: OK in ${seconds(started)}s using ${provider.model}`);
  } catch (err) {
    console.log(`${provider.name}: FAILED after ${seconds(started)}s, ${HINTS[err.kind] || err.message}`);
    console.log(`  details: ${err.message.slice(0, 300)}`);
    continue;
  }

  // The same CV analysis the app runs on upload. The app gives up after 25 seconds.
  started = Date.now();
  try {
    const { system, user } = cvPrompt(SAMPLE_CV);
    const reply = await provider.chat({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      maxTokens: 4000,
      timeoutMs: 90000,
    });
    const valid = parseAndValidate(reply, cvSchema).ok;
    console.log(`  CV analysis: ${seconds(started)}s, ${reply.length} characters, ${valid ? 'valid' : 'INVALID'} JSON`);
  } catch (err) {
    console.log(`  CV analysis: FAILED after ${seconds(started)}s, ${HINTS[err.kind] || err.message}`);
  }
}
