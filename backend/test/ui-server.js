// Serves the built frontend against the fake AI, for trying the UI without API keys or credits:
//   npm run build --prefix ../frontend && node test/ui-server.js
import { createApp } from '../src/app.js';
import { createFakeAI } from './fake-ai.js';

const port = Number(process.env.PORT) || 4173;
createApp({ ai: createFakeAI({ delayMs: 700 }), requestsPerMinute: 1000 }).listen(port, () => {
  console.log(`UI with fake interviewer on http://localhost:${port}`);
});
