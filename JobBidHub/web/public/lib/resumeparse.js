// Resume reader that works WITHOUT AI: pulls a full profile (headline, location, summary, skills,
// experience, education, years of experience) out of resume text with layout-tolerant rules.
// Used on its own when no AI key is set or the AI fails, and as the base the AI result improves on.

(function () {
  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DATE = `(?:${MONTH}\\.?\\s*,?\\s*\\d{4}|\\d{1,2}\\s*[\\/.-]\\s*\\d{4}|\\d{4}\\s*[\\/.-]\\s*\\d{1,2}|\\d{4})`;
  const RANGE_RE = new RegExp(`(${DATE})\\s*(?:[-–—~]|\\bto\\b|\\buntil\\b)\\s*(${DATE}|present|current|now|today|ongoing)`, 'i');
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const TITLE_RE = /\b(engineer|developer|programmer|manager|scientist|analyst|architect|consultant|lead|director|specialist|designer|intern|administrator|officer|associate|expert|head|founder|owner|coordinator|technician|researcher|instructor|teacher|representative|accountant|recruiter|strategist|president|vp|cto|ceo|devops|sre)\b/i;
  const DEGREE_RE = /\b(b\.?\s?s\.?c?|b\.?\s?a\.?|b\.?\s?e\.?|b\.?\s?tech|m\.?\s?s\.?c?|m\.?\s?a\.?|m\.?\s?e\.?|m\.?\s?tech|mba|ph\.?\s?d|bachelor'?s?|master'?s?|associate'?s?|doctor(?:ate)?|diploma|degree)\b/i;
  const SCHOOL_RE = /\b(university|college|institute|school|academy|polytechnic|universit[éäa]t?|univ\.)\b/i;

  const SECTION_RES = [
    ['summary', /^(professional\s+|career\s+|executive\s+)?(summary|profile|about(\s+me)?|objective|overview|introduction)$/i],
    ['experience', /^((professional|work|relevant|career)\s+)?(experience|employment(\s+history)?|work\s+history|career\s+history|positions?\s+held)$/i],
    ['education', /^(education(\s*(&|and)\s*(training|certifications?))?|academic\s+(background|history)|qualifications)$/i],
    ['skills', /^((technical|core|key|professional)\s+)?(skills?|competenc(y|ies)|technolog(y|ies)|tech(nical)?\s+stack|tools(\s*(&|and)\s*technologies)?|skills\s*(&|and)\s*tools|proficienc(y|ies)|expertise)$/i],
    ['other', /^(certifications?|licen[cs]es?|projects?|publications?|awards?|honou?rs|languages?|interests?|hobbies|references?|volunteer(ing)?(\s+experience)?|activities|achievements?|courses?|training)$/i],
  ];

  const US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
  const US_STATE_NAMES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'];
  const COUNTRIES = ['United States', 'USA', 'Canada', 'United Kingdom', 'UK', 'Poland', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Portugal', 'Ireland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Switzerland', 'Austria', 'Belgium', 'India', 'China', 'Japan', 'South Korea', 'Korea', 'Singapore', 'Australia', 'New Zealand', 'Brazil', 'Mexico', 'Argentina', 'Colombia', 'Philippines', 'Vietnam', 'Ukraine', 'Romania', 'Czech Republic', 'Israel', 'United Arab Emirates', 'UAE', 'South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Turkey', 'Pakistan', 'Bangladesh', 'Indonesia', 'Malaysia', 'Thailand', 'Ethiopia', 'Eritrea'];

  const SKILL_WORDS = ['Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Rust', 'C++', 'C#', 'Scala', 'Kotlin', 'Swift', 'Ruby', 'PHP', 'SQL', 'NoSQL', 'Bash', 'R',
    'React', 'Next.js', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Spring', '.NET', 'GraphQL', 'REST', 'gRPC', 'Microservices',
    'HTML', 'CSS', 'Tailwind', 'TailwindCSS', 'Redux', 'React Native', 'Flutter', 'AWS', 'Azure', 'GCP', 'Lambda', 'S3', 'EC2', 'EKS', 'ECS', 'SageMaker', 'Docker', 'Kubernetes',
    'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab', 'CI/CD', 'Linux', 'Git', 'PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'MongoDB', 'Redis', 'DynamoDB',
    'Cassandra', 'Elasticsearch', 'OpenSearch', 'Snowflake', 'Redshift', 'BigQuery', 'Databricks', 'Spark', 'PySpark', 'Hadoop', 'Hive', 'Kafka', 'Kinesis', 'Airflow', 'dbt',
    'Flink', 'ETL', 'ELT', 'Tableau', 'Power BI', 'Looker', 'Pandas', 'NumPy', 'scikit-learn', 'PyTorch', 'TensorFlow', 'Keras', 'JAX', 'Hugging Face', 'LLM', 'LLMs', 'RAG',
    'LangChain', 'LlamaIndex', 'OpenAI', 'GPT-4', 'BERT', 'NLP', 'Computer Vision', 'OpenCV', 'Machine Learning', 'Deep Learning', 'MLOps', 'MLflow', 'Kubeflow', 'vLLM',
    'Pinecone', 'FAISS', 'pgvector', 'Ray', 'Agile', 'Scrum', 'Jira', 'Prometheus', 'Grafana', 'Datadog', 'Salesforce', 'HubSpot', 'Figma', 'Excel'];

  const clean = (s) => String(s || '').replace(/[•●▪◦‣⁃∙•●▪◦∙·]/g, ' ').replace(/[-�]/g, ' ').replace(/\s+/g, ' ').trim();
  const isBullet = (raw) => /^\s*[•●▪◦‣⁃∙•●▪◦∙·\-*–�]\s*/.test(raw);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function toYM(s) {
    s = String(s || '').trim().toLowerCase();
    if (/present|current|now|today|ongoing/.test(s)) return 'Present';
    let m = s.match(new RegExp(`^(${MONTH})\\.?\\s*,?\\s*(\\d{4})$`, 'i'));
    if (m) return `${String(MONTHS.indexOf(m[1].slice(0, 3)) + 1).padStart(2, '0')}/${m[2]}`;
    m = s.match(/^(\d{1,2})\s*[/.-]\s*(\d{4})$/);
    if (m) return `${m[1].padStart(2, '0')}/${m[2]}`;
    m = s.match(/^(\d{4})\s*[/.-]\s*(\d{1,2})$/);
    if (m) return `${m[2].padStart(2, '0')}/${m[1]}`;
    m = s.match(/\d{4}/);
    return m ? m[0] : '';
  }

  function sectionOf(line) {
    const t = clean(line).replace(/[:|]+$/, '').trim();
    if (!t || t.length > 45 || /[@\d]/.test(t.replace(/\b\d{4}\b/g, ''))) return null;
    for (const [name, re] of SECTION_RES) if (re.test(t)) return name;
    return null;
  }

  function findLocation(lines) {
    for (const raw of lines) {
      // Split on bullets / pipes / wide gaps before cleaning (cleaning turns bullets into spaces).
      for (const part of String(raw).split(/\s{2,}|[|•·●▪•#]|\t/)) {
        const p = clean(part).replace(/\(.*?\)/g, '').trim();
        if (!p || /@|https?:|www\.|linkedin|github|\d{3}/i.test(p)) continue;
        let m = p.match(/([A-Z][\p{L}.' -]{1,30}),\s*([A-Z]{2})\b(?:\s*\d{5})?/u);
        if (m && US_STATES.includes(m[2])) return { city: m[1].trim(), state: m[2], country: 'United States' };
        m = p.match(/([A-Z][\p{L}.' -]{1,30}),\s*([A-Z][\p{L}. ]{2,30})$/u);
        if (m) {
          const b = m[2].trim();
          if (US_STATE_NAMES.includes(b.toLowerCase())) return { city: m[1].trim(), state: b, country: 'United States' };
          const c = COUNTRIES.find((x) => x.toLowerCase() === b.toLowerCase());
          if (c) return { city: m[1].trim(), state: '', country: { USA: 'United States', UK: 'United Kingdom', UAE: 'United Arab Emirates', Korea: 'South Korea' }[c] || c };
        }
      }
    }
    return {};
  }

  function splitSkills(text) {
    // Split on separators, but not inside brackets: "Large Language Models (LLMs, RAG)" stays whole.
    const pieces = [];
    let cur = '', depth = 0;
    for (const ch of text) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (!depth && /[,;|\n•·●▪\t]/.test(ch)) { pieces.push(cur); cur = ''; } else cur += ch;
    }
    pieces.push(cur);
    const out = [];
    for (let piece of pieces.flatMap((x) => x.split(/\s{3,}/))) {
      piece = clean(piece).replace(/^[A-Za-z &/]{2,30}:\s*/, '').replace(/^and\s+/i, '').replace(/\.+$/, '').trim();
      if ((piece.match(/\(/g) || []).length > (piece.match(/\)/g) || []).length) piece += ')';
      if (piece.length >= 1 && piece.length <= 45 && !/^(and|or|etc|with|of)$/i.test(piece) && piece.split(' ').length <= 6) out.push(piece);
    }
    return out;
  }

  function dictSkills(text) {
    const found = [];
    for (const s of SKILL_WORDS) {
      const re = new RegExp(`(^|[^A-Za-z0-9+#.])${esc(s)}(?![A-Za-z0-9+#])`, s.length <= 2 ? '' : 'i');
      if (re.test(text) && !found.some((f) => f.toLowerCase() === s.toLowerCase())) found.push(s);
    }
    return found;
  }

  // One experience entry around a line that contains a date range.
  function parseEntry(lines, i, used) {
    const line = clean(lines[i]);
    const m = line.match(RANGE_RE);
    const rest = clean(line.replace(m[0], ' ').replace(/\s*[|,]\s*$/, '').replace(/^\s*[|,]\s*/, ''));
    const candidates = [];
    const take = (j) => {
      if (j < 0 || j >= lines.length || used.has(j)) return;
      const t = clean(lines[j]);
      if (!t || t.length > 90 || isBullet(lines[j]) || sectionOf(lines[j]) || RANGE_RE.test(t) || /[.!?]$/.test(t) && t.split(' ').length > 8) return;
      candidates.push({ j, t });
    };
    if (rest) candidates.push({ j: i, t: rest });
    take(i - 1); take(i + 1); take(i - 2); take(i + 2);

    let title = '', company = '', loc = '';
    const parts = [];
    for (const c of candidates) for (const p of c.t.split(/\s+[|·•]\s+|\s{2,}|\s+[–—-]\s+(?=[A-Z])/)) parts.push({ j: c.j, t: p.trim() });
    for (const p of parts) {
      if (!p.t) continue;
      const lm = p.t.match(/^(remote|hybrid|on-?site)$/i) || p.t.match(/^[A-Z][\p{L}.' -]+,\s*([A-Z]{2}|[A-Z][\p{L} ]+)(\s*\(.*\)|\s+(?:[Rr]emote|[Hh]ybrid|[Oo]n-?\s?[Ss]ite))?$/u);
      if (!loc && lm && !TITLE_RE.test(p.t)) { loc = p.t; continue; }
      if (!title && TITLE_RE.test(p.t)) {
        // "Senior Engineer, Company (Remote)" / "Senior Engineer at Company"
        const split = p.t.match(/^(.*?\b(?:engineer|developer|manager|scientist|analyst|architect|consultant|lead|director|specialist|designer|intern|expert|officer|associate)\b[^,@]*?)(?:\s*,\s*|\s+at\s+|\s+@\s+)(.+)$/i);
        if (split) { title = split[1].trim(); if (!company) company = split[2].replace(/\((remote|hybrid|on-?site)\)/i, '').trim(); }
        else title = p.t;
        used.add(p.j);
        continue;
      }
      if (!company && !TITLE_RE.test(p.t) && !/^https?:|www\./i.test(p.t) && p.t.length <= 60) { company = p.t.replace(/\((remote|hybrid|on-?site)\)/i, '').trim(); used.add(p.j); }
    }
    return { title, company, location: loc, start: toYM(m[1]), end: toYM(m[2]) };
  }

  function parseExperience(lines) {
    const used = new Set();
    const idx = lines.map((l, i) => (RANGE_RE.test(clean(l)) ? i : -1)).filter((i) => i >= 0);
    const entries = idx.map((i) => ({ i, ...parseEntry(lines, i, used) }));
    // Highlights: bullet / sentence lines after each entry until the next one.
    entries.forEach((e, n) => {
      const end = n + 1 < entries.length ? entries[n + 1].i - 2 : lines.length;
      const desc = [];
      for (let j = e.i + 1; j < end && desc.length < 8; j++) {
        const t = clean(lines[j]);
        if (!t || used.has(j) || t.length < 25 || RANGE_RE.test(t)) continue;
        desc.push(t);
      }
      e.description = desc.join('\n');
    });
    return entries.filter((e) => e.title || e.company).map(({ i, ...e }) => e);
  }

  // Two-column PDFs: titles sit on their own lines and the date ranges come later in the same order.
  const SMALL = /^(of|and|&|the|for|in|at|to|a|an|-|\/|,)$/i;
  function looksLikeHeading(t) {
    const core = t.replace(RANGE_RE, '').trim();
    if (!core || core.length > 75 || /[.%;:!?]$/.test(core) || /\d{3,}|%/.test(core)) return false;
    const words = core.split(/\s+/).filter((w) => w && !SMALL.test(w) && /[A-Za-z]/.test(w));
    return words.length > 0 && words.length <= 9 && words.filter((w) => /^[A-Z0-9(]/.test(w)).length / words.length >= 0.7;
  }
  // "City, ST" / "City, Country" / Remote - but never a line with a job title ("Engineer, Mphasis").
  const isLocation = (t) => !TITLE_RE.test(t) && (/^(remote|hybrid|on-?site)$/i.test(t) || /^[A-Z][\p{L}.' -]+,\s*([A-Z]{2}|[A-Z][\p{L} ]+)(\s*\(.*|\s+(?:[Rr]emote|[Hh]ybrid|[Oo]n-?\s?[Ss]ite))?$/u.test(t));

  function parseExperienceByTitles(lines) {
    const L = lines.map(clean);
    const titles = [];
    for (let i = 0; i < L.length; i++) {
      if (isBullet(lines[i]) || !TITLE_RE.test(L[i]) || !looksLikeHeading(L[i]) || isLocation(L[i])) continue;
      titles.push(i);
    }
    const ranges = [];
    L.forEach((t, i) => { const m = t.match(RANGE_RE); if (m) ranges.push({ i, m }); });
    if (!titles.length || !ranges.length) return [];
    return titles.map((ti, n) => {
      const line = L[ti].replace(RANGE_RE, '').replace(/\s+,/g, ',').trim();
      let title = line, company = '';
      const sp = line.match(/^(.*?)(?:\s*,\s*|\s+at\s+|\s+@\s+|\s+\|\s+|\s+[–—]\s+)(.+)$/);
      if (sp && TITLE_RE.test(sp[1])) { title = sp[1].trim(); company = sp[2].trim(); }
      if (!company) {
        const nx = L[ti + 1] ? L[ti + 1].replace(RANGE_RE, '').trim() : '';
        if (nx && !isBullet(lines[ti + 1]) && looksLikeHeading(nx) && !TITLE_RE.test(nx) && !isLocation(nx)) company = nx;
      }
      company = company.replace(/\((remote|hybrid|on-?site)\)/i, '').replace(/\s*[|,]\s*$/, '').trim();
      // n-th title gets the n-th date range (or the first range after it).
      const r = ranges.length === titles.length ? ranges[n] : ranges.find((x) => x.i >= ti) || ranges[n];
      let location = '';
      if (r) {
        const after = [L[r.i].replace(r.m[0], ''), L[r.i + 1] || ''].map((x) => x.replace(/^[|,\s]+|[|,\s]+$/g, ''));
        location = after.find((x) => x && isLocation(x) && !TITLE_RE.test(x)) || '';
        location = location.replace(/\s*\([^)]*$/, '').trim(); // drop a "(On-" cut off by the column
      }
      const end = n + 1 < titles.length ? titles[n + 1] : L.length;
      const desc = [];
      for (let j = ti + 1; j < end && desc.length < 8; j++) {
        if ((r && j === r.i) || RANGE_RE.test(L[j]) || L[j].length < 25 || L[j] === company) continue;
        desc.push(L[j]);
      }
      return { title, company, location, start: r ? toYM(r.m[1]) : '', end: r ? toYM(r.m[2]) : '', description: desc.join('\n') };
    });
  }

  function parseEducation(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const t = clean(lines[i]);
      if (!DEGREE_RE.test(t) && !SCHOOL_RE.test(t)) continue;
      const near = [t, clean(lines[i + 1] || ''), clean(lines[i - 1] || '')];
      const degreeLine = near.find((x) => DEGREE_RE.test(x)) || '';
      const schoolLine = near.find((x) => SCHOOL_RE.test(x)) || '';
      if (!degreeLine && !schoolLine) continue;
      const deg = (degreeLine.match(DEGREE_RE) || [''])[0];
      const field = ((degreeLine.match(/\b(?:in|of)\s+([A-Z][\p{L}&,/ ]{2,50}?)(?:[,|(]|\s+-|\s+at\b|\s{2,}|$)/u) || [])[1] || '').trim();
      const school = (schoolLine.split(/\s*[,|–—]\s*|\s+at\s+|\s{2,}/).find((x) => SCHOOL_RE.test(x)) || '')
        .replace(RANGE_RE, '').replace(/\s*\(?\b(19|20)\d{2}\b.*$/, '').trim();
      const years = near.join(' ').match(/\b(19|20)\d{2}\b/g) || [];
      const rangeM = near.join(' ').match(RANGE_RE);
      const entry = { school, degree: deg ? deg.replace(/\s+/g, '') : '', field, start: rangeM ? toYM(rangeM[1]) : years.length > 1 ? years[0] : '', end: rangeM ? toYM(rangeM[2]) : years[years.length - 1] || '' };
      if (!entry.school && !entry.degree) continue;
      if (!out.some((o) => o.school === entry.school && o.degree === entry.degree)) out.push(entry);
      i++;
    }
    return out.slice(0, 6);
  }

  function localParseResume(text) {
    const rawLines = String(text || '').split(/\r?\n/).filter((l) => clean(l));
    const out = {};

    // Contact details
    const flat = rawLines.join('\n');
    // PDF text sometimes has a stray space next to the @.
    const email = flat.match(/[\w.+-]+ ?@ ?[\w-]+\.[\w.-]+\w/);
    if (email) out.email = email[0].replace(/\s/g, '');
    const phone = flat.match(/\+?\d[\d\s().-]{8,}\d/);
    if (phone) out.phone = phone[0].trim();
    const li = flat.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/\s?[\w%-]+\/?/i);
    if (li) out.linkedin = (li[0].startsWith('http') ? li[0] : 'https://' + li[0]).replace(/\s/g, '');
    const gh = flat.match(/(https?:\/\/)?(www\.)?github\.com\/[\w-]+/i);
    if (gh) out.github = gh[0].startsWith('http') ? gh[0] : 'https://' + gh[0];

    // Sections
    const sections = { header: [] };
    let cur = 'header';
    for (const l of rawLines) {
      const s = sectionOf(l);
      if (s) { cur = s; sections[cur] ||= []; continue; }
      (sections[cur] ||= []).push(l);
    }
    const header = sections.header.slice(0, 12);

    // Name + headline from the top of the resume
    const nameRe = /^[A-ZÀ-ɏ][\p{L}'.-]+(\s+[A-ZÀ-ɏ][\p{L}'.-]+){1,3}$/u;
    let nameIdx = -1;
    for (let i = 0; i < Math.min(header.length, 6); i++) {
      for (const part of clean(header[i]).split(/\s{2,}|\s[|•·]\s/)) {
        const t = part.replace(/\S+@\S+/g, '').trim();
        if (nameRe.test(t) && !TITLE_RE.test(t) && !SCHOOL_RE.test(t)) { out.fullName = t; nameIdx = i; break; }
      }
      if (out.fullName) break;
    }
    if (out.fullName) {
      const w = out.fullName.split(/\s+/);
      out.firstName = w[0];
      out.lastName = w[w.length - 1];
    }
    for (let i = 0; i < Math.min(header.length, 8); i++) {
      if (i === nameIdx) continue;
      const t = clean(header[i]).split(/\s{2,}/).find((p) => TITLE_RE.test(p) && !/@|\d{3}|https?:|linkedin|github/i.test(p) && p.length <= 90);
      if (t) { out.headline = t.replace(/\s*\|\s*/g, ' | ').trim(); break; }
    }

    // The contact line is not always at the top (some templates put it in a footer or sidebar).
    const contactLines = rawLines.filter((l) => /@|\+?\d[\d ().-]{8,}\d|linkedin/i.test(l));
    Object.assign(out, findLocation([...(header.length ? header : rawLines.slice(0, 8)), ...contactLines]));

    // Summary
    const sum = (sections.summary || []).map(clean).filter(Boolean).join(' ');
    if (sum) out.summary = sum.slice(0, 1200);

    // Experience
    const expLines = sections.experience?.length ? sections.experience : rawLines;
    // Two methods; keep the one that finds more complete jobs (title + company + dates).
    const score = (list) => list.filter((e) => e.title && e.company && e.start).length * 2 + list.filter((e) => e.title && e.start).length;
    const byDates = parseExperience(expLines);
    const byTitles = sections.experience?.length ? parseExperienceByTitles(expLines) : [];
    out.experience = (score(byTitles) > score(byDates) ? byTitles : byDates).slice(0, 12)
      .map((e) => ({ ...e, location: (e.location || '').replace(/\s*[-–,(]?\s*\b(remote|hybrid|on-?\s?site)\b\)?\s*$/i, '').trim() }));

    // Education
    out.education = parseEducation(sections.education?.length ? sections.education : rawLines);

    // Skills: the skills section, plus well-known skills mentioned anywhere.
    const fromSection = sections.skills ? splitSkills(sections.skills.join('\n')) : [];
    const known = dictSkills(flat);
    const skills = [];
    for (const s of [...fromSection, ...known]) if (!skills.some((x) => x.toLowerCase() === s.toLowerCase())) skills.push(s);
    out.skills = skills.slice(0, 60);

    // Current role + years of experience
    const first = out.experience[0];
    if (first) {
      out.currentTitle = first.title || '';
      out.currentCompany = first.company || '';
    }
    if (!out.headline && first?.title) out.headline = first.title;
    const yrs = flat.match(/(\d{1,2})\+?\s*(?:\+\s*)?years?\s+(?:of\s+)?(?:professional\s+|industry\s+|hands-on\s+)?(?:experience|expertise)/i);
    if (yrs) out.yearsExperience = yrs[1];
    else {
      const starts = out.experience.map((e) => Number((e.start.match(/\d{4}/) || [])[0])).filter(Boolean);
      if (starts.length) out.yearsExperience = String(Math.max(1, new Date().getFullYear() - Math.min(...starts)));
    }
    return out;
  }

  // pdf.js text items -> text. Some PDFs (e.g. exported from Canva/Word with odd fonts) split words into
  // touching pieces ("202" "4" "." "10", "S" "ummary"); join pieces that touch, put a space only where
  // there is a real gap on the page. A wide gap (between columns or contact items) becomes several spaces,
  // which the location / headline finders use to split a line into parts.
  function pdfItemsToText(items) {
    let out = '';
    let last = null;
    for (const it of items) {
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.hypot(it.transform[2], it.transform[3]) || 10;
      const str = it.str.trim() ? it.str : '';
      if (str && last && !out.endsWith('\n')) {
        const gap = x - last.end;
        const sameLine = Math.abs(y - last.y) < h * 0.5 && x >= last.x;
        const lead = /^\s/.test(str) || /\s$/.test(out);
        if (!sameLine || gap > h * 0.9) out = out.trimEnd() + '   ';
        else if (gap > h * 0.12 && !lead) out += ' ';
      }
      out += str;
      if (str) last = { x, y, end: x + it.width };
      if (it.hasEOL) { out = out.trimEnd() + '\n'; last = null; }
    }
    return out + '\n';
  }

  self.localParseResume = localParseResume;
  self.pdfItemsToText = pdfItemsToText;
})();
