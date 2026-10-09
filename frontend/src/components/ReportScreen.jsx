import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { AlertTriangle, ArrowUpRight, BookOpen, ChevronDown, CircleAlert, CircleCheck, FileText, Plus, Printer, ShieldCheck } from 'lucide-react';
import { BreakdownBars, QuestionScores, ScoreRing } from './ReportCharts';
import { Button, Spinner } from './ui';
import { CATEGORY_LABEL, DIFFICULTIES, INTERVIEW_TYPES } from '../data/panel';

const VERDICTS = {
  strong: { label: 'Strong', color: 'bg-good' },
  adequate: { label: 'Adequate', color: 'bg-accent' },
  vague: { label: 'Needs detail', color: 'bg-warning' },
  weak: { label: 'Needs work', color: 'bg-warning' },
  incorrect: { label: 'Incorrect', color: 'bg-critical' },
  no_answer: { label: 'Skipped', color: 'bg-serious' },
  off_topic: { label: 'Off topic', color: 'bg-serious' },
};

const INTEGRITY_LEVELS = {
  clean: { label: 'No threshold flags', color: 'bg-good', text: 'Recorded observations did not reach a review threshold.' },
  minor: { label: 'Observations noted', color: 'bg-warning', text: 'Some observations reached a monitoring threshold. Review their context below.' },
  review: { label: 'Review recommended', color: 'bg-serious', text: 'Repeated or sustained observations were recorded. They require context before drawing any conclusion.' },
};

const SEVERITIES = {
  INFO: { label: 'Info', color: 'text-ink-soft', background: 'bg-raised' },
  WARNING: { label: 'Warning', color: 'text-warning', background: 'bg-warning/10' },
  SUSPICIOUS: { label: 'Suspicious', color: 'text-serious', background: 'bg-serious/10' },
  SERIOUS_VIOLATION: { label: 'Serious event', color: 'text-critical', background: 'bg-critical/10' },
};

const ATTENTION_VERDICTS = new Set(['vague', 'weak', 'incorrect', 'no_answer', 'off_topic']);
const items = (value) => Array.isArray(value) ? value : [];
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function formatDuration(seconds) {
  if (number(seconds) === null) return 'Not recorded';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  return minutes ? `${minutes}m ${rounded % 60}s` : `${rounded}s`;
}

const Card = ({ title, children, className = '', ...props }) => (
  <section className={`print-plain rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`} {...props}>
    {title && <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>}
    {children}
  </section>
);

export default function ReportScreen({ report, onRestart }) {
  const [printing, setPrinting] = useState(false);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  if (!report) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center" role="status" aria-live="polite">
        <Spinner className="size-7 text-accent" />
        <h1 className="mt-5 text-xl font-semibold text-ink">Preparing your feedback</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">Your responses are being reviewed. The report will appear when the assessment is ready.</p>
      </div>
    );
  }

  const questions = items(report.questions);
  const scores = report.scores || {};
  const strengths = items(report.strengths);
  const weaknesses = items(report.weaknesses);
  const preparation = items(report.study_plan);
  const matches = report.matches || {};
  const typeLabel = INTERVIEW_TYPES.find((t) => t.id === report.type)?.label;
  const difficultyLabel = DIFFICULTIES.find((d) => d.id === report.difficulty)?.label;
  const people = Object.fromEntries(items(report.panel).map((p) => [p.id, p]));
  const needsAttention = questions.filter((q) => ATTENTION_VERDICTS.has(q.verdict));
  const flagged = questions.filter((q) => items(q.integrityFlags).length);
  const visibleQuestions = printing || filter === 'all' ? questions : filter === 'attention' ? needsAttention : flagged;
  const allExpanded = visibleQuestions.length > 0 && visibleQuestions.every((q) => expanded.has(q.number));
  const analyses = [['Technical assessment', report.technical_analysis], ['Behavioural assessment', report.hr_analysis], ['Resume assessment', report.resume_analysis]].filter(([, text]) => text);
  const answered = number(report.questionsAnswered) ?? questions.filter((q) => q.answer).length;
  const skipped = number(report.questionsSkipped) ?? questions.filter((q) => !q.answer).length;
  const contextLimited = report.contextLimited || questions.some((q) => q.contextLimited);
  const savePdf = () => {
    flushSync(() => setPrinting(true));
    window.print();
  };
  const toggleQuestion = (questionNumber) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(questionNumber)) next.delete(questionNumber);
    else next.add(questionNumber);
    return next;
  });
  const toggleAll = () => setExpanded((previous) => {
    const next = new Set(previous);
    visibleQuestions.forEach((q) => allExpanded ? next.delete(q.number) : next.add(q.number));
    return next;
  });
  const selectQuestion = (questionNumber) => flushSync(() => {
    setFilter('all');
    setExpanded((previous) => new Set([...previous, questionNumber]));
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-10">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-accent"><FileText className="size-4" aria-hidden="true" /> Session report</p>
          <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{report.role || 'Interview feedback'}</h1>
          <p className="mt-2 text-sm text-ink-soft">{[report.company, typeLabel, difficultyLabel].filter(Boolean).join(' · ') || 'Practice interview'}</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button onClick={savePdf}><Printer className="size-4" aria-hidden="true" /> Save as PDF</Button>
          <Button variant="primary" onClick={onRestart}><Plus className="size-4" aria-hidden="true" /> New interview</Button>
        </div>
      </header>

      <nav className="no-print flex flex-wrap gap-x-6 gap-y-3 py-5 text-sm" aria-label="Report sections">
        <a href="#report-overview" className="text-ink-soft hover:text-accent">Overview</a>
        {preparation.length > 0 && <a href="#report-preparation" className="text-ink-soft hover:text-accent">Preparation plan</a>}
        {questions.length > 0 && <a href="#report-review" className="text-ink-soft hover:text-accent">Answers & feedback</a>}
        {report.integrity && <a href="#report-monitoring" className="text-ink-soft hover:text-accent">Monitoring summary</a>}
      </nav>

      <dl className="mb-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface px-2 py-4 sm:px-4">
        {[[answered, 'Answered'], [skipped, 'Skipped'], [formatDuration(report.durationSeconds), 'Session duration']].map(([value, label]) => (
          <div key={label} className="px-2 text-center sm:px-4 sm:text-left">
            <dd className="text-lg font-semibold tabular-nums text-ink sm:text-2xl">{value}</dd>
            <dt className="mt-1 text-xs text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      {contextLimited && (
        <p className="mb-5 flex gap-2 rounded-lg border border-warning/25 bg-warning/5 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {report.contextLimited ? 'The final assessment used excerpts of long responses.' : 'Some interview follow-ups used excerpts of long responses.'}
            {report.contextLimited && number(report.evaluationCoverage?.contextCharacters) !== null && number(report.evaluationCoverage?.answerCharacters) !== null && ` AI review covered ${report.evaluationCoverage.contextCharacters.toLocaleString()} of ${report.evaluationCoverage.answerCharacters.toLocaleString()} submitted characters.`}
            {' '}Details outside an excerpt may not have been assessed. Complete responses and review coverage notes are preserved below.
          </span>
        </p>
      )}

      {report.insufficient ? (
        <Card id="report-overview" className="scroll-mt-6">
          <h2 className="text-lg font-semibold text-ink">Not enough responses to assess</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">This session ended before an answer was submitted. Start a new interview and answer a few questions to receive feedback and a preparation plan.</p>
          <Button variant="primary" className="no-print mt-5" onClick={onRestart}><Plus className="size-4" aria-hidden="true" /> Start another interview</Button>
        </Card>
      ) : (
        <>
          <div id="report-overview" className="grid scroll-mt-6 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <Card className="flex flex-col justify-between">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center lg:flex-col lg:items-start xl:flex-row xl:items-center">
                <ScoreRing value={scores.overall} />
                <div>
                  <h2 className="text-base font-semibold text-ink">Overall assessment</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{report.summary || 'An overall assessment was not returned for this session. Available question feedback is shown below.'}</p>
                </div>
              </div>
              <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">AI estimates based on the answers in this session. Scores are out of 100, not percentiles or hiring recommendations. Untested dimensions remain unassessed. Monitoring observations do not change these scores.</p>
              {questions.length > 0 && <a href="#report-review" className="no-print mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent">Review your answers <ArrowUpRight className="size-4" aria-hidden="true" /></a>}
            </Card>
            <Card title="Assessment dimensions"><BreakdownBars scores={scores} /></Card>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <Card title="What worked">
              <FeedbackList entries={strengths} icon={CircleCheck} color="text-good" empty="No specific strengths were included in this report." />
            </Card>
            <Card title="Where to focus next">
              <FeedbackList entries={weaknesses} icon={CircleAlert} color="text-warning" empty="No specific gaps were included in this report." />
            </Card>
          </div>

          {analyses.length > 0 && (
            <div className={`mt-5 grid gap-5 ${analyses.length === 3 ? 'lg:grid-cols-3' : analyses.length === 2 ? 'md:grid-cols-2' : ''}`}>
              {analyses.map(([title, text]) => <Card key={title} title={title}><p className="text-sm leading-relaxed text-ink-soft">{text}</p></Card>)}
            </div>
          )}

          {['strong', 'partial', 'missing'].some((key) => items(matches[key]).length) && (
            <Card title="Resume evidence against the role" className="mt-5">
              <p className="mb-5 text-xs leading-relaxed text-muted">Based on the CV and role information supplied. Missing evidence does not mean you lack the skill.</p>
              <div className="grid gap-5 md:grid-cols-3">
                {[['Strong matches', matches.strong], ['Partial evidence', matches.partial], ['Evidence to add', matches.missing]].map(([label, entries]) => (
                  <div key={label}>
                    <h3 className="mb-2 text-xs font-medium text-muted">{label}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {items(entries).length ? items(entries).map((item, i) => <span key={`${item}-${i}`} className="rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink-soft">{item}</span>) : <span className="text-xs text-muted">None listed</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {preparation.length > 0 && (
            <Card id="report-preparation" title="Your next preparation steps" className="mt-5 scroll-mt-6">
              <ol className="grid gap-5 md:grid-cols-2">
                {preparation.map((item, i) => (
                  <li key={`${item.topic}-${i}`} className="flex gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-raised text-xs font-semibold text-accent">{i + 1}</span>
                    <div>
                      <h3 className="text-sm font-medium text-ink">{item.topic}</h3>
                      {item.why && <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.why}</p>}
                      {item.how && <p className="mt-2 flex gap-2 text-xs leading-relaxed text-muted"><BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{item.how}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card title="Question scores" className="mt-5"><QuestionScores questions={questions} onQuestionSelect={selectQuestion} /></Card>

          <section id="report-review" className="mt-8 scroll-mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">Answers & feedback</h2>
                <p className="mt-1 text-sm text-muted">Review the transcript, assessment and suggested improvements for each answer.</p>
              </div>
              {visibleQuestions.length > 0 && <Button size="sm" className="no-print" onClick={toggleAll}>{allExpanded ? 'Collapse all' : 'Expand all'}</Button>}
            </div>
            {questions.length > 0 && (
              <div className="no-print my-4 flex flex-wrap gap-2" role="group" aria-label="Filter question reviews">
                {[['all', 'All answers', questions.length], ['attention', 'Needs practice', needsAttention.length], ['flagged', 'Monitoring notes', flagged.length]].map(([key, label, count]) => (
                  <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${filter === key ? 'border-accent/50 bg-accent-soft/40 text-ink' : 'border-line bg-surface text-ink-soft hover:border-line-strong'}`}>{label} <span className="ml-1.5 tabular-nums text-muted">{count}</span></button>
                ))}
              </div>
            )}
            <div className="mt-4 space-y-3">
              {visibleQuestions.length ? visibleQuestions.map((q) => <QuestionReview key={q.number} question={q} interviewer={people[q.interviewer]} open={printing || expanded.has(q.number)} printing={printing} onToggle={() => toggleQuestion(q.number)} />) : (
                <Card><p className="text-sm text-muted">{questions.length ? 'No answers match this filter. Choose All answers to review the session.' : 'No answer transcript was returned for this session.'}</p></Card>
              )}
            </div>
          </section>
        </>
      )}

      {report.integrity ? <IntegrityCard integrity={report.integrity} /> : (
        <p className="mt-6 flex gap-2 text-xs leading-relaxed text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> No monitoring summary was recorded. Relaxed practice sessions do not run interview monitoring.</p>
      )}
      <p className="no-print mt-8 text-center text-xs text-muted">Save a PDF to keep this report before starting another interview.</p>
    </div>
  );
}

function FeedbackList({ entries, icon: Icon, color, empty }) {
  if (!entries.length) return <p className="text-sm leading-relaxed text-muted">{empty}</p>;
  return <ul className="space-y-3">{entries.map((item, i) => <li key={`${item}-${i}`} className="flex gap-3 text-sm leading-relaxed text-ink-soft"><Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden="true" />{item}</li>)}</ul>;
}

function IntegrityCard({ integrity }) {
  const level = INTEGRITY_LEVELS[integrity.level];
  const totals = integrity.totals || {};
  const coverage = integrity.coverage;
  const faceMeasured = coverage ? number(coverage.faceSamples) > 0 && number(coverage.faceAvailableMs) > 0 : Boolean(integrity.faceChecks);
  const phoneMeasured = coverage ? number(coverage.objectSamples) > 0 && number(coverage.objectAvailableMs) > 0 : Boolean(integrity.phoneChecks);
  const counted = (key) => number(totals[key]) === null ? 'Not recorded' : String(totals[key]);
  const duration = (key) => number(totals[key]) === null ? 'Not recorded' : formatDuration(totals[key]);
  const faceValue = (key, seconds = false) => faceMeasured ? seconds ? duration(key) : counted(key) : 'Not assessed';
  const events = items(integrity.events);
  const severityCounts = integrity.severityCounts || (events.length ? Object.fromEntries(Object.keys(SEVERITIES).map((key) => [key, events.filter((event) => event.severity === key).length])) : null);
  const metrics = [
    ['Window or tab departures', counted('awayEvents')],
    ['Time away from interview', duration('awaySeconds')],
    ['Full screen exits', counted('fullscreenExits')],
    ['Paste attempts', counted('pasteAttempts')],
    ['Face not visible', faceValue('noFaceSeconds', true)],
    ['Looking away', faceValue('lookAwaySeconds', true)],
    ['Multiple people observations', faceValue('multipleFaceEvents')],
    ...(totals.phoneEvents !== undefined ? [['Potential phone observations', phoneMeasured ? counted('phoneEvents') : 'Not assessed']] : []),
    ...(totals.phoneSeconds !== undefined ? [['Potential phone visible', phoneMeasured ? duration('phoneSeconds') : 'Not assessed']] : []),
    ...(totals.objectEvents !== undefined ? [['Other object observations', phoneMeasured ? counted('objectEvents') : 'Not assessed']] : []),
    ...(totals.faceDisappearances !== undefined ? [['Face disappearance episodes', faceValue('faceDisappearances')]] : []),
    ...(totals.tooFarSeconds !== undefined ? [['Face too far from camera', faceValue('tooFarSeconds', true)]] : []),
    ...(totals.headMovementEvents !== undefined ? [['Sustained head movement', faceValue('headMovementEvents')]] : []),
    ...(totals.cameraInterruptions !== undefined ? [['Camera interruptions', counted('cameraInterruptions')]] : []),
    ...(totals.cameraUnavailableSeconds !== undefined ? [['Camera unavailable', duration('cameraUnavailableSeconds')]] : []),
    ...(totals.microphoneInterruptions !== undefined ? [['Microphone interruptions', counted('microphoneInterruptions')]] : []),
    ...(totals.microphoneUnavailableSeconds !== undefined ? [['Microphone unavailable', duration('microphoneUnavailableSeconds')]] : []),
    ...(totals.visionUnavailableSeconds !== undefined ? [['Face checks unavailable', duration('visionUnavailableSeconds')]] : []),
    ...(totals.objectUnavailableSeconds !== undefined ? [['Object checks unavailable', duration('objectUnavailableSeconds')]] : []),
    ...(totals.copyAttempts !== undefined ? [['Copy attempts', counted('copyAttempts')]] : []),
    ...(totals.shortcutAttempts !== undefined ? [['Observed keyboard shortcuts', counted('shortcutAttempts')]] : []),
  ];
  const availability = (availableMs, samples, measured) => {
    if (!measured) return 'Unavailable / no samples';
    if (number(coverage?.activeMs) > 0) return `${Math.min(100, Math.round((availableMs / coverage.activeMs) * 100))}% of monitored time · ${samples} samples`;
    return 'Checks ran during this session';
  };

  return (
    <Card id="report-monitoring" className="mt-8 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><ShieldCheck className="size-4 text-accent" aria-hidden="true" /> Monitoring summary</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{level?.text || 'Browser observations are listed below for context.'}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink"><span className={`size-2 rounded-full ${level?.color || 'bg-muted'}`} aria-hidden="true" />{level?.label || 'Summary unavailable'}</span>
      </div>
      <p className="mt-4 rounded-lg border border-line bg-raised/50 px-3 py-3 text-xs leading-relaxed text-muted">These are observations, not proof of cheating or identity verification. Lighting, camera angle, assistive tools and normal interruptions can trigger events. Unavailable checks provide no evidence either way; monitoring does not affect your interview assessment.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line px-3 py-3"><p className="text-xs font-medium text-ink-soft">Face monitoring coverage</p><p className="mt-1 text-xs text-muted">{availability(coverage?.faceAvailableMs, coverage?.faceSamples, faceMeasured)}</p></div>
        <div className="rounded-lg border border-line px-3 py-3"><p className="text-xs font-medium text-ink-soft">Phone / object monitoring coverage</p><p className="mt-1 text-xs text-muted">{availability(coverage?.objectAvailableMs, coverage?.objectSamples, phoneMeasured)}</p></div>
      </div>

      {severityCounts && (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(SEVERITIES).map(([key, severity]) => <div key={key} className="rounded-lg border border-line px-3 py-3"><dd className="text-xl font-semibold tabular-nums text-ink">{number(severityCounts[key]) ?? '—'}</dd><dt className={`mt-1 text-xs ${severity.color}`}>{severity.label}</dt></div>)}
        </dl>
      )}
      <dl className="mt-5 grid gap-x-8 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-line/70 pb-2"><dt className="text-muted">{label}</dt><dd className="shrink-0 text-right tabular-nums text-ink-soft">{value}</dd></div>)}
      </dl>
      {items(integrity.flaggedQuestions).length > 0 && <p className="mt-4 text-xs leading-relaxed text-ink-soft">Observations accompanied {integrity.flaggedQuestions.map((n) => `Q${n}`).join(', ')}. Read the notes alongside each answer for context.</p>}

      {events.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-ink">Event log <span className="ml-1 font-normal tabular-nums text-muted">({events.length})</span></h3>
          <p className="mt-1 text-xs text-muted">A bounded record of browser observations. Repeated observations may be grouped into one event.</p>
          <ol className="mt-3 divide-y divide-line">
            {events.map((event, i) => {
              const severity = SEVERITIES[event.severity] || SEVERITIES.INFO;
              const date = new Date(event.timestamp);
              const validTime = Boolean(event.timestamp) && !Number.isNaN(date.getTime());
              const confidence = number(event.confidence);
              return (
                <li key={event.id || `${event.type}-${i}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                  <span className={`w-fit shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${severity.background} ${severity.color}`}>{severity.label}</span>
                  <div className="min-w-0 flex-1"><p className="break-words text-sm leading-relaxed text-ink-soft">{event.message || event.label || String(event.type || 'Monitoring observation').replaceAll('_', ' ').toLowerCase()}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      {validTime ? <time dateTime={event.timestamp}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time> : <span>Time unavailable</span>}
                      {number(event.duration) > 0 && <span>{formatDuration(event.duration / 1000)} duration</span>}
                      {number(event.occurrences) > 1 && <span>{event.occurrences} observations</span>}
                      {confidence !== null && ['PHONE_DETECTED', 'OBJECT_DETECTED', 'MULTIPLE_FACES'].includes(event.type) && <span>{Math.round(Math.min(confidence, 1) * 100)}% detection confidence</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : <p className="mt-5 text-xs leading-relaxed text-muted">No event log was returned for this session. Check monitoring coverage before interpreting zero counts.</p>}
      <p className="mt-5 text-xs leading-relaxed text-muted">The browser cannot see activity on another physical device or prove what an observed object is used for. Face monitoring detects visible faces and approximate movement; it does not recognise or authenticate a person. Camera frames stay in the browser.</p>
    </Card>
  );
}

function QuestionReview({ question: q, interviewer, open, printing, onToggle }) {
  const verdict = VERDICTS[q.verdict] || { label: 'Not assessed', color: 'bg-muted' };
  const flags = items(q.integrityFlags);
  const details = [['What worked', q.review?.good], ['What was missing', q.review?.missing], ['How to improve', q.review?.improve], ['A stronger answer structure', q.review?.ideal_structure]].filter(([, text]) => text);
  const score = number(q.score);
  const skipped = q.verdict === 'no_answer' || !q.answer;
  return (
    <article id={`question-${q.number}`} className="print-plain scroll-mt-6 overflow-hidden rounded-xl border border-line bg-surface">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`answer-${q.number}`} className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-raised/40 sm:gap-4 sm:px-5">
        <span className="mt-0.5 w-7 shrink-0 text-sm font-medium tabular-nums text-muted">Q{q.number}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-muted">{CATEGORY_LABEL[q.category] || q.category || 'Interview question'}{q.isFollowUp ? ' · Follow-up' : ''}{interviewer && ` · ${interviewer.name}, ${interviewer.title}`}</p>
          <h3 className="mt-1.5 break-words text-sm font-medium leading-relaxed text-ink">{q.question}</h3>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-soft">
            <span className="inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${verdict.color}`} aria-hidden="true" />{skipped ? 'Skipped' : verdict.label}</span>
            {!skipped && score !== null && <span className="tabular-nums text-muted">{Math.min(score, 10)} / 10</span>}
            {flags.length > 0 && <span className="inline-flex items-center gap-1 text-muted"><AlertTriangle className="size-3 text-warning" aria-hidden="true" />Monitoring notes</span>}
            {q.contextLimited && <span className="inline-flex items-center gap-1 text-muted"><CircleAlert className="size-3 text-warning" aria-hidden="true" />Feedback uses an excerpt</span>}
          </div>
        </div>
        <ChevronDown className={`no-print mt-0.5 size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={`answer-${q.number}`} className="space-y-5 border-t border-line px-4 py-5 sm:pl-[4rem] sm:pr-6">
          <div>
            <h4 className="text-xs font-semibold text-ink">Your answer</h4>
            {q.contextLimited && <ContextCoverage question={q} />}
            <AnswerTranscript answer={q.answer} printing={printing} />
          </div>
          {flags.length > 0 && <div className="rounded-lg border border-warning/20 bg-warning/5 p-3"><h4 className="text-xs font-medium text-ink-soft">Monitoring observations during this answer</h4><ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">{flags.map((flag, i) => <li key={`${flag}-${i}`} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden="true" />{flag}</li>)}</ul></div>}
          {details.map(([label, text]) => <div key={label}><h4 className="text-xs font-semibold text-ink">{label}</h4><p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-ink-soft">{text}</p></div>)}
          {!details.length && !skipped && <p className="text-xs text-muted">Detailed feedback was not returned for this answer.</p>}
          {q.exampleAnswer && <div className="rounded-lg border border-accent/25 bg-accent-soft/20 p-4"><h4 className="text-xs font-semibold text-accent">Example answer to adapt</h4><p className="mt-1 text-xs leading-relaxed text-muted">Use your own experience and evidence when practising this structure.</p><p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-ink-soft">{q.exampleAnswer}</p></div>}
        </div>
      )}
    </article>
  );
}

function ContextCoverage({ question }) {
  const answerCharacters = number(question.answerCharacters);
  const reportCharacters = number(question.reportContextCharacters) ?? number(question.contextCharacters);
  const liveCharacters = number(question.liveContextCharacters);
  return (
    <p className="mt-2 text-xs leading-relaxed text-muted">
      AI feedback used excerpts.
      {answerCharacters !== null && reportCharacters !== null && ` Final review: ${reportCharacters.toLocaleString()} of ${answerCharacters.toLocaleString()} characters.`}
      {answerCharacters !== null && liveCharacters !== null && liveCharacters < answerCharacters && ` Interview follow-up: ${liveCharacters.toLocaleString()} of ${answerCharacters.toLocaleString()} characters.`}
      {' '}The complete response is preserved below; details outside a review excerpt may not have been assessed.
    </p>
  );
}

// Keep every character available while avoiding layout of long offscreen paragraphs.
function AnswerTranscript({ answer, printing }) {
  const [fullHeight, setFullHeight] = useState(false);
  const long = typeof answer === 'string' && answer.length > 12000;
  const chunks = useMemo(() => {
    if (!long) return [];
    const result = [];
    let offset = 0;
    while (offset < answer.length) {
      let end = Math.min(offset + 12000, answer.length);
      if (end < answer.length) {
        const candidate = answer.slice(offset, end);
        const newline = candidate.lastIndexOf('\n');
        const space = candidate.lastIndexOf(' ');
        if (newline > 6000) end = offset + newline + 1;
        else if (space > 6000) end = offset + space + 1;
      }
      result.push(answer.slice(offset, end));
      offset = end;
    }
    return result;
  }, [answer, long]);

  if (!answer) return <p className="mt-2 text-sm text-muted"><em>No answer submitted.</em></p>;
  if (!long || printing) return <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">{answer}</p>;
  return (
    <>
      <div className="no-print mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Complete response · {answer.length.toLocaleString()} characters{fullHeight ? '' : ' · Scroll to read'}</p>
        <Button size="sm" variant="ghost" onClick={() => setFullHeight((value) => !value)}>{fullHeight ? 'Use compact view' : 'Expand transcript'}</Button>
      </div>
      <div role="region" aria-label="Complete answer transcript" tabIndex={fullHeight ? undefined : 0}
        className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft ${fullHeight ? '' : 'max-h-72 overflow-y-auto rounded-md border border-line bg-raised/30 px-3 py-2'}`}>
        {chunks.map((chunk, index) => <div key={index} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}>{chunk}</div>)}
      </div>
    </>
  );
}
