import { useEffect, useId, useState } from 'react';
import { ArrowLeft, Bookmark, BookOpen, Download, History, Trash2 } from 'lucide-react';
import { Button, ErrorBanner } from './ui';
import { PRACTICE_CATEGORIES, PRACTICE_QUESTIONS, filterQuestions } from '../data/practice';
import { deleteReport, HISTORY_KEY, PRACTICE_KEY, readPractice, readReports, storageError, togglePractice } from '../practice-storage';
import { downloadText } from '../report-export';

const selectClass = 'mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink';
const formatLabel = { mixed: 'Mixed', technical: 'Technical', hr: 'HR' };

function Filter({ label, value, onChange, options }) {
  const id = useId();
  return <div>
    <label htmlFor={id} className="block text-xs text-muted">{label}</label>
    <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
    </select>
  </div>;
}

export default function PracticeWorkspace({ initialTab = 'questions', backLabel = 'Interview setup', onBack }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Button variant="ghost" onClick={onBack}><ArrowLeft className="size-4" aria-hidden /> {backLabel}</Button>
      <header className="my-7">
        <p className="text-xs font-medium uppercase tracking-widest text-accent">Your preparation workspace</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Make practice a habit.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Work through one question at a time, revisit your feedback and decide what to practise next.</p>
      </header>
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Preparation sections">
        <Button variant={tab === 'questions' ? 'primary' : 'secondary'} aria-pressed={tab === 'questions'} onClick={() => setTab('questions')}><BookOpen className="size-4" aria-hidden /> Question library</Button>
        <Button variant={tab === 'history' ? 'primary' : 'secondary'} aria-pressed={tab === 'history'} onClick={() => setTab('history')}><History className="size-4" aria-hidden /> Saved reports</Button>
      </nav>
      <div hidden={tab !== 'questions'}><QuestionLibrary /></div>
      <div hidden={tab !== 'history'}><ReportHistory /></div>
    </main>
  );
}

function QuestionLibrary() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [level, setLevel] = useState('All');
  const [savedOnly, setSavedOnly] = useState(false);
  const [progress, setProgress] = useState({ bookmarks: [], completed: [] });
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    const load = () => {
      try { setProgress(readPractice(window.localStorage)); setError(''); }
      catch (cause) { setError(storageError(cause)); }
    };
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);
  const toggle = (field, id) => {
    try { setProgress(togglePractice(window.localStorage, field, id)); setError(''); }
    catch (cause) { setError(storageError(cause)); }
  };
  const clear = () => {
    try {
      window.localStorage.removeItem(PRACTICE_KEY);
      setProgress({ bookmarks: [], completed: [] }); setError(''); setConfirmClear(false);
    } catch (cause) { setError(storageError(cause)); }
  };
  const questions = filterQuestions({ search, category, level, savedOnly, bookmarks: progress.bookmarks });
  const completed = PRACTICE_QUESTIONS.filter((q) => progress.completed.includes(q.id)).length;
  return (
    <section aria-labelledby="question-library-heading">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="question-library-heading" className="text-lg font-semibold">A small practice session, whenever you need it.</h2>
            <p className="mt-2 text-sm text-muted">Original practice prompts with answer outlines. No AI key, camera or microphone needed.</p>
          </div>
          <p className="text-sm text-accent" aria-live="polite">{completed} / {PRACTICE_QUESTIONS.length} practised</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="text-xs text-muted">Search questions
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try teamwork, SQL or customers" className={selectClass} />
          </label>
          <Filter label="Topic" value={category} onChange={setCategory} options={['All', ...PRACTICE_CATEGORIES]} />
          <Filter label="Level" value={level} onChange={setLevel} options={['All', 'Foundation', 'Stretch']} />
        </div>
        <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} className="size-4 accent-accent" /> Bookmarked only
        </label>
        <p className="mt-4 text-xs leading-relaxed text-muted">Bookmarks and completion marks stay on this browser. Draft answers stay only while this workspace is open and are not submitted or scored.</p>
      </div>
      <div className="mt-4"><ErrorBanner message={error} /></div>
      <p className="my-4 text-xs text-muted" role="status">{questions.length} {questions.length === 1 ? 'question' : 'questions'} shown</p>
      <div className="space-y-4">
        {questions.map((q) => (
          <article key={q.id} className="rounded-xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-accent">{q.category} · {q.level}</p>
                <h3 className="mt-2 text-base font-medium leading-relaxed">{q.question}</h3>
              </div>
              <Button size="sm" aria-label={`Bookmark: ${q.question}`} aria-pressed={progress.bookmarks.includes(q.id)} onClick={() => toggle('bookmarks', q.id)}>
                <Bookmark className={`size-4 ${progress.bookmarks.includes(q.id) ? 'fill-accent text-accent' : ''}`} aria-hidden />
              </Button>
            </div>
            <details className="mt-4">
              <summary className="w-fit cursor-pointer rounded text-sm text-accent">Draft an answer & see the outline</summary>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor={`draft-${q.id}`} className="text-sm text-ink-soft">Your practice answer</label>
                  <textarea id={`draft-${q.id}`} rows={6} value={drafts[q.id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [q.id]: event.target.value }))}
                    placeholder="Use your own experience. What did you do, and what happened?" className="mt-2 w-full rounded-lg border border-line-strong bg-canvas p-3 text-sm leading-7" />
                  <p className="mt-1 text-xs text-muted">{(drafts[q.id] || '').trim().split(/\s+/).filter(Boolean).length} words · Not saved</p>
                </div>
                <div className="rounded-lg bg-raised/50 p-4">
                  <h4 className="text-sm font-medium">Check your structure</h4>
                  <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted">{q.outline.map((point) => <li key={point}>{point}</li>)}</ul>
                  <p className="mt-4 text-xs text-muted">Say it aloud, then revise. These are prompts for reflection, not a model answer or AI assessment.</p>
                </div>
              </div>
            </details>
            <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={progress.completed.includes(q.id)} onChange={() => toggle('completed', q.id)} className="size-4 accent-accent" />
              Practised<span className="sr-only">: {q.question}</span>
            </label>
          </article>
        ))}
      </div>
      {!questions.length && <div className="rounded-xl border border-line p-6">
        <p className="text-sm text-muted">No questions match. Try a broader search or bookmark a question first.</p>
        <Button className="mt-4" onClick={() => { setSearch(''); setCategory('All'); setLevel('All'); setSavedOnly(false); }}>Reset filters</Button>
      </div>}
      <div className="mt-6 border-t border-line pt-4">
        {confirmClear ? <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Remove all bookmarks and completion marks from this browser?</p>
          <Button variant="danger" onClick={clear}>Confirm clear progress</Button>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
        </div> : <Button variant="ghost" onClick={() => setConfirmClear(true)}>Clear practice progress</Button>}
      </div>
    </section>
  );
}

function ReportHistory() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [role, setRole] = useState('All');
  const [type, setType] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [pendingDelete, setPendingDelete] = useState(null);
  useEffect(() => {
    const load = () => {
      try { setEntries(readReports(window.localStorage)); setError(''); }
      catch (cause) { setError(storageError(cause)); }
    };
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);
  const remove = () => {
    try {
      if (pendingDelete === 'all') { window.localStorage.removeItem(HISTORY_KEY); setEntries([]); }
      else setEntries(deleteReport(window.localStorage, pendingDelete));
      setError(''); setPendingDelete(null); setRole('All');
    } catch (cause) { setError(storageError(cause)); }
  };
  const roles = [...new Set(entries.map((entry) => entry.role))];
  const filtered = entries.filter((entry) => (role === 'All' || entry.role === role) && (type === 'All' || entry.type === type) && (difficulty === 'All' || entry.difficulty === difficulty));
  return (
    <section aria-labelledby="saved-reports-heading">
      <h2 id="saved-reports-heading" className="text-lg font-semibold">Your saved practice</h2>
      <p className="mt-2 text-sm leading-7 text-muted">Save a report after an interview to keep its feedback and full answer transcript here. Up to 20 reports are stored on this browser only, visible to anyone using this browser profile. Clearing site data removes them.</p>
      <div className="mt-4"><ErrorBanner message={error} /></div>
      {!entries.length && !error && <div className="mt-6 rounded-xl border border-dashed border-line-strong p-8 text-center">
        <History className="mx-auto size-7 text-muted" aria-hidden />
        <h3 className="mt-3 font-medium">Your first report starts with a conversation.</h3>
        <p className="mt-2 text-sm text-muted">Finish an interview, then choose “Save to this browser” on the report page.</p>
      </div>}
      {entries.length > 0 && <>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Filter label="Saved role" value={role} onChange={setRole} options={['All', ...roles]} />
          <Filter label="Interview format" value={type} onChange={setType} options={['All', ...Object.entries(formatLabel).map(([value, label]) => ({ value, label }))]} />
          <Filter label="Difficulty" value={difficulty} onChange={setDifficulty} options={['All', 'easy', 'medium', 'hard']} />
        </div>
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h3 className="font-medium">Score history</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted">Filter to the same role, format and difficulty for more useful comparisons. AI scores vary with the questions and are not a standardised measure of improvement.</p>
          <ul className="mt-4 space-y-3">
            {[...filtered].reverse().map((entry) => <li key={entry.id}>
              <div className="mb-1 flex justify-between gap-3 text-xs"><span className="min-w-0 break-words text-muted">{new Date(entry.savedAt).toLocaleDateString()} · {entry.role}</span><span className="shrink-0">{entry.score === null ? 'Not assessed' : `${entry.score} / 100`}</span></div>
              {entry.score !== null && <meter min="0" max="100" value={entry.score} className="h-3 w-full" aria-label={`${entry.role} score on ${new Date(entry.savedAt).toLocaleString()}`} />}
            </li>)}
          </ul>
          {!filtered.length && <p className="mt-4 text-sm text-muted">No saved reports match these filters.</p>}
        </div>
        <div className="mt-5 space-y-4">
          {filtered.map((entry) => <article key={entry.id} className="rounded-xl border border-line bg-surface p-5">
            <h3 className="break-words font-medium">{entry.role}{entry.company && ` · ${entry.company}`}</h3>
            <p className="mt-1 text-xs text-muted">{new Date(entry.savedAt).toLocaleString()} · {formatLabel[entry.type]} · {entry.difficulty}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => downloadText(entry.text)}><Download className="size-4" aria-hidden /> Download saved report</Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(entry.id)} aria-label={`Delete report: ${entry.role}`}><Trash2 className="size-4" aria-hidden /> Delete</Button>
            </div>
            {pendingDelete === entry.id && <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted">Remove this report from the browser?</p>
              <Button size="sm" variant="danger" onClick={remove}>Confirm delete</Button>
              <Button size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
            </div>}
            <details className="mt-4">
              <summary className="w-fit cursor-pointer rounded text-sm text-accent">Read saved report</summary>
              <pre className="mt-4 max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-canvas p-4 font-sans text-sm leading-7">{entry.text}</pre>
            </details>
          </article>)}
        </div>
      </>}
      {(entries.length > 0 || error) && <div className="mt-6 border-t border-line pt-4">
        {pendingDelete === 'all' ? <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Delete every saved report from this browser? Download any copies you need first.</p>
          <Button variant="danger" onClick={remove}>Confirm delete all reports</Button>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
        </div> : <Button variant="ghost" onClick={() => setPendingDelete('all')}>Delete all saved reports</Button>}
      </div>}
    </section>
  );
}
