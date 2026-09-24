import { config } from './config.js';
import { createAI } from './ai/index.js';
import { createApp } from './app.js';

const ai = createAI();
const app = createApp({ ai });

app.listen(config.port, () => {
  const { gemini, groq } = ai.status();
  console.log(`AI Interviewer listening on port ${config.port}`);
  console.log(`Providers: Gemini ${gemini ? 'configured' : 'missing'}, Groq ${groq ? 'configured' : 'missing'}`);
  if (!gemini && !groq) console.warn('Set GEMINI_API_KEY and/or GROQ_API_KEY, otherwise interviews cannot start.');
});
