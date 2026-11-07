// Match score (0-100) and Qualified / Disqualified for one profile and one job, without AI.
// Skills: which skills the job asks for that the profile has. Title: how close the job title is to the
// profile's titles. Apply criteria (per profile) can disqualify a job outright, with the reason shown.
import { daysAgo } from './util.js';

const COMMON_SKILLS = `JavaScript, TypeScript, Python, Java, C#, C++, Golang, Rust, Ruby, PHP, Kotlin, Swift, Scala, SQL, Bash, PowerShell, Perl, Dart, Elixir, Haskell,
React, React Native, Next.js, Vue, Nuxt, Angular, Svelte, Redux, jQuery, HTML, CSS, Sass, Tailwind, Bootstrap, Node.js, Express, NestJS, Django, Flask, FastAPI,
Spring, Spring Boot, .NET, ASP.NET, Rails, Laravel, Symfony, GraphQL, REST, gRPC, WebSockets, Microservices,
AWS, Azure, GCP, Google Cloud, Lambda, EC2, S3, ECS, EKS, Kubernetes, Docker, Terraform, Ansible, Helm, Jenkins, GitHub Actions, GitLab CI, CircleCI, ArgoCD, CI/CD,
Linux, Unix, Windows Server, Networking, Prometheus, Grafana, Datadog, Splunk, ELK, New Relic, PagerDuty, SRE, DevOps, Serverless,
PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redis, Cassandra, DynamoDB, Elasticsearch, Snowflake, BigQuery, Redshift, Databricks, Kafka, RabbitMQ, Spark, Hadoop, Airflow, dbt, ETL,
Machine Learning, Deep Learning, NLP, Computer Vision, LLM, Generative AI, RAG, LangChain, LlamaIndex, PyTorch, TensorFlow, Keras, scikit-learn, Pandas, NumPy, Hugging Face, OpenAI, MLOps,
Tableau, Power BI, Looker, Salesforce, SAP, ServiceNow, Jira, Confluence, Figma,
iOS, Android, Flutter, Xamarin, Unity, Selenium, Cypress, Playwright, Jest, Pytest, JUnit, QA, Agile, Scrum,
OAuth, SAML, SIEM, Penetration Testing, SOC 2, HIPAA, Blockchain, Solidity, Embedded, IoT`.split(/,\s*/).map((s) => s.trim()).filter(Boolean);

const ALIASES = { golang: 'go', nodejs: 'node.js', 'react.js': 'react', reactjs: 'react', 'vue.js': 'vue', vuejs: 'vue', nextjs: 'next.js',
  postgres: 'postgresql', 'google cloud': 'gcp', 'google cloud platform': 'gcp', k8s: 'kubernetes', 'amazon web services': 'aws', 'ms sql': 'sql server', mssql: 'sql server',
  'scikit learn': 'scikit-learn', sklearn: 'scikit-learn', 'gen ai': 'generative ai', genai: 'generative ai', llms: 'llm', 'large language models': 'llm', 'dotnet': '.net', 'asp.net core': 'asp.net', '.net core': '.net', 'ci cd': 'ci/cd' };
const canon = (s) => { const k = String(s || '').toLowerCase().trim(); return ALIASES[k] || k; };

const AMBIGUOUS = new Set(['go', 'rust', 'swift', 'spring', 'express', 'rest', 'spark', 'unity', 'chef', 'puppet', 'ember', 'meteor', 'elm', 'julia', 'excel', 'access', 'word', 'next', 'node', 'echo', 'fiber', 'gin', 'helm', 'r', 'c']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function skillRe(skill) {
  if (reCache.has(skill)) return reCache.get(skill);
  // Word edges that also work for C++, C#, .NET, Node.js; "Go" and "R" only as standalone capitalised words.
  const body = esc(skill).replace(/\\\.|\s+/g, (m) => (m === '\\.' ? '\\.?' : '[\\s-]?'));
  // Skill names that are also everyday words ("the rest", "spring hiring") only count with their exact capitals.
  const re = AMBIGUOUS.has(skill.toLowerCase())
    ? new RegExp(`(?<![A-Za-z0-9+#.])(?:${esc(skill[0].toUpperCase() + skill.slice(1))}|${esc(skill.toUpperCase())})(?![A-Za-z0-9+#])`)
    : skill.length <= 2 && /^[a-z]+$/i.test(skill)
    ? new RegExp(`(?<![A-Za-z0-9+#.])${esc(skill.toUpperCase() === skill ? skill : skill[0].toUpperCase() + skill.slice(1))}(?![A-Za-z0-9+#])`)
    : new RegExp(`(?<![A-Za-z0-9+#])${body}(?![A-Za-z0-9+#])`, 'i');
  reCache.set(skill, re);
  return re;
}

export function skillsIn(text, vocab) {
  const found = new Map();
  for (const s of vocab) {
    const c = canon(s);
    if (found.has(c)) continue;
    if (skillRe(s).test(text)) found.set(c, s);
  }
  return found; // canon -> display name
}

// Resume parsing sometimes leaves words like "&", "Intelligent" or "Environment" in the skill list.
const NOT_SKILLS = new Set(['intelligent', 'environment', 'automation', 'data processing', 'processing', 'development', 'design', 'engineering', 'software', 'systems', 'system',
  'management', 'communication', 'teamwork', 'leadership', 'problem solving', 'analysis', 'testing', 'research', 'support', 'operations', 'technology', 'tools', 'team', 'skills',
  'experience', 'other', 'and', 'or', 'with', 'web', 'cloud', 'data', 'api', 'apis', 'frameworks', 'languages', 'databases', 'platforms', 'methodologies']);
const isSkill = (t) => t.length >= 1 && t.length <= 40 && /[a-z0-9]/i.test(t) && !NOT_SKILLS.has(t.toLowerCase()) && (t.length > 1 || /^[CR]$/.test(t));

let vocabCache = { key: '', list: [] };
export function vocabulary(profiles) {
  const key = profiles.map((p) => (p.skills || []).length + ':' + p.id).join('|');
  if (vocabCache.key === key) return vocabCache.list;
  const all = new Map();
  for (const s of [...COMMON_SKILLS, ...profiles.flatMap((p) => p.skills || [])]) {
    const t = String(s).trim();
    if (isSkill(t) && !all.has(canon(t))) all.set(canon(t), t);
  }
  // Extra spellings found by aliases (e.g. Golang, k8s) also need to be searched.
  for (const a of Object.keys(ALIASES)) if (all.has(ALIASES[a]) && !all.has(a)) all.set(a + '#alias', a);
  vocabCache = { key, list: [...all.values()] };
  return vocabCache.list;
}

const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'to', 'in', 'a', 'an', 'with', 'at', 'on', 'i', 'ii', 'iii', 'iv', 'remote', 'hybrid', 'us', 'usa', 'senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'mid', 'level']);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));

export function seniorityOf(title) {
  const t = String(title || '').toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return 'Intern';
  if (/\b(junior|jr\.?|entry|graduate|associate)\b/.test(t)) return 'Junior';
  if (/\b(director|vp|vice president|head of|chief)\b/.test(t)) return 'Director';
  if (/\b(manager|mgr)\b/.test(t)) return 'Manager';
  if (/\b(principal|distinguished|architect)\b/.test(t)) return 'Principal';
  if (/\b(staff)\b/.test(t)) return 'Staff';
  if (/\b(lead|tech lead)\b/.test(t)) return 'Lead';
  if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) return 'Senior';
  return 'Mid';
}

export const DEFAULT_CRITERIA = {
  minScore: 45, titles: [], mustHave: [], dealBreakers: [], excludeCompanies: [], excludeTitleWords: ['intern'],
  workMode: 'any', locations: [], minSalary: 0, seniority: [], maxAgeDays: 0, noClearance: true, needsSponsorship: 'auto',
};
export const criteriaOf = (p) => ({ ...DEFAULT_CRITERIA, ...(p?.criteria || {}) });

// Region words in a job's title/location that exclude candidates living elsewhere.
const REGIONS = { latam: 'LATAM', 'latin america': 'Latin America', 'south america': 'South America', europe: 'Europe', emea: 'EMEA', eu: 'EU', uk: 'UK', 'united kingdom': 'UK',
  germany: 'Germany', france: 'France', spain: 'Spain', portugal: 'Portugal', poland: 'Poland', netherlands: 'Netherlands', ireland: 'Ireland', canada: 'Canada', apac: 'APAC',
  asia: 'Asia', india: 'India', australia: 'Australia', 'new zealand': 'New Zealand', brazil: 'Brazil', mexico: 'Mexico', argentina: 'Argentina', colombia: 'Colombia',
  philippines: 'Philippines', africa: 'Africa', 'south africa': 'South Africa', nigeria: 'Nigeria', kenya: 'Kenya', pakistan: 'Pakistan', japan: 'Japan', singapore: 'Singapore' };
const OPEN_WORDS = /\b(worldwide|anywhere|global|americas|north america|united states|usa|us|u\.s\.)\b/i;
const EUROPE_HOME = /germany|france|spain|portugal|poland|netherlands|ireland|kingdom|italy|europe|sweden|denmark|norway|finland|austria|belgium|switzerland|romania|ukraine/;
const LATAM_HOME = /brazil|mexico|argentina|colombia|chile|peru|uruguay|ecuador|costa rica/;
function regionClash(profile, job, text) {
  const where = `${job.location || ''} | ${job.title || ''}`;
  const home = `${profile.country || ''} ${profile.state || ''} ${profile.workCountries || ''}`.toLowerCase();
  const usHome = !home.trim() || /united states|usa|\bus\b|america/.test(home);
  const hits = Object.keys(REGIONS).filter((r) => new RegExp(`\\b${r}\\b`, 'i').test(where));
  if (!hits.length) {
    // The description says so: "Europe only", "must be based in Canada".
    const m = text.match(/\b(?:only|must (?:be )?(?:based|located|reside) in)\b.{0,25}?\b(latam|latin america|europe|emea|uk|canada|india|apac|brazil|mexico|philippines)\b|\b(latam|latin america|europe|emea|uk|canada|india|apac|brazil|mexico|philippines)\b.{0,12}\bonly\b/i);
    if (!m) return '';
    hits.push((m[1] || m[2]).toLowerCase());
  }
  if (usHome && OPEN_WORDS.test(where)) return ''; // "US, Canada" or "Worldwide" is fine for a US candidate
  const fits = hits.some((r) => home.includes(r) || (r === 'uk' && home.includes('kingdom'))
    || (['europe', 'eu', 'emea'].includes(r) && EUROPE_HOME.test(home)) || (['latam', 'latin america', 'south america'].includes(r) && LATAM_HOME.test(home)));
  return fits ? '' : REGIONS[hits[0]];
}

const listHit = (list, text) => (list || []).map((s) => String(s).trim()).filter(Boolean).filter((s) => skillRe(s).test(text) || text.toLowerCase().includes(s.toLowerCase()));

export function scoreJob(profile, job, vocab) {
  const c = criteriaOf(profile);
  const text = `${job.title}\n${(job.tags || []).join(', ')}\n${job.description || ''}`;
  const reasons = [];
  const fail = (t) => reasons.push({ ok: false, text: t });
  const pass = (t) => reasons.push({ ok: true, text: t });

  // Skills the job asks for vs. skills the profile has.
  const jobSkills = skillsIn(text, vocab);
  const mine = new Set((profile.skills || []).filter(isSkill).map(canon));
  const matched = [...jobSkills.keys()].filter((k) => mine.has(k));
  const missing = [...jobSkills.keys()].filter((k) => !mine.has(k));
  let skillScore;
  if (jobSkills.size >= 3) skillScore = matched.length / jobSkills.size;
  else skillScore = jobSkills.size ? (matched.length ? 0.7 : 0.2) : 0.35; // posting names few skills: weak signal either way
  // Matching 80% of the listed skills counts as a full skills score.
  skillScore = Math.min(1, skillScore / 0.8);

  // Title similarity: job title words vs. profile headline / current title / target titles.
  const targets = [...(c.titles || []), profile.headline, profile.currentTitle].filter(Boolean);
  const jt = new Set(words(job.title));
  let titleScore = 0;
  for (const t of targets) {
    const tw = words(t);
    if (!tw.length) continue;
    const hit = tw.filter((w) => jt.has(w)).length / tw.length;
    titleScore = Math.max(titleScore, hit);
  }
  if (!targets.length) titleScore = 0.5;

  const score = Math.round(100 * (0.65 * skillScore + 0.35 * titleScore));
  if (matched.length) pass(`${matched.length} of ${jobSkills.size} skills match`);

  // ---- Apply criteria ----
  const lowTitle = String(job.title || '').toLowerCase();
  if (c.titles?.length && !c.titles.some((t) => words(t).every((w) => jt.has(w)) || lowTitle.includes(String(t).toLowerCase()))) fail('Title is not one of the target titles');
  const badTitle = (c.excludeTitleWords || []).filter((w) => w && new RegExp(`\\b${esc(String(w).toLowerCase())}\\b`).test(lowTitle));
  if (badTitle.length) fail(`Title contains "${badTitle.join('", "')}"`);
  const needs = (c.mustHave || []).filter(Boolean);
  const lacking = needs.filter((s) => !listHit([s], text).length);
  if (needs.length && lacking.length) fail(`Missing must-have: ${lacking.join(', ')}`);
  else if (needs.length) pass('All must-have skills mentioned');
  const breakers = listHit(c.dealBreakers, text);
  if (breakers.length) fail(`Deal-breaker: ${breakers.join(', ')}`);
  if ((c.excludeCompanies || []).some((x) => x && String(job.company || '').toLowerCase().includes(String(x).toLowerCase()))) fail('Company is on your exclude list');

  const loc = `${job.location || ''}`.toLowerCase();
  const isRemote = job.remote || /\bremote\b/.test(loc);
  const isHybrid = /\bhybrid\b/i.test(`${loc} ${job.title}`);
  if (c.workMode === 'remote' && !isRemote) fail('Not remote');
  if (c.workMode === 'hybrid' && !isRemote && !isHybrid) fail('Not remote or hybrid');
  if (c.workMode === 'onsite' && isRemote) fail('Remote, you want on-site');
  if ((c.locations || []).filter(Boolean).length && !isRemote && !c.locations.some((l) => loc.includes(String(l).toLowerCase()))) fail(`Location ${job.location || 'unknown'} not in your list`);
  // Remote jobs limited to another region ("Senior Engineer LATAM", "Remote - Europe only").
  const region = regionClash(profile, job, text);
  if (region) fail(`Only for ${region}`);

  if (c.minSalary && job.salaryMax && job.salaryMax < c.minSalary) fail(`Pays up to ${Math.round(job.salaryMax / 1000)}k, below your ${Math.round(c.minSalary / 1000)}k`);
  const sen = seniorityOf(job.title);
  if ((c.seniority || []).length && !c.seniority.includes(sen)) fail(`${sen} level`);
  if (c.maxAgeDays && job.postedAt && daysAgo(job.postedAt) > c.maxAgeDays) fail(`Posted over ${c.maxAgeDays} days ago`);
  if (c.noClearance && /\b(security clearance|secret clearance|ts\/sci|top secret|active clearance|clearance required|polygraph)\b/i.test(text)) fail('Needs a security clearance');
  const sponsor = c.needsSponsorship === 'auto' ? /^y/i.test(profile.requiresSponsorship || '') : c.needsSponsorship === true;
  if (sponsor && /\b(no|not|unable to|cannot|won'?t|will not)\b.{0,30}\b(sponsor|sponsorship)\b|\bmust be (a )?(us citizen|u\.s\. citizen|green card)/i.test(text)) fail('No visa sponsorship');
  if (/\b(us citizens? only|must be a us citizen|u\.s\. citizenship (is )?required)\b/i.test(text) && /^y/i.test(profile.requiresSponsorship || '')) fail('US citizens only');

  if (score < c.minScore) fail(`Match ${score}% is below your minimum ${c.minScore}%`);
  const qualified = !reasons.some((r) => !r.ok);
  return {
    score, qualified, seniority: sen, reasons,
    matched: matched.map((k) => jobSkills.get(k)).slice(0, 20),
    missing: missing.map((k) => jobSkills.get(k)).slice(0, 20),
  };
}

// Scores for every profile; a manual "Mark as qualified/disqualified" override always wins.
export function scoreAll(profiles, job) {
  const vocab = vocabulary(profiles);
  const out = {};
  for (const p of profiles) {
    const s = scoreJob(p, job, vocab);
    const o = job.overrides?.[p.id];
    if (o === 'qualified' || o === 'disqualified') s.qualified = o === 'qualified', s.override = o;
    out[p.id] = s;
  }
  return out;
}
