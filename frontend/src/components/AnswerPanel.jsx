import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock, Keyboard, Mic, Repeat, Send, SkipForward } from 'lucide-react';
import { Button, Spinner } from './ui';

// Matches the server limit: roughly 2,500 words, far more than any single interview answer needs.
export const MAX_ANSWER_CHARS = 15000;
// Real interviewers expect most answers to take one to three minutes.
const LONG_ANSWER_SECONDS = 240;

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Time spent on the current question, counted from when the candidate could start answering.
function useAnswerTimer(phase, questionKey) {
  const [seconds, setSeconds] = useState(0);
  const since = useRef(null);
  useEffect(() => {
    since.current = null;
    setSeconds(0);
  }, [questionKey]);
  useEffect(() => {
    if (phase !== 'answering') return;
    since.current ??= Date.now();
    const tick = () => setSeconds(Math.floor((Date.now() - since.current) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, questionKey]);
  return seconds;
}

// The bottom half of the interview screen: what the candidate can do right now.
export default function AnswerPanel({
  phase, speakerName, inputMode, voice, draft, setDraft, transcribing, questionKey, onPasteBlocked,
  onSend, onSkip, onRepeat, onStopVoice, onResumeVoice, onTypeInstead, onSkipListening, onFinish,
}) {
  const seconds = useAnswerTimer(phase, questionKey);
  const textarea = useRef(null);
  const transcriptBox = useRef(null);

  // The answer box grows with the answer, then scrolls, so long answers stay readable.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    // Capped at about a third of the screen so the interviewer stays in view.
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.max(128, Math.min(window.innerHeight * 0.3, 300)))}px`;
  }, [draft, inputMode, phase]);

  useEffect(() => {
    const el = transcriptBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [voice.transcript, voice.interim]);

  if (phase === 'speaking') {
    return (
      <Shell>
        <p className="text-sm text-muted">{speakerName} is asking a question…</p>
        <Button size="sm" variant="ghost" onClick={onSkipListening}>Skip to answering</Button>
      </Shell>
    );
  }

  if (phase === 'thinking') {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4 text-accent" /> {speakerName} is considering your answer…</p>
      </Shell>
    );
  }

  if (phase === 'ended' || phase === 'ending') {
    return (
      <Shell>
        <p className="text-sm text-ink-soft">
          {phase === 'ending' ? 'Writing your debrief. This usually takes 20 to 60 seconds…' : "That's the end of the interview."}
        </p>
        <Button variant="primary" onClick={onFinish} disabled={phase === 'ending'}>
          {phase === 'ending' ? <><Spinner /> Preparing</> : 'See my feedback'}
        </Button>
      </Shell>
    );
  }

  const blockPaste = onPasteBlocked
    ? (event) => {
      event.preventDefault();
      onPasteBlocked();
    }
    : undefined;

  const spoken = inputMode === 'voice' ? `${voice.transcript} ${voice.interim}` : '';
  const fullText = `${draft} ${spoken}`;
  const status = (
    <AnswerStatus seconds={seconds} words={countWords(fullText)} chars={fullText.trim().length} />
  );

  const actions = (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={onRepeat}><Repeat className="size-3.5" /> Repeat</Button>
      <Button size="sm" variant="ghost" onClick={onSkip}><SkipForward className="size-3.5" /> Skip</Button>
    </div>
  );

  if (inputMode === 'voice') {
    const live = `${voice.transcript}${voice.interim}`.trim();
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div ref={transcriptBox} className="max-h-[30vh] min-h-16 overflow-y-auto rounded-lg bg-raised/60 px-4 py-3 text-[15px] leading-relaxed" aria-live="polite">
          {draft && <span className="text-ink">{draft} </span>}
          {transcribing ? (
            <span className="flex items-center gap-2 text-muted"><Spinner /> Transcribing your answer…</span>
          ) : voice.kind === 'recorder' ? (
            <span className="text-muted">{voice.active ? 'Recording. Take your time; press Send when you have finished.' : 'Recording paused.'}</span>
          ) : live ? (
            <>
              <span className="text-ink">{voice.transcript}</span>
              <span className="text-muted">{voice.interim}</span>
            </>
          ) : (
            <span className="text-muted">{voice.active ? 'Listening. Take your time; pauses are fine. Your words will appear here.' : 'Microphone paused.'}</span>
          )}
        </div>
        {status}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {actions}
          <div className="flex gap-2">
            <Button size="sm" onClick={onTypeInstead} disabled={transcribing}><Keyboard className="size-3.5" /> Edit as text</Button>
            {voice.active ? (
              <Button size="sm" variant="primary" onClick={onStopVoice} disabled={transcribing}><Send className="size-3.5" /> Send answer</Button>
            ) : (
              <Button size="sm" variant="primary" onClick={onResumeVoice} disabled={transcribing}><Mic className="size-3.5" /> Resume speaking</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <label htmlFor="answer" className="sr-only">Your answer</label>
      <textarea
        id="answer"
        ref={textarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend(draft); }}
        onPaste={blockPaste}
        onDrop={blockPaste}
        rows={4}
        maxLength={MAX_ANSWER_CHARS}
        autoFocus
        placeholder="Type your answer as you would say it. Take as long as you need…"
        className="block w-full resize-none overflow-y-auto rounded-lg border border-line bg-raised/60 px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      {status}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {actions}
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted sm:inline">Ctrl + Enter to send</span>
          <Button size="sm" variant="primary" onClick={() => onSend(draft)} disabled={!draft.trim()}>
            <Send className="size-3.5" /> Send answer
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnswerStatus({ seconds, words, chars }) {
  const long = seconds >= LONG_ANSWER_SECONDS;
  const nearLimit = chars > MAX_ANSWER_CHARS * 0.8;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-3 tabular-nums">
        <span className="inline-flex items-center gap-1" title="Time on this question"><Clock className="size-3" aria-hidden /> {clock(seconds)}</span>
        <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
        {nearLimit && (
          <span className={chars >= MAX_ANSWER_CHARS ? 'text-warning' : ''}>
            {Math.min(chars, MAX_ANSWER_CHARS).toLocaleString()} / {MAX_ANSWER_CHARS.toLocaleString()} characters
          </span>
        )}
      </span>
      {long && <span className="text-ink-soft">Most interviewers expect answers of one to three minutes. Consider wrapping up with your key point.</span>}
    </div>
  );
}

const Shell = ({ children }) => (
  <div className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4">{children}</div>
);
