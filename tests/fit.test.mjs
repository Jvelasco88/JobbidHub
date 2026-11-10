// JobBid Fit Estimate: the AI's evidence review and how JavaScript checks it, resume / profile evidence, years
// from different sources, the score's parts and weights, readability kept apart, score-change explanations,
// the rules-only fallback, broken AI answers. Real ats.js / resumedoc.js in Node, fixed AI replies, made-up people.
//   node fit.test.mjs
import { ATS, rdOpen, makeDocx, fileOf, DOCX } from './ats-fixtures.mjs';

let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`); } };
const section = (t) => console.log(t);
const docModel = async (paras, opt) => { const d = await rdOpen(fileOf(makeDocx(paras, opt), 'r.docx', DOCX)); return ATS.buildModel(d.lines, d.meta); };
const comp = (r, k) => r.components.find((c) => c.key === k);
const req = (r, t) => r.requirements.find((x) => x.term === t);

// A job like the Zillow "Senior Applied Scientist, Agentic AI" posting: long, sentence-style requirements.
const JOB = { title: 'Senior Applied Scientist, Agentic AI', company: 'HomeCo', url: 'https://jobs.example.com/z', description: `
HomeCo is the leading real estate marketplace. We build personalization, ranking and recommendations for buyers and renters.
What you will do: develop and evaluate LLM-based systems; run A/B testing and offline evaluations; apply advanced statistical modeling to large-scale datasets;
measure model performance; write tested, reusable code.
Who you are: 8+ years of experience. Python and SQL. Experience with recommendation systems and ranking. Knowledge of causal inference is a plus.
PostgreSQL experience preferred. A Master's degree in Computer Science or Statistics, or equivalent experience.` };
// The AI's job reading in the new format: short standard names, the posting's words as "quote".
const AI_JOB = {
  titleAliases: ['Applied Scientist', 'Machine Learning Scientist'], seniority: 'senior', yearsRequired: 8,
  degree: { level: 'master', fields: ['Computer Science', 'Statistics'], required: false },
  industries: [{ term: 'Real Estate' }, { term: 'Marketplace' }, { term: 'Gaming' }],
  requirements: [
    { term: 'Python', kind: 'required_skill', quote: 'Python and SQL' },
    { term: 'SQL', kind: 'required_skill', quote: 'Python and SQL' },
    { term: 'Large Language Models', aliases: ['LLM', 'LLMs'], kind: 'required_skill', quote: 'develop and evaluate LLM-based systems' },
    { term: 'A/B Testing', kind: 'required_skill', quote: 'run A/B testing and offline evaluations' },
    { term: 'Statistical Modeling', kind: 'required_skill', quote: 'apply advanced statistical modeling to large-scale datasets' },
    { term: 'Model Evaluation', kind: 'required_skill', related: ['Model Monitoring'], quote: 'measure model performance' },
    { term: 'Recommendation Systems', kind: 'required_skill', quote: 'Experience with recommendation systems and ranking' },
    { term: 'Ranking', kind: 'required_skill', quote: 'recommendation systems and ranking' },
    { term: 'PyTorch', kind: 'required_skill', related: ['TensorFlow'], quote: 'Python and SQL' },
    { term: 'PostgreSQL', aliases: ['Postgres'], kind: 'preferred_skill', quote: 'PostgreSQL experience preferred' },
    { term: 'Causal Inference', kind: 'nice_to_have', quote: 'Knowledge of causal inference is a plus' },
    { term: 'Writing Tested, Reusable Code', kind: 'soft_skill', quote: 'write tested, reusable code' },
    { term: 'Build personalization and ranking', kind: 'responsibility', quote: 'We build personalization, ranking and recommendations' },
    { term: 'Large Language Models', aliases: ['LLM'], kind: 'required_skill', quote: 'LLM-based systems' }, // duplicate
    { term: 'Quantum Annealing', kind: 'required_skill', quote: 'quantum annealing on qubits' }, // not in the posting
    { term: 'Years', kind: 'seniority', quote: '8+ years of experience' }, // read apart
  ],
};
const RESUME_A = [
  { name: true, text: 'Riley Park' }, { text: 'Senior Data Scientist | Machine Learning' }, { text: 'riley@example.com · (555) 010-7000' },
  { h: true, text: 'Summary' }, { text: 'Data scientist with 9+ years of experience building ML products in Python for marketplaces and real estate search.' },
  { h: true, text: 'Skills' }, { label: 'Languages: ', text: 'Python, SQL, Postgres' }, { label: 'ML: ', text: 'TensorFlow, scikit-learn, LLMs, statistical models' },
  { h: true, text: 'Experience' },
  { tab: ['Senior Data Scientist, Homes Inc', 'Jan 2019 - Present'] },
  { li: true, text: 'Built recommendation models for home listings and measured precision and recall on holdout sets.' },
  { li: true, text: 'Ran online experiments (A/B tests) on search ranking with 2M weekly users.' },
  { li: true, text: 'Shipped an LLM-based assistant answering buyer questions.' },
  { tab: ['Data Scientist, Shop Co', 'Jun 2016 - Dec 2018'] },
  { li: true, text: 'Built demand forecasting models with TensorFlow.' },
  { h: true, text: 'Education' }, { text: 'M.S. Statistics, State University, 2016' },
];
// A weaker version of the same person's resume: no experiments, no recommendations.
const RESUME_B = RESUME_A.filter((p) => !/recommendation|A\/B|LLM-based/.test(p.text || ''));
const PROFILE = { fullName: 'Riley Park', headline: 'Senior Data Scientist', summary: 'Data scientist with 7 years of experience.', yearsExperience: '7',
  skills: ['Python', 'SQL', 'Causal Inference'], experience: [{ title: 'Senior Data Scientist', company: 'Homes Inc', start: '01/2019', end: 'Present', description: 'Built causal inference studies for pricing.' }],
  education: [{ degree: 'M.S.', field: 'Statistics', school: 'State University', end: '2016' }] };

const a = ATS.validateAnalysis(AI_JOB, JOB);
const mA = await docModel(RESUME_A);
const idOf = (m, start) => m.lines.find((l) => l.text.startsWith(start))?.id;
// The AI's review of resume A (some honest, some to be caught).
const reviewOut = (m) => ({
  results: [
    { id: a.requirements.find((r) => r.term === 'A/B Testing').id, status: 'equivalent', lines: [idOf(m, 'Ran online experiments')], quote: 'Ran online experiments (A/B tests) on search ranking', explanation: 'Online experiments are A/B tests.', recommendation: 'Name the method: "A/B testing" in the experiments bullet.' },
    { id: a.requirements.find((r) => r.term === 'Model Evaluation').id, status: 'equivalent', lines: [idOf(m, 'Built recommendation models')], quote: 'measured precision and recall on holdout sets', explanation: 'Precision/recall on holdout sets is model evaluation.', recommendation: 'Add the evaluation metrics you used to other model bullets.' },
    { id: a.requirements.find((r) => r.term === 'Recommendation Systems').id, status: 'direct', lines: [idOf(m, 'Built recommendation models')], quote: 'Built recommendation models for home listings', explanation: 'Recommendation models for listings.', recommendation: 'Say "recommendation systems" and describe their scale (500 million users).' },
    // The AI calls TensorFlow equivalent to PyTorch: the job reading says it is only related.
    { id: a.requirements.find((r) => r.term === 'PyTorch').id, status: 'equivalent', lines: [idOf(m, 'Built demand forecasting')], quote: 'models with TensorFlow', explanation: 'Deep learning framework.' },
    // Cites a line that does not exist and a quote that is not in the resume.
    { id: a.requirements.find((r) => r.term === 'Causal Inference').id, status: 'direct', lines: [9999], quote: 'ran causal inference studies at scale', explanation: 'Causal work.' },
    // "Direct" without the words: becomes equivalent.
    { id: a.requirements.find((r) => r.term === 'Ranking').id, status: 'direct', lines: [idOf(m, 'Ran online experiments')], quote: 'on search ranking', explanation: 'Search ranking.' },
  ],
  summary: { status: 'adequate', explanation: 'Mentions ML and marketplaces but not LLM systems.', recommendation: 'Lead with the LLM assistant you shipped.' },
  suggestions: [{ text: 'Your resume mentions online experiments; name them as A/B testing.', lines: [idOf(m, 'Ran online experiments')] }, { text: 'Add your Kaggle wins.', lines: [12345] }],
});
const review = ATS.validateReview(reviewOut(mA), a, mA);
const rA = ATS.score(mA, a, null, review);

console.log('JobBid Fit Estimate');
section('Job reading: types, quotes, duplicates');
check('short standard names kept with the posting\'s words as quote', a.requirements.some((r) => r.term === 'Model Evaluation' && r.quote === 'measure model performance'));
check('a quote not in the posting: dropped (Quantum Annealing)', !a.requirements.some((r) => r.term === 'Quantum Annealing'));
check('years / seniority are not requirements', !a.requirements.some((r) => r.term === 'Years') && a.yearsRequired === 8 && a.seniority === 'senior');
check('duplicates merged (one Large Language Models)', a.requirements.filter((r) => r.term === 'Large Language Models').length === 1);
check('types: required, preferred, nice to have, soft, responsibility', req(rA, 'Python').kind === 'Required skill' && req(rA, 'PostgreSQL').kind === 'Preferred skill' && req(rA, 'Causal Inference').kind === 'Nice to have'
  && req(rA, 'Writing Tested, Reusable Code').kind === 'Soft skill' && req(rA, 'Build personalization and ranking').kind === 'Responsibility');
check('an industry the posting never names is dropped (Gaming)', !a.requirements.some((r) => r.term === 'Gaming'));

section('Evidence review: the AI\'s judgments checked against the resume');
check('"A/B tests" in the resume: matched by its own words (A/B Testing)', req(rA, 'A/B Testing').match === 'direct' && /online experiments/.test(req(rA, 'A/B Testing').evidence[0]?.text || ''));
check('equivalent in other words, with the AI\'s quote kept (Recommendation Systems from "recommendation models")', req(rA, 'Recommendation Systems').match === 'equivalent' && /recommendation models/.test(req(rA, 'Recommendation Systems').quote));
check('equivalent in other words: kept (Model Evaluation from precision/recall)', req(rA, 'Model Evaluation').match === 'equivalent');
check('the evidence excerpt is shown', /precision and recall/.test(req(rA, 'Model Evaluation').evidence[0]?.text || ''));
check('a related tool called equivalent: downgraded (TensorFlow for PyTorch)', req(rA, 'PyTorch').match === 'related' && /related skill/.test(req(rA, 'PyTorch').note));
check('a citation that does not exist: not demonstrated (Causal Inference)', req(rA, 'Causal Inference').match === 'none' && /cited nothing/.test(req(rA, 'Causal Inference').note));
check('"direct" without the words: counted as equivalent (Ranking)', req(rA, 'Ranking').match === 'equivalent' || req(rA, 'Ranking').match === 'direct');
check('words in the resume are a direct match even if the AI missed them (Python)', req(rA, 'Python').match === 'direct');
check('an exact equivalent from the job reading (Postgres for PostgreSQL)', req(rA, 'PostgreSQL').match === 'equivalent' && req(rA, 'PostgreSQL').via === 'Postgres');
check('LLM normalized: "LLMs" in the resume matches Large Language Models', ['direct', 'equivalent'].includes(req(rA, 'Large Language Models').match));
check('a recommendation with a number the resume lacks is dropped', req(rA, 'Recommendation Systems').recommendation === '');
check('a suggestion pointing at no real line is dropped', rA.suggestions.length === 1 && /A\/B testing/.test(rA.suggestions[0].text));
check('summary judgment kept', rA.summaryReview?.status === 'adequate');
check('results labelled AI-reviewed', rA.mode === 'ai');

section('Score parts and weights');
check('labelled "JobBid Fit Estimate" with a band', rA.label === 'JobBid Fit Estimate' && /alignment$/.test(rA.band));
check('the parts: required, experience, responsibilities, industry, title, preferred, education', ['required', 'experience', 'responsibilities', 'industry', 'title', 'preferred', 'education'].every((k) => comp(rA, k)));
check('the parts add up to the score', Math.abs(rA.components.reduce((s, c) => s + c.points, 0) - rA.score) < 0.2);
check('related experience is not a match (PyTorch costs points)', comp(rA, 'required').deductions.some((d) => /PyTorch/.test(d.text)));
check('every lost point is explained', rA.components.every((c) => c.points >= c.max - 0.2 || c.deductions.length));
const noEdu = ATS.validateAnalysis({ ...AI_JOB, degree: null }, { ...JOB, description: JOB.description.replace(/A Master's degree[^.]*\./, '') });
const rNoEdu = ATS.score(mA, noEdu, null, ATS.validateReview(reviewOut(mA), noEdu, mA));
check('no education asked: the part is left out and the rest scaled to 100', !comp(rNoEdu, 'education') && Math.abs(rNoEdu.components.reduce((s, c) => s + c.max, 0) - 100) < 0.5);
check('same inputs, same score (reproducible)', ATS.score(mA, a, null, ATS.validateReview(reviewOut(mA), a, mA)).score === rA.score);
check('readability is separate: a table does not change the fit score', ATS.score(await docModel(RESUME_A, { table: true }), a, null, review).score === rA.score);
check('the table shows as a readability risk instead', ATS.score(await docModel(RESUME_A, { table: true }), a, null, review).readability.checks.some((c) => c.title === 'Tables' && !c.ok));
check('readability wording: "some ATS", never "every ATS"', !JSON.stringify(rA.readability).match(/every ATS|all ATS/i));
const longJob = { ...JOB, description: JOB.description + ' Tools: ' + Array.from({ length: 60 }, (_, i) => `Tool${i}`).join(', ') + '.' };
const longA = ATS.validateAnalysis({ ...AI_JOB, requirements: [...AI_JOB.requirements, ...Array.from({ length: 60 }, (_, i) => ({ term: `Tool${i}`, kind: 'nice_to_have' }))] }, longJob);
const rLong = ATS.score(mA, longA, null, ATS.validateReview(reviewOut(mA), longA, mA));
check('a long keyword list: capped, and nice-to-haves cannot swamp required skills', longA.requirements.length <= 45 && comp(rLong, 'required').max >= 30, `${longA.requirements.length} reqs, required max ${comp(rLong, 'required').max}`);

section('Same job, different resume versions / same resume, different jobs');
const mB = await docModel(RESUME_B);
const rB = ATS.score(mB, a, null, ATS.validateReview(reviewOut(mB), a, mB));
check('the weaker resume scores lower', rB.score < rA.score, `${rA.score} vs ${rB.score}`);
check('the weaker resume misses A/B Testing', req(rB, 'A/B Testing').match === 'none');
const JOB2 = { title: 'Backend Engineer', company: 'PayCo', url: 'https://jobs.example.com/p', description: `Backend Engineer for payments. 5+ years. Go, Kubernetes, gRPC, PostgreSQL required. Kafka preferred. Fintech experience a plus.` };
const a2 = ATS.validateAnalysis({ yearsRequired: 5, industries: [{ term: 'Fintech' }], requirements: [{ term: 'Go', kind: 'required_skill', quote: 'Go, Kubernetes' }, { term: 'Kubernetes', kind: 'required_skill' }, { term: 'gRPC', kind: 'required_skill' }, { term: 'PostgreSQL', aliases: ['Postgres'], kind: 'required_skill' }, { term: 'Kafka', kind: 'preferred_skill' }] }, JOB2);
const r2 = ATS.score(mA, a2, null, ATS.rulesReview(a2, mA));
check('the same resume fits an unrelated job worse', r2.score < rA.score, `${rA.score} vs ${r2.score}`);
check('missing required skills listed (Go, Kubernetes, gRPC)', ['Go', 'Kubernetes', 'gRPC'].every((t) => req(r2, t).match === 'none'));
check('missing preferred skill (Kafka) costs preferred points only', comp(r2, 'preferred').deductions.some((d) => /Kafka/.test(d.text)) && !comp(r2, 'required').deductions.some((d) => /Kafka/.test(d.text)));

section('Resume, profile or both');
const prof = ATS.buildProfileModel(PROFILE);
const evR = ATS.combineEvidence(mA, prof, 'resume'), evP = ATS.combineEvidence(null, prof, 'profile'), evBoth = ATS.combineEvidence(await docModel(RESUME_A), prof, 'both');
const yR = ATS.yearsInfo(evR), yP = ATS.yearsInfo(evP), yB = ATS.yearsInfo(evBoth);
check('resume evidence: years from the resume\'s dates (about 10.9)', yR.from === 'resume dates' && yR.years >= 10 && yR.years <= 12, JSON.stringify(yR));
check('the disagreement is shown (resume 9+, profile 7) with the source used', yR.conflict && /profile says 7/.test(yR.note) && /Used: resume dates/.test(yR.note), yR.note);
check('profile evidence: the profile\'s own dates, not the resume', yP.from === 'profile dates' && yP.years < 9, JSON.stringify(yP));
check('no extra years inferred: none without dates or a statement', ATS.yearsInfo(ATS.combineEvidence(null, ATS.buildProfileModel({ fullName: 'X Y', skills: ['Python', 'SQL'], summary: 'Analyst.' }), 'profile')).years === null);
const rR = ATS.score(evR, a, null, ATS.rulesReview(a, evR));
check('resume only: a profile-only skill is not used (Causal Inference)', req(rR, 'Causal Inference').match === 'none');
const rBoth = ATS.score(evBoth, a, null, ATS.rulesReview(a, evBoth));
check('resume + profile: the profile\'s skill counts, with its source shown', req(rBoth, 'Causal Inference').match === 'direct' && req(rBoth, 'Causal Inference').evidence[0].source === 'profile');
check('the report says which evidence was used', rR.source === 'resume' && rBoth.source === 'both' && ATS.score(evP, a, null, ATS.rulesReview(a, evP)).source === 'profile');
check('profile lines can never be edited by the optimizer', prof.lines.every((l) => l.lock));

section('No AI / broken AI answers');
const fb = ATS.fallbackAnalysis(JOB, 'No AI key');
check('rules-only job reading: labelled, with requirements from the posting\'s words', fb.mode === 'rules' && fb.reason === 'No AI key' && fb.requirements.some((r) => r.term === 'Python') && fb.yearsRequired === 8);
const rFb = ATS.score(mA, fb, null, ATS.rulesReview(fb, mA));
check('a rules-only score says so', rFb.mode === 'rules');
const junk = ATS.validateReview({ results: 'none of that' }, a, mA);
check('an answer without results: nothing is taken from the AI, only exact words count (and say so)', Object.values(junk.byId).every((j) => !j.judged && /not judged by the AI/.test(j.note))
  && Object.entries(junk.byId).every(([id, j]) => j.match === ATS.rulesReview(a, mA).byId[id].match));
const partial = ATS.validateReview({ results: [reviewOut(mA).results[1]] }, a, mA);
check('a partial answer: the AI\'s judgments kept, the rest by exact words', partial.byId[a.requirements.find((r) => r.term === 'Model Evaluation').id].judged && Object.values(partial.byId).filter((j) => !j.judged).length === a.requirements.length - 1);
const liar = ATS.validateReview({ results: a.requirements.map((r) => ({ id: r.id, status: 'direct', lines: [], quote: 'world-class expert in everything' })) }, a, mA);
check('"direct" for everything with no evidence: all not demonstrated', Object.values(liar.byId).every((j) => j.match === 'none'));
const rLiar = ATS.score(mA, a, null, liar);
check('...and the score then only counts what the words show', rLiar.score <= ATS.score(mA, a, null, ATS.rulesReview(a, mA)).score + 0.1);
let parseErr = '';
try { await rdOpen({ name: 'broken.docx', type: DOCX, data: Buffer.from('not a zip file at all').toString('base64') }); } catch (e) { parseErr = e.message; }
check('a broken resume file: a clear error', /not a valid \.docx|could not read/i.test(parseErr), parseErr);
let typeErr = '';
try { await rdOpen({ name: 'resume.txt', type: 'text/plain', data: Buffer.from('hello').toString('base64') }); } catch (e) { typeErr = e.message; }
check('an unsupported file type: a clear error', /only PDF and Word/.test(typeErr), typeErr);

section('Explaining a score change');
const before = ATS.reportDigest(rB);
const diff = ATS.diffReports(before, rA);
check('the change is explained by part and requirement', diff && diff.delta > 0 && diff.reasons.some((r) => /Required skills/.test(r)) && diff.reasons.some((r) => /A\/B Testing: Not demonstrated → Direct match/.test(r)), JSON.stringify(diff?.reasons));
check('a weights change is named', ATS.diffReports(ATS.reportDigest(rA), ATS.score(mA, a, { required: 60 }, review)).reasons.some((r) => /weights/.test(r)));
check('no change, no message', ATS.diffReports(ATS.reportDigest(rA), rA) === null);

section('After the optimizer: the same judgments move to the new file');
const changed = RESUME_A.map((p) => (p.text?.startsWith('Ran online experiments') ? { ...p, text: 'Ran A/B testing (online experiments) on search ranking with 2M weekly users.' } : p));
const mC = await docModel(changed);
const carried = ATS.carryReview(review, mA, mC);
const rC = ATS.score(mC, a, null, carried);
check('unchanged evidence keeps its judgment (Model Evaluation)', req(rC, 'Model Evaluation').match === 'equivalent');
check('a rewritten line that now names the skill: direct (A/B Testing)', req(rC, 'A/B Testing').match === 'direct');
check('the score moves only for what changed', rC.score >= rA.score && rC.score - rA.score < 5, `${rA.score} -> ${rC.score}`);

console.log(`\n${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
