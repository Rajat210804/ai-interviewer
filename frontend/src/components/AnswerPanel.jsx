import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock, Keyboard, Mic, Repeat, Send, SkipForward } from 'lucide-react';
import { Button, Spinner } from './ui';

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function useAnswerTimer(phase, questionKey) {
  const [seconds, setSeconds] = useState(0);
  const elapsed = useRef(0);
  useEffect(() => { elapsed.current = 0; setSeconds(0); }, [questionKey]);
  useEffect(() => {
    if (phase !== 'answering') return;
    const start = Date.now();
    const tick = () => setSeconds(Math.floor((elapsed.current + Date.now() - start) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => { clearInterval(timer); elapsed.current += Date.now() - start; };
  }, [phase, questionKey]);
  return seconds;
}

export default function AnswerPanel({
  phase, audioSpeaking, speakerName, inputMode, voice, draft, setDraft, transcribing, busy, requestSeconds = 0, answerUpload, questionKey, onPasteBlocked,
  onSend, onSkip, onRepeat, onStopVoice, onResumeVoice, onTypeInstead, onSkipListening, onFinish,
}) {
  const seconds = useAnswerTimer(phase, questionKey);
  const textarea = useRef(null);
  const transcriptBox = useRef(null);
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.max(128, Math.min(window.innerHeight * 0.3, 300)))}px`;
  }, [draft, inputMode, phase]);
  useEffect(() => { const el = transcriptBox.current; if (el) el.scrollTop = el.scrollHeight; }, [voice.transcript, voice.interim]);

  if (phase === 'speaking') return <Shell><p className="flex items-center gap-2 text-sm text-ink-soft">{audioSpeaking ? <><span className="voice-bars flex h-3 items-center gap-[3px] text-accent" aria-hidden><span /><span /><span /></span>{speakerName} is speaking</> : <><Spinner />Preparing interviewer audio</>}</p><Button size="sm" variant="ghost" onClick={onSkipListening}>Continue to answer</Button></Shell>;
  if (phase === 'thinking') return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-ink-soft"><Spinner className="size-4 text-accent" />{answerUpload && answerUpload.uploadedCharacters < answerUpload.totalCharacters ? 'Sending your answer' : `${speakerName} is considering your answer`}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{answerUpload && answerUpload.uploadedCharacters < answerUpload.totalCharacters ? `${Math.floor(answerUpload.uploadedCharacters / answerUpload.totalCharacters * 100)}% uploaded. Your complete answer is retained while we send it.` : requestSeconds >= 20 ? 'The response is taking longer than usual. Your answer is saved while we wait.' : 'Your answer has been sent. The microphone is paused.'}</p>
      {draft && <details className="mt-3 text-xs text-muted"><summary className="w-fit cursor-pointer text-ink-soft">Review your answer</summary><p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">{draft}</p></details>}
    </div>
  );
  if (phase === 'ended' || phase === 'ending') return <Shell><div><p className="text-sm text-ink-soft">{phase === 'ending' ? 'Preparing your interview feedback' : 'Your interview is complete.'}</p><p className="mt-1 text-xs text-muted">{phase === 'ending' ? requestSeconds >= 45 ? 'The review is taking a little longer. Your submitted answers are saved.' : 'We are reviewing your answers and session observations.' : 'Review your strengths, areas to develop and answers.'}</p></div><Button variant="primary" onClick={onFinish} disabled={phase === 'ending'}>{phase === 'ending' ? <><Spinner />Preparing</> : 'View feedback'}</Button></Shell>;

  const blockPaste = onPasteBlocked ? (event) => { event.preventDefault(); onPasteBlocked(); } : undefined;
  const spoken = inputMode === 'voice' ? `${voice.transcript} ${voice.interim}` : '';
  const fullText = `${draft} ${spoken}`;
  const status = <AnswerStatus seconds={seconds} words={countWords(fullText)} />;
  const actions = <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={onRepeat} disabled={busy}><Repeat className="size-3.5" />Repeat question</Button><Button size="sm" variant="ghost" onClick={onSkip} disabled={busy}><SkipForward className="size-3.5" />Skip</Button></div>;

  if (inputMode === 'voice') {
    const live = `${voice.transcript} ${voice.interim}`.trim();
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-medium text-ink">Your answer</h2><p className="flex items-center gap-1.5 text-xs text-muted"><Mic className={`size-3.5 ${voice.active ? 'text-good' : ''}`} />{transcribing ? 'Processing remaining audio' : voice.active ? voice.processing ? 'Recording · Transcribing' : 'Microphone active' : busy ? 'Starting microphone' : 'Microphone paused'}</p></div>
        <div ref={transcriptBox} className="max-h-[30vh] min-h-20 overflow-y-auto rounded-lg border border-line bg-raised/50 px-4 py-3 text-[15px] leading-relaxed" aria-live="polite">
          {draft && <span className="text-ink">{draft} </span>}
          {transcribing ? <span className="flex items-center gap-2 text-muted"><Spinner />Transcribing your answer</span>
            : voice.kind === 'recorder' ? <span className="text-muted">{voice.active ? 'Keep speaking at your own pace. Audio is transcribed in segments; send your answer when you are ready.' : 'Recording is paused.'}</span>
              : live ? <><span className="text-ink">{voice.transcript}</span><span className="text-muted"> {voice.interim}</span></>
                : <span className="text-muted">{voice.active ? 'Speak at your own pace. Your words will appear here.' : 'Resume the microphone or edit your answer as text.'}</span>}
        </div>
        {status}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{actions}<div className="flex gap-2"><Button size="sm" onClick={onTypeInstead} disabled={busy}><Keyboard className="size-3.5" />Edit as text</Button>{voice.active ? <Button size="sm" variant="primary" onClick={onStopVoice} disabled={busy}>{busy ? <Spinner /> : <Send className="size-3.5" />}Send answer</Button> : <Button size="sm" variant="primary" onClick={onResumeVoice} disabled={busy}><Mic className="size-3.5" />Resume speaking</Button>}</div></div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><label htmlFor="answer" className="text-sm font-medium text-ink">Your answer</label><span className="text-xs text-muted">{busy ? 'Processing microphone input' : 'Answer in your own words'}</span></div>
      <textarea id="answer" ref={textarea} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && draft.trim()) onSend(draft); } }} onPaste={blockPaste} onDrop={blockPaste} rows={4} autoFocus placeholder="Explain your approach, then give a specific example…" className="block w-full resize-none overflow-y-auto rounded-lg border border-line bg-raised/50 px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-muted focus:border-accent focus:outline-none" />
      {status}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{actions}<div className="flex items-center gap-3"><span className="hidden text-xs text-muted sm:inline">Ctrl / ⌘ + Enter</span><Button size="sm" variant="primary" onClick={() => onSend(draft)} disabled={busy || !draft.trim()}>{busy ? <Spinner /> : <Send className="size-3.5" />}Send answer</Button></div></div>
    </div>
  );
}

function AnswerStatus({ seconds, words }) {
  return <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted"><span className="flex items-center gap-3 tabular-nums"><span className="inline-flex items-center gap-1" title="Time spent answering this question"><Clock className="size-3" aria-hidden />{clock(seconds)}</span><span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span></span></div>;
}
const Shell = ({ children }) => <div className="flex min-h-[84px] flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4">{children}</div>;
