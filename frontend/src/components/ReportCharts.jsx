import { CATEGORY_LABEL } from '../data/panel';

const SERIES = '#3987e5';
const TRACK = '#242a35';

function scoreValue(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : null;
}

export function ScoreRing({ value }) {
  const score = scoreValue(value, 100);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (score / 100) * circumference;
  return (
    <div className="relative size-36 shrink-0" role="img" aria-label={score === null ? 'Overall performance was not assessed' : `Overall performance: ${score} out of 100`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke={TRACK} strokeWidth="7" />
        {score !== null && score > 0 && (
          <circle cx="60" cy="60" r={radius} fill="none" stroke={SERIES} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`} className="transition-[stroke-dasharray] duration-700" />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-4xl font-semibold tracking-tight text-ink tabular-nums">{score ?? '—'}</p>
          <p className="mt-1 text-xs text-muted">{score === null ? 'Not assessed' : 'out of 100'}</p>
        </div>
      </div>
    </div>
  );
}

const DIMENSIONS = [
  ['communication', 'Communication', 'How directly you explained your ideas and examples.'],
  ['technical', 'Technical knowledge', 'Accuracy and depth of the technical answers given.'],
  ['problem_solving', 'Problem solving', 'Your reasoning through scenarios and open questions.'],
  ['resume_credibility', 'Resume evidence', 'How your answers supported the claims in your CV.'],
  ['role_knowledge', 'Role knowledge', 'Your understanding of the role and its responsibilities.'],
  ['clarity', 'Clarity and confidence', 'How your words read; not a measure of vocal delivery.'],
];

export function BreakdownBars({ scores = {} }) {
  return (
    <ul className="space-y-4">
      {DIMENSIONS.map(([key, label, description]) => {
        const value = scoreValue(scores[key], 100);
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-ink-soft">{label}</span>
              <span className={value === null ? 'shrink-0 text-xs text-muted' : 'shrink-0 font-medium tabular-nums text-ink'}>
                {value === null ? 'Not assessed' : `${value} / 100`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              {value !== null && <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${value}%`, background: SERIES }} />}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{description}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function QuestionScores({ questions = [], onQuestionSelect }) {
  if (!questions.length) return <p className="text-sm text-muted">No question scores are available for this session.</p>;
  return (
    <div>
      <p className="mb-6 text-xs leading-relaxed text-muted">Each question is assessed out of 10. Skipped answers and unavailable scores are labelled separately. Focus a bar to read its score.</p>
      <div className="overflow-x-auto pb-3">
        <div data-print-chart style={{ minWidth: `${Math.max(240, questions.length * 34)}px` }}>
          <div className="relative h-36">
            {[10, 5, 0].map((tick) => (
              <div key={tick} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${tick * 10}%`, transform: 'translateY(50%)' }} aria-hidden="true">
                <span className="w-5 text-right text-[11px] tabular-nums text-muted">{tick}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            ))}
            <div className="absolute inset-y-0 left-7 right-0 flex items-end gap-2">
              {questions.map((q) => {
                const score = scoreValue(q.score, 10);
                const skipped = q.verdict === 'no_answer' || !q.answer;
                const label = skipped ? 'Skipped' : score === null ? 'Not assessed' : `${score} / 10`;
                return (
                  <div key={q.number} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                    <a href={`#question-${q.number}`} onClick={() => onQuestionSelect?.(q.number)} aria-label={`Review question ${q.number}: ${label}`}
                      title={`Q${q.number} · ${CATEGORY_LABEL[q.category] || q.category || 'Question'} · ${label}\n${q.question || ''}`}
                      className="flex h-full w-full max-w-7 items-end justify-center rounded-t-sm focus-visible:outline-offset-4">
                      {score !== null && score > 0 && !skipped ? (
                        <span className="w-full rounded-t-sm bg-accent transition-opacity hover:opacity-75" style={{ height: `${score * 10}%` }} />
                      ) : <span className={`w-full border-t-2 ${skipped || score === null ? 'border-dashed border-muted' : 'border-accent'}`} />}
                      <span className="absolute inset-x-0 -top-5 text-center text-[10px] tabular-nums text-muted">{skipped ? 'Skip' : score ?? '—'}</span>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="ml-7 mt-3 flex gap-2" aria-hidden="true">
            {questions.map((q) => <span key={q.number} className="flex-1 text-center text-[10px] tabular-nums text-muted">Q{q.number}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
