// Estimated ATS match: the job's requirements (read once by the AI, then checked against the job text) are
// looked for in the actual resume file's text. The scoring itself never asks the AI, so the same resume and
// job always get the same score, before and after the optimizer changes the resume.
// Works in the service worker (importScripts) and in Node (tests): everything is on self.JobBidATS.

(function (root) {
  // 3: requirement types, quotes from the posting, the AI's evidence review (jobs read before are read again).
  const VERSION = 3;
  // JobBid Fit Estimate: points out of 100 for each part (configurable: chrome.storage.local "atsWeights").
  // These are starting defaults, not validated ATS weights. A part the job doesn't ask about (no preferred
  // skills, no education) is left out and the others are scaled up to 100.
  const DEFAULT_WEIGHTS = { required: 35, experience: 20, responsibilities: 15, industry: 10, title: 10, preferred: 5, education: 5 };
  const WEIGHT_LABELS = {
    required: 'Required skills', experience: 'Relevant work experience', responsibilities: 'Responsibilities', industry: 'Industry / domain',
    title: 'Job title & seniority', preferred: 'Preferred skills', education: 'Education & certifications',
  };
  const IMPORTANCE = { required: 3, preferred: 1.5, optional: 0.75 };
  const CATEGORIES = ['skill', 'tool', 'domain', 'responsibility', 'qualification', 'certification', 'soft'];
  // Industry terms ('domain') have their own part of the score.
  const KEYWORD_CATS = new Set(['skill', 'tool', 'soft']);

  // ---------- Words ----------

  const clean = (s) => String(s ?? '').replace(/[‐-―−]/g, '-').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const STOP = new Set(('a an the and or of for to in on with at by from as is are be been this that these those using use used via into over within across ' +
    'our your their its we you they it will can may must should etc e g i ie eg such including include includes strong solid proven good excellent ' +
    'experience experienced years year knowledge understanding ability skills skill work working plus').split(' '));
  const SUFFIXES = ['izations', 'ization', 'isation', 'ations', 'ation', 'ically', 'izing', 'ising', 'ments', 'ment', 'ings', 'ing', 'ized', 'ised', 'izes', 'ises',
    'ize', 'ise', 'ical', 'ics', 'ic', 'ers', 'er', 'ies', 'ied', 'ed', 'al', 'ly', 's'];
  function stem1(w) {
    if (w.length <= 4 || /[0-9+#]/.test(w)) return w;
    if (/(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('es') && !/(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -1);
    for (const suf of SUFFIXES) {
      if (w.endsWith(suf) && w.length - suf.length >= 3) {
        let b = w.slice(0, -suf.length);
        if (suf === 'ies' || suf === 'ied') b += 'y';
        if (/([b-df-hj-np-tv-z])\1$/.test(b) && !/(ss|ll)$/.test(b)) b = b.slice(0, -1);
        return b;
      }
    }
    return w;
  }
  // "modeling" / "models" / "modelling" -> "model"; "statistical" / "statistics" -> "statist".
  const stem = (w) => {
    let s = stem1(stem1(w));
    if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
    return s;
  };
  const tokens = (s) => clean(s).toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
  const stems = (s) => tokens(s).map(stem);
  // The words of `form` in a row inside `line` (both stemmed); "node js" also matches "nodejs".
  function phraseAt(line, form) {
    if (!form.length || form.length > line.length + 1) return -1;
    outer: for (let i = 0; i + form.length <= line.length; i++) {
      for (let k = 0; k < form.length; k++) if (line[i + k] !== form[k]) continue outer;
      return i;
    }
    if (form.length > 1) { const j = form.join(''); const i = line.indexOf(j); if (i >= 0) return i; }
    return -1;
  }
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const round1 = (n) => Math.round(n * 10) / 10;

  // ---------- Resume structure ----------

  const HEADINGS = [
    ['summary', /^((professional|career|executive|personal) )?(summary|profile|overview|objective)( of qualifications)?$|^about( me)?$|^summary of qualifications$|^highlights$/],
    ['skills', /^((technical|core|key|relevant|professional) )?(skills|competencies|expertise|technologies|tech stack|toolkit)( (and|&) (tools|technologies|expertise|competencies|certifications))?$|^tools( (and|&) technologies)?$|^areas of expertise$|^skills summary$/],
    ['experience', /^((professional|work|relevant|career|industry) )?(experience|employment( history)?|work history|career history)$/],
    ['projects', /^((key|selected|personal|academic|notable|side|technical) )?projects?$/],
    ['education', /^education( (and|&) (training|certifications?))?$|^academic (background|qualifications)$/],
    ['certifications', /^(certifications?|licenses?( (and|&) certifications?)?|certificates?|credentials|certifications? (and|&) (awards|training))$/],
    ['other', /^(awards?|honors?( (and|&) awards)?|publications?|languages?|volunteer( experience| work)?|interests|achievements|leadership|activities|references|patents|additional information)$/],
  ];
  const headingKey = (text) => {
    const t = clean(text).toLowerCase().replace(/[^a-z&\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.split(' ').length > 6) return '';
    for (const [k, re] of HEADINGS) if (re.test(t)) return k;
    return '';
  };
  const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
  const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
  const URL_RE = /\b(https?:\/\/|www\.)\S+|\b(linkedin\.com|github\.com)\/\S*/i;
  const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE = `(?:(?:${MONTH})\\s*,?\\s*(\\d{4})|(\\d{1,2})\\s*/\\s*(\\d{4})|(\\d{4}))`;
  const RANGE_RE = new RegExp(`${DATE}\\s*(?:-|–|—|to|until|through)\\s*(present|current|now|today|${DATE})`, 'gi');
  const DATED_RE = new RegExp(`${DATE}\\s*(?:-|–|—|to|until|through)\\s*(present|current|now|today|${DATE})|\\b(19|20)\\d{2}\\b`, 'i');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // rawLines: [{ id, text, bullet, strong, size, editable }] in reading order (from resumedoc.js).
  // Every line gets its section, what it is (heading / bullet / text) and, when it must never be changed, why.
  function buildModel(rawLines, meta = {}) {
    const sizes = rawLines.map((l) => l.size || 0).filter(Boolean).sort((a, b) => a - b);
    const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    let section = 'header';
    let seenHeading = false;
    const lines = rawLines.map((l) => {
      const text = clean(l.text);
      const hk = headingKey(text);
      const looksHeading = hk && !l.bullet && text.length <= 48 && (l.strong || text === text.toUpperCase() || (bodySize && l.size > bodySize * 1.05) || text.length <= 30);
      let kind = l.bullet ? 'bullet' : 'text';
      if (looksHeading) { section = hk; seenHeading = true; kind = 'heading'; }
      let zone = section;
      // "Skills: Python, SQL" / "Summary: ..." on one line, outside a skills / summary section.
      const label = text.match(/^([A-Za-z &/]{3,40}):\s*\S/);
      if (!looksHeading && label && (headingKey(label[1]) === 'skills' || /\b(languages|frameworks|tools|technologies|platforms|databases|cloud|libraries)\b/i.test(label[1])) && zone !== 'experience' && zone !== 'projects') zone = 'skills';
      // A paragraph before the first heading is a summary written without a heading.
      if (!seenHeading && zone === 'header' && text.length > 140 && !EMAIL_RE.test(text)) zone = 'summary';
      return { id: l.id, text, kind, zone, section: kind === 'heading' ? hk : zone, bullet: !!l.bullet, strong: !!l.strong, size: l.size || 0, editable: l.editable !== false, stems: stems(text) };
    });
    for (const ln of lines) {
      ln.dated = DATED_RE.test(ln.text) && ln.kind !== 'bullet';
      ln.lock = ln.kind === 'heading' ? 'section heading'
        : ln.zone === 'header' ? 'name and contact details'
          : EMAIL_RE.test(ln.text) || URL_RE.test(ln.text) || (PHONE_RE.test(ln.text) && ln.text.length < 80) ? 'contact details'
            : ln.zone === 'education' || ln.zone === 'certifications' ? 'education and certifications'
              : ln.zone === 'other' ? 'not a section the optimizer changes'
                : ln.dated ? 'job title, company or dates'
                  : (ln.zone === 'experience' || ln.zone === 'projects') && ln.kind === 'text' && ln.text.length < 70 ? 'job title, company or project name'
                    : '';
    }
    const fullText = lines.map((l) => l.text).join('\n');
    const words = tokens(fullText).length;
    return { lines, meta, fullText, words, sections: [...new Set(lines.map((l) => l.zone))] };
  }

  // ---------- The job's requirements (AI, then checked) ----------

  function analysisPrompt(job) {
    return `You are an expert recruiter configuring an applicant tracking system. Read this job posting and list what a resume is screened for.
Return ONLY JSON:
{"titleAliases": ["other titles for the same role"],
 "seniority": "intern|junior|mid|senior|staff|principal|lead|manager|director|",
 "yearsRequired": number or null,
 "degree": {"level": "associate|bachelor|master|phd|", "fields": ["field of study"], "required": true|false} or null,
 "industries": [{"term": "industry or business area, as the posting words it", "related": ["neighbouring industries"]}],
 "requirements": [{"term": "short standard name", "aliases": ["exact equivalents"], "related": ["related but different"],
   "kind": "required_skill|preferred_skill|nice_to_have|responsibility|domain|education|certification|soft_skill",
   "hard": false, "quote": "the posting's own words it comes from (up to 15 words, copied exactly)"}]}
Rules:
- 10 to 35 requirements, each ONE thing. "term" is a short standard name of 1-5 words ("A/B Testing", "Statistical Modeling", "Large Language Models", "Recommendation Systems", "Model Evaluation"), never a sentence fragment. A phrase like "tested, reusable code" is a soft_skill or responsibility with a name like "Writing Tested, Reusable Code".
- One requirement per skill: merge synonyms and repeats ("Large Language Models" with aliases ["LLM", "LLMs"]; "PostgreSQL" with ["Postgres"]). Split lists ("AWS, GCP or Azure" are three).
- "aliases": only true equivalents (abbreviations, spellings). "related": neighbouring skills that are NOT the same ("TensorFlow" for PyTorch). Never put a different tool in "aliases".
- "kind": required_skill = a must-have technical skill or tool; preferred_skill = listed as preferred / nice to have / bonus; nice_to_have = mentioned in passing; responsibility = a main duty as a short phrase ("Build ranking models"); domain = industry or business area; education = degree or field; certification = a named certificate or license; soft_skill = communication, collaboration, ownership...
- "hard": true only for real eligibility gates: work authorization, security clearance, a license, a degree stated as mandatory.
- Years of experience and seniority go in "yearsRequired" / "seniority", not in "requirements".
- "industries": 1 to 8, only ones the posting's text names.
- Leave out benefits, company boilerplate, location, salary, equal-opportunity text.

JOB TITLE: ${job.title || ''}
COMPANY: ${job.company || ''}
${clean(job.description).slice(0, 9000)}`;
  }

  // Years the posting asks for, read from its text ("5+ years of experience").
  function yearsInText(text) {
    let best = null;
    for (const m of String(text || '').matchAll(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,5}?(?:experience|exp\b|working|in\b|building|developing)/gi)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 20 && (best == null || n > best)) best = n;
    }
    return best;
  }

  function prepReq(r, idx) {
    const forms = [r.term, ...r.aliases].map(stems).filter((f) => f.length);
    const uniq = [];
    for (const f of forms) if (!uniq.some((u) => u.join(' ') === f.join(' '))) uniq.push(f);
    // Soft skills ("communication") count half: an ATS rarely screens on them.
    return { ...r, id: r.id || 'r' + idx, weight: (IMPORTANCE[r.importance] || 1) * (r.category === 'soft' ? 0.5 : 1), forms: uniq, relatedForms: r.related.map(stems).filter((f) => f.length) };
  }

  // The AI's list, kept only where the posting really says it: every term (or one of its exact equivalents)
  // must be in the job text, so a requirement can't be invented. Duplicates are merged.
  // The requirement list in whatever shape the AI wrote it: {"requirements": [...]}, a bare list, another key
  // name ("keywords", "skills"), wrapped ({"analysis": {...}}), grouped by importance ({"required": [...]}),
  // items as plain strings.
  const IMP_KEYS = { required: 'required', must_have: 'required', musthave: 'required', mandatory: 'required', minimum: 'required', basic: 'required',
    preferred: 'preferred', nice_to_have: 'preferred', nicetohave: 'preferred', bonus: 'preferred', plus: 'preferred', optional: 'optional' };
  function requirementList(out, depth = 0) {
    if (Array.isArray(out)) return out;
    if (!out || typeof out !== 'object' || depth > 3) return [];
    for (const k of ['requirements', 'keywords', 'skills', 'items', 'job_requirements', 'jobRequirements', 'requirement_list', 'list']) if (Array.isArray(out[k]) && out[k].length) return out[k];
    const grouped = [];
    for (const [k, v] of Object.entries(out)) {
      const imp = IMP_KEYS[k.toLowerCase().replace(/[\s-]+/g, '_')] || IMP_KEYS[k.toLowerCase().replace(/[\s_-]+/g, '')];
      if (imp && Array.isArray(v)) grouped.push(...v.map((x) => (typeof x === 'string' ? { term: x, importance: imp } : x && typeof x === 'object' ? { importance: imp, ...x } : null)).filter(Boolean));
    }
    if (grouped.length) return grouped;
    for (const v of Object.values(out)) { if (v && typeof v === 'object') { const r = requirementList(v, depth + 1); if (r.length) return r; } }
    return [];
  }
  const word = (v) => String(v || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  // Requirement type -> [category, importance]; null = not a requirement (years / seniority are read apart).
  const KINDS = { required_skill: ['skill', 'required'], preferred_skill: ['skill', 'preferred'], nice_to_have: ['skill', 'optional'], responsibility: ['responsibility', ''],
    domain: ['domain', ''], industry: ['domain', ''], education: ['qualification', ''], certification: ['certification', ''], soft_skill: ['soft', ''], seniority: null, years: null, experience_years: null };
  const normImportance = (v) => {
    const t = word(v);
    if (/required|must|mandatory|minimum|basic|core|essential|critical|high/.test(t)) return 'required';
    if (/optional|passing|low|mention/.test(t)) return 'optional';
    return 'preferred';
  };
  const normCategory = (v) => {
    const t = word(v);
    if (CATEGORIES.includes(t)) return t;
    if (/soft|communication|interpersonal/.test(t)) return 'soft';
    if (/certif|licen/.test(t)) return 'certification';
    if (/educat|degree|qualif/.test(t)) return 'qualification';
    if (/responsib|duty|duties|task|experience area/.test(t)) return 'responsibility';
    if (/industr|domain|business/.test(t)) return 'domain';
    if (/tool|technolog|platform|framework|library|software|language|cloud|database/.test(t)) return 'tool';
    return 'skill';
  };

  function validateAnalysis(out, job) {
    const src = out && typeof out === 'object' && !Array.isArray(out) ? out : {};
    const jdStems = stems(`${job.title || ''}\n${job.description || ''}`);
    const jdSentences = String(job.description || '').split(/[\n.;•]+|\s[-–]\s/).map(stems).filter((s) => s.length >= 3);
    const strs = (v, n, max = 60) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,;]\s*/) : []).map((x) => clean(x)).filter((x) => x.length >= 1 && x.length <= max).slice(0, n);
    const inJd = (t) => { const f = stems(t); return f.length > 0 && phraseAt(jdStems, f) >= 0; };
    // Most of a multi-word term's words in one sentence of the posting ("statistical modeling techniques").
    const nearJd = (t) => { const c = [...new Set(stems(t).filter((w) => !STOP.has(w)))]; return c.length >= 2 && jdSentences.some((s) => c.filter((w) => s.includes(w)).length / c.length >= 0.75); };
    // The quote must be the posting's words: found as they are, or almost all of its words in one sentence.
    const jdFlat = ' ' + flat(`${job.title || ''} ${job.description || ''}`) + ' ';
    const quoteInJd = (q) => {
      const f = flat(q);
      if (f.length < 3) return false;
      if (jdFlat.includes(' ' + f + ' ') || jdFlat.includes(f)) return true;
      const w = [...new Set(stems(q).filter((x) => !STOP.has(x)))];
      return w.length >= 3 && jdSentences.some((s) => w.filter((x) => s.includes(x)).length / w.length >= 0.85);
    };
    const reqs = [];
    const list = requirementList(out);
    let dropped = 0;
    const droppedTerms = [];
    const add = (r) => {
      const key = stems(r.term).join(' ');
      const same = reqs.find((x) => [x.term, ...x.aliases].some((t) => stems(t).join(' ') === key) || [r.term, ...r.aliases].some((t) => stems(t).join(' ') === stems(x.term).join(' ')));
      if (!same) return reqs.push(r);
      if (IMPORTANCE[r.importance] > IMPORTANCE[same.importance]) same.importance = r.importance;
      same.hard = same.hard || r.hard;
      if (!same.quote && r.quote) same.quote = r.quote;
      for (const a of r.aliases) if (!same.aliases.includes(a) && a.toLowerCase() !== same.term.toLowerCase()) same.aliases.push(a);
    };
    for (const raw0 of list) {
      const raw = typeof raw0 === 'string' ? { term: raw0 } : raw0;
      if (!raw || typeof raw !== 'object') continue;
      let term = clean(raw.term || raw.k || raw.name || raw.keyword || raw.skill || raw.requirement || raw.text || raw.title || raw.label).replace(/^[-•*\s]+|[.:;]+$/g, '');
      if (term.length < 1 || term.length > 90) { dropped++; continue; }
      let category = normCategory(raw.category || raw.type || raw.kind);
      let importance = normImportance(raw.importance || raw.priority || raw.level || (raw.required === true ? 'required' : raw.required === false ? 'preferred' : ''));
      // The requirement type ("kind") decides category and importance.
      const kind = word(raw.kind).replace(/ /g, '_');
      const k = KINDS[kind];
      if (k === null) { dropped++; continue; } // years / seniority: read separately
      if (k) { category = k[0]; importance = k[1] || (raw.importance ? importance : kind === 'responsibility' ? 'required' : kind === 'certification' ? (raw.hard ? 'required' : 'preferred') : 'preferred'); }
      const quote = clean(raw.quote || raw.evidence || raw.source).slice(0, 200);
      const quoted = quoteInJd(quote);
      const hard = raw.hard === true || raw.hard === 'true';
      let aliases = strs(raw.aliases || raw.synonyms || raw.equivalents, 8, 40);
      const related = strs(raw.related || raw.relatedSkills, 6, 40);
      // "AWS (Amazon Web Services)": both names are the same thing.
      const paren = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (paren && category !== 'responsibility') { term = paren[1].trim(); aliases = [paren[2].trim(), ...aliases]; }
      aliases = [...new Set(aliases.filter((a) => a.toLowerCase() !== term.toLowerCase()))];
      if (category === 'responsibility') {
        const c = stems(term).filter((w) => !STOP.has(w));
        if (quoted || (c.length && jdSentences.some((s) => c.filter((w) => s.includes(w)).length / c.length >= 0.6))) add({ term, aliases, related, category, importance, quote: quoted ? quote : '', hard });
        else { dropped++; droppedTerms.push(term); }
        continue;
      }
      if ([term, ...aliases].some(inJd)) { add({ term, aliases, related, category, importance, quote: quoted ? quote : '', hard }); continue; }
      // "AWS / GCP / Azure", "Python or Go": each part the posting names is its own requirement.
      const parts = term.split(/\s*(?:\/|,|\bor\b|\band\b|&)\s*/i).map((x) => x.trim()).filter((x) => x.length >= 1);
      const hits = parts.length > 1 ? parts.filter(inJd) : [];
      if (hits.length) { for (const h of hits) add({ term: h, aliases: [], related, category, importance, quote: quoted ? quote : '', hard }); continue; }
      // A short standard name ("Model Evaluation") for words the posting has ("model-performance measurement").
      if (nearJd(term) || quoted) { add({ term, aliases, related, category, importance, quote: quoted ? quote : '', hard }); continue; }
      dropped++;
      droppedTerms.push(term);
    }
    // The job's industries: requirements of their own kind, kept only when the posting names them.
    for (const raw0 of (Array.isArray(src.industries) ? src.industries : typeof src.industries === 'string' ? src.industries.split(/\s*[,;]\s*/) : []).slice(0, 10)) {
      const raw = typeof raw0 === 'string' ? { term: raw0 } : raw0;
      const term = clean(raw?.term || raw?.name || raw?.industry);
      if (!term || term.length > 60) continue;
      const paren = term.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      const t = paren ? paren[1].trim() : term, aliases = paren ? [paren[2].trim()] : [];
      if ([t, ...aliases].some(inJd) || nearJd(t)) add({ term: t, aliases, related: strs(raw?.related, 6, 40), category: 'domain', importance: normImportance(raw?.importance || 'preferred') });
      else droppedTerms.push(t);
    }
    const order = { required: 0, preferred: 1, optional: 2 };
    reqs.sort((a, b) => order[a.importance] - order[b.importance]);
    const requirements = reqs.slice(0, 45).map(prepReq);
    let years = Number(src.yearsRequired);
    // A number of years the posting doesn't state is not used; its own text decides then.
    if (!(years >= 1 && years <= 20) || !new RegExp(`\\b${years}\\s*\\+?\\s*(?:(?:-|–|to)\\s*\\d+\\s*)?\\+?\\s*years?`, 'i').test(job.description || '')) years = yearsInText(job.description);
    const dg = src.degree && typeof src.degree === 'object' ? src.degree : {};
    const level = ['associate', 'bachelor', 'master', 'phd'].includes(String(dg.level || '').toLowerCase()) ? String(dg.level).toLowerCase() : '';
    const degreeSaid = /\b(degree|bachelor|master|ph\.?\s?d|b\.?s\.?|m\.?s\.?|bs\/ms|diploma)\b/i.test(job.description || '');
    const sen = word(src.seniority);
    return {
      version: VERSION, mode: 'ai', title: clean(job.title), company: clean(job.company),
      titleAliases: strs(src.titleAliases, 5, 60),
      seniority: /^(intern|junior|mid|senior|staff|principal|lead|manager|director)$/.test(sen) ? sen : '',
      yearsRequired: years ?? null,
      degree: level && degreeSaid ? { level, fields: strs(dg.fields, 6, 50), required: dg.required !== false } : null,
      requirements, dropped, droppedTerms: droppedTerms.slice(0, 8), received: list.length, at: new Date().toISOString(),
    };
  }

  // ---------- Scoring ----------

  const DEMO_ZONES = new Set(['experience', 'projects']);
  function evidenceOf(ln, form) {
    return { lineId: ln.id, section: ln.zone, text: ln.text.length > 220 ? ln.text.slice(0, 217) + '...' : ln.text, demonstrated: DEMO_ZONES.has(ln.zone) && ln.kind !== 'heading', form };
  }
  // One requirement against the resume lines: matched (the term or an exact equivalent), partial (a related
  // skill, or most words of a multi-word term on one line), or missing. Each requirement counts once,
  // however often the resume repeats it.
  function matchRequirement(req, lines) {
    const body = lines.filter((l) => l.kind !== 'heading');
    if (req.category === 'responsibility') {
      const c = [...new Set(req.forms[0]?.filter((w) => !STOP.has(w)) || [])];
      let best = 0, at = null;
      for (const ln of body) {
        if (!DEMO_ZONES.has(ln.zone) && ln.zone !== 'summary') continue;
        const set = new Set(ln.stems);
        const r = c.length ? c.filter((w) => set.has(w)).length / c.length : 0;
        if (r > best) { best = r; at = ln; }
      }
      const status = best >= 0.6 ? 'matched' : best >= 0.34 ? 'partial' : 'missing';
      return { status, demonstrated: status !== 'missing' && !!at && DEMO_ZONES.has(at.zone), evidence: at && status !== 'missing' ? [evidenceOf(at, '')] : [], via: '' };
    }
    const hits = [];
    let via = '';
    for (const ln of body) {
      const f = req.forms.find((x) => phraseAt(ln.stems, x) >= 0);
      if (f) { hits.push(evidenceOf(ln, f.join(' '))); if (!via && f !== req.forms[0]) via = [req.term, ...req.aliases].find((t) => stems(t).join(' ') === f.join(' ')) || ''; }
    }
    if (hits.length) {
      hits.sort((a, b) => b.demonstrated - a.demonstrated);
      return { status: 'matched', demonstrated: hits.some((h) => h.demonstrated), evidence: hits.slice(0, 3), mentions: hits.length, via };
    }
    const partial = [];
    for (const ln of body) {
      const rf = req.relatedForms.findIndex((x) => phraseAt(ln.stems, x) >= 0);
      if (rf >= 0) { partial.push({ ...evidenceOf(ln, ''), related: req.related[rf] }); continue; }
      const c = (req.forms[0] || []).filter((w) => !STOP.has(w));
      if (c.length >= 2) {
        const set = new Set(ln.stems);
        if (c.filter((w) => set.has(w)).length >= Math.ceil(c.length / 2)) partial.push({ ...evidenceOf(ln, ''), related: '' });
      }
    }
    if (partial.length) {
      partial.sort((a, b) => b.demonstrated - a.demonstrated);
      return { status: 'partial', demonstrated: partial.some((h) => h.demonstrated), evidence: partial.slice(0, 2), via: partial[0].related || '' };
    }
    return { status: 'missing', demonstrated: false, evidence: [], via: '' };
  }

  // Work time from the date ranges in the experience section (overlapping jobs counted once).
  function resumeYears(model) {
    const exp = model.lines.filter((l) => l.zone === 'experience' || l.zone === 'projects');
    const src = exp.length ? exp : model.lines.filter((l) => l.zone !== 'education' && l.zone !== 'certifications');
    const now = new Date();
    const nowM = now.getFullYear() * 12 + now.getMonth();
    const toM = (mon, y1, mm, y2, y3, end) => {
      if (y1) return Number(y1) * 12 + Math.max(0, MONTHS.indexOf(String(mon).toLowerCase().slice(0, 3)));
      if (y2) return Number(y2) * 12 + Math.max(0, Math.min(11, Number(mm) - 1));
      if (y3) return Number(y3) * 12 + (end ? 11 : 0);
      return null;
    };
    const spans = [];
    for (const ln of src) {
      for (const m of ln.text.matchAll(RANGE_RE)) {
        const start = toM(m[1], m[2], m[3], m[4], m[5], false);
        const end = /present|current|now|today/i.test(m[6]) ? nowM : toM(m[7], m[8], m[9], m[10], m[11], true);
        if (start == null || end == null || end < start || start < 1960 * 12 || end > nowM + 1) continue;
        spans.push([start, end]);
      }
    }
    if (!spans.length) {
      const claim = model.lines.map((l) => l.text.match(/\b(\d{1,2})\+?\s*years?\b/i)).filter(Boolean).map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 45);
      return claim.length ? { years: Math.max(...claim), from: 'claim' } : { years: null, from: '' };
    }
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0, [s, e] = spans[0];
    for (const [a, b] of spans.slice(1)) { if (a <= e + 1) e = Math.max(e, b); else { total += e - s + 1; [s, e] = [a, b]; } }
    total += e - s + 1;
    return { years: round1(total / 12), from: 'dates' };
  }

  const TITLE_STOP = new Set(['senior', 'sr', 'junior', 'jr', 'staff', 'lead', 'principal', 'head', 'of', 'and', 'the', 'i', 'ii', 'iii', 'iv', 'a', 'an', 'to', 'for', 'in', 'remote', 'hybrid', 'mid', 'level', 'associate', 'contract', 'contractor', 'w2', 'us', 'usa', 'onsite', 'on', 'site']);
  const TITLE_SAME = { developer: 'engineer', programmer: 'engineer', swe: 'engineer', sde: 'engineer', ml: 'machine', ai: 'machine', fullstack: 'full', frontend: 'front', backend: 'back', scientist: 'scientist' };
  const titleWords = (s) => new Set(tokens(s).filter((w) => !TITLE_STOP.has(w)).map((w) => TITLE_SAME[w] || stem(w)));
  // The job's own title counts in full; a title the AI called the same role only counts 70% (a recruiter's
  // ATS searches the posting's title, not its look-alikes).
  function titleMatch(model, analysis) {
    const wants = [{ w: titleWords(analysis.title), f: 1 }, ...(analysis.titleAliases || []).map((t) => ({ w: titleWords(t), f: 0.7 }))].filter((x) => x.w.size);
    if (!wants.length) return null;
    const cands = model.lines.filter((l) => (l.zone === 'header' && l.text.length < 160) || ((l.zone === 'experience' || l.zone === 'summary') && l.kind !== 'bullet' && l.text.length < 100));
    let best = 0, line = '';
    for (const c of cands) {
      // Each piece of "Senior Engineer | AI Engineer · name@x.com" and the whole line.
      const pieces = c.text.replace(EMAIL_RE, ' | ').split(/\s[|·•]\s|[|·•]|,\s| - | – | at /).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 70);
      for (const { w: want, f } of wants) {
        for (const ww of [...pieces.map(titleWords), titleWords(c.text)]) {
          if (!ww.size) continue;
          const common = [...want].filter((x) => ww.has(x)).length;
          // How much of the job's title the line covers (a long line with the title in it still counts).
          const s = f * Math.max((2 * common) / (want.size + Math.min(ww.size, want.size + 2)), common / want.size * 0.9);
          if (s > best) { best = s; line = c.text; }
        }
      }
    }
    return { credit: Math.min(1, best), line };
  }

  const DEGREE_LEVELS = [['phd', 4, /\b(ph\.?\s?d|doctorate|doctor of philosophy|d\.?phil)\b/i], ['master', 3, /\b(master'?s?|m\.?\s?s\.?c?|m\.?\s?eng|mba|m\.?\s?a\.|ms in|m\.s\.)\b/i],
    ['bachelor', 2, /\b(bachelor'?s?|b\.?\s?s\.?c?|b\.?\s?a\.|b\.?\s?eng|b\.?\s?tech|bs in|b\.s\.|undergraduate degree)\b/i], ['associate', 1, /\bassociate'?s? (degree|of)\b/i]];
  const LEVEL_N = { associate: 1, bachelor: 2, master: 3, phd: 4 };
  function degreeOf(model) {
    const edu = model.lines.filter((l) => l.zone === 'education');
    let best = 0, line = '';
    for (const l of edu.length ? edu : model.lines) {
      for (const [, n, re] of DEGREE_LEVELS) if (re.test(l.text) && n > best && (edu.length || !/\bms (office|word|excel)\b/i.test(l.text))) { best = n; line = l.text; }
    }
    return { level: best, line, lines: edu };
  }

  // ---------- Candidate evidence: the resume file, the profile, or both ----------

  // Profile lines get ids from 100000 up, so they never clash with the resume's line ids.
  const PROFILE_ID = 100000;
  function profileRawLines(p) {
    const raw = [];
    let n = 0;
    const push = (text, extra = {}) => { const t = clean(text); if (t) raw.push({ id: PROFILE_ID + n++, text: t, ...extra }); };
    push(p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '));
    push([p.headline, p.currentTitle && p.currentTitle !== p.headline ? p.currentTitle : ''].filter(Boolean).join(' | '));
    push([p.email, p.phone].filter(Boolean).join(' · '));
    if (p.summary) { push('Summary', { strong: true }); push(p.summary); }
    const skills = Array.isArray(p.skills) ? p.skills : typeof p.skills === 'string' ? p.skills.split(/\s*[,;]\s*/) : [];
    if (skills.length) { push('Skills', { strong: true }); push(skills.join(', ')); }
    const exp = Array.isArray(p.experience) ? p.experience : [];
    if (exp.length) {
      push('Experience', { strong: true });
      for (const e of exp) {
        push(`${[e.title, e.company].filter(Boolean).join(', ')} ${e.start || ''}${e.start || e.end ? ' - ' : ''}${e.end || (e.start ? 'Present' : '')}`);
        for (const d of String(e.description || '').split(/\n+|\s*[•●▪]\s+|(?<=\.)\s+(?=[A-Z])/)) push(d.replace(/^[-*]\s+/, ''), { bullet: true });
      }
    }
    const edu = Array.isArray(p.education) ? p.education : [];
    if (edu.length) { push('Education', { strong: true }); for (const e of edu) push([[e.degree, e.field].filter(Boolean).join(' in '), e.school, e.end || e.start].filter(Boolean).join(', ')); }
    const certs = Array.isArray(p.certifications) ? p.certifications : typeof p.certifications === 'string' ? p.certifications.split(/\s*[,;\n]\s*/) : [];
    if (certs.length) { push('Certifications', { strong: true }); for (const c of certs) push(typeof c === 'string' ? c : c?.name); }
    return raw;
  }
  function buildProfileModel(p) {
    const m = buildModel(profileRawLines(p || {}), { profile: true });
    for (const l of m.lines) { l.source = 'profile'; l.editable = false; l.lock = l.lock || 'profile field (change it in the dashboard)'; }
    const stated = Number(String(p?.yearsExperience ?? '').match(/\d+(\.\d+)?/)?.[0]);
    m.statedYears = stated >= 0.5 && stated <= 50 ? stated : null;
    return m;
  }
  // The evidence the score is based on: only the chosen source(s), never one silently swapped for the other.
  function combineEvidence(resumeModel, profileModel, source) {
    if (resumeModel) for (const l of resumeModel.lines) l.source = l.source || 'resume';
    if (source === 'profile' || !resumeModel) return { ...profileModel, source: 'profile', resume: null, profile: profileModel };
    if (source === 'resume' || !profileModel) return { ...resumeModel, source: 'resume', resume: resumeModel, profile: profileModel || null };
    const lines = [...resumeModel.lines, ...profileModel.lines];
    return { lines, meta: resumeModel.meta, fullText: lines.map((l) => l.text).join('\n'), words: resumeModel.words, sections: [...new Set(lines.map((l) => l.zone))], source: 'both', resume: resumeModel, profile: profileModel };
  }

  // Years: from the dates, and what the text states ("9+ years"), per source. Nothing is inferred beyond them.
  function yearsFacts(model) {
    if (!model) return { dates: null, stated: null };
    const y = resumeYears({ ...model, lines: model.lines.filter((l) => l.zone !== 'header' || !/\byears?\b/i.test(l.text)) });
    const stated = model.lines.filter((l) => l.zone === 'summary' || l.zone === 'header')
      .map((l) => l.text.match(/\b(\d{1,2})\s*(\+?)\s*(?:years?|yrs)\b/i)).filter(Boolean).map((m) => ({ n: Number(m[1]), plus: !!m[2] })).filter((x) => x.n >= 1 && x.n <= 45)
      .sort((a, b) => b.n - a.n);
    // "9+ years" is a minimum: dates of 10.5 years agree with it.
    return { dates: y.from === 'dates' ? y.years : null, stated: stated[0]?.n ?? model.statedYears ?? null, plus: stated[0]?.plus || false };
  }
  function yearsInfo(ev) {
    const r = yearsFacts(ev.resume), p = yearsFacts(ev.profile);
    const order = ev.source === 'profile' ? [['profile dates', p.dates], ['profile', p.stated]]
      : ev.source === 'resume' ? [['resume dates', r.dates], ['resume summary', r.stated]]
        : [['resume dates', r.dates], ['resume summary', r.stated], ['profile dates', p.dates], ['profile', p.stated]];
    const used = order.find(([, v]) => v != null) || ['', null];
    const all = [['resume dates', r.dates], ['resume summary', r.stated], ['profile dates', p.dates], ['profile', p.stated]].filter(([, v]) => v != null);
    const plusOf = { 'resume summary': r.plus, profile: p.plus };
    // Two figures disagree when they are 1.5+ years apart, unless one is a minimum ("9+") the other meets.
    const agree = ([k1, v1], [k2, v2]) => Math.abs(v1 - v2) < 1.5 || (plusOf[k1] && v2 >= v1) || (plusOf[k2] && v1 >= v2);
    const conflict = all.some((x, i) => all.slice(i + 1).some((y) => !agree(x, y)));
    const say = { 'resume dates': 'the resume\'s dates show', 'resume summary': 'the resume states', 'profile dates': 'the profile\'s dates show', profile: 'the profile says' };
    return { years: used[1], from: used[0], resume: r, profile: p, conflict,
      note: conflict ? `${all.map(([k, v]) => `${say[k]} ${v}${plusOf[k] ? '+' : ''} years`).join(', ')}. Used: ${used[0] || 'none'}.`.replace(/^./, (c) => c.toUpperCase()) : '' };
  }

  // ---------- The AI's review of the evidence, checked line by line ----------

  const MATCHES = ['direct', 'equivalent', 'related', 'none', 'contradiction'];
  const MATCH_LABELS = { direct: 'Direct match', equivalent: 'Equivalent match', related: 'Related experience', none: 'Not demonstrated', contradiction: 'Contradiction' };
  const CREDIT = { direct: 1, equivalent: 0.9, related: 0.35, none: 0, contradiction: 0 };
  const KIND_LABEL = (r) => (r.category === 'responsibility' ? 'Responsibility' : r.category === 'domain' ? 'Industry / domain' : r.category === 'certification' ? 'Certification'
    : r.category === 'qualification' ? 'Education' : r.category === 'soft' ? 'Soft skill' : r.importance === 'required' ? 'Required skill' : r.importance === 'preferred' ? 'Preferred skill' : 'Nice to have');

  function reviewPrompt(analysis, model) {
    const reqs = analysis.requirements.map((r) => `${r.id} (${KIND_LABEL(r)}${r.hard ? ', must-have' : ''}) ${r.term}${r.aliases.length ? ` [same as: ${r.aliases.join(', ')}]` : ''}${r.quote ? ` - posting: "${r.quote}"` : ''}`).join('\n');
    const lines = model.lines.filter((l) => l.kind !== 'heading' && l.text.length > 1)
      .map((l) => `[${l.id}] (${l.source || 'resume'} · ${l.zone}) ${l.text}`).join('\n').slice(0, 16000);
    return `You check a job candidate's evidence against a job's requirements. Use ONLY the numbered evidence lines below; never assume anything they don't say.
For every requirement return:
- "status": "direct" = a line names it (or an exact equivalent word); "equivalent" = the same skill in other words (e.g. "Postgres" for PostgreSQL, "built CTR prediction models" for Predictive Modeling); "related" = relevant but not the same (a different tool, a neighbouring area); "none" = nothing shows it; "contradiction" = a line shows the opposite (e.g. the only degree is in an unrelated field when a field is required).
- "lines": ids of the lines that show it; "quote": 3-15 words copied exactly from one of those lines.
- "explanation": one short sentence: what the evidence shows, or what is missing.
- "recommendation": one short sentence on how to show it better, using only what the lines say; "" when the evidence is none (do not suggest claiming it).
Do not call related experience equivalent. Different tools (TensorFlow vs PyTorch, AWS vs Azure) are related, not equivalent.
Also judge the professional summary for this job: "summary": {"status": "strong|adequate|weak|missing", "explanation": "...", "recommendation": "..."}.
And up to 5 "suggestions": [{"text": "...", "lines": [ids]}] - concrete resume improvements built on real lines (e.g. "Your resume mentions statistical modeling but not how you evaluated models; add the evaluation methods you actually used").
Never suggest adding skills, employers, projects, degrees, certifications, dates or numbers the lines don't show.
Return ONLY JSON: {"results":[{"id":"r1","status":"direct","lines":[3],"quote":"...","explanation":"...","recommendation":"..."}],"summary":{...},"suggestions":[...]}

JOB: ${analysis.title}${analysis.company ? ' at ' + analysis.company : ''}
REQUIREMENTS:
${reqs}

EVIDENCE LINES:
${lines}`;
  }

  const numbersIn = (s) => (String(s).match(/\d[\d,.]*%?/g) || []).map((x) => x.replace(/[,.]$/, ''));
  // The AI's judgments, kept only where the evidence it cites is really there: a line id that exists, a quote
  // found in the evidence. A "direct" match whose words aren't in the lines becomes "equivalent"; one with no
  // real evidence becomes "not demonstrated". Recommendations with numbers the evidence doesn't have are dropped.
  function validateReview(out, analysis, model) {
    const byLine = new Map(model.lines.map((l) => [l.id, l]));
    const flatLines = model.lines.map((l) => [l, ' ' + flat(l.text) + ' ']);
    const evNums = new Set(numbersIn(model.fullText));
    const okText = (t) => { const s = clean(t).slice(0, 300); return numbersIn(s).every((n) => evNums.has(n)) ? s : ''; };
    const list = Array.isArray(out?.results) ? out.results : Array.isArray(out) ? out : requirementList(out);
    const given = new Map();
    for (const x of list) if (x && typeof x === 'object' && x.id != null) given.set(String(x.id), x);
    const byId = {};
    for (const r of analysis.requirements) {
      const x = given.get(r.id) || given.get(r.term);
      let match = MATCHES.includes(String(x?.status || '').toLowerCase()) ? String(x.status).toLowerCase() : 'none';
      const notes = [];
      if (!x) notes.push('the AI did not judge this requirement');
      const ids = (Array.isArray(x?.lines) ? x.lines : x?.line != null ? [x.line] : []).map(Number).filter((id) => byLine.has(id) && byLine.get(id).kind !== 'heading');
      const q = clean(x?.quote || '');
      const fq = flat(q);
      let quoteLine = null;
      if (fq.length >= 3) quoteLine = (ids.map((id) => byLine.get(id)).find((l) => (' ' + flat(l.text) + ' ').includes(fq))) || flatLines.find(([, t]) => t.includes(fq))?.[0] || null;
      const lines = [...new Set([...(quoteLine ? [quoteLine.id] : []), ...ids])].map((id) => byLine.get(id));
      if (match !== 'none' && !lines.length) { notes.push(`the AI said "${MATCH_LABELS[match]}" but cited nothing that is in the evidence`); match = 'none'; }
      if (match !== 'none' && q && !quoteLine && lines.length) notes.push('the AI\'s quote is not word for word in the evidence; its cited line is shown instead');
      const own = lines.some((l) => r.forms.some((f) => phraseAt(l.stems, f) >= 0));
      if (match === 'direct' && !own) { match = 'equivalent'; notes.push('the exact words are not in the line: counted as equivalent'); }
      // A tool the job reading itself called related (TensorFlow for PyTorch) is never an equivalent.
      const rel = !own && r.related.find((t) => lines.some((l) => phraseAt(l.stems, stems(t)) >= 0));
      if ((match === 'equivalent' || match === 'direct') && rel) { match = 'related'; notes.push(`"${rel}" is a related skill, not the same one`); }
      byId[r.id] = { match, lines: lines.map((l) => l.id), quote: quoteLine ? q : '', explanation: okText(x?.explanation), recommendation: match === 'none' ? '' : okText(x?.recommendation), note: notes.join('; ') };
    }
    const s = out?.summary && typeof out.summary === 'object' ? out.summary : null;
    const summary = s ? { status: ['strong', 'adequate', 'weak', 'missing'].includes(String(s.status).toLowerCase()) ? String(s.status).toLowerCase() : 'adequate', explanation: okText(s.explanation), recommendation: okText(s.recommendation) } : null;
    const suggestions = (Array.isArray(out?.suggestions) ? out.suggestions : []).slice(0, 6).map((g) => ({ text: okText(typeof g === 'string' ? g : g?.text), lines: (Array.isArray(g?.lines) ? g.lines : []).map(Number).filter((id) => byLine.has(id)) }))
      .filter((g) => g.text && g.lines.length);
    return { mode: 'ai', byId, summary, suggestions };
  }
  // Without the AI: the words themselves (an exact equivalent from the job reading counts as equivalent).
  function rulesReview(analysis, model) {
    const byId = {};
    for (const r of analysis.requirements) {
      const m = matchRequirement(r, model.lines);
      const match = m.status === 'matched' ? (m.via ? 'equivalent' : 'direct') : m.status === 'partial' ? 'related' : 'none';
      byId[r.id] = { match, lines: m.evidence.map((e) => e.lineId), quote: '', explanation: match === 'none' ? `"${r.term}" is not in the evidence` : m.via ? `Found as "${m.via}"` : match === 'related' ? 'Only a related term or part of the words was found' : 'Named in the evidence', recommendation: '', note: '' };
    }
    return { mode: 'rules', byId, summary: null, suggestions: [] };
  }
  // After the resume is changed: the same judgments, moved to the new file's lines (matched by their text).
  // A judgment whose evidence line was rewritten is kept only if its quote is still in the new text.
  function carryReview(review, oldModel, newModel) {
    if (!review) return null;
    const oldById = new Map(oldModel.lines.map((l) => [l.id, l]));
    const newByText = new Map();
    for (const l of newModel.lines) { const k = flat(l.text); if (!newByText.has(k)) newByText.set(k, l.id); }
    const newFlat = newModel.lines.map((l) => [l.id, ' ' + flat(l.text) + ' ']);
    const byId = {};
    for (const [rid, j] of Object.entries(review.byId)) {
      const ids = j.lines.map((id) => newByText.get(flat(oldById.get(id)?.text || ''))).filter((x) => x != null);
      if (!ids.length && j.quote) { const hit = newFlat.find(([, t]) => t.includes(flat(j.quote))); if (hit) ids.push(hit[0]); }
      byId[rid] = j.match === 'none' || ids.length ? { ...j, lines: ids } : { ...j, match: 'none', lines: [], note: 'its evidence line was changed', recommendation: '' };
    }
    const sug = review.suggestions.map((g) => ({ ...g, lines: g.lines.map((id) => newByText.get(flat(oldById.get(id)?.text || ''))).filter((x) => x != null) })).filter((g) => g.lines.length);
    return { ...review, byId, suggestions: sug };
  }

  // ---------- Resume readability: a separate diagnostic, not part of the fit score ----------

  function readabilityReport(model) {
    const m = model.meta || {};
    const checks = [];
    const add = (ok, level, title, detail, advice = '') => checks.push({ ok, level: ok ? 'ok' : level, title, detail, advice });
    const unread = m.unreadable > 0.05;
    add(model.words >= 150 && !unread, 'risk', 'Text can be read', model.words < 150 ? `Only ${model.words} words could be read: an ATS may see an almost empty resume.` : unread ? `${Math.round(m.unreadable * 100)}% of the letters have no text map (a font problem): those words read as gaps.` : `${model.words} words read.`,
      'Export the resume from Word or Google Docs as a text-based PDF or .docx, not a scan or image.');
    const heads = new Set(model.lines.filter((l) => l.kind === 'heading').map((l) => l.section));
    const missing = [['experience', 'Experience'], ['education', 'Education'], ['skills', 'Skills']].filter(([k]) => !heads.has(k)).map(([, n]) => n);
    add(!missing.length, missing.includes('Experience') ? 'risk' : 'warn', 'Standard section headings', missing.length ? `No heading an ATS recognizes for: ${missing.join(', ')}.` : 'Experience, Education and Skills headings found.', 'Use plain headings such as "Experience", "Education", "Skills".');
    const expLines = model.lines.filter((l) => l.zone === 'experience');
    const range1 = new RegExp(RANGE_RE.source, 'i');
    const dated = expLines.filter((l) => range1.test(l.text));
    add(!expLines.length || dated.length > 0, 'warn', 'Employment dates', dated.length ? `${dated.length} date range${dated.length === 1 ? '' : 's'} found (e.g. "${dated[0].text.match(range1)?.[0] || ''}").` : 'No date ranges in a common format were found in the experience section.',
      'Write each job\'s dates like "Jan 2020 - Present" or "01/2020 - 03/2023" on the job\'s line.');
    const email = EMAIL_RE.test(model.fullText), phone = PHONE_RE.test(model.fullText);
    add(email && phone, 'warn', 'Contact details', email && phone ? 'Email and phone found in the text.' : `${email ? '' : 'No email'}${!email && !phone ? ' and ' : ''}${phone ? '' : 'no phone'} found in the readable text.`, 'Put email and phone as plain text near the top.');
    if (m.headerContact) add(false, 'warn', 'Contact details in the page header', 'Email or phone are only in the Word page header; some ATS do not read page headers.', 'Move them into the first lines of the page body.');
    if (m.tables) add(false, 'warn', 'Tables', 'The resume uses a table. Some ATS read table cells out of order or skip them.', 'If the table holds jobs or skills, consider plain lines instead.');
    if (m.textboxes) add(false, 'warn', 'Text boxes', 'The resume uses text boxes. Some ATS do not read text inside text boxes.', 'Move important text (skills, contact details) out of text boxes.');
    if (m.columns) add(false, 'warn', 'Columns', 'The layout has two columns. Some ATS read across the columns and mix the lines.', 'A single-column layout is read in order everywhere.');
    if (model.words > 1300) add(false, 'info', 'Length', `${model.words} words: long for most roles.`, 'Keep the most relevant 1-2 pages.');
    if (m.stuffed?.length) add(false, 'warn', 'Repeated keywords', `Written 7+ times: ${m.stuffed.slice(0, 4).join(', ')}. This can read as keyword stuffing.`, 'Name each skill where it was used, not over and over.');
    const level = checks.some((c) => c.level === 'risk') ? 'High parsing risk' : checks.some((c) => c.level === 'warn') ? 'Some parsing risks' : 'Good';
    return { level, checks };
  }

  // ---------- The JobBid Fit Estimate ----------

  const SENIORITY = [['intern', 0], ['junior', 1], ['jr', 1], ['entry', 1], ['associate', 1], ['mid', 2], ['senior', 3], ['sr', 3], ['lead', 4], ['staff', 4], ['principal', 5], ['architect', 4], ['manager', 4], ['head', 5], ['director', 5]];
  const levelOf = (t) => { const w = tokens(t); let lv = null; for (const [k, n] of SENIORITY) if (w.includes(k)) lv = Math.max(lv ?? 0, n); return lv; };
  const BANDS = [[80, 'Strong alignment'], [65, 'Good alignment'], [45, 'Partial alignment'], [0, 'Limited alignment']];

  // model: the chosen evidence (combineEvidence); review: validateReview / rulesReview; years: yearsInfo.
  function score(model, analysis, weightsIn, review, years) {
    const weights = { ...DEFAULT_WEIGHTS, ...(weightsIn || {}) };
    for (const k of Object.keys(weights)) weights[k] = Math.max(0, Number(weights[k]) || 0);
    review = review || rulesReview(analysis, model);
    years = years || yearsInfo({ resume: model.resume || model, profile: model.profile || null, source: model.source || 'resume' });
    const byLine = new Map(model.lines.map((l) => [l.id, l]));
    const rows = analysis.requirements.map((r) => {
      let j = review.byId[r.id] || { match: 'none', lines: [], quote: '', explanation: '', recommendation: '', note: '' };
      // The words themselves always count: a term written in the evidence is a direct match, whatever the AI said.
      const lit = matchRequirement(r, model.lines);
      if (lit.status === 'matched' && (j.match === 'none' || j.match === 'related' || (j.match === 'equivalent' && !lit.via))) {
        j = { ...j, match: lit.via ? 'equivalent' : 'direct', lines: lit.evidence.map((e) => e.lineId), quote: '', explanation: j.match === 'none' || !j.explanation ? (lit.via ? `Written as "${lit.via}"` : 'Named in the evidence') : j.explanation, note: j.match === 'none' && review.mode === 'ai' ? 'found by its exact words' : j.note };
      }
      const ev = j.lines.map((id) => byLine.get(id)).filter(Boolean);
      const evidence = ev.slice(0, 3).map((l) => ({ lineId: l.id, section: l.zone, source: l.source || 'resume', text: l.text.length > 220 ? l.text.slice(0, 217) + '...' : l.text, demonstrated: DEMO_ZONES.has(l.zone) }));
      const status = j.match === 'direct' || j.match === 'equivalent' ? 'matched' : j.match === 'related' ? 'partial' : 'missing';
      return { id: r.id, term: r.term, category: r.category, importance: r.importance, kind: KIND_LABEL(r), hard: !!r.hard, weight: r.weight, aliases: r.aliases, related: r.related, quoteJob: r.quote || '',
        match: j.match, matchLabel: MATCH_LABELS[j.match], status, demonstrated: evidence.some((e) => e.demonstrated), evidence, quote: j.quote, explanation: j.explanation, recommendation: j.recommendation, note: j.note,
        via: lit.via || '', mentions: lit.mentions || 0 };
    });
    model.meta = { ...(model.meta || {}), stuffed: rows.filter((x) => x.mentions >= 7).map((x) => x.term) };
    const sumW = (list) => list.reduce((s, x) => s + x.weight, 0);
    const c = (x) => CREDIT[x.match];
    const lostText = (x) => (x.match === 'related' ? `"${x.term}": related experience only${x.explanation ? ` - ${x.explanation}` : ''}` : x.match === 'contradiction' ? `"${x.term}": the evidence conflicts${x.explanation ? ` - ${x.explanation}` : ''}`
      : x.match === 'equivalent' ? `"${x.term}": equivalent, not the posting's words` : `"${x.term}" (${x.importance}) is not demonstrated`);
    const group = (key, list, detail) => {
      if (!list.length) return null;
      const W = sumW(list);
      return { key, credit: list.reduce((s, x) => s + x.weight * c(x), 0) / W, detail,
        deductions: list.filter((x) => c(x) < 1).map((x) => ({ lost: (x.weight * (1 - c(x))) / W, text: lostText(x), term: x.term })) };
    };
    const skills = rows.filter((x) => KEYWORD_CATS.has(x.category) && x.category !== 'soft');
    const req = skills.filter((x) => x.importance === 'required');
    const pref = rows.filter((x) => (KEYWORD_CATS.has(x.category) && x.importance !== 'required') || x.category === 'soft');
    const shown = (list) => list.filter((x) => x.status === 'matched').length;
    const comps = [
      group('required', req, `${shown(req)} of ${req.length} required skills shown`),
      group('preferred', pref, `${shown(pref)} of ${pref.length} preferred / nice-to-have shown`),
      group('responsibilities', rows.filter((x) => x.category === 'responsibility'), `${shown(rows.filter((x) => x.category === 'responsibility'))} of ${rows.filter((x) => x.category === 'responsibility').length} main duties shown`),
      group('industry', rows.filter((x) => x.category === 'domain'), `${shown(rows.filter((x) => x.category === 'domain'))} of ${rows.filter((x) => x.category === 'domain').length} of the job's industries shown`),
    ].filter(Boolean);
    // Relevant work experience: the years asked for, and the job's skills shown in actual jobs or projects
    // (not only listed under Skills).
    const expParts = [];
    if (analysis.yearsRequired) {
      const need = analysis.yearsRequired, have = years.years;
      const yc = have == null ? 0.5 : Math.min(1, have / need);
      expParts.push({ w: 1, c: yc, text: have == null ? 'No work dates or stated years found' : have < need ? `The job asks for ${need}+ years; ${years.from} ${have}` : '' });
    }
    const core = skills.filter((x) => x.importance !== 'optional');
    if (core.length) {
      const W = sumW(core);
      const d = (x) => (x.status === 'matched' ? (x.demonstrated ? 1 : 0.3) : x.match === 'related' && x.demonstrated ? 0.2 : 0);
      const dc = core.reduce((s, x) => s + x.weight * d(x), 0) / W;
      const listedOnly = core.filter((x) => x.status === 'matched' && !x.demonstrated).map((x) => x.term);
      expParts.push({ w: 1, c: dc, text: listedOnly.length ? `Listed but not shown in a job or project: ${listedOnly.slice(0, 5).join(', ')}` : dc < 1 ? 'Some of the job\'s skills are not shown in work experience' : '' });
    }
    if (expParts.length) {
      const W = expParts.reduce((s, x) => s + x.w, 0);
      comps.push({ key: 'experience', credit: expParts.reduce((s, x) => s + x.w * x.c, 0) / W, deductions: expParts.filter((x) => x.c < 1 && x.text).map((x) => ({ lost: (x.w * (1 - x.c)) / W, text: x.text })),
        detail: `${analysis.yearsRequired ? `Job: ${analysis.yearsRequired}+ yrs · ${years.years == null ? 'no years found' : `${years.years} yrs (${years.from})`} · ` : ''}${core.filter((x) => x.status === 'matched' && x.demonstrated).length} of ${core.length} skills shown in work` });
    }
    // Title & seniority: the job's own title words (an AI look-alike title counts 70%), and the level.
    const title = titleMatch(model, analysis);
    const jobLevel = levelOf(analysis.seniority || '') ?? levelOf(analysis.title);
    const myLevel = title?.line ? levelOf(title.line) : null;
    if (title) {
      const sc = jobLevel == null || myLevel == null ? null : myLevel >= jobLevel ? 1 : jobLevel - myLevel === 1 ? 0.5 : 0;
      const tc = sc == null ? title.credit : 0.75 * title.credit + 0.25 * sc;
      const ded = [];
      if (title.credit < 0.95) ded.push({ lost: (sc == null ? 1 : 0.75) * (1 - title.credit), text: title.line ? `Closest title: "${title.line.slice(0, 80)}" vs "${analysis.title}"` : `No title close to "${analysis.title}"` });
      if (sc != null && sc < 1) ded.push({ lost: 0.25 * (1 - sc), text: 'The resume\'s title is a lower level than the job\'s' });
      comps.push({ key: 'title', credit: tc, deductions: ded, detail: title.line ? `Closest: ${title.line.slice(0, 80)}` : 'No similar title found' });
    }
    // Education & certifications.
    const quals = rows.filter((x) => x.category === 'certification' || x.category === 'qualification');
    const deg = degreeOf(model);
    if (analysis.degree || quals.length) {
      const parts = [];
      if (analysis.degree) {
        const need = LEVEL_N[analysis.degree.level];
        const fieldOk = !analysis.degree.fields.length || analysis.degree.fields.some((f) => deg.lines.some((l) => phraseAt(l.stems, stems(f)) >= 0));
        const dc = !deg.level ? 0 : deg.level >= need ? (fieldOk ? 1 : 0.8) : 0.35;
        parts.push({ w: analysis.degree.required ? 3 : 1.5, c: dc, text: !deg.level ? `No degree found (the job ${analysis.degree.required ? 'asks for' : 'prefers'} a ${analysis.degree.level}'s)` : deg.level < need ? `The job ${analysis.degree.required ? 'asks for' : 'prefers'} a ${analysis.degree.level}'s degree; the evidence shows a lower one` : !fieldOk ? `Degree field differs from ${analysis.degree.fields.slice(0, 3).join(' / ')}` : '' });
      }
      for (const q of quals) parts.push({ w: q.weight, c: c(q), text: c(q) < 1 ? lostText(q) : '' });
      const W = Math.max(3, parts.reduce((s, x) => s + x.w, 0));
      comps.push({ key: 'education', credit: 1 - parts.reduce((s, x) => s + x.w * (1 - x.c), 0) / W, deductions: parts.filter((x) => x.c < 1 && x.text).map((x) => ({ lost: (x.w * (1 - x.c)) / W, text: x.text })),
        detail: deg.line ? `Evidence: ${deg.line.slice(0, 80)}` : 'No degree line found' });
    }

    const used = comps.filter((x) => weights[x.key] > 0);
    const W = used.reduce((s, x) => s + weights[x.key], 0) || 1;
    const order = Object.keys(DEFAULT_WEIGHTS);
    const components = used.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((x) => {
      const max = (weights[x.key] / W) * 100;
      return { key: x.key, label: WEIGHT_LABELS[x.key], weight: weights[x.key], max: round1(max), points: round1(max * Math.max(0, Math.min(1, x.credit))), credit: round1(x.credit * 100) / 100,
        detail: x.detail, deductions: x.deductions.map((d) => ({ points: round1(max * d.lost), text: d.text })).filter((d) => d.points >= 0.1).sort((a, b) => b.points - a.points) };
    });
    const total = Math.min(100, round1(components.reduce((s, x) => s + max0(x.points), 0)));
    // Readability is about the resume file; with only the profile as evidence there is none to check.
    const readability = model.source === 'profile' ? { level: 'Not checked (profile only)', checks: [] } : readabilityReport(model.resume || model);
    const eligibility = rows.filter((x) => x.hard).map((x) => ({ term: x.term, match: x.match, met: x.status === 'matched', explanation: x.explanation }));
    return {
      version: VERSION, label: 'JobBid Fit Estimate', band: BANDS.find(([n]) => total >= n)[1], score: total, mode: review.mode, source: model.source || 'resume',
      components, requirements: rows, labels: WEIGHT_LABELS,
      counts: { matched: rows.filter((x) => x.status === 'matched').length, partial: rows.filter((x) => x.status === 'partial').length, missing: rows.filter((x) => x.status === 'missing').length, total: rows.length },
      years: { need: analysis.yearsRequired, have: years.years, from: years.from, note: years.note, conflict: years.conflict, resume: years.resume, profile: years.profile },
      title: title ? { job: analysis.title, line: title.line, pct: Math.round(title.credit * 100), jobLevel, myLevel } : null,
      degree: analysis.degree ? { need: analysis.degree.level, required: analysis.degree.required, fields: analysis.degree.fields, have: Object.keys(LEVEL_N).find((k) => LEVEL_N[k] === deg.level) || '', line: deg.line } : null,
      eligibility, readability, warnings: readability.checks.filter((x) => !x.ok).map((x) => x.detail),
      summaryReview: review.summary || null, suggestions: (review.suggestions || []).map((g) => ({ text: g.text, evidence: g.lines.map((id) => byLine.get(id)?.text).filter(Boolean).slice(0, 2) })),
      weights, words: model.words,
    };
  }
  const max0 = (n) => Math.max(0, n);

  // What changed since the last score of the same job and resume, and why (requirements, evidence, weights, method).
  const reportDigest = (r) => ({ score: r.score, version: r.version, mode: r.mode, source: r.source, weights: r.weights, at: new Date().toISOString(),
    components: Object.fromEntries(r.components.map((x) => [x.key, x.points])), reqs: Object.fromEntries(r.requirements.map((x) => [x.term, x.match])) });
  function diffReports(prev, cur) {
    if (!prev || prev.score == null) return null;
    const d = reportDigest(cur);
    const reasons = [];
    if (prev.version !== d.version) reasons.push('The scoring method was updated since the last score.');
    if (prev.mode !== d.mode) reasons.push(d.mode === 'ai' ? 'This time the AI reviewed the evidence (last time: rules only).' : 'This time only rules were used (the AI was not available).');
    if (prev.source !== d.source) reasons.push(`Evidence changed from ${prev.source} to ${d.source}.`);
    if (JSON.stringify(prev.weights) !== JSON.stringify(d.weights)) reasons.push('The scoring weights were changed.');
    for (const [k, v] of Object.entries(d.components)) { const b = prev.components?.[k]; if (b == null) reasons.push(`New part: ${WEIGHT_LABELS[k] || k} (${v} points).`); else if (Math.abs(v - b) >= 0.5) reasons.push(`${WEIGHT_LABELS[k] || k}: ${b} → ${v}.`); }
    const moved = Object.entries(d.reqs).filter(([t, m]) => prev.reqs?.[t] && prev.reqs[t] !== m).map(([t, m]) => `${t}: ${MATCH_LABELS[prev.reqs[t]] || prev.reqs[t]} → ${MATCH_LABELS[m]}`);
    if (moved.length) reasons.push(`Requirements judged differently: ${moved.slice(0, 6).join('; ')}${moved.length > 6 ? ` and ${moved.length - 6} more` : ''}.`);
    const newReqs = Object.keys(d.reqs).filter((t) => !(t in (prev.reqs || {}))).length, goneReqs = Object.keys(prev.reqs || {}).filter((t) => !(t in d.reqs)).length;
    if (newReqs || goneReqs) reasons.push(`The job's requirement list changed (${newReqs} new, ${goneReqs} gone).`);
    if (Math.abs(d.score - prev.score) < 0.1 && !reasons.length) return null;
    return { from: prev.score, to: d.score, delta: round1(d.score - prev.score), at: prev.at, reasons };
  }

  // Without the AI: the job's requirements from its words alone (labelled "rules only" everywhere it shows).
  const FALLBACK_TERMS = ['python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#', 'scala', 'kotlin', 'swift', 'ruby', 'php', 'sql', 'nosql', 'bash',
    'react', 'angular', 'vue', 'node.js', 'django', 'flask', 'fastapi', 'spring', '.net', 'graphql', 'rest', 'grpc', 'microservices', 'aws', 'azure', 'gcp', 'sagemaker', 'vertex ai',
    'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'linux', 'git', 'postgresql', 'mysql', 'mongodb', 'redis', 'dynamodb', 'elasticsearch', 'snowflake',
    'redshift', 'bigquery', 'databricks', 'spark', 'pyspark', 'hadoop', 'kafka', 'airflow', 'dbt', 'etl', 'data warehouse', 'tableau', 'power bi', 'looker', 'pandas', 'numpy',
    'scikit-learn', 'pytorch', 'tensorflow', 'keras', 'hugging face', 'llm', 'large language models', 'generative ai', 'rag', 'langchain', 'nlp', 'computer vision',
    'machine learning', 'deep learning', 'mlops', 'mlflow', 'statistics', 'statistical modeling', 'a/b testing', 'recommendation systems', 'reinforcement learning',
    'agile', 'scrum', 'jira', 'devops', 'observability', 'prometheus', 'grafana', 'datadog', 'salesforce', 'excel', 'figma', 'ios', 'android'];
  function fallbackAnalysis(job, reason = '') {
    const text = String(job.description || '');
    const lines = text.split(/\n|(?<=[.;])\s+/);
    const NICE = /\b(nice to have|preferred|bonus|a plus|plus if|good to have|desirable|ideally|familiarity)\b/i;
    const reqs = [];
    for (const t of FALLBACK_TERMS) {
      const f = stems(t);
      const at = lines.find((l) => phraseAt(stems(l), f) >= 0);
      if (!at) continue;
      if (reqs.some((r) => stems(r.term).join(' ') === f.join(' '))) continue;
      reqs.push({ term: t.length <= 4 ? t.toUpperCase().replace('GOLANG', 'Go') : t.replace(/\b\w/g, (ch) => ch.toUpperCase()), aliases: t === 'llm' ? ['LLMs', 'Large Language Models'] : t === 'golang' ? ['Go'] : [], related: [], category: 'skill', importance: NICE.test(at) ? 'preferred' : 'required', quote: clean(at).slice(0, 120) });
    }
    const lv = /\b(ph\.?\s?d|doctorate)\b/i.test(text) ? 'phd' : /\bmaster'?s?\b/i.test(text) ? 'master' : /\b(bachelor'?s?|b\.?s\.?\b|bs\/ms)\b/i.test(text) ? 'bachelor' : '';
    return { version: VERSION, mode: 'rules', reason, title: clean(job.title), company: clean(job.company), titleAliases: [], seniority: '', yearsRequired: yearsInText(text),
      degree: lv ? { level: lv, fields: [], required: !/\bor equivalent\b/i.test(text) } : null, requirements: reqs.slice(0, 30).map(prepReq), dropped: 0, droppedTerms: [], received: reqs.length, at: new Date().toISOString() };
  }

  // ---------- Optimizer: the AI's proposed changes, checked ----------

  const SECTION_NAMES = { summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects' };
  // targets: [{ term, how: 'confirmed' | 'demonstrate' }] - "confirmed" = the candidate said they have it.
  function optimizePrompt({ model, analysis, report, sections, targets, job, fitsOnly }) {
    const sel = new Set(sections);
    const byTerm = new Map(report.requirements.map((r) => [r.term, r]));
    const confirmed = targets.filter((t) => t.how === 'confirmed').map((t) => t.term);
    const demonstrate = targets.filter((t) => t.how === 'demonstrate').map((t) => t.term);
    const unsupported = report.requirements.filter((r) => r.status !== 'matched' && !confirmed.includes(r.term)).map((r) => r.term);
    const lines = model.lines.map((l) => {
      const tag = l.lock ? `LOCKED: ${l.lock}` : !sel.has(l.zone) ? 'LOCKED: section not selected' : `${l.zone} ${l.kind}`;
      return `[${l.id}] (${tag}) ${l.text}`;
    }).join('\n');
    const evidence = (t) => (byTerm.get(t)?.evidence || []).map((e) => e.text).slice(0, 1).join('');
    return `You tailor a resume to a job, truthfully. Propose edits as JSON operations on the numbered resume lines.
Sections you may edit: ${sections.map((s) => SECTION_NAMES[s] || s).join(', ')}. Lines marked LOCKED must not be changed, deleted or used as the place for a new line, except that a new line may follow a LOCKED job title/company line inside a section you may edit.
Hard rules (a change that breaks one is thrown away):
- Never invent experience, employers, job titles, dates, degrees, certifications, technologies, achievements or metrics. Every number in your text must already be in the resume.
- Only add a skill or keyword that the resume already shows somewhere, or that is in the CONFIRMED list below. NOT SUPPORTED requirements must not be claimed; list them in "cannot" instead.
- Keep each bullet one sentence, start with a strong past-tense verb (present tense for a current job), at most 230 characters, no first person. Keep the candidate's real results.
- Do not stuff keywords: use each keyword at most twice across all your edits, in natural sentences.
What to do:
- Summary: rewrite it (2-4 sentences) to lead with the job's title and the candidate's matching strengths.
- Skills: put the job's exact terms (supported or confirmed ones) into the skill lines, most relevant first; a new skills line may be added.
- Experience / Projects: rewrite bullets to bring out the relevant technologies, responsibilities and results; add a bullet (op "insert") under a job only when the resume or the confirmed list supports it; delete a bullet only if it is irrelevant and the job has 4+ others.${fitsOnly ? '\n- This file\'s layout cannot move: only "replace", and keep each new text about as long as the old one.' : ''}
Reply with ONLY JSON:
{"changes":[{"op":"replace","id":12,"text":"new line","reason":"short why"},{"op":"insert","after":14,"text":"new bullet","reason":"..."},{"op":"delete","id":20,"reason":"..."}],
 "cannot":[{"term":"requirement","why":"what experience would be needed"}],
 "summary":"one sentence: what you changed"}

KEYWORDS TO WORK IN (supported by the resume): ${demonstrate.length ? demonstrate.map((t) => `${t}${evidence(t) ? ` [resume: "${evidence(t).slice(0, 90)}"]` : ''}`).join('; ') : 'none'}
CONFIRMED BY THE CANDIDATE (they have used these; you may add them): ${confirmed.length ? confirmed.join(', ') : 'none'}
NOT SUPPORTED (do not claim): ${unsupported.filter((t) => !demonstrate.includes(t)).join(', ') || 'none'}

JOB: ${analysis.title}${analysis.company ? ' at ' + analysis.company : ''}
Requirements: ${analysis.requirements.map((r) => `${r.term} (${r.importance})`).join(', ')}
${clean(job.description).slice(0, 3500)}

RESUME LINES:
${lines.slice(0, 16000)}`;
  }

  const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s*(?:%|\+|k\b|m\b|x\b)?/gi;
  const numKey = (s) => s.toLowerCase().replace(/[\s,$]/g, '');
  // ctx: { model, analysis, report, sections, targets, kind ('docx' | 'pdf'), fits(id, text) -> bool }
  function validateChanges(out, ctx) {
    const { model, analysis, report, sections, targets = [] } = ctx;
    const byId = new Map(model.lines.map((l) => [l.id, l]));
    const sel = new Set(sections);
    const confirmed = new Set(targets.filter((t) => t.how === 'confirmed').map((t) => t.term.toLowerCase()));
    const origStems = model.lines.map((l) => l.stems);
    const origNums = new Set((model.fullText.match(NUM_RE) || []).map(numKey));
    const origWords = new Set(tokens(model.fullText));
    const jdWords = new Set(tokens(`${analysis.title} ${analysis.requirements.map((r) => [r.term, ...r.aliases].join(' ')).join(' ')}`));
    const reqOf = new Map(report.requirements.map((r) => [r.term, r]));
    const list = Array.isArray(out?.changes) ? out.changes : Array.isArray(out) ? out : [];
    const changes = [], dropped = [];
    const seen = new Set();
    let n = 0;
    for (const raw of list.slice(0, 80)) {
      if (!raw || typeof raw !== 'object') continue;
      const op = ['replace', 'insert', 'delete'].includes(raw.op) ? raw.op : raw.after != null ? 'insert' : 'replace';
      const id = Number(op === 'insert' ? raw.after ?? raw.id : raw.id);
      const line = byId.get(id);
      const text = clean(raw.text).replace(/^[•●▪■◦‣○►✓*–-]\s+/, '');
      const drop = (why) => dropped.push({ op, id, text: text || line?.text || '', why });
      if (!line) { drop('points to a line that does not exist'); continue; }
      const zone = line.zone;
      if (!sel.has(zone)) { drop(`${SECTION_NAMES[zone] || zone} was not selected`); continue; }
      if (op !== 'insert' && line.lock) { drop(`locked line (${line.lock})`); continue; }
      if (op === 'insert' && line.lock && !/job title|company|section heading/.test(line.lock)) { drop(`cannot add a line after a locked line (${line.lock})`); continue; }
      if (op !== 'delete' && (text.length < 3 || text.length > 600)) { drop('empty or far too long'); continue; }
      if (op === 'replace' && text === line.text) continue;
      const key = `${op}|${id}|${text}`;
      if (seen.has(key) || (op !== 'insert' && changes.some((c) => c.op !== 'insert' && c.id === id))) { drop('a second change of the same line'); continue; }
      seen.add(key);
      const flags = [];
      // Numbers the resume never had: an invented metric.
      if (op !== 'delete') {
        const nums = (text.match(NUM_RE) || []).map(numKey).filter((x) => /\d/.test(x) && !/^(19|20)\d{2}$/.test(x));
        const newNums = nums.filter((x) => !origNums.has(x) && !origNums.has(x.replace(/[%+kmx]$/, '')));
        if (newNums.length) flags.push(`New number not in the resume: ${newNums.join(', ')}`);
      }
      // Requirements this text adds, and whether the resume or the candidate supports them.
      const tStems = stems(text);
      const before = op === 'replace' ? line.stems : [];
      const added = [], unsupported = [];
      for (const r of analysis.requirements) {
        if (r.category === 'responsibility') continue;
        const inNew = r.forms.some((f) => phraseAt(tStems, f) >= 0);
        if (!inNew || r.forms.some((f) => phraseAt(before, f) >= 0)) continue;
        added.push(r.term);
        const inResume = r.forms.some((f) => origStems.some((s) => phraseAt(s, f) >= 0)) || reqOf.get(r.term)?.status === 'matched';
        if (!inResume && !confirmed.has(r.term.toLowerCase())) unsupported.push(r.term);
      }
      if (unsupported.length) flags.push(`Adds ${unsupported.map((t) => `"${t}"`).join(', ')}, which the resume doesn't show and you didn't confirm`);
      // Names (tools, companies) that are in neither the resume nor the job: possibly invented.
      if (op !== 'delete') {
        const names = [...new Set((text.match(/(?<=\s)[A-Z][A-Za-z0-9+#.]*[A-Za-z0-9+#]/g) || []).map((w) => w.toLowerCase().replace(/\.$/, '')))]
          .filter((w) => w.length > 2 && !origWords.has(w) && !jdWords.has(w) && !confirmed.has(w) && !tokens(w).every((t) => origWords.has(t) || jdWords.has(t)));
        if (names.length) flags.push(`New name not in the resume or the job: ${names.slice(0, 4).join(', ')}`);
      }
      // Keyword stuffing inside one line.
      const counts = new Map();
      for (const r of analysis.requirements) { const c = r.forms.reduce((s, f) => s + (phraseAt(tStems, f) >= 0 ? 1 : 0), 0); if (c) counts.set(r.term, (counts.get(r.term) || 0) + (tStems.join(' ').split(r.forms[0].join(' ')).length - 1)); }
      if ([...counts.values()].some((c) => c >= 3)) flags.push('Repeats the same keyword 3+ times');
      // The Word paragraph or PDF line it is based on (a new line copies the look of a body line nearby).
      let styleFrom = id;
      if (op === 'insert' && (line.kind === 'heading' || line.lock)) {
        const same = model.lines.filter((l) => l.zone === zone && !l.lock && l.kind !== 'heading');
        const nextBody = same.find((l) => l.id > id) || same[same.length - 1];
        if (nextBody) styleFrom = nextBody.id;
      }
      const fits = op === 'replace' && typeof ctx.fits === 'function' ? !!ctx.fits(id, text) : op === 'replace';
      changes.push({ cid: 'c' + n++, op, id, after: op === 'insert' ? id : null, styleFrom, section: zone, before: op === 'insert' ? '' : line.text, text: op === 'delete' ? '' : text,
        reason: clean(raw.reason).slice(0, 200), keywords: added.map((t) => ({ term: t, importance: reqOf.get(t)?.importance || '' })), flags, safe: !flags.length, fitsLayout: ctx.kind === 'docx' ? true : fits });
    }
    const cannot = (Array.isArray(out?.cannot) ? out.cannot : []).filter((c) => c && (c.term || c.keyword)).slice(0, 30)
      .map((c) => ({ term: clean(c.term || c.keyword).slice(0, 80), why: clean(c.why || c.reason).slice(0, 200) }));
    return { changes, dropped, cannot, summary: clean(out?.summary).slice(0, 300) };
  }

  // The resume's lines after the accepted changes, in order (what the new file should say).
  function applyToLines(model, changes) {
    const rep = new Map(changes.filter((c) => c.op === 'replace').map((c) => [c.id, c.text]));
    const del = new Set(changes.filter((c) => c.op === 'delete').map((c) => c.id));
    const ins = new Map();
    for (const c of changes.filter((x) => x.op === 'insert')) { if (!ins.has(c.after)) ins.set(c.after, []); ins.get(c.after).push(c); }
    const out = [];
    for (const l of model.lines) {
      if (!del.has(l.id)) out.push({ ...l, text: rep.get(l.id) ?? l.text, changed: rep.has(l.id) });
      for (const c of ins.get(l.id) || []) {
        const like = model.lines.find((x) => x.id === c.styleFrom) || l;
        out.push({ ...like, id: null, text: c.text, kind: like.kind === 'heading' ? 'bullet' : like.kind, bullet: like.bullet, strong: false, added: true });
      }
    }
    return out;
  }

  // Side-by-side rows: every original line next to what it became (changed, removed, added, unchanged).
  function compareRows(model, changes) {
    const rep = new Map(changes.filter((c) => c.op === 'replace').map((c) => [c.id, c]));
    const del = new Map(changes.filter((c) => c.op === 'delete').map((c) => [c.id, c]));
    const ins = new Map();
    for (const c of changes.filter((x) => x.op === 'insert')) { if (!ins.has(c.after)) ins.set(c.after, []); ins.get(c.after).push(c); }
    const rows = [];
    for (const l of model.lines) {
      const r = rep.get(l.id), d = del.get(l.id);
      rows.push(r ? { kind: 'changed', a: l.text, b: r.text, zone: l.zone, cid: r.cid } : d ? { kind: 'removed', a: l.text, b: '', zone: l.zone, cid: d.cid } : { kind: 'same', a: l.text, b: l.text, zone: l.zone, heading: l.kind === 'heading' });
      for (const c of ins.get(l.id) || []) rows.push({ kind: 'added', a: '', b: c.text, zone: l.zone, cid: c.cid });
    }
    return rows;
  }

  // ---------- After the new file is built and read again ----------

  const flat = (s) => clean(s).toLowerCase().replace(/[•●▪■◦‣○►✓]/g, ' ').replace(/[^a-z0-9+#%$]+/g, ' ').trim();
  // Before/after, every selected keyword checked in the new file, every accepted change looked for in it.
  function verify({ before, after, beforeModel, afterModel, targets, changes }) {
    const bReq = new Map(before.requirements.map((r) => [r.term, r]));
    const aReq = new Map(after.requirements.map((r) => [r.term, r]));
    const full = ' ' + flat(afterModel.fullText.replace(/\n/g, ' ')) + ' ';
    const keywords = targets.map((t) => {
      const b = bReq.get(t.term), a = aReq.get(t.term);
      return { term: t.term, how: t.how, before: b?.status || 'missing', after: a?.status || 'missing', demonstratedBefore: b?.status === 'matched' && !!b.demonstrated, demonstrated: a?.status === 'matched' && !!a.demonstrated,
        evidence: a?.evidence?.[0]?.text || '', done: t.how === 'demonstrate' ? !!a?.demonstrated || (b?.status !== 'matched' && a?.status === 'matched') : a?.status === 'matched' };
    });
    const fullBefore = ' ' + flat(String(beforeModel?.fullText || '').replace(/\n/g, ' ')) + ' ';
    const count = (hay, t) => hay.split(' ' + t + ' ').length - 1;
    const present = changes.map((c) => {
      const t = flat(c.op === 'delete' ? c.before : c.text);
      if (t.length < 4) return { cid: c.cid, op: c.op, ok: true };
      return { cid: c.cid, op: c.op, ok: c.op === 'delete' ? count(full, t) < count(fullBefore, t) : count(full, t) > 0 };
    });
    const deltas = after.components.map((c) => {
      const b = before.components.find((x) => x.key === c.key);
      return { key: c.key, label: c.label, before: b?.points ?? 0, after: c.points, max: c.max, delta: round1(c.points - (b?.points ?? 0)) };
    });
    const gained = after.requirements.filter((r) => r.status === 'matched' && bReq.get(r.term)?.status !== 'matched').map((r) => r.term);
    const nowShown = after.requirements.filter((r) => r.demonstrated && r.status === 'matched' && !bReq.get(r.term)?.demonstrated && bReq.get(r.term)?.status === 'matched').map((r) => r.term);
    const lost = after.requirements.filter((r) => r.status !== 'matched' && bReq.get(r.term)?.status === 'matched').map((r) => r.term);
    const explain = [];
    for (const d of deltas.filter((x) => Math.abs(x.delta) >= 0.1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
      explain.push(`${d.label}: ${d.delta > 0 ? '+' : ''}${d.delta} (${d.before} → ${d.after} of ${d.max})`);
    }
    if (gained.length) explain.push(`Now matched: ${gained.join(', ')}`);
    if (nowShown.length) explain.push(`Now shown in work experience: ${nowShown.join(', ')}`);
    if (lost.length) explain.push(`No longer found: ${lost.join(', ')}`);
    if (!explain.length) explain.push('The score did not change: the edits did not add any requirement the scorer counts.');
    return { delta: round1(after.score - before.score), keywords, present, deltas, explain, gained, lost };
  }

  // Whether another pass can still help truthfully.
  function nextStep(after, history, tried) {
    const triedSet = new Set(tried.map((t) => t.toLowerCase()));
    const open = after.requirements.filter((r) => r.category !== 'responsibility' && (r.status !== 'matched' || !r.demonstrated));
    const supported = open.filter((r) => r.status === 'matched' && !r.demonstrated && !triedSet.has(r.term.toLowerCase()));
    const needExperience = open.filter((r) => r.status !== 'matched').map((r) => r.term);
    const gains = history.slice(1).map((s, i) => s - history[i]);
    const plateau = gains.length >= 1 && gains[gains.length - 1] < 1;
    const canContinue = !plateau && supported.length > 0;
    return {
      canContinue, plateau, supported: supported.map((r) => r.term), needExperience,
      reason: canContinue ? `${supported.length} listed skill${supported.length === 1 ? '' : 's'} can still be shown in work experience`
        : plateau ? 'The last pass improved the score by less than 1 point: further edits would only add words, not relevance'
          : needExperience.length ? 'What is left needs experience the resume does not show (or that you confirm)' : 'Every requirement is matched',
    };
  }

  root.JobBidATS = { MATCH_LABELS, CREDIT, buildProfileModel, combineEvidence, yearsFacts, yearsInfo, reviewPrompt, validateReview, rulesReview, carryReview, readabilityReport,
    diffReports, reportDigest, fallbackAnalysis, VERSION, DEFAULT_WEIGHTS, WEIGHT_LABELS, IMPORTANCE, SECTION_NAMES, clean, tokens, stem, stems, phraseAt, hash, headingKey,
    buildModel, analysisPrompt, validateAnalysis, requirementList, matchRequirement, resumeYears, score, optimizePrompt, validateChanges, applyToLines, compareRows, verify, nextStep, yearsInText };
})(typeof self !== 'undefined' ? self : globalThis);
