// Interviewer photos load from Unsplash (free to use under the Unsplash License).
// To self-host them, put images in frontend/public/avatars and point `photo` at /avatars/<file>.
const unsplash = (id) => `https://images.unsplash.com/photo-${id}?w=900&h=900&fit=crop&crop=faces&q=80`;

export const AVATARS = [
  { id: 'young-woman', label: 'Young woman', name: 'Maya Collins', gender: 'female', photo: unsplash('1494790108377-be9c29b29330') },
  { id: 'professional-woman', label: 'Professional woman', name: 'Rachel Moore', gender: 'female', photo: unsplash('1573496359142-b8d87734a5a2') },
  { id: 'professional-man', label: 'Professional man', name: 'Daniel Hayes', gender: 'male', photo: unsplash('1472099645785-5658abf4ff4e') },
  { id: 'young-man', label: 'Young man', name: 'Ethan Brooks', gender: 'male', photo: unsplash('1519244703995-f4e0f30006d5') },
  { id: 'senior-man', label: 'Man in suit', name: 'James Carter', gender: 'male', photo: unsplash('1560250097-0b93528c311a') },
  { id: 'woman-lead', label: 'Team lead', name: 'Nina Shah', gender: 'female', photo: unsplash('1580489944761-15a19d654956') },
];

export const avatarById = (id) => AVATARS.find((a) => a.id === id) || AVATARS[0];

// Each role sounds slightly different so the panel doesn't feel like one voice.
export const ROLE_INFO = {
  hr: { title: 'HR Manager', blurb: 'Motivation, communication, behaviour', voice: { rate: 1, pitch: 1.05 }, avatar: 'professional-woman' },
  tech: { title: 'Technical Lead', blurb: 'Depth, trade-offs, what you built', voice: { rate: 1.04, pitch: 0.95 }, avatar: 'professional-man' },
  manager: { title: 'Hiring Manager', blurb: 'Ownership, decisions, impact', voice: { rate: 0.96, pitch: 1 }, avatar: 'senior-man' },
};

// Who sits on the panel, lead interviewer first.
const PANEL_ROLES = {
  1: { hr: ['hr'], technical: ['tech'], mixed: ['manager'] },
  2: { hr: ['hr', 'manager'], technical: ['tech', 'manager'], mixed: ['hr', 'tech'] },
  3: { hr: ['hr', 'manager', 'tech'], technical: ['tech', 'manager', 'hr'], mixed: ['hr', 'tech', 'manager'] },
};

// Rebuild the panel for a new type or size, keeping the avatar already chosen for a role.
export function buildPanel(type, size, previous = []) {
  const panel = [];
  for (const role of PANEL_ROLES[size][type]) {
    const kept = previous.find((seat) => seat.role === role)?.avatarId;
    const taken = new Set(panel.map((seat) => seat.avatarId));
    const avatarId = [kept, ROLE_INFO[role].avatar, ...AVATARS.map((a) => a.id)].find((id) => id && !taken.has(id));
    panel.push({ role, avatarId });
  }
  return panel;
}

export const INTERVIEW_TYPES = [
  { id: 'hr', label: 'HR', description: 'Motivation, behaviour and communication' },
  { id: 'technical', label: 'Technical', description: 'Skills, projects and problem solving' },
  { id: 'mixed', label: 'Mixed', description: 'A realistic blend of both' },
];

export const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', description: 'Fundamentals and straightforward CV questions' },
  { id: 'medium', label: 'Medium', description: 'Scenarios, deeper CV questions, follow-ups' },
  { id: 'hard', label: 'Hard', description: 'Pressure, edge cases and challenged claims' },
];

export const LENGTHS = [
  { id: 10, label: 'Quick', description: '10 questions · ~20 min' },
  { id: 20, label: 'Standard', description: '20 questions · ~40 min' },
  { id: 30, label: 'Deep', description: '30 questions · ~60 min' },
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
