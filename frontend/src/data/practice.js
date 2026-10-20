// Original practice prompts, not questions attributed to a particular employer.
export const PRACTICE_QUESTIONS = [
  { id: 'intro', category: 'General', level: 'Foundation', question: 'Tell me about yourself and why this role is your next step.', outline: ['Your current focus', 'One relevant achievement', 'Why this role fits your next step'] },
  { id: 'motivation', category: 'General', level: 'Foundation', question: 'What interests you about this role beyond the job title?', outline: ['A specific responsibility', 'Evidence from your experience', 'What you want to learn or contribute'] },
  { id: 'setback', category: 'Behavioural', level: 'Foundation', question: 'Describe a setback and what you changed afterwards.', outline: ['Situation and your responsibility', 'What went wrong and your response', 'Evidence that your approach improved'] },
  { id: 'conflict', category: 'Behavioural', level: 'Stretch', question: 'Tell me about a disagreement with a teammate that affected your work.', outline: ['The competing views', 'How you listened and reached a decision', 'The outcome and what you would change'] },
  { id: 'priorities', category: 'Behavioural', level: 'Stretch', question: 'How did you handle two urgent requests that could not both be completed?', outline: ['Constraints and impact', 'How you agreed priorities with stakeholders', 'What you delivered and communicated'] },
  { id: 'debug', category: 'Software engineering', level: 'Foundation', question: 'An API suddenly becomes slow. How would you investigate?', outline: ['Define the symptom and scope', 'Use metrics, logs and a reproducible case', 'Isolate the bottleneck and verify the fix'] },
  { id: 'design', category: 'Software engineering', level: 'Stretch', question: 'Design a notification service that must avoid sending duplicate messages.', outline: ['Delivery and scale requirements', 'Queues, retries and idempotency', 'Failure modes and monitoring'] },
  { id: 'testing', category: 'Software engineering', level: 'Foundation', question: 'How would you test a checkout flow before releasing it?', outline: ['Critical user journeys', 'Payment failures, retries and edge cases', 'Test layers and release monitoring'] },
  { id: 'data-quality', category: 'Data analysis', level: 'Foundation', question: 'Two dashboards show different revenue totals. How would you reconcile them?', outline: ['Align definitions and time windows', 'Trace sources, joins and filters', 'Validate a sample and document the resolution'] },
  { id: 'experiment', category: 'Data analysis', level: 'Stretch', question: 'A feature increases clicks but reduces completed purchases. How would you assess it?', outline: ['Primary goal and guardrail metrics', 'Segments, sample size and uncertainty', 'A decision and the next experiment'] },
  { id: 'sql', category: 'Data analysis', level: 'Foundation', question: 'How would you find the three highest-spending customers in each region using SQL?', outline: ['Define tables and spending period', 'Aggregate before ranking within each region', 'Explain how ties and refunds are handled'] },
  { id: 'product', category: 'Product management', level: 'Foundation', question: 'How would you decide which user problem to solve next?', outline: ['Evidence from users and data', 'Impact, effort and strategy', 'Success criteria and a small validation step'] },
  { id: 'launch', category: 'Product management', level: 'Stretch', question: 'A launch misses its adoption target. What would you do in the first week?', outline: ['Check measurement and the activation funnel', 'Talk to users and identify friction', 'Prioritise a test and define a review point'] },
  { id: 'customer', category: 'Customer support', level: 'Foundation', question: 'How would you help an upset customer when you cannot immediately fix their issue?', outline: ['Acknowledge the impact', 'Clarify facts and explain available options', 'Agree a follow-up and keep ownership'] },
  { id: 'escalation', category: 'Customer support', level: 'Stretch', question: 'Several customers report the same urgent issue. How would you manage the queue?', outline: ['Assess severity and common symptoms', 'Escalate with useful evidence', 'Keep customers informed and track resolution'] },
  { id: 'sales', category: 'Sales & marketing', level: 'Foundation', question: 'A prospect says the price is too high. How would you respond?', outline: ['Understand the underlying concern', 'Connect value to their actual needs', 'Agree an honest next step without overpromising'] },
  { id: 'campaign', category: 'Sales & marketing', level: 'Stretch', question: 'How would you evaluate a campaign with strong reach but few qualified leads?', outline: ['Clarify the audience and business goal', 'Inspect targeting, message and conversion steps', 'Choose a measurable change to test'] },
  { id: 'leadership', category: 'Leadership', level: 'Stretch', question: 'How would you support a capable teammate whose performance has declined?', outline: ['Discuss specific observations privately', 'Understand obstacles and agree support', 'Set expectations and follow up fairly'] },
];

export const PRACTICE_CATEGORIES = [...new Set(PRACTICE_QUESTIONS.map((question) => question.category))];

export function filterQuestions({ search = '', category = 'All', level = 'All', savedOnly = false, bookmarks = [] }) {
  const query = search.trim().toLowerCase();
  return PRACTICE_QUESTIONS.filter((q) =>
    (category === 'All' || q.category === category) &&
    (level === 'All' || q.level === level) &&
    (!savedOnly || bookmarks.includes(q.id)) &&
    `${q.question} ${q.category} ${q.outline.join(' ')}`.toLowerCase().includes(query));
}
