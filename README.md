# AI Interviewer

A virtual interview room that reads your CV and the job description, then runs a realistic interview with a panel of one to three AI interviewers. They ask one question at a time, follow up on vague or shaky answers, challenge claims on your CV, and finish with a detailed debrief.

It runs as a single Node service: an Express API that also serves the React app. It is built to deploy on Render.

## Features

1. **Interview setup.** Enter the company, role and your name, then upload a CV and a JD as PDF, DOCX, TXT or an image, or paste them in. Both are optional; the interview adapts to whatever you give it.
2. **Document analysis on upload.** The CV and JD are analysed as soon as you add them, so they are usually ready before you finish choosing settings.
3. **Interview types:** HR, Technical or Mixed. **Difficulties:** Easy, Medium or Hard, and the difficulty changes the reasoning depth and how hard the panel pushes, not just a label. **Lengths:** 10, 20 or 30 planned questions.
4. **Panels of 1 to 3 interviewers**, each with its own role (HR Manager, Technical Lead, Hiring Manager), personality, voice and photo avatar.
5. **Video-call style interview room:** a main speaker tile, a filmstrip, your optional camera preview, captions, and mute, camera, voice and end controls.
6. **Voice or text answers.** Speech recognition runs in the browser (Chrome and Edge), with a Groq Whisper fallback for other browsers and a text box everywhere.
7. **Dynamic questions.** Each question is generated after your previous answer, so follow-ups build on what you actually said.
8. **Debrief dashboard:** an overall score, six skill dimensions, a chart of scores by question, strengths and weak areas, and technical, HR and resume analysis. It also shows your CV against the role, a study plan, a question-by-question review with an ideal answer structure, and example stronger answers. You can save it as a PDF.

## Architecture

```
Browser (React)                           Express server                       Model providers
─────────────────                         ─────────────────                    ───────────────
Setup ── upload CV / JD ───────────────▶  POST /api/documents/:kind  ──┐
                                            extract text (PDF, DOCX,   │
                                            TXT, image OCR) + analyse  ├──▶  AI layer ──▶ Gemini (analysis, OCR, report)
Preparing ── start ────────────────────▶  POST /api/interview/start   │     createAI()    Groq  (live turns, Whisper)
                                            plan + opening question    │     fallback to the other
Interview room ── each answer ─────────▶  POST /api/interview/:id/answer   provider if one fails
                                            assess + next question     │
Debrief ◀── report ─────────────────────  POST /api/interview/:id/end ┘
```

API keys exist only on the server. The browser only ever talks to `/api/*`.

## Tech stack

| Part | Choice |
| --- | --- |
| Frontend | React 19, Vite 8, Tailwind CSS 4, lucide-react icons |
| Backend | Node 22, Express 5, zod for validation, multer for uploads, helmet and express-rate-limit |
| Documents | unpdf (PDF), mammoth (DOCX), vision model OCR (images) |
| AI | Google Gemini and Groq behind one provider layer (Gemini's own API, Groq's OpenAI-compatible API) |
| Voice | Browser SpeechSynthesis and SpeechRecognition, with Groq Whisper as the fallback |
| Storage | None. Sessions live in memory and are deleted when the interview ends |

## Project structure

```
ai-interviewer/
├── package.json            build and start scripts used by Render
├── render.yaml             Render blueprint
├── backend/
│   ├── src/
│   │   ├── server.js       starts the app
│   │   ├── app.js          Express setup, security headers, routes, static frontend
│   │   ├── config.js       environment variables
│   │   ├── errors.js       user-safe errors and the error handler
│   │   ├── ai/
│   │   │   ├── providers.js  AIProvider, GeminiProvider, GroqProvider
│   │   │   ├── index.js      routing between providers, fallback, JSON repair
│   │   │   ├── prompts.js    CV, JD, OCR, plan, interview turn and report prompts
│   │   │   └── schemas.js    zod schemas for every model response
│   │   ├── documents/extract.js   file type detection and text extraction
│   │   ├── interview/
│   │   │   ├── flow.js     panel roles, question plan, opening lines
│   │   │   └── engine.js   session state, turns, follow-ups, report
│   │   └── routes/         documents, interview, transcribe
│   ├── scripts/check-ai.js checks that your keys and models work
│   └── test/               unit and API tests with a fake AI
└── frontend/
    └── src/
        ├── App.jsx         screen flow: setup, preparing, interview, report
        ├── api.js          fetch wrapper with friendly errors
        ├── data/panel.js   avatars, roles, options
        ├── hooks/          document analysis, speech, camera
        └── components/     setup, interview room, report and shared UI
```

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | One of the two keys | | Google AI Studio key |
| `GROQ_API_KEY` | One of the two keys | | Groq key (also needed for the Whisper fallback) |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Gemini model for documents, images and the report |
| `GEMINI_FALLBACK_MODEL` | No | `gemini-3.5-flash-lite` | Used automatically when the main Gemini model is overloaded or unavailable |
| `AI_PRIMARY` | No | `gemini` | Set to `groq` to have Groq read documents and write the report first (Gemini still reads images and stays as the backup) |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | Groq chat model |
| `GROQ_VISION_MODEL` | No | `qwen/qwen3.8-27b` | Groq model for reading images |
| `GROQ_WHISPER_MODEL` | No | `whisper-large-v3-turbo` | Speech-to-text fallback |
| `PORT` | No | `3001` | Render sets this automatically |

With both keys set, each provider covers for the other. With one key, everything runs on that provider. Voice fallback for non-Chrome browsers needs the Groq key.

## Local setup

You need Node 22.12 or newer.

```bash
git clone <your repo> ai-interviewer
cd ai-interviewer
npm install --prefix backend
npm install --prefix frontend
cp backend/.env.example backend/.env    # then paste your keys into backend/.env
npm run check:ai --prefix backend       # confirms both keys and models respond
```

### Running the backend

```bash
npm run dev --prefix backend
```

This starts the API on http://localhost:3001 and restarts on file changes. It reads `backend/.env`.

### Running the frontend

In a second terminal:

```bash
npm run dev --prefix frontend
```

Open http://localhost:5173. Vite forwards `/api` requests to the backend on port 3001.

### Running it like production

```bash
npm run build     # installs both parts and builds the frontend
npm start         # Express serves the API and the built app on one port
```

## API configuration

Both providers are called through `backend/src/ai`. The rest of the app only calls `ai.generate({ route, system, user, schema })`.

| Route | First choice | Fallback | Used for |
| --- | --- | --- | --- |
| `analysis` | Gemini | Groq | CV analysis, JD analysis, interview plan |
| `ocr` | Gemini | Groq | Reading CV or JD images |
| `live` | Groq | Gemini | Assessing each answer and writing the next question |
| `report` | Gemini | Groq | The final debrief |

**Why this split:** Gemini handles long documents, images and long-form judgement well, so it reads the CV and JD and writes the debrief. Groq is very fast, so it runs the live conversation, where a few seconds of delay would break the feeling of a real interview.

**How a call works:**

1. Every call uses JSON mode.
2. The response is parsed and validated with a zod schema. If it doesn't match, the same provider gets one repair attempt, with the validation errors attached.
3. If that still fails, or the provider times out, rate-limits, rejects the key or doesn't have the model, the other provider is tried once.

A normal call is a single request; nothing is sent twice unless something failed.

API endpoints:

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Which providers are configured (used by the UI and Render's health check) |
| `POST /api/documents/cv` and `/api/documents/jd` | Multipart `file` or `text`; returns the structured profile |
| `POST /api/interview/start` | Setup plus the CV and JD profiles; returns the session, panel and opening question |
| `POST /api/interview/:id/answer` | `{ text, skipped }`; returns the next question or the closing remarks |
| `POST /api/interview/:id/end` | Returns the debrief and deletes the session |
| `POST /api/transcribe` | Multipart `audio`; Whisper transcription for browsers without speech recognition |

## Render deployment

### Option 1: Blueprint (recommended)

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and select the repository. Render reads `render.yaml`.
3. When prompted, paste `GEMINI_API_KEY` and `GROQ_API_KEY`. They are stored as secrets and never committed.
4. Deploy. Render runs `npm run build`, then `npm start`, and checks `/api/health`.

### Option 2: Manual web service

1. **New → Web Service**, connect the repository, runtime **Node**.
2. Build command: `npm run build`
3. Start command: `npm start`
4. Environment: add `GEMINI_API_KEY`, `GROQ_API_KEY` and `NODE_VERSION=22`.
5. Health check path: `/api/health`

No source changes are needed to deploy. Render's free plan has no shell, so check your keys on your own machine with `npm run check:ai --prefix backend` before deploying. After deploying, open `https://<your-app>.onrender.com/api/health`; both providers should show `true`.

## How the interview engine works

The engine (`backend/src/interview/engine.js`) keeps one session per interview. The session holds the setup, the CV and JD profiles, the plan, the panel, every question and answer with its private assessment, the topics already covered, and the strong and weak areas seen so far.

**The code decides the shape of the interview; the model decides the words.**

1. `flow.js` builds a plan of question slots when the interview starts. It always opens with an introduction and ends with your questions for the panel. The middle is split across categories (resume, behavioural, role, technical, scenario, motivation) according to the interview type. The order is shuffled a little each time, so no two interviews follow the same sequence.
2. Each slot is owned by the interviewer whose role fits it. Technical questions go to the Technical Lead, behavioural ones to HR, and resume questions alternate between the Hiring Manager and the Technical Lead.
3. After each answer, one model call does two jobs. It privately scores the answer (0 to 10, with a verdict, gaps and anything technically wrong) and writes what the panel says next.
4. The model can only choose moves the plan allows. It may follow up (Easy allows 1 follow-up per question, Medium 2, Hard 3), move to the next planned question, or close the interview. A move outside the allowed set fails schema validation and is repaired, so the interview can't drift off its plan.
5. The prompt tells the interviewer to probe vague answers ("What exactly did you implement yourself?"), verify impressive claims with concrete questions, challenge wrong statements, and avoid chatbot praise.
6. When the interview ends, the full transcript and the live assessments go to the report prompt. Its output is merged with the real questions and answers, which come from the session rather than from the model, and the session is deleted.

## How CV and JD analysis works

1. The file type is detected from the file's first bytes, not from its name. Anything other than PDF, DOCX, TXT, PNG, JPG or WEBP is rejected. The size limit is 5 MB.
2. Text is extracted with unpdf or mammoth. Images go to a vision model that transcribes them. A scanned PDF with no text layer gets a clear message asking for an image instead.
3. The text is cleaned and capped at 20,000 characters, and the model extracts a structured profile.
   **CV profile:** education, skills, languages, frameworks, tools, projects with their claims, experience, certifications, achievements, and a list of claims worth probing.
   **JD profile:** required and preferred skills, responsibilities, qualifications, tools, domain knowledge, soft skills and experience requirements.
4. If the document clearly isn't a CV or a JD, you are told so.
5. At the start of the interview, the plan prompt compares the two profiles. It lists strong matches, partial matches and missing skills, 10 to 15 prioritised focus areas (including missing skills to test real understanding), and a style note for the company. That note is limited to widely known facts about the type of employer; the model is told never to invent facts about the company.

## Testing

```bash
npm test --prefix backend
```

There are 39 tests. They cover:

1. The question planner.
2. Provider request formats: Gemini's JSON output and image parts, Groq reasoning settings, Whisper upload.
3. Fallback between providers, and repair of malformed JSON.
4. A full interview through the engine.
5. The HTTP API with real PDF, DOCX, TXT and image uploads.
6. File validation and size limits.
7. That errors never leak internals.

All tests use a fake AI, so they need no keys or network.

To click through the UI without spending API credits:

```bash
npm run build --prefix frontend
node backend/test/ui-server.js     # http://localhost:4173, fake interviewer
```

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "The AI interviewer isn't configured yet" | No key is set. Add `GEMINI_API_KEY` and/or `GROQ_API_KEY` and restart. |
| "The AI service rejected the server credentials" | A key is wrong or revoked. Run `npm run check:ai --prefix backend`. |
| `check:ai` says Gemini is rate limited or over quota | The free tier has per-minute and daily limits. Wait and retry, or enable billing on the Google AI Studio project. Groq covers in the meantime. |
| A provider's account has no credit left | Top it up, or remove that key and the app runs on the other provider alone. A provider with a rejected key or no credit is skipped for 10 minutes, so the app keeps working. |
| `check:ai` says the model is not available | Your account can't use the default model. Set `GEMINI_MODEL` or `GROQ_MODEL` to one listed in Google AI Studio or the Groq console. |
| Logs show `analysis via gemini failed (timeout)` | Gemini took longer than 25 seconds, so Groq took over, and Gemini is then skipped for 3 minutes so later steps don't wait again. Run `npm run check:ai --prefix backend` on your machine to see how long a real CV analysis takes. If Gemini is consistently slow, set `AI_PRIMARY=groq` on Render. |
| Logs show Gemini `HTTP 503 ... high demand` | Google's servers for that model are busy. The app retries on `GEMINI_FALLBACK_MODEL` and then Groq, so interviews keep working. If it happens often, set `GEMINI_MODEL=gemini-3.5-flash-lite` on Render. |
| Gemini says "API key not valid" | Copy the key again from aistudio.google.com (API keys), with no spaces, and update it on Render. |
| No voice button | Voice answers need Chrome or Edge, or the Groq key for the Whisper fallback. Typing always works. |
| Microphone or camera blocked | Allow them in the browser's site settings. The site must be served over HTTPS (Render does this). |
| The interviewer sounds robotic | Voices come from your operating system and browser. Chrome and Edge have the most natural ones. |
| "This interview session has expired" | The server restarted. Render's free plan sleeps after inactivity. Start a new interview. |
| First request is slow on Render | The free plan cold-starts in about 30 to 60 seconds. A paid instance stays warm. |

## Known limitations

1. **The avatars are photos, not video.** The interviewer is a still photo with speaking, listening and thinking cues, and a voice from the browser. The tile says so. There is no lip sync.
2. **Photos load from Unsplash** (free license). To self-host them, put images in `frontend/public/avatars` and update `frontend/src/data/panel.js`.
3. **Sessions live in memory.** A server restart ends any interview in progress, and a single instance is assumed.
4. **Scores are estimates** from one simulated session, based only on the words of your answers. They are not a measure of ability.
5. **Free-tier Gemini data use.** On Gemini's free tier, Google may use prompts (which include CV text) to improve its products. Enable billing on the AI Studio project if that matters for your users.
6. **Company style comes from general knowledge.** There is no live company research.
7. **Scanned PDFs are not OCR'd directly.** Upload a photo or screenshot of the page instead.

## Future improvements

1. A pluggable lip-synced avatar provider behind `InterviewerTile`, for example a streaming avatar API.
2. Streaming the interviewer's reply so speech starts before the full response arrives.
3. Optional accounts with saved reports, to track progress across interviews.
4. Company research from a search API, clearly labelled with sources.
5. A coding or whiteboard pane for technical rounds.
6. Redis-backed sessions, for running more than one instance.
