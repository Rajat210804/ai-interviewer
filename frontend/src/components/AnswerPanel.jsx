import { Keyboard, Mic, Repeat, Send, SkipForward } from 'lucide-react';
import { Button, Spinner } from './ui';

// The bottom half of the interview screen: what the candidate can do right now.
export default function AnswerPanel({
  phase, speakerName, inputMode, voice, draft, setDraft, transcribing,
  onSend, onSkip, onRepeat, onStopVoice, onResumeVoice, onTypeInstead, onSkipListening, onFinish,
}) {
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
        <div className="min-h-16 rounded-lg bg-raised/60 px-4 py-3 text-[15px] leading-relaxed" aria-live="polite">
          {transcribing ? (
            <span className="flex items-center gap-2 text-muted"><Spinner /> Transcribing your answer…</span>
          ) : voice.kind === 'recorder' ? (
            <span className="text-muted">{voice.active ? 'Recording. Speak your answer, then press Send.' : 'Recording paused.'}</span>
          ) : live ? (
            <>
              <span className="text-ink">{voice.transcript}</span>
              <span className="text-muted">{voice.interim}</span>
            </>
          ) : (
            <span className="text-muted">{voice.active ? 'Listening. Start speaking and your words will appear here.' : 'Microphone paused.'}</span>
          )}
        </div>
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
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend(draft); }}
        rows={3}
        maxLength={6000}
        autoFocus
        placeholder="Type your answer as you would say it…"
        className="w-full resize-none rounded-lg border border-line bg-raised/60 px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
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

const Shell = ({ children }) => (
  <div className="flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4">{children}</div>
);
