import { ArrowRight, Mic, ShieldCheck, Video } from 'lucide-react';
import DocumentCard from './DocumentCard';
import { Button, ErrorBanner, OptionGroup, Portrait, TextField } from './ui';
import { AVATARS, DIFFICULTIES, INTERVIEW_TYPES, LENGTHS, ROLE_INFO, avatarById, buildPanel } from '../data/panel';

const CONDITIONS = [
  { id: true, label: 'Real interview', description: 'Camera on, full screen, no pasting. Tab switches and looking away are noted.' },
  { id: false, label: 'Relaxed practice', description: 'No integrity checks. Camera is optional.' },
];

const PANEL_SIZES = [
  { id: 1, label: '1 interviewer', description: 'One-to-one' },
  { id: 2, label: '2 interviewers', description: 'Small panel' },
  { id: 3, label: '3 interviewers', description: 'Full panel' },
];

function Section({ step, title, description, children }) {
  return (
    <section className="animate-rise">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-xs font-semibold tabular-nums text-accent">{String(step).padStart(2, '0')}</span>
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SetupScreen({ setup, setSetup, docs, onAnalyze, onClear, health, onStart }) {
  const update = (changes) => setSetup((current) => ({ ...current, ...changes }));
  const setType = (type) => update({ type, panel: buildPanel(type, setup.panel.length, setup.panel) });
  const setPanelSize = (size) => update({ panel: buildPanel(setup.type, size, setup.panel) });
  const setAvatar = (seat, avatarId) => update({ panel: setup.panel.map((s, i) => (i === seat ? { ...s, avatarId } : s)) });

  const noProvider = health && !health.providers.gemini && !health.providers.groq;
  const docError = docs.cv.status === 'error' || docs.jd.status === 'error';
  const blocker = noProvider
    ? 'The server has no AI keys configured yet.'
    : setup.role.trim().length < 2
      ? 'Enter the job role to continue.'
      : docError ? 'Retry or remove the document that failed.' : '';

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
      <header className="mb-10 max-w-2xl">
        <p className="text-sm font-medium text-accent">Interview Room</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Practise the interview before the interview.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          An AI panel reads your CV and the job description, then interviews you the way a real team would: follow-ups, pushback and all.
          You get a detailed debrief at the end.
        </p>
      </header>

      {noProvider && (
        <div className="mb-8"><ErrorBanner message="This server has no Gemini or Groq API key configured, so interviews can't start. Add GEMINI_API_KEY or GROQ_API_KEY to the environment and restart." /></div>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className="space-y-12">
          <Section step={1} title="The role" description="The company name shapes the interview style; it is never used to invent facts.">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Company" hint="(optional)" placeholder="e.g. Google, EY, Qualcomm" value={setup.company} maxLength={80} onChange={(e) => update({ company: e.target.value })} />
              <TextField label="Job role" placeholder="e.g. Data Analyst" value={setup.role} maxLength={80} onChange={(e) => update({ role: e.target.value })} />
              <TextField label="Your first name" hint="(optional)" placeholder="How the panel should greet you" value={setup.candidateName} maxLength={60} onChange={(e) => update({ candidateName: e.target.value })} />
            </div>
          </Section>

          <Section step={2} title="Your documents" description="Questions are built from these. Without them the interview is based on the role alone.">
            <div className="grid gap-4 md:grid-cols-2">
              <DocumentCard kind="cv" title="CV / Resume" hint="PDF, DOCX, TXT or a photo · max 5 MB" doc={docs.cv} onAnalyze={onAnalyze} onClear={onClear} />
              <DocumentCard kind="jd" title="Job description" hint="PDF, DOCX, TXT or a screenshot · max 5 MB" doc={docs.jd} onAnalyze={onAnalyze} onClear={onClear} />
            </div>
          </Section>

          <Section step={3} title="Interview format">
            <div className="space-y-6">
              <OptionGroup label="Type" options={INTERVIEW_TYPES} value={setup.type} onChange={setType} />
              <OptionGroup label="Difficulty" options={DIFFICULTIES} value={setup.difficulty} onChange={(difficulty) => update({ difficulty })} />
              <OptionGroup label="Length" options={LENGTHS} value={setup.length} onChange={(length) => update({ length })} />
              <OptionGroup label="Conditions" options={CONDITIONS} value={setup.proctored} onChange={(proctored) => update({ proctored })} columns={2} />
            </div>
          </Section>

          <Section step={4} title="Your panel" description="Each interviewer has their own role, focus and voice.">
            <OptionGroup label="Panel size" options={PANEL_SIZES} value={setup.panel.length} onChange={setPanelSize} />
            <div className="mt-6 space-y-4">
              {setup.panel.map((seat, index) => {
                const taken = new Set(setup.panel.filter((_, i) => i !== index).map((s) => s.avatarId));
                const chosen = avatarById(seat.avatarId);
                return (
                  <div key={seat.role} className="rounded-xl border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {chosen.name} <span className="font-normal text-muted">· {ROLE_INFO[seat.role].title}{index === 0 ? ' · leads' : ''}</span>
                      </p>
                      <p className="text-xs text-muted">{ROLE_INFO[seat.role].blurb}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {AVATARS.map((avatar) => {
                        const selected = avatar.id === seat.avatarId;
                        return (
                          <button
                            key={avatar.id}
                            type="button"
                            disabled={taken.has(avatar.id)}
                            onClick={() => setAvatar(index, avatar.id)}
                            aria-pressed={selected}
                            title={`${avatar.name} · ${avatar.label}`}
                            className={`group text-left disabled:cursor-not-allowed disabled:opacity-30 ${selected ? '' : 'opacity-75 hover:opacity-100'}`}
                          >
                            <Portrait avatar={avatar} className={`aspect-square rounded-lg ring-2 transition ${selected ? 'ring-accent' : 'ring-transparent'}`} />
                            <span className="mt-1.5 block truncate text-[11px] text-muted group-hover:text-ink-soft">{avatar.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Your interview</p>
            <p className="mt-2 text-lg font-semibold leading-snug text-ink">
              {setup.role.trim() || 'Job role'}
              {setup.company.trim() && <span className="font-normal text-ink-soft"> at {setup.company.trim()}</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {INTERVIEW_TYPES.find((t) => t.id === setup.type).label} · {DIFFICULTIES.find((d) => d.id === setup.difficulty).label} · {setup.length} questions
            </p>
            {setup.proctored && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-ink-soft">
                <ShieldCheck className="size-3.5 text-accent" aria-hidden /> Real interview conditions
              </p>
            )}

            <div className="mt-5 flex -space-x-3">
              {setup.panel.map((seat) => (
                <Portrait key={seat.role} avatar={avatarById(seat.avatarId)} className="size-12 rounded-full ring-2 ring-surface" />
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-sm text-ink-soft">
              {setup.panel.map((seat) => (
                <li key={seat.role}>{avatarById(seat.avatarId).name} <span className="text-muted">· {ROLE_INFO[seat.role].title}</span></li>
              ))}
            </ul>

            <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm">
              {[['CV', docs.cv], ['Job description', docs.jd]].map(([label, doc]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className={doc.status === 'error' ? 'text-critical' : 'text-ink-soft'}>
                    {{ empty: 'Not provided', analyzing: 'Analysing…', ready: 'Ready', error: 'Failed' }[doc.status]}
                  </dd>
                </div>
              ))}
            </dl>

            <Button variant="primary" size="lg" className="mt-6 w-full" disabled={Boolean(blocker)} onClick={onStart}>
              Start interview <ArrowRight className="size-4" />
            </Button>
            {blocker && <p className="mt-2 text-center text-xs text-muted">{blocker}</p>}

            <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              <p className="flex gap-2"><Mic className="mt-0.5 size-3.5 shrink-0" /> Answer by voice (best in Chrome or Edge) or by typing.</p>
              <p className="flex gap-2"><Video className="mt-0.5 size-3.5 shrink-0" /> Your camera stays on your device. Integrity checks run in your browser; video is never uploaded.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
