const GUIDES = [
  ['Introduce yourself', 'Start with what you do, connect one relevant experience to the role, and explain what you want to work on next. Aim for a focused opening, not your entire CV.'],
  ['Make your examples concrete', 'For behavioural questions, use STAR: Situation, Task, Action, Result. Keep the context short, explain your own contribution, and include a result or lesson.'],
  ['Explain your reasoning', 'For technical and scenario questions, clarify the problem, state assumptions, compare options and explain your choice. Discuss how you would test it and what could go wrong.'],
  ['When you do not know', 'Say what you know, identify the gap and explain how you would investigate. A clear approach is more useful than a confident guess.'],
];

export default function PracticeGuide() {
  return (
    <section id="practice-guide" className="scroll-mt-6 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="practice-guide-heading">
      <p className="text-xs font-medium uppercase tracking-widest text-accent">Before you begin</p>
      <h2 id="practice-guide-heading" className="mt-2 text-lg font-semibold text-ink">Build an answer worth discussing.</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">Prepare a few examples, then practise saying them in your own words.</p>
      <div className="mt-4 divide-y divide-line">
        {GUIDES.map(([title, detail]) => (
          <details key={title} className="py-3">
            <summary className="cursor-pointer rounded text-sm font-medium text-ink-soft">{title}</summary>
            <p className="mt-3 text-sm leading-7 text-muted">{detail}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
