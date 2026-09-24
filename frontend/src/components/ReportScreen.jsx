import { useEffect, useState } from 'react';
import { BookOpen, ChevronDown, CircleAlert, CircleCheck, Plus, Printer } from 'lucide-react';
import { BreakdownBars, QuestionScores, ScoreRing } from './ReportCharts';
import { Button } from './ui';
import { CATEGORY_LABEL, DIFFICULTIES, INTERVIEW_TYPES } from '../data/panel';

// Status colours always come with a text label, never on their own.
const VERDICTS = {
  strong: { label: 'Strong', color: 'bg-good' },
  adequate: { label: 'Adequate', color: 'bg-accent' },
  vague: { label: 'Vague', color: 'bg-warning' },
  weak: { label: 'Weak', color: 'bg-warning' },
  incorrect: { label: 'Incorrect', color: 'bg-critical' },
  no_answer: { label: 'Skipped', color: 'bg-serious' },
  off_topic: { label: 'Off topic', color: 'bg-serious' },
};

const Card = ({ title, children, className = '' }) => (
  <section className={`print-plain rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}>
    {title && <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>}
    {children}
  </section>
);

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}

export default function ReportScreen({ report, onRestart }) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // Expand every question review when saving as PDF.
    const before = () => setPrinting(true);
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
  const typeLabel = INTERVIEW_TYPES.find((t) => t.id === report.type)?.label;
  const difficultyLabel = DIFFICULTIES.find((d) => d.id === report.difficulty)?.label;
  const people = Object.fromEntries(report.panel.map((p) => [p.id, p]));

  if (report.insufficient) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold text-ink">Not enough to review yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          The interview ended before you answered any questions, so there is nothing to give feedback on. Start again and answer a few questions to get a debrief.
        </p>
        <Button variant="primary" className="mt-8" onClick={onRestart}><Plus className="size-4" /> New interview</Button>
      </div>
    );
  }

  const analyses = [
    ['Technical', report.technical_analysis],
    ['HR and behaviour', report.hr_analysis],
    ['Resume', report.resume_analysis],
  ].filter(([, text]) => text);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-accent">Interview debrief</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
            {report.role}{report.company && <span className="font-normal text-ink-soft"> at {report.company}</span>}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {typeLabel} · {difficultyLabel} · {report.questionsAnswered} answered
            {report.questionsSkipped > 0 && `, ${report.questionsSkipped} skipped`} · {formatDuration(report.durationSeconds)} · {new Date().toLocaleDateString()}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button onClick={() => window.print()}><Printer className="size-4" /> Save as PDF</Button>
          <Button variant="primary" onClick={onRestart}><Plus className="size-4" /> New interview</Button>
        </div>
      </header>

      <p className="mt-6 rounded-lg border border-line bg-raised/50 px-4 py-3 text-xs leading-relaxed text-muted">
        These scores are estimates from this practice session, based only on what you said. They are not an objective measure of your ability.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="flex items-center">
          <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-center">
            <ScoreRing value={report.scores.overall} />
            <div>
              <h2 className="text-sm font-semibold text-ink">Overall performance</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{report.summary}</p>
            </div>
          </div>
        </Card>
        <Card title="Performance breakdown">
          <BreakdownBars scores={report.scores} />
        </Card>
      </div>

      <Card title="Score by question" className="mt-5">
        <QuestionScores questions={report.questions} />
      </Card>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card title="Strong areas">
          <ul className="space-y-3">
            {report.strengths.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-soft"><CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />{item}</li>
            ))}
          </ul>
        </Card>
        <Card title="Weak areas">
          <ul className="space-y-3">
            {report.weaknesses.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-soft"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />{item}</li>
            ))}
          </ul>
        </Card>
      </div>

      {analyses.length > 0 && (
        <div className={`mt-5 grid gap-5 ${analyses.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}>
          {analyses.map(([title, text]) => (
            <Card key={title} title={`${title} analysis`}>
              <p className="text-sm leading-relaxed text-ink-soft">{text}</p>
            </Card>
          ))}
        </div>
      )}

      {(report.matches.strong.length > 0 || report.matches.missing.length > 0) && (
        <Card title="Your CV against the role" className="mt-5">
          <div className="grid gap-5 md:grid-cols-3">
            {[['Strong matches', report.matches.strong], ['Partial evidence', report.matches.partial], ['Missing from your CV', report.matches.missing]].map(([label, items]) => (
              <div key={label}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.length ? items.map((item) => (
                    <span key={item} className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink-soft">{item}</span>
                  )) : <span className="text-xs text-muted">None</span>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {report.study_plan.length > 0 && (
        <Card title="Recommended preparation" className="mt-5">
          <ol className="grid gap-4 md:grid-cols-2">
            {report.study_plan.map((item, i) => (
              <li key={item.topic} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-ink">{item.topic}</p>
                  {item.why && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.why}</p>}
                  {item.how && <p className="mt-1 flex gap-1.5 text-xs leading-relaxed text-muted"><BookOpen className="mt-0.5 size-3 shrink-0" aria-hidden />{item.how}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-ink">Question review</h2>
        <div className="space-y-3">
          {report.questions.map((q) => <QuestionReview key={q.number} question={q} interviewer={people[q.interviewer]} forceOpen={printing} />)}
        </div>
      </section>
    </div>
  );
}

function QuestionReview({ question: q, interviewer, forceOpen }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || forceOpen;
  const verdict = VERDICTS[q.verdict] || VERDICTS.adequate;
  const details = [
    ['What worked', q.review?.good],
    ['What was missing', q.review?.missing],
    ['How to improve', q.review?.improve],
    ['Strong answer structure', q.review?.ideal_structure],
  ].filter(([, text]) => text);

  return (
    <article className="print-plain overflow-hidden rounded-xl border border-line bg-surface">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={open} className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-raised/40">
        <span className="mt-0.5 w-8 shrink-0 text-sm tabular-nums text-muted">Q{q.number}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {CATEGORY_LABEL[q.category]}{q.isFollowUp ? ' follow-up' : ''}{interviewer && ` · ${interviewer.name}, ${interviewer.title}`}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{q.question}</p>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          <span className={`size-2 rounded-full ${verdict.color}`} aria-hidden />
          {verdict.label}
          <span className="tabular-nums text-muted">{q.score}/10</span>
        </span>
        <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-5 py-5 sm:pl-[4.25rem]">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Your answer</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{q.answer || <em className="text-muted">Skipped</em>}</p>
          </div>
          {details.map(([label, text]) => (
            <div key={label}>
              <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
          {q.exampleAnswer && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-accent">Example of a stronger answer</p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink">{q.exampleAnswer}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
