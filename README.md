# AI Interviewer

Practise interviews for your next role, get feedback on your answers, and leave with a clear plan for what to improve.

**[Try AI Interviewer →](https://ai-interviewer-7eqv.onrender.com)**

No account needed. Enter any job role to begin; adding a CV or job description makes the questions more relevant. You can speak or type your answers.

## What you can do

- Practise HR, technical or mixed interviews with an AI panel.
- Start with a practice preset or customise the difficulty, panel and question count.
- Use the answer guide to prepare examples before your session.
- Get follow-up questions based on your responses, at your own pace.
- Review feedback, a full transcript and a preparation checklist. Save the report as PDF or text.
- Choose relaxed practice or optional camera and browser monitoring.

The feedback is for practice, not a hiring assessment. Sessions are temporary: save your report before leaving. Camera checks run on your device; submitted documents, answers and recorded audio are processed by the configured AI providers.

## Run locally

Requires **Node.js 22.12+** and npm.

```bash
git clone https://github.com/Rajat210804/ai-interviewer.git
cd ai-interviewer
npm ci --prefix backend
npm ci --prefix frontend
cp backend/.env.example backend/.env
```

Add `GROQ_API_KEY` or `GEMINI_API_KEY` to `backend/.env`. At least one is needed for live interviews; Groq is also used for audio transcription. Keep keys on the backend. See [the environment example](backend/.env.example) for model overrides.

Start these in separate terminals:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

The frontend runs on port 5173 and the API on port 3001. Camera and microphone features require localhost or HTTPS.

## Tests and production build

```bash
npm test             # offline backend and frontend tests
npm run build        # install dependencies and build the frontend
npm start            # serve the built app and API on port 3001
```

To try the UI without API keys, build the frontend and run `node backend/test/ui-server.js`. It serves deterministic test responses on port 4173. Optional live provider checks: `npm run check:ai --prefix backend`.

Built with React, Vite, Tailwind CSS, Node.js and Express. Interviews use Gemini and Groq; optional camera checks use TensorFlow.js. Vision models are included in the repository. [render.yaml](render.yaml) contains the Render deployment configuration.

## Contributing

Bug reports and focused pull requests are welcome. For a bug, include what you tried, what happened and your browser. Keep API keys and personal interview content out of issues.
