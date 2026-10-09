# AI Interviewer

An interview practice platform that runs technical and HR interviews in the browser. It uses your CV, the job description and your answers to guide the conversation, then gives you a review you can use to prepare for the next interview.

The aim is to make practising alone more useful: questions have context, follow ups test what you actually said, and feedback refers to your answers. This is a practice tool, not a hiring service or a verified assessment of a candidate.

## How an interview works

1. Enter the role and company. Upload or paste a CV and job description if you want questions grounded in your experience and the role.
2. Choose HR, Technical or Mixed, a difficulty, 10, 20 or 30 planned questions, and a panel of one to three interviewers.
3. Check your devices in the waiting room. Camera and microphone failures have retry controls; typed answers remain available.
4. The panel asks one question at a time. Answer by voice or text, take the time you need, and send when you are ready. You can repeat or skip a question and finish early.
5. Review your scores, strengths, gaps, study plan and question by question transcript. The report can be printed or saved as a PDF through the browser.

HR interviews probe examples, decisions and outcomes. Technical interviews ask for reasoning and, when appropriate, edge cases, implementation details and complexity. Mixed interviews include both. A supplied JD guides relevant skills and scenarios; a supplied CV gives the panel claims and projects to explore.

Difficulty controls the depth of questioning and the follow up budget: Easy allows one follow up per planned question, Medium two and Hard three. The model chooses wording and probes from the previous answer within those constraints. The prompts discourage repeated questions, automatic praise and giving away the answer during the interview. Generated questions can still vary in quality.

Interviewers have fictional names, professional roles, photo avatars and browser voices. Listening, thinking, speaking and transition states follow the interview and speech lifecycle. These are portraits with state indicators, not generated video or animated lip sync. The photos are served locally; their sources and licence references are in `frontend/public/avatars`.

## Answers and audio

There is no application deadline or character limit for a candidate answer. The answer timer and word count are informational. Silence does not submit an answer, and the app waits for the candidate to send it.

Large typed answers travel in ordered parts so each request fits the server's request budget. An interrupted upload can resume from the last acknowledgement. Submissions carry the expected turn, which prevents a lost response and retry from advancing the interview twice. The complete submitted text is kept in the session and report.

Browser speech recognition is used where available. It restarts through pauses and preserves the transcript. The alternative records microphone audio for Groq Whisper. That recording rotates into independently decodable segments roughly every 45 seconds and at a conservative size threshold. Segments are transcribed in order while the candidate keeps speaking. Rotation is a transport detail, not an answer time limit. Failed segments stay in the current tab for retry or explicit discard; sending waits for the remaining transcription.

Recording and transcription depend on the browser, available memory, connection and provider. A brief overlap can occur at recorder boundaries. The server accepts up to 10 MB per audio upload. Speech recognition can mishear or omit words, so review the transcript before sending. Interviewer speech uses the browser's installed voices; captions remain usable if playback fails.

AI context is finite even though the stored answer is not clipped. Live assessment receives up to 16,000 characters of answer context. Reports share a 24,000 character answer context budget within a 48,000 character total transcript budget. Very long answers use labelled beginning, middle and end excerpts. The report identifies limited context and distinguishes the stored transcript from the text supplied for assessment. Scores are practice feedback, not a claim that omitted text was reviewed.

## Monitoring and computer vision

The optional interview conditions mode combines local camera inference with browser observations. Relaxed practice turns monitoring off and permits notes and pasting.

The camera pipeline shares one TensorFlow.js runtime. Tiny Face Detector and facial landmarks estimate face count, framing, head direction and movement. This is face detection, not identity recognition: there is no enrolment, face matching or biometric identity check. Head direction is an approximate signal and does not measure eye gaze.

COCO SSD uses its actual `cell phone` class to look for visible phones. It also watches a limited set of reference objects, currently books and remotes. Position relative to a detected face can describe a nearby phone, but cannot establish whether someone is holding or using it. Unknown objects and things outside the camera view cannot be reliably detected.

Inference runs at a lower rate than the camera preview: face checks approximately every 750 ms on WebGL or 1.5 seconds on CPU, and object checks every 2.4 or 4 seconds. Work is serialized and scheduled after inference completes. Models load once, inputs are downscaled, and checks pause or stop with the interview lifecycle. A failed object model leaves face checks available and is shown as missing coverage, not a clean result.

A central event engine applies confidence thresholds, persistence, cooldowns and rolling windows. A single missing face or phone frame does not create a violation. Examples include:

| Observation | Response |
| --- | --- |
| Brief camera instability | Informational device event |
| Face missing across several samples for 3 seconds | Warning |
| Multiple faces continuing for 7 seconds | Serious event for review |
| Sustained or repeated looking away | Warning, then increased suspicion |
| Potential phone continuing for 4 seconds | Warning or suspicious event, depending on confidence |
| Repeated confident phone observations | Increased severity for manual review |

Events use `INFO`, `WARNING`, `SUSPICIOUS` and `SERIOUS_VIOLATION`, with timestamps, duration and detection confidence where meaningful. The bounded event log and coverage summary appear in the report. Monitoring observations do not lower the answer scores or prove misconduct.

Browser monitoring observes visibility changes, window focus, fullscreen exits, copy and paste actions, selected shortcuts, and camera or microphone permission and track changes. It cannot know which other application was opened, inspect another physical device, or reliably detect developer tools. Device failures are reported as interruptions rather than accusations.

Camera frames are processed locally and are not uploaded by monitoring. The backend receives sanitized counts, coverage and events, which it treats as untrusted observations. Audio recorded for Whisper is sent to the backend and Groq; submitted text, CV/JD content and interview context are sent to the configured AI providers. No media recording or account history is persisted by this application.

## Architecture

The frontend is React 19 with Vite 8, Tailwind CSS 4 and lucide-react. The backend is Node and Express 5, using Zod for validation, multer for memory uploads, unpdf for PDF extraction and mammoth for DOCX files.

In production, Express serves the built frontend and `/api` from the same origin. Development uses Vite's API proxy. Provider credentials stay on the server.

| Area | Location | Responsibility |
| --- | --- | --- |
| Screen flow and UI | `frontend/src/App.jsx`, `components/` | Setup, device check, interview and report |
| Media and preparation | `frontend/src/hooks/` | Device lifecycle, recognition, recording, speech and preparation cancellation |
| Monitoring | `frontend/src/proctoring/`, `hooks/useProctoring.js` | Models, temporal rules and browser events |
| Client transport | `frontend/src/api.js` | Timeouts, cancellation, answer upload and retry |
| Interview engine | `backend/src/interview/` | Plans, turns, follow ups, sessions and integrity summaries |
| Prompts and validation | `backend/src/ai/prompts.js`, `schemas.js` | Model instructions, evidence and response schemas |
| Providers | `backend/src/ai/providers.js`, `index.js` | Existing Gemini/Groq routing, fallback and JSON repair |
| API | `backend/src/routes/` | Documents, interviews and transcription |

Gemini is the default first choice for document analysis and reports; Groq is the default for live turns and Whisper. The existing provider layer validates structured responses, attempts a repair when needed and uses the available fallback provider. Its configuration remains in `backend/src/config.js`.

Sessions are held in memory. Active interviews send a heartbeat while the candidate answers or the interviewer speaks; three hours of inactivity expires a session. Completed reports are cached for five minutes to allow recovery from a lost response. Sessions and the cache are bounded, and a process restart loses them. There is no database, account system or cross-device resume.

## Local setup

Use Node 22.12 or newer and npm. From this repository:

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

For a new installation, copy `backend/.env.example` to `backend/.env` and configure provider credentials there or through your environment. Preserve an existing `.env`; it is ignored by Git. Never put provider keys in frontend variables.

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Gemini credential | None |
| `GROQ_API_KEY` | Groq credential; required for Whisper fallback | None |
| `AI_PRIMARY` | First provider for analysis and reports | `gemini` |
| `GEMINI_MODEL` | Gemini model | `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Alternative Gemini model | `gemini-3.5-flash-lite` |
| `GROQ_MODEL` | Groq chat model | `openai/gpt-oss-120b` |
| `GROQ_VISION_MODEL` | Groq image model | `qwen/qwen3.8-27b` |
| `GROQ_WHISPER_MODEL` | Transcription model | `whisper-large-v3-turbo` |
| `PORT` | Backend port | `3001` |

At least one chat provider must be configured to conduct interviews. Provider model availability depends on the account; the table records the repository defaults.

Start the backend and frontend in separate terminals:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

Open `http://localhost:5173`. The backend runs on port 3001. Camera and microphone access require a secure context, such as localhost or HTTPS.

Vision weights are included under `frontend/public/models`; no model download is needed during normal startup or build. To restore the COCO SSD assets:

```bash
npm run setup:vision --prefix frontend
```

That command needs curl and network access to `storage.googleapis.com`. It retains TLS verification and checks official object checksums plus the recorded SHA-256 values. Model provenance and the COCO SSD Apache 2.0 licence are included with the assets.

## Testing and building

```bash
npm test                          # backend and frontend tests
npm run build                     # frozen dependency installs and frontend production build
npm start                         # serve the built app and API
npm run check:ai --prefix backend # optional live provider and sample CV checks
```

Tests use fake AI responses rather than credentials. They exercise API validation, document extraction, allowed interview moves, provider fallback, prompt boundaries, full answer retention, resumable uploads, response replay, session activity, report budgets, media cleanup, recorder rotation, browser listeners and temporal proctoring. The vision rules include transient and prolonged missing faces, multiple faces, phone confidence and persistence, repeated looking away, camera/microphone failures, blur and fullscreen events.

The live AI check is separate from the offline suite. Read its output: it can report skipped or failed provider checks even when the process exits successfully. There is no lint script configured.

For UI development without live providers, build the frontend and run `node backend/test/ui-server.js`. It serves the application with deterministic test responses on port 4173 by default. Use that server only for development checks.

## Deployment

The included `render.yaml` deploys one Node web service. Use `npm run build` as the build command, `npm start` as the start command, and `/api/health` as the health check. Configure secrets in the hosting service rather than committing `.env`. Use HTTPS for browser media access and allow the backend to reach the selected provider APIs.

The build copies local portraits and vision models into the frontend output. Account for the roughly 18 MB object model when serving static assets. Health reports which providers are configured; it does not perform a live inference request or establish provider availability.

Documents support PDF, DOCX, TXT, PNG, JPG and WEBP with a 5 MB upload limit. Extracted document context is limited to 20,000 characters and reports truncation. These document limits are separate from candidate answers. File content is validated during extraction, and uploaded evidence is quoted in prompts with instructions not to follow embedded commands. Those boundaries reduce prompt injection risk but do not make model output infallible.

## Known limitations and next improvements

Vision accuracy depends on lighting, framing, camera quality and device performance. Small or occluded phones may be missed, and supported objects can be misclassified. Head direction and movement are approximations. Browser monitoring is observable evidence, not a secure examination boundary; a modified client can falsify it.

Answers can continue without an application cutoff, but browser memory, provider availability and network interruptions impose practical limits. Reloading the page loses unsent drafts and pending audio. Reports retain full submitted text while AI review uses bounded context. Early endings with too little evidence are shown as insufficient rather than invented scores.

Useful next steps would be persisted sessions with an explicit retention policy, broader device and browser testing, and measured vision evaluation on representative interview conditions. Longer answers could also benefit from a provider-budgeted multi-pass assessment that reviews every section instead of excerpts. These are future work, not current features.
