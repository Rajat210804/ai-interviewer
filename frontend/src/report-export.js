const list = (value) => Array.isArray(value) ? value : [];

// Plain text keeps long answers intact and opens without a particular app.
export function reportText(report) {
  const lines = [
    'AI INTERVIEWER — PRACTICE REPORT',
    [report.role, report.company].filter(Boolean).join(' · '),
    'Practice feedback, not a hiring assessment.',
    '',
    report.insufficient ? 'Not enough responses to assess.' : report.summary || '',
    '',
    'SCORES (OUT OF 100)',
    ...Object.entries(report.scores || {}).map(([name, score]) =>
      `${name}: ${typeof score === 'number' && Number.isFinite(score) ? score : 'Not assessed'}`),
    '',
    'STRENGTHS',
    ...list(report.strengths).map((text) => `- ${text}`),
    '',
    'AREAS TO PRACTISE',
    ...list(report.weaknesses).map((text) => `- ${text}`),
    '',
    ...[['Technical assessment', report.technical_analysis], ['Behavioural assessment', report.hr_analysis], ['Resume assessment', report.resume_analysis]]
      .filter(([, text]) => text).flatMap(([label, text]) => [label.toUpperCase(), text, '']),
    'PREPARATION PLAN',
    ...list(report.study_plan).flatMap((item, i) => [
      `${i + 1}. ${item.topic}`, item.why || '', item.how || '', '',
    ]),
    'ANSWERS & FEEDBACK',
    ...list(report.questions).flatMap((q, i) => [
      `${q.number ?? i + 1}. ${q.question || ''}`,
      `Answer: ${q.answer || '(No answer submitted)'}`,
      ...[['What worked', q.review?.good], ['What was missing', q.review?.missing], ['How to improve', q.review?.improve], ['A stronger answer structure', q.review?.ideal_structure]]
        .filter(([, text]) => text).map(([label, text]) => `${label}: ${text}`),
      ...(q.exampleAnswer ? [`Example answer to adapt: ${q.exampleAnswer}`] : []),
      ...(q.contextLimited ? ['AI assessment used excerpts of this answer.'] : []),
      '',
    ]),
    ...(report.contextLimited ? ['The final AI assessment used excerpts of long responses.'] : []),
    'Practise again: https://ai-interviewer-7eqv.onrender.com',
  ];
  return lines.join('\n');
}

export function downloadReport(report) {
  const url = URL.createObjectURL(new Blob([reportText(report)], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ai-interviewer-report.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
