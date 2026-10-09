import {
  ArrowRight,
  Check,
  ClipboardList,
  MessageSquare,
  Mic,
  ShieldCheck,
  SlidersHorizontal,
  Video,
} from 'lucide-react';
import DocumentCard from './DocumentCard';
import { Button, ErrorBanner, OptionGroup, Portrait, TextField } from './ui';
import {
  AVATARS,
  DIFFICULTIES,
  INTERVIEW_TYPES,
  LENGTHS,
  ROLE_INFO,
  avatarById,
  buildPanel,
} from '../data/panel';

const CONDITIONS = [
  {
    id: true,
    label: 'Monitored practice',
    description:
      'Camera and browser activity checks. Sustained events appear in your report.',
  },
  {
    id: false,
    label: 'Relaxed practice',
    description: 'Camera is optional. No monitoring events are recorded.',
  },
];
const PANEL_SIZES = [
  { id: 1, label: '1 interviewer', description: 'A focused conversation' },
  { id: 2, label: '2 interviewers', description: 'Two perspectives' },
  { id: 3, label: '3 interviewers', description: 'A complete panel' },
];
const WORKFLOW = [
  {
    icon: SlidersHorizontal,
    title: 'Make it relevant',
    detail: 'Choose a role, add your documents and set the level.',
  },
  {
    icon: MessageSquare,
    title: 'Have a conversation',
    detail:
      'Answer one question at a time, with follow-ups based on your responses.',
  },
  {
    icon: ClipboardList,
    title: 'Review your answers',
    detail: 'Get a score, specific feedback and areas to work on.',
  },
];

function Section({ step, title, description, children }) {
  return (
    <section
      className="rounded-xl border border-line bg-surface p-5 sm:p-6"
      aria-labelledby={`setup-section-${step}`}
    >
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded border border-line-strong text-xs font-medium tabular-nums text-muted">
          {step}
        </span>
        <div>
          <h2
            id={`setup-section-${step}`}
            className="text-base font-semibold tracking-tight text-ink"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SetupScreen({
  setup,
  setSetup,
  docs,
  onAnalyze,
  onClear,
  health,
  onStart,
}) {
  const update = (changes) =>
    setSetup((current) => ({ ...current, ...changes }));
  const setType = (type) =>
    update({ type, panel: buildPanel(type, setup.panel.length, setup.panel) });
  const setPanelSize = (size) =>
    update({ panel: buildPanel(setup.type, size, setup.panel) });
  const setAvatar = (seat, avatarId) =>
    update({
      panel: setup.panel.map((s, i) => (i === seat ? { ...s, avatarId } : s)),
    });
  const noProvider =
    health && !health.providers?.gemini && !health.providers?.groq;
  const docError = docs.cv.status === 'error' || docs.jd.status === 'error';
  const blocker = noProvider
    ? 'The AI service is temporarily unavailable. Try again shortly.'
    : setup.role.trim().length < 2
      ? 'Enter a job role to continue.'
      : docError
        ? 'Retry or remove the document that could not be read.'
        : '';

  return (
    <div className="mx-auto max-w-7xl px-4 pb-32 sm:px-6 lg:px-8 lg:pb-12">
      <header className="flex items-center justify-between gap-4 border-b border-line py-5 sm:py-6">
        <a
          href="#"
          className="flex items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight text-ink"
          aria-label="Interview Room home"
        >
          <span className="grid size-8 place-items-center rounded-lg border border-line-strong bg-surface">
            <MessageSquare className="size-4 text-accent" aria-hidden />
          </span>
          Interview Room
        </a>
        <span className="text-xs text-muted sm:text-sm">
          Practice workspace
        </span>
      </header>

      <div className="py-8 sm:py-10">
        <p className="text-xs font-medium uppercase tracking-widest text-accent">
          Your next interview starts here
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          Prepare with a conversation that adapts to you.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-ink-soft sm:text-base">
          Practise technical and HR interviews with an AI panel. Bring your CV
          or a job description, answer in your own words, and leave with useful
          feedback.
        </p>
        <div className="mt-7 grid gap-4 border-y border-line py-5 md:grid-cols-3 md:gap-6">
          {WORKFLOW.map(({ icon: Icon, title, detail }, index) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">
                  <span className="mr-2 text-xs tabular-nums text-muted">
                    0{index + 1}
                  </span>
                  {title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {noProvider && (
        <div className="mb-6">
          <ErrorBanner message="The AI service is temporarily unavailable. Your setup is preserved; please try again shortly." />
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-5">
          <Section
            step={1}
            title="Choose the role"
            description="Give the panel a clear target. Documents are optional, so a job role is enough to begin."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Job role"
                placeholder="e.g. Software Engineer"
                value={setup.role}
                maxLength={80}
                required
                onChange={(e) => update({ role: e.target.value })}
                autoComplete="organization-title"
              />
              <TextField
                label="Company"
                hint="(optional)"
                placeholder="Where you are interviewing"
                value={setup.company}
                maxLength={80}
                onChange={(e) => update({ company: e.target.value })}
                autoComplete="organization"
              />
              <TextField
                label="First name"
                hint="(optional)"
                placeholder="How the panel should address you"
                value={setup.candidateName}
                maxLength={60}
                onChange={(e) => update({ candidateName: e.target.value })}
                autoComplete="given-name"
              />
              <p className="self-end pb-2 text-xs leading-relaxed text-muted">
                A company name gives context. The panel does not have access to
                that company's private interview process.
              </p>
            </div>
          </Section>

          <Section
            step={2}
            title="Add context"
            description="Your CV helps the panel explore your experience. A job description helps it focus on the role's requirements."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <DocumentCard
                kind="cv"
                title="CV / Resume"
                hint="PDF, DOCX, TXT, MD or image · up to 5 MB"
                doc={docs.cv}
                onAnalyze={onAnalyze}
                onClear={onClear}
              />
              <DocumentCard
                kind="jd"
                title="Job description"
                hint="PDF, DOCX, TXT, MD or image · up to 5 MB"
                doc={docs.jd}
                onAnalyze={onAnalyze}
                onClear={onClear}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Documents are processed by the server and the configured AI
              provider. Avoid including personal details you do not need for
              practice.
            </p>
          </Section>

          <Section step={3} title="Set the interview format">
            <div className="space-y-6">
              <OptionGroup
                label="Interview type"
                options={INTERVIEW_TYPES}
                value={setup.type}
                onChange={setType}
              />
              <OptionGroup
                label="Difficulty"
                options={DIFFICULTIES}
                value={setup.difficulty}
                onChange={(difficulty) => update({ difficulty })}
              />
              <OptionGroup
                label="Interview length"
                options={LENGTHS}
                value={setup.length}
                onChange={(length) => update({ length })}
              />
              <p className="-mt-3 text-xs leading-relaxed text-muted">
                Take as much time as you need for each answer. These options set
                the number of questions, not a deadline.
              </p>
              <OptionGroup
                label="Practice conditions"
                options={CONDITIONS}
                value={setup.proctored}
                onChange={(proctored) => update({ proctored })}
                columns={2}
              />
            </div>
          </Section>

          <Section
            step={4}
            title="Meet your panel"
            description="Choose AI personas for each interviewer. Photos represent the panel; speech uses the voices available in your browser."
          >
            <OptionGroup
              label="Panel size"
              options={PANEL_SIZES}
              value={setup.panel.length}
              onChange={setPanelSize}
            />
            <div className="mt-5 space-y-5">
              {setup.panel.map((seat, index) => {
                const taken = new Set(
                  setup.panel
                    .filter((_, i) => i !== index)
                    .map((s) => s.avatarId),
                );
                const chosen = avatarById(seat.avatarId);
                return (
                  <div key={seat.role} className="border-t border-line pt-5">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {ROLE_INFO[seat.role].title}
                          {index === 0 && (
                            <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-normal text-muted">
                              Lead
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {ROLE_INFO[seat.role].blurb}
                        </p>
                      </div>
                      <p className="text-xs text-ink-soft">{chosen.name}</p>
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
                            aria-label={`Choose ${avatar.name} as ${ROLE_INFO[seat.role].title}${taken.has(avatar.id) ? ', already on the panel' : ''}`}
                            className={`group relative rounded-lg border p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${selected ? 'border-accent bg-accent-soft/25' : 'border-transparent hover:border-line-strong'}`}
                          >
                            <Portrait
                              avatar={avatar}
                              className="aspect-square rounded-md"
                            />
                            {selected && (
                              <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-accent-strong text-white">
                                <Check className="size-3" aria-hidden />
                              </span>
                            )}
                            <span className="mt-2 block truncate text-xs text-ink-soft">
                              {avatar.name.split(' ')[0]}
                            </span>
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

        <aside
          className="rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-6"
          aria-label="Interview summary"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Session overview
          </p>
          <h2 className="mt-3 break-words text-lg font-semibold leading-snug text-ink">
            {setup.role.trim() || 'Your interview'}
            {setup.company.trim() && (
              <span className="block pt-1 text-sm font-normal text-ink-soft">
                at {setup.company.trim()}
              </span>
            )}
          </h2>
          <dl className="mt-5 space-y-3 text-sm">
            {[
              [
                'Format',
                INTERVIEW_TYPES.find((t) => t.id === setup.type).label,
              ],
              [
                'Difficulty',
                DIFFICULTIES.find((d) => d.id === setup.difficulty).label,
              ],
              ['Questions', `${setup.length} planned + follow-ups`],
              [
                'Conditions',
                setup.proctored ? 'Monitored practice' : 'Relaxed practice',
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right text-ink-soft">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 border-y border-line py-4">
            <p className="mb-3 text-xs text-muted">Your AI panel</p>
            <ul className="space-y-3">
              {setup.panel.map((seat) => (
                <li key={seat.role} className="flex items-center gap-3">
                  <Portrait
                    avatar={avatarById(seat.avatarId)}
                    className="size-9 shrink-0 rounded-lg"
                    initialsClassName="text-xs"
                  />
                  <div>
                    <p className="text-xs font-medium text-ink">
                      {avatarById(seat.avatarId).name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {ROLE_INFO[seat.role].title}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <dl className="mt-4 space-y-2 text-xs" aria-live="polite">
            {[
              ['CV', docs.cv],
              ['Job description', docs.jd],
            ].map(([label, doc]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted">{label}</dt>
                <dd
                  className={
                    doc.status === 'error'
                      ? 'text-critical'
                      : doc.status === 'ready'
                        ? 'text-good'
                        : 'text-ink-soft'
                  }
                >
                  {
                    {
                      empty: 'Not added',
                      analyzing: 'Reading…',
                      ready: 'Ready',
                      error: 'Needs attention',
                    }[doc.status]
                  }
                </dd>
              </div>
            ))}
          </dl>
          <Button
            variant="primary"
            size="lg"
            className="mt-6 w-full"
            disabled={Boolean(blocker)}
            onClick={onStart}
            aria-describedby="setup-start-hint"
          >
            Check devices & continue{' '}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <p
            id="setup-start-hint"
            className="mt-2 text-center text-xs leading-relaxed text-muted"
          >
            {blocker || 'Your interview begins after the device check.'}
          </p>
          <div className="mt-5 space-y-3 border-t border-line pt-4 text-xs leading-relaxed text-muted">
            <p className="flex gap-2">
              <Mic className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Speak or
              type your answers. Browser voice support varies; typing is always
              available.
            </p>
            <p className="flex gap-2">
              <Video className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Camera
              analysis stays on this device. Video frames are never sent to the
              server.
            </p>
            {setup.proctored && (
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{' '}
                Monitoring records observable signals for review. It does not
                prove misconduct or verify your identity.
              </p>
            )}
          </div>
        </aside>
      </div>
      <footer className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        A practice session, not a hiring decision. AI feedback is a starting
        point for your preparation.
      </footer>
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {setup.role.trim() || 'Set up your interview'}
            </p>
            <p
              id="mobile-setup-hint"
              className="mt-0.5 text-xs leading-relaxed text-muted"
            >
              {blocker || `${setup.length} questions · Answer at your own pace`}
            </p>
          </div>
          <Button
            variant="primary"
            className="shrink-0"
            disabled={Boolean(blocker)}
            onClick={onStart}
            aria-label="Continue to device check"
            aria-describedby="mobile-setup-hint"
          >
            Continue <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
