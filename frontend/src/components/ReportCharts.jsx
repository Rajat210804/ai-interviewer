import { CATEGORY_LABEL } from '../data/panel';

// Chart colours follow the app's dark palette: one blue series, recessive grid, text in text colours.
const SERIES = '#3987e5';
const TRACK = '#1a2940';

export function ScoreRing({ value }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = value == null ? 0 : (value / 100) * circumference;
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" stroke={TRACK} strokeWidth="8" />
        <circle
          cx="60" cy="60" r={radius} fill="none" stroke={SERIES} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`} className="transition-[stroke-dasharray] duration-1000"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-5xl font-semibold tracking-tight text-ink tabular-nums">{value ?? '–'}</p>
          <p className="text-xs text-muted">out of 100</p>
        </div>
      </div>
    </div>
  );
}

const DIMENSIONS = [
  ['communication', 'Communication', 'How clearly and directly you got your points across'],
  ['technical', 'Technical knowledge', 'Accuracy and depth of technical answers'],
  ['problem_solving', 'Problem solving', 'How you reasoned through scenarios and open questions'],
  ['resume_credibility', 'Resume credibility', 'How well you backed up your CV when probed'],
  ['role_knowledge', 'Role knowledge', 'Understanding of what the job involves'],
  ['clarity', 'Clarity and confidence', 'Judged only from the words of your answers'],
];

export function BreakdownBars({ scores }) {
  return (
    <ul className="space-y-4">
      {DIMENSIONS.map(([key, label, description]) => {
        const value = scores[key];
        return (
          <li key={key} title={description}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-soft">{label}</span>
              <span className={value == null ? 'text-xs text-muted' : 'font-medium tabular-nums text-ink'}>
                {value == null ? 'Not assessed' : `${value}%`}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full" style={{ background: TRACK }}>
              {value != null && (
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(value, 2)}%`, background: SERIES }} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function QuestionScores({ questions }) {
  return (
    <div>
      <div className="relative h-44">
        {[10, 5, 0].map((tick) => (
          <div key={tick} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${tick * 10}%`, transform: 'translateY(50%)' }}>
            <span className="w-5 text-right text-[11px] tabular-nums text-muted">{tick}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}
        <div className="absolute inset-y-0 left-7 right-0 flex items-end gap-0.5">
          {questions.map((q, index) => (
            <div key={q.number} className="group relative flex h-full flex-1 items-end justify-center">
              <div
                tabIndex={0}
                aria-label={`Question ${q.number}, ${CATEGORY_LABEL[q.category]}, scored ${q.score} out of 10`}
                className="w-full max-w-6 rounded-t-[4px] transition-opacity group-hover:opacity-80"
                style={{ height: `${Math.max(q.score, 0.3) * 10}%`, background: SERIES }}
              />
              <div
                className={`pointer-events-none absolute z-10 mb-2 hidden w-56 rounded-lg border border-line bg-raised p-3 text-left shadow-xl group-focus-within:block group-hover:block ${
                  index < questions.length / 2 ? 'left-0' : 'right-0'
                }`}
                style={{ bottom: `calc(${Math.max(q.score, 0.3) * 10}% + 8px)` }}
              >
                <p className="text-xs text-muted">Q{q.number} · {CATEGORY_LABEL[q.category]}{q.isFollowUp ? ' follow-up' : ''}</p>
                <p className="mt-0.5 text-sm font-medium text-ink">{q.answer ? `${q.score} / 10` : 'Skipped'}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-soft">{q.question}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ml-7 mt-2 flex gap-0.5">
        {questions.map((q) => (
          <span key={q.number} className="flex-1 text-center text-[10px] tabular-nums text-muted">
            {questions.length <= 20 || q.number % 5 === 0 ? q.number : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
