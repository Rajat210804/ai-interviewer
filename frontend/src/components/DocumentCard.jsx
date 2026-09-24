import { useRef, useState } from 'react';
import { CircleCheck, ClipboardPaste, FileUp, RotateCcw, X } from 'lucide-react';
import { Button, Spinner } from './ui';

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 5 * 1024 * 1024;

function summarize(kind, profile) {
  if (kind === 'cv') {
    const parts = [
      profile.name,
      `${profile.skills.length + profile.programming_languages.length + profile.frameworks.length} skills`,
      `${profile.projects.length} projects`,
      `${profile.experience.length} roles`,
    ];
    return parts.filter(Boolean).join(' · ');
  }
  return [profile.title, `${profile.required_skills.length} required skills`].filter(Boolean).join(' · ');
}

export default function DocumentCard({ kind, title, hint, doc, onAnalyze, onClear }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState('');

  function pick(file) {
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.split(',').includes(extension)) return setLocalError('Please choose a PDF, DOCX, TXT, PNG, JPG or WEBP file.');
    if (file.size > MAX_BYTES) return setLocalError('That file is larger than 5 MB.');
    setLocalError('');
    onAnalyze(kind, { file });
  }

  function submitText() {
    if (text.trim().length < 30) return setLocalError('Paste a little more text so the interviewer has something to work with.');
    setLocalError('');
    setPasting(false);
    onAnalyze(kind, { text });
  }

  const header = (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <span className="text-xs text-muted">Optional</span>
    </div>
  );

  if (doc.status === 'analyzing' || doc.status === 'ready' || doc.status === 'error') {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        {header}
        <div className="flex items-start gap-3 rounded-lg bg-raised/70 px-3.5 py-3">
          {doc.status === 'analyzing' && <Spinner className="mt-0.5 size-4 text-accent" />}
          {doc.status === 'ready' && <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />}
          {doc.status === 'error' && <X className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{doc.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {doc.status === 'analyzing' && 'Reading and analysing…'}
              {doc.status === 'ready' && summarize(kind, doc.profile)}
              {doc.status === 'error' && <span className="text-ink-soft">{doc.error}</span>}
            </p>
            {doc.truncated && <p className="mt-1 text-xs text-warning">Long document: only the first part was used.</p>}
          </div>
          <div className="flex shrink-0 gap-1">
            {doc.status === 'error' && (
              <Button size="sm" variant="ghost" onClick={() => onAnalyze(kind, doc.input)} aria-label="Try again">
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onClear(kind)} aria-label={`Remove ${title}`}>
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      {header}
      {pasting ? (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            autoFocus
            placeholder={`Paste the ${title.toLowerCase()} here`}
            className="w-full resize-y rounded-lg border border-line bg-raised/60 p-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={submitText}>Use this text</Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
          className={`rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${dragging ? 'border-accent bg-accent-soft/40' : 'border-line-strong'}`}
        >
          <FileUp className="mx-auto size-5 text-muted" aria-hidden />
          <p className="mt-2 text-sm text-ink-soft">Drop a file here, or</p>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" onClick={() => input.current.click()}>Choose file</Button>
            <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
              <ClipboardPaste className="size-3.5" /> Paste text
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">{hint}</p>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
        </div>
      )}
      {localError && <p className="mt-2 text-xs text-critical" role="alert">{localError}</p>}
    </div>
  );
}
