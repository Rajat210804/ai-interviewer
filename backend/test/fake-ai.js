// A stand-in for the real AI layer so the API and UI can be tested without network access or keys.
// Every canned response still goes through the real zod schemas, exactly like model output would.

const SAMPLE_CV = {
  is_cv: true,
  name: 'Rajat Sample',
  headline: 'Final-year B.Tech student in Electronics & Instrumentation',
  education: [{ institution: 'Thapar Institute of Engineering and Technology', degree: 'B.Tech EIC', period: '2023-2027', score: '7.3/10' }],
  skills: ['Python', 'SQL', 'Excel', 'Power BI'],
  programming_languages: ['Python', 'C++'],
  frameworks: ['LangGraph', 'Flask'],
  tools: ['Git'],
  projects: [{ name: 'MedIntel AI', summary: 'LangGraph agent over Oracle SQL', technologies: ['LangGraph', 'Oracle SQL'], claims: ['157 automated tests'] }],
  experience: [{ organization: 'JBM Green', title: 'R&D Intern', period: 'Jun-Jul 2026', highlights: ['Saved ~2 days of manual work per test cycle'] }],
  certifications: ['Deep Learning Specialization'],
  achievements: [],
  claims_to_probe: [{ claim: 'Saved ~2 days of manual work per test cycle', reason: 'How was the saving measured?' }],
};

const SAMPLE_JD = {
  is_jd: true,
  title: 'Data Analyst',
  company: 'Acme',
  summary: 'Analyse sales data and build dashboards.',
  required_skills: ['SQL', 'Python', 'Excel'],
  preferred_skills: ['AWS'],
  responsibilities: ['Build dashboards', 'Write SQL queries'],
  qualifications: ['B.Tech'],
  tools: ['Power BI'],
  programming_languages: ['Python', 'SQL'],
  domain_knowledge: ['Sales'],
  soft_skills: ['Communication'],
  experience_requirements: '0-1 years',
};

const SAMPLE_PLAN = {
  strong_matches: ['SQL', 'Python'],
  partial_matches: ['Excel dashboards'],
  missing_skills: ['AWS'],
  focus_areas: [
    { topic: 'JBM Green data tool', why: 'Check personal contribution', kind: 'resume' },
    { topic: 'SQL window functions', why: 'Core skill for the role', kind: 'technical' },
    { topic: 'AWS basics', why: 'Missing requirement', kind: 'gap' },
  ],
  company_style: 'Keep a neutral professional style.',
};

const QUESTIONS = {
  follow_up: 'You said it saved two days. How exactly did you measure that?',
  next_question: 'Walk me through how you would find the top three products by revenue in each region using SQL.',
  close: "That's everything from our side. Thanks for your time today; the recruiter will be in touch about next steps.",
};

export function createFakeAI({ delayMs = 0, failLabels = [] } = {}) {
  const calls = [];
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));

  async function generate(request) {
    calls.push(request);
    await wait();
    if (failLabels.includes(request.label)) {
      const { AppError } = await import('../src/errors.js');
      throw new AppError(502, "We couldn't connect to the interviewer right now. Please try again.");
    }
    return request.schema.parse(respond(request));
  }

  function respond({ label, schema, user }) {
    if (label === 'cv analysis') return SAMPLE_CV;
    if (label === 'jd analysis') return SAMPLE_JD;
    if (label === 'ocr') return { text: 'Job description: Data Analyst. Requirements: SQL, Python, Excel dashboards and stakeholder communication.' };
    if (label === 'plan') return SAMPLE_PLAN;
    if (label === 'turn') return turn(schema.shape.move.options, user);
    if (label === 'report') return report(user);
    throw new Error(`fake AI has no response for ${label}`);
  }

  function turn(allowedMoves, user) {
    const answer = user.split("## Candidate's answer")[1] || '';
    const short = answer.replace(/[<>\n]/g, '').trim().length < 60;
    const move = short && allowedMoves.includes('follow_up') ? 'follow_up' : allowedMoves.find((m) => m !== 'follow_up');
    return {
      assessment: {
        score: short ? 4 : 7,
        verdict: short ? 'vague' : 'adequate',
        strengths: short ? [] : ['Gave a concrete example'],
        gaps: short ? ['No specifics'] : ['Could quantify the result'],
        incorrect_points: [],
        topics: [short ? 'Vague answer' : 'SQL'],
      },
      move,
      reaction: move === 'close' ? 'Most teams here work in two-week sprints, but your recruiter can share specifics.' : short ? "That's still quite general." : 'Okay.',
      question: QUESTIONS[move],
      category: 'technical',
      topic: move === 'follow_up' ? 'Measuring impact' : 'SQL ranking',
    };
  }

  function report(user) {
    const numbers = [...user.matchAll(/^Q(\d+) \[/gm)].map((m) => Number(m[1]));
    return {
      summary: 'Clear on your internship, but answers lacked specifics under follow-up questions.',
      scores: { overall: 64, communication: 70, technical: 58, problem_solving: 61, resume_credibility: 55, role_knowledge: 60, clarity: 68 },
      strengths: ['Explained the JBM Green tool clearly', 'Structured the SQL approach step by step'],
      weaknesses: ['Could not say how the time saving was measured', 'No mention of window functions'],
      technical_analysis: 'SQL fundamentals are in place; ranking within groups was hand-waved.',
      hr_analysis: 'Motivated and polite; answers were long before reaching the point.',
      resume_analysis: 'The internship claim held up partly; the metric needs a method.',
      study_plan: [
        { topic: 'SQL window functions', why: 'Asked directly and missed', how: 'Solve 15 ROW_NUMBER/RANK problems' },
        { topic: 'Quantifying impact', why: 'Metric was not backed up', how: 'Write the before/after for each CV claim' },
      ],
      question_review: numbers.map((index) => ({
        index,
        good: 'Answered directly.',
        missing: 'A concrete number and how it was measured.',
        improve: 'Lead with the result, then the method.',
        ideal_structure: 'Context, what you did, how you measured it, result.',
      })),
      example_answers: numbers.slice(0, 1).map((index) => ({ index, answer: 'In my internship at JBM Green, each test cycle took [X hours] to process by hand...' })),
    };
  }

  return {
    generate,
    transcribe: async () => 'This is a transcribed answer.',
    status: () => ({ gemini: true, groq: true }),
    calls,
  };
}
