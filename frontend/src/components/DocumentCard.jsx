import { useId, useRef, useState } from 'react';
import {
  CircleCheck,
  ClipboardPaste,
  FileText,
  FileUp,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button, Spinner } from './ui';

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 5 * 1024 * 1024;

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}
function summarize(kind, profile) {
  profile ??= {};
  if (kind === 'cv') {
    return [
      profile.name,
      `${count(profile.skills) + count(profile.programming_languages) + count(profile.frameworks)} skills`,
      `${count(profile.projects)} projects`,
      `${count(profile.experience)} roles`,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return [profile.title, `${count(profile.required_skills)} required skills`]
    .filter(Boolean)
    .join(' · ');
}

export default function DocumentCard({
  kind,
  title,
  hint,
  doc,
  onAnalyze,
  onClear,
}) {
  const input = useRef(null);
  const textId = useId();
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState('');

  function pick(file) {
    if (!file) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPT.split(',').includes(extension))
      return setLocalError(
        'Choose a PDF, DOCX, TXT, MD, PNG, JPG or WEBP file.',
      );
    if (file.size > MAX_BYTES)
      return setLocalError('Choose a file smaller than 5 MB.');
    if (file.size === 0)
      return setLocalError(
        'That file is empty. Choose another file or paste the text.',
      );
    setLocalError('');
    onAnalyze(kind, { file });
  }

  function submitText() {
    if (text.trim().length < 30)
      return setLocalError(
        'Include at least 30 characters so the panel has enough context.',
      );
    setLocalError('');
    setPasting(false);
    onAnalyze(kind, { text: text.trim() });
  }

  function clearDocument() {
    setLocalError('');
    onClear(kind);
  }

  return (
    <div
      className="min-w-0 rounded-lg border border-line-strong bg-canvas/30 p-4"
      aria-busy={doc.status === 'analyzing'}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
          <FileText className="size-4 text-muted" aria-hidden />
          {title}
        </h3>
        <span className="text-xs text-muted">Optional</span>
      </div>
      {doc.status !== 'empty' ? (
        <div
          className="flex items-start gap-3 rounded-lg bg-raised/60 p-3"
          aria-live="polite"
        >
          {doc.status === 'analyzing' && (
            <Spinner className="mt-0.5 size-4 text-accent" />
          )}
          {doc.status === 'ready' && (
            <CircleCheck
              className="mt-0.5 size-4 shrink-0 text-good"
              aria-hidden
            />
          )}
          {doc.status === 'error' && (
            <X className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-ink">{doc.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {doc.status === 'analyzing' &&
                'Reading your document. You can continue with the setup.'}
              {doc.status === 'ready' && summarize(kind, doc.profile)}
              {doc.status === 'error' && doc.error}
            </p>
            {doc.truncated && (
              <p className="mt-2 text-xs leading-relaxed text-warning">
                This document was shortened before analysis. The panel may not
                have all of its details.
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {doc.status === 'error' && doc.input && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onAnalyze(kind, doc.input)}
                aria-label={`Retry reading ${title}`}
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={clearDocument}
              aria-label={`Remove ${title}`}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      ) : pasting ? (
        <div>
          <label htmlFor={textId} className="sr-only">
            {title} text
          </label>
          <textarea
            id={textId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            autoFocus
            placeholder={`Paste your ${title.toLowerCase()} here`}
            className="w-full resize-y rounded-lg border border-line-strong bg-canvas/50 p-3 text-sm leading-relaxed text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            aria-describedby={localError ? `${textId}-error` : undefined}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPasting(false);
                setLocalError('');
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={submitText}>
              Use text
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`rounded-lg border border-dashed px-3 py-5 text-center transition-colors ${dragging ? 'border-accent bg-accent-soft/30' : 'border-line-strong'}`}
        >
          <FileUp className="mx-auto size-5 text-muted" aria-hidden />
          <p className="mt-2 text-xs text-ink-soft">Drop your document here</p>
          <div className="mt-3 flex flex-wrap justify-center gap-1">
            <Button size="sm" onClick={() => input.current?.click()}>
              Choose file
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPasting(true);
                setLocalError('');
              }}
            >
              <ClipboardPaste className="size-3.5" aria-hidden />
              Paste text
            </Button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">{hint}</p>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label={`Upload ${title}`}
            onChange={(e) => {
              pick(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {localError && (
        <p
          id={`${textId}-error`}
          className="mt-2 text-xs leading-relaxed text-critical"
          role="alert"
        >
          {localError}
        </p>
      )}
    </div>
  );
}
