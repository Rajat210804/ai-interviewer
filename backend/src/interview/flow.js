// The code decides the shape of the interview (who asks what kind of question, and when);
// the model decides the actual wording based on the CV, the JD and the answers so far.

export const ROLES = {
  hr: {
    title: 'HR Manager',
    personality:
      'Warm but professional and a careful listener. Interested in motivation, communication, self-awareness and how the candidate works with people. Asks for specific examples and pushes back on rehearsed or generic answers.',
  },
  tech: {
    title: 'Technical Lead',
    personality:
      'Analytical, precise and economical with words. Cares about why a choice was made, trade-offs, edge cases, and what the candidate built personally versus what a library or teammate did. Says plainly when something is technically wrong.',
  },
  manager: {
    title: 'Hiring Manager',
    personality:
      'Direct and outcome-focused. Cares about ownership, decisions, prioritisation and measurable impact. Asks what the candidate would actually do in the job and what they would do differently next time.',
  },
};

export const TYPE_LABEL = { hr: 'HR', technical: 'technical', mixed: 'mixed' };

// Relative share of question categories between the opener and the candidate's questions.
const MIX = {
  hr: { motivation: 2, behavioral: 4, resume: 2, role: 2 },
  technical: { resume: 3, technical: 5, scenario: 2, role: 1 },
  mixed: { resume: 2, behavioral: 2, technical: 3, role: 1.5, scenario: 1.5, motivation: 1 },
};

// Rough position in the interview. Random jitter lets neighbouring stages interleave,
// so no two interviews follow exactly the same sequence.
const STAGE_ORDER = { motivation: 1, resume: 2, behavioral: 3, role: 4, technical: 5, scenario: 6 };

const OWNERS = {
  motivation: ['hr', 'manager', 'tech'],
  behavioral: ['hr', 'manager', 'tech'],
  resume: ['manager', 'tech', 'hr'],
  role: ['manager', 'tech', 'hr'],
  technical: ['tech', 'manager', 'hr'],
  scenario: ['tech', 'manager', 'hr'],
  candidate_questions: ['manager', 'hr', 'tech'],
};

export function buildSlots(type, total, panel, random = Math.random) {
  const middle = allocate(MIX[type], total - 2)
    .map((category) => ({ category, key: STAGE_ORDER[category] + random() * 2.5 }))
    .sort((a, b) => a.key - b.key)
    .map((slot) => slot.category);

  let resumeCount = 0;
  const slots = middle.map((category) => ({
    category,
    interviewer: ownerFor(category, panel, category === 'resume' ? resumeCount++ : 0),
  }));
  return [
    { category: 'intro', interviewer: panel[0].id },
    ...slots,
    { category: 'candidate_questions', interviewer: ownerFor('candidate_questions', panel, 0) },
  ];
}

function ownerFor(category, panel, turn) {
  const present = OWNERS[category].map((role) => panel.find((p) => p.role === role)).filter(Boolean);
  // CV questions alternate between the hiring manager and the technical lead when both are on the panel.
  if (category === 'resume') {
    const cvOwners = present.filter((p) => p.role !== 'hr');
    if (cvOwners.length > 1) return cvOwners[turn % cvOwners.length].id;
  }
  return present[0].id;
}

// Largest-remainder split of n questions across the weighted categories.
function allocate(weights, n) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const shares = Object.entries(weights).map(([category, weight]) => {
    const exact = (weight / total) * n;
    return { category, exact, count: Math.floor(exact) };
  });
  let left = n - shares.reduce((sum, s) => sum + s.count, 0);
  for (const share of [...shares].sort((a, b) => (b.exact - b.count) - (a.exact - a.count))) {
    if (left-- <= 0) break;
    share.count++;
  }
  return shares.flatMap((s) => Array(s.count).fill(s.category));
}

const INTRO_QUESTIONS = {
  hr: [
    'To start, tell me a little about yourself.',
    "Let's begin with you. Walk me through your background and what brings you to this role.",
    "Could you introduce yourself and tell me what you've been working on recently?",
  ],
  technical: [
    'To start, give me a quick overview of your background, with the focus on your technical work.',
    "Walk me through your background briefly, and tell me which piece of technical work you're most proud of.",
  ],
};
INTRO_QUESTIONS.mixed = [...INTRO_QUESTIONS.hr, INTRO_QUESTIONS.technical[1]];

export function openingTurn({ panel, setup, firstName }, random = Math.random) {
  const [lead, ...others] = panel;
  const where = setup.company ? ` at ${setup.company}` : '';
  const colleagues = others.map((p) => `${p.name}, our ${ROLES[p.role].title}`);
  const withUs = colleagues.length ? ` With me today ${colleagues.length === 1 ? 'is' : 'are'} ${colleagues.join(' and ')}.` : '';
  const questions = INTRO_QUESTIONS[setup.type];

  return {
    interviewer: lead.id,
    category: 'intro',
    topic: 'Introduction',
    reaction:
      `Hi${firstName ? ` ${firstName}` : ''}, thanks for joining us. I'm ${lead.name}, ${ROLES[lead.role].title}${where}.${withUs}` +
      ` This is a ${TYPE_LABEL[setup.type]} interview for the ${setup.role} role, about ${setup.length} questions. Take your time with each answer.`,
    question: questions[Math.floor(random() * questions.length)],
  };
}
