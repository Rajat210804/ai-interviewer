// Local stock portraits represent AI personas, not live interviewers.
// Sources and Unsplash licensing information: public/avatars/README.md.

export const AVATARS = [
  {
    id: 'young-woman',
    label: 'Young woman',
    name: 'Maya Collins',
    gender: 'female',
    photo: '/avatars/young-woman.jpg',
  },
  {
    id: 'professional-woman',
    label: 'Professional woman',
    name: 'Rachel Moore',
    gender: 'female',
    photo: '/avatars/professional-woman.jpg',
  },
  {
    id: 'professional-man',
    label: 'Professional man',
    name: 'Daniel Hayes',
    gender: 'male',
    photo: '/avatars/professional-man.jpg',
  },
  {
    id: 'young-man',
    label: 'Young man',
    name: 'Ethan Brooks',
    gender: 'male',
    photo: '/avatars/young-man.jpg',
  },
  {
    id: 'senior-man',
    label: 'Man in suit',
    name: 'James Carter',
    gender: 'male',
    photo: '/avatars/senior-man.jpg',
  },
  {
    id: 'woman-lead',
    label: 'Team lead',
    name: 'Nina Shah',
    gender: 'female',
    photo: '/avatars/woman-lead.jpg',
  },
];

export const avatarById = (id) =>
  AVATARS.find((a) => a.id === id) || AVATARS[0];

// Each role sounds slightly different so the panel doesn't feel like one voice.
export const ROLE_INFO = {
  hr: {
    title: 'HR Manager',
    blurb: 'Motivation, communication, behaviour',
    voice: { rate: 1, pitch: 1.05 },
    avatar: 'professional-woman',
  },
  tech: {
    title: 'Technical Lead',
    blurb: 'Depth, trade-offs, what you built',
    voice: { rate: 1.04, pitch: 0.95 },
    avatar: 'professional-man',
  },
  manager: {
    title: 'Hiring Manager',
    blurb: 'Ownership, decisions, impact',
    voice: { rate: 0.96, pitch: 1 },
    avatar: 'senior-man',
  },
};

// Who sits on the panel, lead interviewer first.
const PANEL_ROLES = {
  1: { hr: ['hr'], technical: ['tech'], mixed: ['manager'] },
  2: {
    hr: ['hr', 'manager'],
    technical: ['tech', 'manager'],
    mixed: ['hr', 'tech'],
  },
  3: {
    hr: ['hr', 'manager', 'tech'],
    technical: ['tech', 'manager', 'hr'],
    mixed: ['hr', 'tech', 'manager'],
  },
};

// Rebuild the panel for a new type or size, keeping the avatar already chosen for a role.
export function buildPanel(type, size, previous = []) {
  const panel = [];
  for (const role of PANEL_ROLES[size][type]) {
    const kept = previous.find((seat) => seat.role === role)?.avatarId;
    const taken = new Set(panel.map((seat) => seat.avatarId));
    const avatarId = [
      kept,
      ROLE_INFO[role].avatar,
      ...AVATARS.map((a) => a.id),
    ].find((id) => id && !taken.has(id));
    panel.push({ role, avatarId });
  }
  return panel;
}

export const INTERVIEW_TYPES = [
  {
    id: 'hr',
    label: 'HR',
    description: 'Motivation, behaviour and communication',
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Skills, projects and problem solving',
  },
  { id: 'mixed', label: 'Mixed', description: 'A realistic blend of both' },
];

export const DIFFICULTIES = [
  {
    id: 'easy',
    label: 'Easy',
    description: 'Fundamentals and straightforward CV questions',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Scenarios, deeper CV questions, follow-ups',
  },
  {
    id: 'hard',
    label: 'Hard',
    description: 'Edge cases, trade-offs and challenged assumptions',
  },
];

export const LENGTHS = [
  { id: 10, label: 'Quick', description: '10 questions · flexible pace' },
  { id: 20, label: 'Standard', description: '20 questions · flexible pace' },
  { id: 30, label: 'Deep', description: '30 questions · flexible pace' },
];

export const CATEGORY_LABEL = {
  intro: 'Introduction',
  motivation: 'Motivation',
  resume: 'Resume',
  behavioral: 'Behavioural',
  role: 'Role',
  technical: 'Technical',
  scenario: 'Scenario',
  candidate_questions: 'Your questions',
};
