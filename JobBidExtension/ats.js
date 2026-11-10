// Estimated ATS match: the job's requirements (read once by the AI, then checked against the job text) are
// looked for in the actual resume file's text. The scoring itself never asks the AI, so the same resume and
// job always get the same score, before and after the optimizer changes the resume.
// Works in the service worker (importScripts) and in Node (tests): everything is on self.JobBidATS.

(function (root) {
  const VERSION = 1;
  // Points out of 100 for each part of the score (configurable: chrome.storage.local "atsWeights").
  // A part the job doesn't ask about (no degree, no years) is left out and the others are scaled up.
  const DEFAULT_WEIGHTS = { keywords: 40, demonstrated: 15, responsibilities: 10, title: 10, years: 10, qualifications: 7, readability: 8 };
  const WEIGHT_LABELS = {
    keywords: 'Keyword coverage', demonstrated: 'Skills shown in experience', responsibilities: 'Relevant experience',
    title: 'Job title alignment', years: 'Years of experience', qualifications: 'Education & certifications', readability: 'ATS readability',
  };
  const IMPORTANCE = { required: 3, preferred: 1.5, optional: 0.75 };
  const CATEGORIES = ['skill', 'tool', 'domain', 'responsibility', 'qualification', 'certification', 'soft'];
  const KEYWORD_CATS = new Set(['skill', 'tool', 'domain', 'soft']);

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
    return `You are an ATS (applicant tracking system) configuration expert. Read this job posting and list what a resume is screened for.
Return ONLY JSON:
{"titleAliases": ["other titles for the same role"],
 "yearsRequired": number or null,
 "degree": {"level": "associate|bachelor|master|phd|", "fields": ["field of study"], "required": true|false},
 "requirements": [{"term": "exact wording from the posting", "aliases": ["abbreviations and exact equivalents"], "related": ["related but different skills"],
   "category": "skill|tool|domain|responsibility|qualification|certification|soft", "importance": "required|preferred|optional"}]}
Rules:
- 15 to 40 requirements. Use the posting's own words for "term" (keep multi-word skills whole: "Predictive Modeling", "Statistical Analysis", "Machine Learning").
- Split lists: "AWS, GCP or Azure" is three requirements. Merge duplicates.
- "aliases" are only true equivalents a recruiter accepts as the same thing: abbreviations ("ML" for "Machine Learning", "K8s" for "Kubernetes"), spellings ("PostgreSQL"/"Postgres"). Never put a different tool there.
- "related" are neighbouring skills that show something but are not the same ("TensorFlow" for "PyTorch").
- "importance": required = must-have / minimum qualification / core of the role; preferred = nice to have / bonus / preferred; optional = mentioned in passing.
- "domain" = industry or business area terms (e.g. "Healthcare", "Claims"); "responsibility" = a short phrase for a main duty (e.g. "deploy models to production"); "certification" = a named certificate or license.
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
  function validateAnalysis(out, job) {
    const src = out && typeof out === 'object' ? out : {};
    const jdStems = stems(`${job.title || ''}\n${job.description || ''}`);
    const jdSentences = String(job.description || '').split(/[\n.;•]+/).map(stems).filter((s) => s.length >= 3);
    const strs = (v, n, max = 60) => (Array.isArray(v) ? v : []).map((x) => clean(x)).filter((x) => x.length >= 1 && x.length <= max).slice(0, n);
    const reqs = [];
    let dropped = 0;
    for (const raw of Array.isArray(src.requirements) ? src.requirements : []) {
      if (!raw || typeof raw !== 'object') continue;
      const term = clean(raw.term || raw.k || raw.name).replace(/^[-•*\s]+/, '');
      if (term.length < 1 || term.length > 70) { dropped++; continue; }
      const category = CATEGORIES.includes(String(raw.category || '').toLowerCase()) ? String(raw.category).toLowerCase() : 'skill';
      const importance = IMPORTANCE[String(raw.importance || '').toLowerCase()] ? String(raw.importance).toLowerCase() : 'preferred';
      const aliases = strs(raw.aliases, 8, 40).filter((a) => a.toLowerCase() !== term.toLowerCase());
      const related = strs(raw.related, 6, 40);
      const r = { term, aliases, related, category, importance };
      const grounded = category === 'responsibility'
        ? jdSentences.some((s) => { const c = stems(term).filter((w) => !STOP.has(w)); return c.length && c.filter((w) => s.includes(w)).length / c.length >= 0.6; })
        : [term, ...aliases].some((t) => phraseAt(jdStems, stems(t)) >= 0);
      if (!grounded) { dropped++; continue; }
      const key = stems(term).join(' ');
      const same = reqs.find((x) => [x.term, ...x.aliases].some((t) => stems(t).join(' ') === key) || [term, ...aliases].some((t) => stems(t).join(' ') === stems(x.term).join(' ')));
      if (same) {
        if (IMPORTANCE[importance] > IMPORTANCE[same.importance]) same.importance = importance;
        for (const a of aliases) if (!same.aliases.includes(a) && a.toLowerCase() !== same.term.toLowerCase()) same.aliases.push(a);
        continue;
      }
      reqs.push(r);
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
    return {
      version: VERSION, title: clean(job.title), company: clean(job.company),
      titleAliases: strs(src.titleAliases, 5, 60),
      yearsRequired: years ?? null,
      degree: level && degreeSaid ? { level, fields: strs(dg.fields, 6, 50), required: dg.required !== false } : null,
      requirements, dropped, at: new Date().toISOString(),
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
  function titleMatch(model, analysis) {
    const wants = [analysis.title, ...(analysis.titleAliases || [])].map(titleWords).filter((w) => w.size);
    if (!wants.length) return null;
    const cands = model.lines.filter((l) => (l.zone === 'header' && l.text.length < 160) || ((l.zone === 'experience' || l.zone === 'summary') && l.kind !== 'bullet' && l.text.length < 100));
    let best = 0, line = '';
    for (const c of cands) {
      // Each piece of "Senior Engineer | AI Engineer · name@x.com" and the whole line.
      const pieces = c.text.replace(EMAIL_RE, ' | ').split(/\s[|·•]\s|[|·•]|,\s| - | – | at /).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 70);
      for (const want of wants) {
        for (const ww of [...pieces.map(titleWords), titleWords(c.text)]) {
          if (!ww.size) continue;
          const common = [...want].filter((x) => ww.has(x)).length;
          // How much of the job's title the line covers (a long line with the title in it still counts).
          const s = Math.max((2 * common) / (want.size + Math.min(ww.size, want.size + 2)), common / want.size * 0.9);
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

  function readability(model) {
    const m = model.meta || {};
    const out = [];
    const add = (lost, text) => out.push({ lost, text });
    if (model.words < 120) add(0.6, `Very little readable text (${model.words} words): an ATS may see an almost empty resume (scanned image or unusual font?)`);
    if (m.unreadable > 0.05) add(Math.min(0.4, m.unreadable), `${Math.round(m.unreadable * 100)}% of the text can't be read as letters (a font without a text map)`);
    const zones = new Set(model.lines.filter((l) => l.kind === 'heading').map((l) => l.section));
    if (!zones.has('experience')) add(0.2, 'No standard "Experience" heading: the ATS may not find the work history');
    if (!zones.has('education')) add(0.08, 'No "Education" heading');
    if (!zones.has('skills')) add(0.1, 'No "Skills" heading: a skills section is where an ATS looks first');
    if (!EMAIL_RE.test(model.fullText)) add(0.12, 'No email address in the readable text');
    if (!PHONE_RE.test(model.fullText)) add(0.05, 'No phone number in the readable text');
    if (m.headerContact) add(0.1, 'Contact details are in the Word page header: some ATS skip page headers');
    if (m.tables) add(0.1, 'Tables: some ATS read table cells out of order');
    if (m.textboxes) add(0.15, 'Text boxes: many ATS skip text inside text boxes');
    if (m.columns) add(0.15, 'Two-column layout: an ATS may mix the columns together');
    if (model.words > 1300) add(0.1, `Long resume (${model.words} words)`);
    // The same requirement written over and over reads as keyword stuffing.
    if (m.stuffed?.length) add(Math.min(0.3, 0.1 * m.stuffed.length), `Repeated many times (keyword stuffing): ${m.stuffed.slice(0, 4).join(', ')}`);
    const lost = Math.min(1, out.reduce((s, x) => s + x.lost, 0));
    return { credit: 1 - lost, deductions: out };
  }

  function score(model, analysis, weightsIn) {
    const weights = { ...DEFAULT_WEIGHTS, ...(weightsIn || {}) };
    for (const k of Object.keys(weights)) weights[k] = Math.max(0, Number(weights[k]) || 0);
    const reqs = analysis.requirements.map((r) => ({ r, m: matchRequirement(r, model.lines) }));
    const rows = reqs.map(({ r, m }) => ({ id: r.id, term: r.term, category: r.category, importance: r.importance, weight: r.weight, aliases: r.aliases, related: r.related,
      status: m.status, demonstrated: m.demonstrated, evidence: m.evidence, via: m.via, mentions: m.mentions || 0 }));
    // Keyword stuffing: one requirement written 7+ times.
    model.meta = { ...(model.meta || {}), stuffed: rows.filter((x) => x.mentions >= 7).map((x) => x.term) };
    const comps = [];
    const credit = { matched: 1, partial: 0.4, missing: 0 };
    const sumW = (list) => list.reduce((s, x) => s + x.weight, 0);
    const kw = rows.filter((x) => KEYWORD_CATS.has(x.category));
    if (kw.length) {
      const W = sumW(kw);
      comps.push({ key: 'keywords', credit: kw.reduce((s, x) => s + x.weight * credit[x.status], 0) / W,
        deductions: kw.filter((x) => x.status !== 'matched').map((x) => ({ lost: (x.weight * (1 - credit[x.status])) / W, text: x.status === 'partial' ? `"${x.term}" (${x.importance}) only partly matched${x.via ? ` - the resume has "${x.via}", a related skill` : ''}` : `"${x.term}" (${x.importance}) is missing` })),
        detail: `${kw.filter((x) => x.status === 'matched').length} of ${kw.length} keywords matched, ${kw.filter((x) => x.status === 'partial').length} partly` });
      // Shown in work: a skill named in a job or project counts more than one only listed under Skills.
      const core = kw.filter((x) => x.importance !== 'optional' && x.category !== 'soft');
      if (core.length) {
        const CW = sumW(core);
        const d = (x) => (x.status === 'matched' ? (x.demonstrated ? 1 : 0.25) : x.status === 'partial' && x.demonstrated ? 0.2 : 0);
        comps.push({ key: 'demonstrated', credit: core.reduce((s, x) => s + x.weight * d(x), 0) / CW,
          deductions: core.filter((x) => d(x) < 1 && x.status !== 'missing').map((x) => ({ lost: (x.weight * (1 - d(x))) / CW, text: x.status === 'matched' ? `"${x.term}" is only listed, not shown in work experience or projects` : `"${x.term}" is not shown in work experience` }))
            .concat(core.filter((x) => x.status === 'missing').length ? [{ lost: core.filter((x) => x.status === 'missing').reduce((s, x) => s + x.weight, 0) / CW, text: `${core.filter((x) => x.status === 'missing').length} missing skills are not shown anywhere` }] : []),
          detail: `${core.filter((x) => x.status === 'matched' && x.demonstrated).length} of ${core.length} main skills shown in work experience` });
      }
    }
    const resp = rows.filter((x) => x.category === 'responsibility');
    if (resp.length) {
      const W = sumW(resp);
      comps.push({ key: 'responsibilities', credit: resp.reduce((s, x) => s + x.weight * credit[x.status], 0) / W,
        deductions: resp.filter((x) => x.status !== 'matched').map((x) => ({ lost: (x.weight * (1 - credit[x.status])) / W, text: `${x.status === 'partial' ? 'Partly shown' : 'Not shown'}: "${x.term}"` })),
        detail: `${resp.filter((x) => x.status === 'matched').length} of ${resp.length} main duties shown in experience` });
    }
    const title = titleMatch(model, analysis);
    if (title) {
      comps.push({ key: 'title', credit: title.credit, deductions: title.credit < 0.95 ? [{ lost: 1 - title.credit, text: title.line ? `Closest title in the resume: "${title.line.slice(0, 80)}" vs "${analysis.title}"` : `No title close to "${analysis.title}"` }] : [],
        detail: title.line ? `Closest: ${title.line.slice(0, 80)}` : 'No similar title found' });
    }
    const yrs = resumeYears(model);
    if (analysis.yearsRequired) {
      const need = analysis.yearsRequired;
      const c = yrs.years == null ? 0.5 : Math.min(1, yrs.years / need);
      comps.push({ key: 'years', credit: c, deductions: c < 1 ? [{ lost: 1 - c, text: yrs.years == null ? 'No work dates the ATS can read (e.g. "Jan 2020 - Present")' : `The job asks for ${need}+ years; the resume's dates show about ${yrs.years}` }] : [],
        detail: `Job: ${need}+ yrs · resume: ${yrs.years == null ? 'no dates found' : yrs.years + ' yrs' + (yrs.from === 'claim' ? ' (stated)' : '')}` });
    }
    const quals = rows.filter((x) => x.category === 'certification' || x.category === 'qualification');
    const deg = degreeOf(model);
    if (analysis.degree || quals.length) {
      const parts = [];
      if (analysis.degree) {
        const need = LEVEL_N[analysis.degree.level];
        const fieldOk = !analysis.degree.fields.length || analysis.degree.fields.some((f) => deg.lines.some((l) => phraseAt(l.stems, stems(f)) >= 0));
        const c = !deg.level ? 0 : deg.level >= need ? (fieldOk ? 1 : 0.8) : 0.35;
        const w = analysis.degree.required ? 3 : 1.5;
        parts.push({ w, c, text: !deg.level ? `No degree found in the resume (the job ${analysis.degree.required ? 'asks for' : 'prefers'} a ${analysis.degree.level}'s)` : deg.level < need ? `The job ${analysis.degree.required ? 'asks for' : 'prefers'} a ${analysis.degree.level}'s degree; the resume shows a lower one` : !fieldOk ? `Degree field differs from ${analysis.degree.fields.slice(0, 3).join(' / ')}` : '' });
      }
      for (const q of quals) parts.push({ w: q.weight, c: credit[q.status], text: q.status === 'matched' ? '' : `"${q.term}" (${q.importance}) ${q.status === 'partial' ? 'only partly matched' : 'is missing'}` });
      // At least one required item's worth: a single missing "preferred" certificate costs half, not all.
      const W = Math.max(3, parts.reduce((s, x) => s + x.w, 0));
      comps.push({ key: 'qualifications', credit: 1 - parts.reduce((s, x) => s + x.w * (1 - x.c), 0) / W,
        deductions: parts.filter((x) => x.c < 1 && x.text).map((x) => ({ lost: (x.w * (1 - x.c)) / W, text: x.text })),
        detail: deg.line ? `Resume: ${deg.line.slice(0, 80)}` : 'No degree line found' });
    }
    const rd = readability(model);
    comps.push({ key: 'readability', credit: rd.credit, deductions: rd.deductions, detail: rd.deductions.length ? `${rd.deductions.length} formatting warning${rd.deductions.length === 1 ? '' : 's'}` : 'Clean, readable layout' });

    const used = comps.filter((c) => weights[c.key] > 0);
    const W = used.reduce((s, c) => s + weights[c.key], 0) || 1;
    const components = used.map((c) => {
      const max = (weights[c.key] / W) * 100;
      return { key: c.key, label: WEIGHT_LABELS[c.key], weight: weights[c.key], max: round1(max), points: round1(max * Math.max(0, Math.min(1, c.credit))), credit: round1(c.credit * 100) / 100,
        detail: c.detail, deductions: c.deductions.map((d) => ({ points: round1(max * d.lost), text: d.text })).filter((d) => d.points >= 0.1).sort((a, b) => b.points - a.points) };
    });
    const total = round1(components.reduce((s, c) => s + max0(c.points), 0));
    return {
      version: VERSION, label: 'Estimated ATS match', score: Math.min(100, total), components, requirements: rows,
      counts: { matched: rows.filter((x) => x.status === 'matched').length, partial: rows.filter((x) => x.status === 'partial').length, missing: rows.filter((x) => x.status === 'missing').length, total: rows.length },
      years: { need: analysis.yearsRequired, have: yrs.years, from: yrs.from }, title: title ? { line: title.line, pct: Math.round(title.credit * 100) } : null,
      degree: analysis.degree ? { need: analysis.degree.level, have: Object.keys(LEVEL_N).find((k) => LEVEL_N[k] === deg.level) || '', line: deg.line } : null,
      warnings: rd.deductions.map((d) => d.text), weights, words: model.words,
    };
  }
  const max0 = (n) => Math.max(0, n);

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
        const inResume = r.forms.some((f) => origStems.some((s) => phraseAt(s, f) >= 0));
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

  root.JobBidATS = { VERSION, DEFAULT_WEIGHTS, WEIGHT_LABELS, IMPORTANCE, SECTION_NAMES, clean, tokens, stem, stems, phraseAt, hash, headingKey,
    buildModel, analysisPrompt, validateAnalysis, matchRequirement, resumeYears, score, optimizePrompt, validateChanges, applyToLines, compareRows, verify, nextStep, yearsInText };
})(typeof self !== 'undefined' ? self : globalThis);
