// JobBid side panel: job match, required-fields checklist and actions next to an application form.
// Lives in the top frame; forms inside iframes report their fields to it via postMessage.

(() => {
  const LOGO = (() => { try { return chrome.runtime.getURL('icons/logo.png'); } catch { return ''; } })();
  const api = window.__jobbid;
  if (!api || window.__jobbidPanel) return;
  window.__jobbidPanel = true;

  const { IS_TOP, norm, textOf } = api;
  // Storage that survives the extension being reloaded under this page (see alive() in content.js).
  const store = {
    get: (k) => (api.alive() ? chrome.storage.local.get(k).catch(() => ({})) : (api.shutDown(), Promise.resolve({}))),
    set: (o) => (api.alive() ? chrome.storage.local.set(o).catch(() => {}) : (api.shutDown(), Promise.resolve())),
  };
  // Every settings / profile page is in the JobBid Hub dashboard.
  const openPage = async (path) => {
    if (!api.alive()) return api.shutDown();
    const r = await api.send({ type: 'openHub', path: String(path).split('#')[1] || '/' });
    if (!r.ok) api.toast({ kind: 'warn', title: 'Dashboard not available', msg: r.error, ms: 8000 });
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Width can be changed by dragging the panel's inner edge (remembered per Chrome).
  const MIN_W = 300, MAX_W = 620, DEFAULT_W = 340;
  let panelW = DEFAULT_W;
  // Opened from the JobBid icon (also shows the sign-in when signed out).
  let forceOpen = false;
  // Where the user dragged the panel / launcher (null = docked on the left edge).
  let pos = null, tabTop = null;
  const clampW = (w) => Math.max(MIN_W, Math.min(MAX_W, Math.round(Number(w) || DEFAULT_W), Math.max(MIN_W, innerWidth - 120)));

  // ---------- Field summary (every frame) ----------

  function fieldName(f) {
    if (f.kind === 'file') return /cover/i.test(f.label + ' ' + f.hint) ? 'Cover letter' : 'Resume/CV';
    const name = api.cleanQ(f.label) || api.cleanQ(f.hint) || 'Unlabeled field';
    return name.length > 70 ? name.slice(0, 67) + '...' : name;
  }

  function statusOf(f) {
    if (api.hasValue(f)) return f.kind === 'file' ? 'file' : api.sourceOf(f) === 'ai' ? 'ai' : 'done';
    return f.required ? 'missing' : 'empty';
  }

  let lastFields = [];
  function summarize() {
    lastFields = api.collectFields().filter((f) => f.label || f.hint || f.kind === 'file');
    return lastFields.map((f, i) => ({
      id: i,
      name: fieldName(f),
      required: !!f.required || (f.kind === 'file' && /resume|cv\b/i.test(f.label + ' ' + f.hint)),
      status: statusOf(f),
      ownWords: api.noAiQuestion(f),
      question: api.isQuestion(f),
      isFile: f.kind === 'file',
      file: f.kind === 'file' ? api.attachedName(f.el) : '',
      fixed: f.kind === 'file' && api.hasValue(f) && api.isFixedResume(f.el),
    }));
  }

  function focusField(i) {
    const f = lastFields[i];
    if (!f) return;
    const el = f.els ? f.els[0] : f.el;
    const box = f.kind === 'file' ? el.closest('div') || el : el;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = box.style.boxShadow;
    box.style.transition = 'box-shadow .3s';
    box.style.boxShadow = '0 0 0 4px rgba(99,70,229,.45)';
    setTimeout(() => (box.style.boxShadow = prev), 1600);
    if (f.kind !== 'file') el.focus?.({ preventScroll: true });
  }

  // Iframes: report to the top frame, accept focus requests.
  if (!IS_TOP) {
    let t;
    const report = () => {
      // Mid-fill: report once the fill is done (a scan now only slows it down).
      if (api.isFilling?.()) { clearTimeout(t); t = setTimeout(report, 800); return; }
      const items = summarize();
      if (items.length >= 3 || items.some((x) => x.name === 'Resume/CV') || items.filter((x) => x.question).length >= 2) window.top.postMessage({ __jobbid: 'report', items }, '*');
    };
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(report, 1000); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked', 'aria-pressed'] });
    document.addEventListener('input', () => { clearTimeout(t); t = setTimeout(report, 600); }, true);
    window.addEventListener('message', (e) => {
      if (e.data?.__jobbid === 'focus') focusField(e.data.id);
      if (e.data?.__jobbid === 'attach') api.attachResumeNow(e.data.resumeId, e.data.fixed).then(report);
      // Answer with AI inside this frame, then tell the panel (top frame) how it went.
      if (e.data?.__jobbid === 'ai') api.aiAnswerNow((e.data.ids || []).map((i) => lastFields[i])).catch((err) => ({ ok: false, error: err.message })).then((r) => { report(); window.top.postMessage({ __jobbid: 'aiDone', req: e.data.req, result: r }, '*'); });
    });
    setTimeout(report, 800);
    return;
  }

  // ---------- Top frame: the panel ----------

  const frameReports = new Map(); // iframe window -> items
  const aiWaits = new Map(); // request id -> resolve, for questions answered inside an iframe
  window.addEventListener('message', (e) => {
    if (e.data?.__jobbid === 'aiDone') { aiWaits.get(e.data.req)?.(e.data.result); aiWaits.delete(e.data.req); return; }
    if (e.data?.__jobbid !== 'report' || e.source === window) return;
    frameReports.set(e.source, e.data.items);
    schedule();
  });

  // Skill match: which known skills in the job description the candidate has.
  const SKILLS = ['python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#', 'scala', 'kotlin', 'swift', 'ruby', 'php', 'r', 'sql', 'nosql', 'bash',
    'react', 'next.js', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'fastapi', 'spring', 'spring boot', '.net', 'graphql', 'rest', 'grpc', 'microservices',
    'html', 'css', 'tailwind', 'redux', 'aws', 'azure', 'gcp', 'google cloud', 'lambda', 's3', 'ec2', 'eks', 'ecs', 'sagemaker', 'bedrock', 'vertex ai', 'docker', 'kubernetes',
    'terraform', 'ansible', 'jenkins', 'github actions', 'gitlab', 'ci/cd', 'linux', 'git', 'postgresql', 'postgres', 'mysql', 'sql server', 'oracle', 'mongodb', 'redis',
    'dynamodb', 'cassandra', 'elasticsearch', 'opensearch', 'snowflake', 'redshift', 'bigquery', 'databricks', 'spark', 'pyspark', 'hadoop', 'hive', 'kafka', 'kinesis',
    'airflow', 'dbt', 'flink', 'etl', 'elt', 'data warehouse', 'data lake', 'data modeling', 'tableau', 'power bi', 'looker', 'pandas', 'numpy', 'scikit-learn', 'pytorch',
    'tensorflow', 'keras', 'jax', 'hugging face', 'transformers', 'llm', 'llms', 'genai', 'generative ai', 'rag', 'langchain', 'llamaindex', 'openai', 'gpt', 'bert', 'nlp',
    'computer vision', 'opencv', 'machine learning', 'deep learning', 'mlops', 'mlflow', 'kubeflow', 'vllm', 'triton', 'fine-tuning', 'lora', 'embeddings', 'vector database',
    'pinecone', 'faiss', 'pgvector', 'weaviate', 'ray', 'agile', 'scrum', 'jira', 'devops', 'sre', 'observability', 'prometheus', 'grafana', 'datadog', 'security', 'oauth',
    'salesforce', 'hubspot', 'figma', 'react native', 'flutter', 'ios', 'android', 'unity', 'blockchain', 'solidity', 'web3', 'a/b testing', 'statistics', 'excel'];
  const skillRe = (s) => new RegExp(`(^|[^a-z0-9+#.])${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![a-z0-9+#])`, 'i');
  const SKILL_RES = SKILLS.map((s) => [s, skillRe(s)]);
  // How each skill is normally written ("fastapi" -> "FastAPI").
  const SKILL_NAMES = { javascript: 'JavaScript', typescript: 'TypeScript', 'c++': 'C++', 'c#': 'C#', php: 'PHP', sql: 'SQL', nosql: 'NoSQL', 'next.js': 'Next.js', 'node.js': 'Node.js',
    fastapi: 'FastAPI', '.net': '.NET', graphql: 'GraphQL', rest: 'REST', grpc: 'gRPC', html: 'HTML', css: 'CSS', aws: 'AWS', gcp: 'GCP', s3: 'S3', ec2: 'EC2', eks: 'EKS', ecs: 'ECS',
    sagemaker: 'SageMaker', 'ci/cd': 'CI/CD', postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB', dynamodb: 'DynamoDB', opensearch: 'OpenSearch', bigquery: 'BigQuery',
    pyspark: 'PySpark', dbt: 'dbt', etl: 'ETL', elt: 'ELT', 'power bi': 'Power BI', numpy: 'NumPy', 'scikit-learn': 'scikit-learn', pytorch: 'PyTorch', tensorflow: 'TensorFlow',
    jax: 'JAX', llm: 'LLM', llms: 'LLMs', genai: 'GenAI', rag: 'RAG', langchain: 'LangChain', llamaindex: 'LlamaIndex', openai: 'OpenAI', gpt: 'GPT', bert: 'BERT', nlp: 'NLP',
    opencv: 'OpenCV', mlops: 'MLOps', mlflow: 'MLflow', vllm: 'vLLM', lora: 'LoRA', faiss: 'FAISS', pgvector: 'pgvector', devops: 'DevOps', sre: 'SRE', oauth: 'OAuth',
    hubspot: 'HubSpot', ios: 'iOS', 'generative ai': 'Generative AI', 'google cloud': 'Google Cloud', 'hugging face': 'Hugging Face', 'vector database': 'vector database', web3: 'Web3', 'a/b testing': 'A/B testing', 'github actions': 'GitHub Actions', gitlab: 'GitLab', 'vertex ai': 'Vertex AI', 'sql server': 'SQL Server' };
  const skillName = (s) => SKILL_NAMES[s] || s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  // Same skill under another name: full credit.
  const SKILL_SAME = [['llm', 'llms', 'large language model', 'large language models'], ['genai', 'generative ai'], ['go', 'golang'], ['postgresql', 'postgres'],
    ['gcp', 'google cloud'], ['rest', 'restful', 'rest api', 'rest apis'], ['fine-tuning', 'fine tuning', 'finetuning'], ['rag', 'retrieval-augmented', 'retrieval augmented'],
    ['a/b testing', 'a/b test', 'ab testing', 'experimentation'], ['ci/cd', 'cicd', 'continuous integration'], ['node.js', 'nodejs'], ['next.js', 'nextjs'],
    ['security', 'cybersecurity', 'secure coding', 'appsec'], ['gpt', 'chatgpt', 'openai']];
  // Same family: half credit (knowing LlamaIndex says something about LangChain).
  const SKILL_FAMILY = [
    ['llm', 'llms', 'genai', 'generative ai', 'gpt', 'openai', 'rag', 'langchain', 'llamaindex', 'hugging face', 'transformers', 'fine-tuning', 'lora', 'vllm', 'embeddings', 'vector database', 'bedrock', 'vertex ai', 'bert', 'nlp'],
    ['machine learning', 'deep learning', 'pytorch', 'tensorflow', 'keras', 'jax', 'scikit-learn', 'mlops', 'mlflow', 'kubeflow', 'sagemaker', 'computer vision', 'statistics', 'a/b testing'],
    ['aws', 'azure', 'gcp', 'google cloud', 'lambda', 's3', 'ec2', 'eks', 'ecs'], ['docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'github actions', 'ci/cd', 'devops', 'sre'],
    ['react', 'angular', 'vue', 'next.js', 'redux', 'react native'], ['node.js', 'express', 'django', 'flask', 'fastapi', 'spring', 'spring boot', '.net', 'rest', 'graphql', 'grpc', 'microservices'],
    ['postgresql', 'postgres', 'mysql', 'sql server', 'oracle', 'sql', 'mongodb', 'dynamodb', 'cassandra', 'redis', 'nosql'],
    ['spark', 'pyspark', 'hadoop', 'hive', 'kafka', 'kinesis', 'airflow', 'dbt', 'flink', 'etl', 'elt', 'snowflake', 'redshift', 'bigquery', 'databricks', 'data warehouse', 'data lake'],
    ['tableau', 'power bi', 'looker', 'excel'], ['java', 'kotlin', 'scala'], ['javascript', 'typescript'], ['c++', 'c#', 'rust', 'go']];
  const reCache = new Map();
  const has = (corpus, s) => { if (!reCache.has(s)) reCache.set(s, skillRe(s)); return reCache.get(s).test(corpus); };
  const profileText = (p) => [p.headline, p.currentTitle, p.summary, ...(p.skills || []), ...(p.experience || []).flatMap((e) => [e.title, e.company, e.description]),
    ...(p.education || []).flatMap((e) => [e.degree, e.field])].filter(Boolean).join('\n').toLowerCase();

  // Skills the job asks for: literal (what an ATS sees), and by meaning (same skill / same family).
  function skillMatch(job, p, extra = '') {
    const jd = (job.title + '\n' + job.description).toLowerCase();
    const wanted = SKILL_RES.filter(([, re]) => re.test(jd)).map(([s]) => s).filter((s, i, a) => !(s === 'llm' && a.includes('llms')));
    if (wanted.length < 3) return null;
    const corpus = profileText(p) + '\n' + String(extra).toLowerCase();
    const have = [], related = [], missing = [];
    for (const s of wanted) {
      if (has(corpus, s) || SKILL_SAME.some((g) => g.includes(s) && g.some((x) => has(corpus, x)))) have.push(s);
      else if (SKILL_FAMILY.some((g) => g.includes(s) && g.some((x) => x !== s && has(corpus, x)))) related.push(s);
      else missing.push(s);
    }
    const literal = wanted.filter((s) => has(corpus, s) || (s.endsWith('s') ? has(corpus, s.slice(0, -1)) : has(corpus, s + 's')));
    return { pct: Math.round(((have.length + related.length / 2) / wanted.length) * 100), have, related, missing, literal, wanted };
  }

  // How much each job keyword matters, like an ATS weighs it: 2 = main skill (in the job title, named twice
  // or more, or on a "required / must have" line), 0.5 = only on a "nice to have / preferred / bonus" line, 1 = the rest.
  function keywordWeights(job, wanted) {
    const title = String(job.title || '').toLowerCase();
    const NICE = /\b(nice to have|nice-to-have|preferred|bonus|a plus|is a plus|plus if|good to have|desirable|ideally|familiarity with)\b/;
    const MUST = /\b(required|requirements?|must[- ]have|must have|you have|you bring|what you.?ll need|qualifications?|proficien\w*|strong (experience|knowledge)|expert\w*)\b/;
    const OTHER = /\b(responsibilit\w*|what you.?ll do|about (us|the (role|team|company))|benefits|perks|compensation|why join)\b/;
    // Each line belongs to the section above it ("Requirements:" then bullets), or says so itself.
    let section = '';
    const lines = String(job.description || '').toLowerCase().split(/\n|(?<=[.;])\s+/).map((l) => {
      const head = l.trim().length < 60;
      if (head && NICE.test(l)) section = 'nice';
      else if (head && MUST.test(l)) section = 'must';
      else if (head && OTHER.test(l)) section = '';
      return { l, kind: NICE.test(l) ? 'nice' : MUST.test(l) ? 'must' : section };
    });
    const w = {};
    for (const s of wanted) {
      const re = reCache.get(s) || skillRe(s);
      const hits = lines.filter((x) => re.test(x.l));
      if (re.test(title) || hits.length >= 2 || hits.some((x) => x.kind === 'must')) w[s] = 2;
      else if (hits.length && hits.every((x) => x.kind === 'nice')) w[s] = 0.5;
      else w[s] = 1;
    }
    return w;
  }


  // ---------- Match: experience, skills, industry and title, like a recruiter's first look ----------
  const INDUSTRIES = {
    Healthcare: /\b(health ?care|clinical|hospital|patient|medical|ehr|hipaa|telehealth)\b/g,
    'Biotech / Pharma': /\b(biotech\w*|pharma\w*|biopharma|life sciences?|drug discovery|genomic\w*|biolog\w*|regenerative|precision medicine)\b/g,
    'Finance / Fintech': /\b(fintech|banking|bank|financial services|trading|payments?|lending|capital markets|wealth|asset management|credit)\b/g,
    Insurance: /\b(insurance|insurtech|underwriting|claims)\b/g,
    'E-commerce / Retail': /\b(e-?commerce|retail|marketplace|shopping|merchants?)\b/g,
    'Education': /\b(edtech|education|learning platform|students|universit(y|ies))\b/g,
    'Government / Defense': /\b(government|federal|defense|public sector|dod|national security|clearance)\b/g,
    'Media / Advertising': /\b(adtech|advertising|media|marketing technology|publishing|streaming)\b/g,
    Gaming: /\b(gaming|video games?|game studio)\b/g,
    Automotive: /\b(automotive|autonomous vehicles?|self-driving|ev charging)\b/g,
    Telecom: /\b(telecom\w*|wireless|5g|network operator)\b/g,
    Energy: /\b(energy|utilities|oil and gas|renewable|solar|grid)\b/g,
    'Logistics / Supply chain': /\b(logistics|supply chain|freight|shipping|warehouse management)\b/g,
    'Real estate': /\b(real estate|proptech|mortgage|property management)\b/g,
    Cybersecurity: /\b(cybersecurity|security operations|threat detection|soc 2|siem|zero trust)\b/g,
    'Travel / Hospitality': /\b(travel|hospitality|hotels?|airlines?|booking)\b/g,
    'HR / Recruiting': /\b(hr tech|recruiting|talent acquisition|payroll|workforce)\b/g,
    'Crypto / Web3': /\b(crypto\w*|blockchain|web3|defi)\b/g,
    Manufacturing: /\b(manufacturing|industrial|factory|robotics)\b/g,
    Legal: /\b(legal tech|law firm|legal)\b/g,
  };
  function industriesIn(text, min) {
    const t = String(text || '').toLowerCase();
    return Object.entries(INDUSTRIES).map(([name, re]) => [name, (t.match(re) || []).length]).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }

  const LEVEL_YEARS = { intern: 0, entry: 0, junior: 1, jr: 1, associate: 2, mid: 3, senior: 5, sr: 5, staff: 8, lead: 7, principal: 10, director: 10, head: 10, architect: 8 };
  function profileYears(p) {
    const y = parseFloat(p.yearsExperience);
    if (Number.isFinite(y) && y > 0) return y;
    let months = 0;
    for (const e of p.experience || []) {
      const d = (s) => { const m = String(s || '').match(/(?:(\d{1,2})\/)?(\d{4})/); return m ? Number(m[2]) * 12 + (Number(m[1]) || 1) : null; };
      const a = d(e.start), b = /present|current|now/i.test(e.end || '') ? new Date().getFullYear() * 12 + new Date().getMonth() + 1 : d(e.end);
      if (a && b && b > a) months += b - a;
    }
    return months ? Math.round(months / 12) : null;
  }
  // Years the job asks for. A range ("1-7 years") also gives its top, so 10 years isn't "overqualified" there.
  let lastYearsMax = null;
  function requiredYears(text) {
    let best = null, top = null;
    for (const m of String(text || '').matchAll(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*years?(?:'|’)?\s+(?:of\s+)?(?:\w+\s+){0,4}?(?:experience|exp\b|working|in\b|building|developing)/gi)) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 15 && (best == null || n > best)) { best = n; top = m[2] ? Number(m[2]) : null; }
    }
    lastYearsMax = top;
    return best;
  }

  const TITLE_STOP = new Set(['senior', 'sr', 'junior', 'jr', 'staff', 'lead', 'principal', 'head', 'of', 'and', 'the', 'i', 'ii', 'iii', 'iv', 'a', 'an', 'to', 'for', 'in', 'remote', 'hybrid', 'mid', 'level', 'associate']);
  const TITLE_SAME = { developer: 'engineer', programmer: 'engineer', swe: 'engineer', sde: 'engineer', ml: 'machine', ai: 'machine', llm: 'machine', genai: 'machine', fullstack: 'full', frontend: 'front', backend: 'back' };
  const titleWords = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ').filter((w) => w && !TITLE_STOP.has(w)).map((w) => TITLE_SAME[w] || w.replace(/s$/, '')));
  function titleScore(job, p) {
    const want = titleWords(job.title);
    if (!want.size) return null;
    const mine = [p.headline, p.currentTitle, ...(p.experience || []).slice(0, 3).map((e) => e.title)].filter(Boolean);
    let best = 0, bestTitle = '';
    for (const t of mine) {
      const w = titleWords(t);
      const common = [...want].filter((x) => w.has(x)).length;
      const s = w.size ? (2 * common) / (want.size + w.size) : 0;
      if (s > best) { best = s; bestTitle = t; }
    }
    return { pct: Math.round(25 + 75 * best), mine: bestTitle || mine[0] || '' };
  }

  // A quick score from the page and the profile (no AI). The AI version replaces it when asked.
  // extra: the text of a resume fixed for this job, so its new keywords count.
  function matchAnalysis(job, p, extra = '') {
    const skills = skillMatch(job, p, extra);
    const jd = job.title + '\n' + job.description;
    const yrs = profileYears(p);
    const req = requiredYears(job.description);
    const lvl = (job.title.toLowerCase().match(/\b(intern|entry|junior|jr|associate|mid|senior|sr|staff|lead|principal|director|head|architect)\b/) || [])[1];
    const need = req ?? (lvl ? LEVEL_YEARS[lvl] : null);
    let exp = 80;
    const needMax = req != null ? lastYearsMax : null;
    // Far more years than a junior role asks for reads as overqualified to a recruiter (not to an ATS).
    const over = need != null && yrs != null && need <= 2 && yrs > (needMax ?? need) + 8;
    if (need != null && yrs != null) exp = yrs >= need ? (over ? 70 : 95) : Math.max(15, Math.round(95 * (yrs / Math.max(1, need))));
    // An ATS only filters out too FEW years.
    const atsExp = over ? 95 : exp;
    const jobInd = industriesIn(jd, 2).slice(0, 4);
    const myInd = industriesIn(profileText(p) + '\n' + String(extra).toLowerCase(), 1);
    const shared = jobInd.filter((x) => myInd.includes(x));
    const industry = !jobInd.length ? 75 : Math.round(45 + 55 * (shared.length / jobInd.length));
    const title = titleScore(job, p);
    const skillPct = skills ? skills.pct : 70;
    const overall = Math.round(0.45 * skillPct + 0.35 * exp + 0.1 * industry + 0.1 * (title ? title.pct : 70));
    // ATS keywords: exact word = full credit, the same skill under another name ("Postgres") = 0.8,
    // a related tool of the same family = 0.25. Main skills count double, "nice to have" ones half.
    let kw = 0.7;
    const kwState = {};
    if (skills) {
      const weights = keywordWeights(job, skills.wanted);
      let got = 0, total = 0;
      for (const s of skills.wanted) {
        const st = skills.literal.includes(s) ? 'have' : skills.have.includes(s) ? 'same' : skills.related.includes(s) ? 'close' : 'miss';
        kwState[s] = st;
        got += weights[s] * { have: 1, same: 0.8, close: 0.25, miss: 0 }[st];
        total += weights[s];
      }
      kw = total ? got / total : 0.7;
    }
    const ats = Math.round(10 * (0.6 * kw + 0.15 * ((title?.pct ?? 70) / 100) + 0.15 * (atsExp / 100) + 0.1 * (industry / 100)) * 10) / 10;
    const tips = [];
    // Words to add: the ones the resume doesn't literally contain (main skills first).
    const missingKw = skills ? skills.wanted.filter((s) => !skills.literal.includes(s)).sort((a, b) => (kwState[a] === 'miss') - (kwState[b] === 'miss')) : [];
    if (missingKw.length) tips.push(`Add these words to the resume if you have used them: ${missingKw.slice(0, 6).map(skillName).join(', ')}.`);
    if (title && title.pct < 60) tips.push(`Your title (${title.mine || 'not set'}) is far from "${job.title}". A tailored resume headline helps the ATS.`);
    if (jobInd.length && !shared.length) tips.push(`No ${jobInd.slice(0, 2).join(' or ')} experience shows in the profile. Mention any related project or domain work.`);
    if (need != null && yrs != null && yrs < need) tips.push(`The job asks for about ${need}+ years; the profile shows ${yrs}.`);
    return {
      overall, ats, experience: exp, skills: skillPct, industry, title: title?.pct ?? 70,
      yrs, need, jobInd, shared, myTitle: title?.mine || '', skillInfo: skills,
      keywords: skills ? skills.wanted.map((s) => ({ k: skillName(s), have: skills.literal.includes(s), close: kwState[s] === 'same' || kwState[s] === 'close' })) : [],
      tips,
    };
  }

  // ---------- Job details without AI (used instantly, and as a fallback) ----------

  function guessDetails(job) {
    const t = job.description || '';
    const pick = (re) => (t.match(re) || [])[0]?.trim() || '';
    const salary = pick(/(?:US)?\$\s?\d[\d,.]*\s?[kK]?(?:\s?(?:-|–|to)\s?(?:US)?\$?\s?\d[\d,.]*\s?[kK]?)?(?:\s?(?:\/|per|an?)\s?(?:yr|year|hour|hr|annum))?/);
    const workMode = /\bhybrid\b/i.test(t) ? 'Hybrid' : /\b(fully |100% )?remote\b/i.test(t) ? 'Remote' : /\bon-?site\b|\bin[- ]office\b/i.test(t) ? 'On-site' : '';
    const employmentType = /\bfull[- ]time\b/i.test(t) ? 'Full-time' : /\bpart[- ]time\b/i.test(t) ? 'Part-time' : /\bcontract(or)?\b/i.test(t) ? 'Contract' : /\bintern(ship)?\b/i.test(t) ? 'Internship' : '';
    const lvl = (job.title.match(/\b(intern|junior|jr|associate|mid|senior|sr|staff|lead|principal|director|head)\b/i) || [])[1] || '';
    const seniority = { jr: 'Junior', sr: 'Senior' }[lvl.toLowerCase()] || (lvl ? lvl[0].toUpperCase() + lvl.slice(1).toLowerCase() : '');
    const posted = pick(/\b(?:posted\s+)?(?:\d+\+?\s+(?:minute|hour|day|week|month)s?\s+ago|today|yesterday)\b/i);
    let loc = '';
    for (const el of document.querySelectorAll('[data-testid*="location" i], [class*="location" i], [data-automation-id="locations"]')) {
      const s = textOf(el);
      if (s && s.length < 80 && !el.closest('#jobbid-root, #jobbid-root-panel')) { loc = s; break; }
    }
    if (!loc) loc = ((t.match(/\blocation[s]?\s*[:\-]\s*([^\n.;|]{3,60})/i) || [])[1] || '').trim();
    const skills = SKILL_RES.filter(([, re]) => re.test(t)).map(([s]) => s).slice(0, 10);
    return { title: job.title, company: job.company, location: loc, workMode, seniority, employmentType, salary, posted, skills, summary: '' };
  }

  // ---------- UI ----------

  const host = document.createElement('div');
  host.id = 'jobbid-root-panel';
  host.style.cssText = 'all:initial;position:fixed!important;left:auto!important;top:12px!important;right:12px!important;bottom:auto!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483646!important;display:none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .w { --bg:#f6f6fb; --card:#fff; --text:#1b1b2f; --t2:#5b5d72; --t3:#8b8da3; --stroke:rgba(30,27,75,.09); --div:rgba(30,27,75,.07);
        --accent:#6d28d9; --on:#fff; --soft:rgba(109,40,217,.08); --hover:rgba(109,40,217,.06); --ok:#16a34a; --okbg:#dcfce7; --warn:#b45309; --warnbg:#fef3c7;
        --err:#dc2626; --errbg:#fee2e2; --ai:#7c3aed; --grad:linear-gradient(135deg,#6d28d9,#9333ea 60%,#c026d3); --skel:#e7e7ef; --skel2:#f3f3f8;
        font: 13px/18px "Segoe UI Variable Text","Segoe UI","Malgun Gothic","Microsoft YaHei",system-ui,sans-serif; color: var(--text); height: 100%; }
      @media (prefers-color-scheme: dark) {
          .w:not([data-theme=light]) { --bg:#13131c; --card:#1d1d29; --text:#f1f1f8; --t2:#b4b6cc; --t3:#868aa3; --stroke:rgba(255,255,255,.08); --div:rgba(255,255,255,.07);
          --accent:#c4b5fd; --on:#fff; --soft:rgba(167,139,250,.14); --hover:rgba(196,181,253,.08); --ok:#4ade80; --okbg:rgba(74,222,128,.14); --warn:#fbbf24; --warnbg:rgba(251,191,36,.14);
          --err:#f87171; --errbg:rgba(248,113,113,.15); --ai:#a78bfa; --grad:linear-gradient(135deg,#7c3aed,#9333ea 60%,#c026d3); --skel:#2a2a38; --skel2:#33334a; }
        }
        .w[data-theme=dark] { --bg:#13131c; --card:#1d1d29; --text:#f1f1f8; --t2:#b4b6cc; --t3:#868aa3; --stroke:rgba(255,255,255,.08); --div:rgba(255,255,255,.07);
          --accent:#c4b5fd; --on:#fff; --soft:rgba(167,139,250,.14); --hover:rgba(196,181,253,.08); --ok:#4ade80; --okbg:rgba(74,222,128,.14); --warn:#fbbf24; --warnbg:rgba(251,191,36,.14);
          --err:#f87171; --errbg:rgba(248,113,113,.15); --ai:#a78bfa; --grad:linear-gradient(135deg,#7c3aed,#9333ea 60%,#c026d3); --skel:#2a2a38; --skel2:#33334a; }
      svg { width:16px; height:16px; flex:none; }
      button { font: inherit; color: inherit; }
      .panel { position:relative; width:var(--pw, 340px); height:auto; max-height:calc(100vh - var(--top, 12px) - 12px); display:flex; flex-direction:column; background:var(--card); border:1px solid var(--stroke); border-radius:16px;
        box-shadow:0 16px 48px rgba(0,0,0,.22); overflow:hidden; animation:in .25s cubic-bezier(.1,.9,.2,1); }
      @keyframes in { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:none; } }

      header { display:flex; align-items:center; gap:6px; padding:10px 10px 8px 12px; cursor:grab; user-select:none; touch-action:none; }
      header.dragging { cursor:grabbing; }
      header button, header .menu { cursor:pointer; }
      .w.out .tabs, .w.out #who, .w.out .langwrap:has(#more) { display:none; }
      .signin { display:flex; flex-direction:column; gap:8px; }
      .signin label { display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:600; color:var(--t2); }
      .signin input { font:inherit; font-size:13px; padding:8px 10px; border-radius:9px; border:1px solid var(--stroke); background:var(--card); color:var(--text); outline:none; }
      .signin input:focus { border-color:var(--accent); }
      .signin .go { all:unset; cursor:pointer; text-align:center; padding:9px; border-radius:10px; background:var(--grad); color:#fff; font-weight:700; font-size:13px; }
      .signin .msg { font-size:12px; color:var(--err); min-height:16px; }
      .signin .hint { font-size:12px; color:var(--t2); }
      .signin .go.alt { background:var(--card); color:var(--accent); border:1px solid var(--accent); }
      .signin .or { display:flex; align-items:center; gap:8px; color:var(--t3); font-size:11px; }
      .signin .or::before, .signin .or::after { content:''; flex:1; height:1px; background:var(--stroke); }
      .offbar { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:10px; background:rgba(217,119,6,.1); border:1px solid rgba(217,119,6,.3); font-size:12px; color:var(--text); }
      .offbar svg { width:15px; height:15px; color:var(--warn); flex:none; }
      .offbar.upd { background:rgba(124,58,237,.08); border-color:rgba(124,58,237,.3); }
      .offbar.upd svg { color:var(--accent); }
      .mwho { padding:6px 10px 2px; font-size:11.5px; color:var(--t2); }
      .logo { width:28px; height:28px; flex:none; display:block; }
      .brand { font-weight:700; font-size:15px; margin-right:auto; }
      .ib { all:unset; cursor:pointer; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; color:var(--t2); flex:none; border:1px solid var(--stroke); background:var(--card); position:relative; }
      .ib:hover { background:var(--hover); color:var(--accent); }
      .ib svg { width:15px; height:15px; }
      .langwrap { position:relative; display:inline-flex; }
      .menu { position:absolute; top:36px; right:0; z-index:5; background:var(--card); border:1px solid var(--stroke); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.18); padding:4px; display:none; min-width:130px; }
      .menu.open { display:block; }
      .menu button { all:unset; display:block; cursor:pointer; padding:7px 10px; border-radius:6px; font-size:13px; color:var(--text); }
      .menu button:hover { background:var(--hover); }
      .menu button[aria-checked=true] { color:var(--accent); font-weight:700; }

      .tabs { display:flex; gap:2px; margin:0 10px 6px; padding:3px; border-radius:12px; background:var(--bg); border:1px solid var(--stroke); }
      .tabs button { all:unset; cursor:pointer; flex:1; display:flex; align-items:center; justify-content:center; gap:8px; height:40px; border-radius:9px; color:var(--t2); font-weight:600; font-size:14px; min-width:0; }
      .tabs button:hover { color:var(--text); }
      .tabs button.on { background:var(--card); color:var(--accent); box-shadow:0 1px 3px rgba(30,27,75,.1); }
      .tabs button svg { width:18px; height:18px; }
      .tabs .two { display:flex; flex-direction:column; line-height:13px; text-align:left; min-width:0; }
      .tabs .two small { font-size:10px; font-weight:500; color:var(--t3); }
      .tabs .two span { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:76px; color:var(--text); }

      .body { flex:1 1 auto; min-height:0; overflow:auto; padding:6px 12px 12px; display:flex; flex-direction:column; gap:10px; }
      .cap { font-size:11px; font-weight:700; letter-spacing:.06em; color:var(--t3); text-transform:uppercase; margin-top:4px; }
      .card { background:var(--card); border:1px solid var(--stroke); border-radius:12px; padding:12px; }
      .grow { flex:1; min-width:0; }
      .ellip { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .t2 { color:var(--t2); font-size:12px; }
      .jtitle { font-size:17px; line-height:22px; font-weight:700; }
      .drow { display:flex; align-items:flex-start; gap:10px; color:var(--t2); }
      .drow > svg { margin-top:1px; color:var(--t3); }
      .drow .v { color:var(--text); }
      .drow.muted .v { color:var(--t3); }
      .pair { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .pill { display:inline-flex; align-items:center; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; background:var(--soft); color:var(--accent); margin-left:6px; }
      .chips { display:flex; flex-wrap:wrap; gap:4px; }
      .chip { font-size:11px; padding:1px 8px; border-radius:10px; background:var(--okbg); color:var(--ok); }
      .chip.miss { background:var(--bg); color:var(--t2); border:1px solid var(--stroke); }
      .chip.close { background:rgba(217,119,6,.1); color:var(--warn); border-color:rgba(217,119,6,.25); }
      .chip.rel { background:var(--warnbg); color:var(--warn); }
      .mhead { display:flex; align-items:center; gap:14px; }
      .mhead .ring { width:72px; height:72px; font-size:19px; }
      .mhead .ring svg { width:72px; height:72px; }
      .mverdict { font-weight:700; font-size:15px; }
      .mbars { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
      .mbar { display:grid; grid-template-columns:1fr auto; gap:3px 8px; font-size:12.5px; align-items:center; }
      .mbar .tr { grid-column:1 / -1; height:5px; border-radius:3px; background:var(--bg); overflow:hidden; }
      .mbar .tr i { display:block; height:100%; border-radius:3px; }
      .mbar .note { grid-column:1 / -1; font-size:11px; color:var(--t3); }
      .ats { display:flex; align-items:center; gap:10px; }
      .ats .num { font-size:24px; font-weight:800; line-height:28px; }
      .ats .num small { font-size:12px; font-weight:600; color:var(--t3); }
      .mlist { margin:4px 0 0; padding-left:18px; color:var(--t2); font-size:12.5px; line-height:18px; }
      .mlist li { margin:2px 0; }
      .summary { color:var(--t2); font-size:12.5px; line-height:18px; }
      .match { display:flex; gap:12px; align-items:center; }
      .ring { width:52px; height:52px; flex:none; position:relative; display:grid; place-items:center; font-weight:700; font-size:13px; }
      .ring svg { position:absolute; inset:0; width:52px; height:52px; transform:rotate(-90deg); }
      .link { all:unset; cursor:pointer; color:var(--accent); font-weight:600; font-size:12px; }

      .sk { border-radius:8px; background:linear-gradient(90deg,var(--skel) 25%,var(--skel2) 50%,var(--skel) 75%); background-size:200% 100%; animation:sh 1.3s infinite linear; }
      @keyframes sh { from { background-position:200% 0; } to { background-position:-200% 0; } }
      .thinking { display:flex; align-items:center; gap:8px; color:var(--t2); font-size:13px; padding:4px 0; }
      .spin { width:14px; height:14px; border-radius:50%; border:2px solid var(--skel); border-top-color:var(--accent); animation:rot .8s linear infinite; }
      @keyframes rot { to { transform:rotate(360deg); } }

      .bar-info { display:flex; gap:10px; align-items:center; padding:8px 12px; border-radius:10px; border-left:3px solid var(--accent); font-size:12px; background:var(--soft); }
      .bar-info.warn { background:var(--warnbg); border-left-color:var(--warn); }
      .bar-info.err { background:var(--errbg); border-left-color:var(--err); }
      .bar-info a { color:var(--accent); font-weight:600; cursor:pointer; }
      .ipline { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:10px; border:1px solid var(--stroke); font-size:12px; color:var(--t2); cursor:pointer; }
      .ipline svg { width:14px; height:14px; }
      .ipline.ok svg { color:var(--ok); }
      .ipline.warn { border-color:var(--warn); background:var(--warnbg); color:var(--text); }

      .fill { all:unset; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; height:44px; border-radius:12px; background:var(--grad); color:#fff; font-weight:700; font-size:14px; box-shadow:0 6px 18px rgba(109,40,217,.3); }
      .fill:hover { filter:brightness(1.08); }
      .fill[disabled] { opacity:.6; cursor:default; }
      .prog-head { display:flex; align-items:center; gap:8px; font-size:13px; }
      .prog-head b { font-size:14px; }
      .sep { width:1px; height:14px; background:var(--div); }
      .prog { height:6px; border-radius:3px; background:var(--bg); margin-top:8px; overflow:hidden; }
      .prog i { display:block; height:100%; border-radius:3px; background:linear-gradient(90deg,var(--ok),#22c55e); transition:width .3s; }
      .grp { font-weight:700; margin:12px 0 4px; }
      .grp:first-child { margin-top:0; }
      .item { all:unset; cursor:pointer; display:flex; align-items:center; gap:10px; width:100%; padding:5px 6px; margin:0 -6px; border-radius:6px; }
      .item:hover { background:var(--hover); }
      .item .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .st { width:18px; height:18px; border-radius:50%; display:grid; place-items:center; flex:none; }
      .st svg { width:12px; height:12px; }
      .st.done, .st.file { background:var(--ok); color:#fff; }
      .st.ai { background:var(--ai); color:#fff; }
      .st.missing { background:var(--err); color:#fff; }
      .st.empty { color:var(--t3); }
      .tag { font-size:11px; color:var(--t3); }
      .acts { display:flex; gap:6px; }
      .acts button { all:unset; cursor:pointer; flex:1; text-align:center; padding:9px 8px; border-radius:10px; border:1px solid var(--stroke); background:var(--card); font-size:13px; font-weight:600; }
      .acts button:hover { background:var(--hover); }
      .acts button[disabled] { opacity:.45; cursor:not-allowed; }
      .acts select.mini { flex:1; min-width:0; font:inherit; font-size:12px; padding:6px; border-radius:10px; border:1px solid var(--stroke); background:var(--card); color:var(--text); }
      .acts button svg { width:14px; height:14px; vertical-align:-2px; margin-right:6px; }
      .fixbox { display:flex; flex-direction:column; gap:8px; }
      .fixlive { position:relative; overflow:hidden; padding:10px 12px; border-radius:12px; border:1px solid rgba(109,40,217,.28); background:linear-gradient(135deg,rgba(109,40,217,.1),rgba(192,38,211,.07)); color:#5b21b6; animation:fixin .28s ease; }
      .fixlive.ok { border-color:rgba(22,163,74,.35); background:rgba(22,163,74,.1); color:var(--ok); }
      .fixlive.held { border-color:rgba(109,40,217,.4); background:rgba(109,40,217,.12); color:#6d28d9; }
      .fixlive.err { border-color:rgba(220,38,38,.3); background:rgba(220,38,38,.08); color:var(--err); }
      .fixlive.warn { border-color:rgba(217,119,6,.35); background:rgba(217,119,6,.1); color:#b45309; display:flex; align-items:flex-start; gap:8px; }
      .bidst { margin-top:8px; }
      .bidst .t2 { margin-top:2px; }
      .fixlive > svg { width:16px; height:16px; flex:none; }
      .fixlive.ok, .fixlive.held, .fixlive.err { display:flex; align-items:flex-start; gap:8px; }
      @keyframes fixin { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
      .fixrow { display:flex; align-items:center; gap:8px; font-size:13px; }
      .fixdots::after { content:''; animation:fixdots 1.2s steps(4,end) infinite; }
      @keyframes fixdots { 0%{content:''} 25%{content:'.'} 50%{content:'..'} 75%{content:'...'} }
      .fixstage { margin-top:6px; font-size:12px; color:var(--t2); line-height:1.35; min-height:16px; transition:color .2s; }
      .fixsecs { font-variant-numeric:tabular-nums; color:var(--t3); font-size:12px; }
      .fixbar { height:3px; border-radius:2px; background:rgba(109,40,217,.14); margin-top:8px; overflow:hidden; }
      .fixbar i { display:block; height:100%; width:38%; border-radius:2px; background:var(--grad); animation:fixslide 1.35s ease-in-out infinite; }
      @keyframes fixslide { 0%{ transform:translateX(-120%); } 100%{ transform:translateX(320%); } }
      .acts button.fix-ok { border-color:rgba(22,163,74,.4); color:var(--ok); background:rgba(22,163,74,.07); }
      .acts button.fix-held { border-color:rgba(109,40,217,.4); color:#6d28d9; background:rgba(109,40,217,.1); opacity:1; }
      .acts button.fix-busy { border-color:rgba(109,40,217,.35); color:#6d28d9; background:rgba(109,40,217,.08); opacity:1; }
      #log { color:var(--ok); } #cover { color:var(--ai); }
      textarea { width:100%; min-height:180px; border:1px solid var(--stroke); border-radius:8px; background:var(--card); color:var(--text); font:inherit; padding:8px; resize:vertical; }

      .pcard { all:unset; cursor:pointer; display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; border:1px solid var(--stroke); }
      .pcard:hover { background:var(--hover); }
      .pcard.on { border-color:var(--accent); background:var(--soft); }
      .av { width:36px; height:36px; border-radius:50%; background:var(--grad); color:#fff; display:grid; place-items:center; font-weight:700; font-size:13px; letter-spacing:.02em; flex:none;
        position:relative; box-shadow:inset 0 1px 0 rgba(255,255,255,.3), 0 0 0 2px var(--card), 0 0 0 3.5px var(--avc, #8b5cf6); text-shadow:0 1px 1px rgba(0,0,0,.15); }
      .av.lg { width:44px; height:44px; font-size:15px; }
      .av .dot { position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 2px var(--card); }
      .check { color:var(--accent); }

      /* Hidden state: a small launcher on the page edge (with a status badge). */
      .tab { all:unset; cursor:pointer; position:fixed; right:10px; top:40%; width:48px; height:48px; border-radius:12px; background:transparent;
        display:none; place-items:center; box-shadow:0 6px 20px rgba(11,87,208,.35); transition:transform .15s, box-shadow .15s; }
      .tab > img { width:48px; height:48px; display:block; }
      .tab:hover { transform:scale(1.06); box-shadow:0 8px 26px rgba(11,87,208,.45); }
      .w.left .tab { right:auto; left:10px; }
      .tab .tb { position:absolute; right:-5px; bottom:-5px; min-width:20px; height:20px; padding:0 4px; border-radius:10px; display:grid; place-items:center;
        background:#fff; color:#6d28d9; border:2px solid #6d28d9; font-size:10px; font-weight:800; box-sizing:border-box; }
      .tab .tb svg { width:11px; height:11px; stroke-width:3; }
      .tab .tb.miss { background:#dc2626; border-color:#fff; color:#fff; }
      .tab .tb.ok { background:#16a34a; border-color:#fff; color:#fff; }
      .tab .tb.lock { background:#64748b; border-color:#fff; color:#fff; }
      .w.left #collapse svg { transform:rotate(180deg); }
      .w.left .panel { animation-name:inl; }
      /* Drag handle on the panel's inner edge to change its width. */
      .rz { position:absolute; top:0; bottom:0; left:-4px; width:8px; cursor:ew-resize; z-index:6; }
      .w.left .rz { left:auto; right:-4px; }
      .rz::after { content:''; position:absolute; top:50%; left:3px; width:2px; height:36px; margin-top:-18px; border-radius:2px; background:var(--stroke); opacity:0; transition:opacity .15s; }
      .rz:hover::after, .rz.on::after { opacity:1; background:var(--accent, #4f46e5); }
      @keyframes inl { from { opacity:0; transform:translateX(-16px); } to { opacity:1; transform:none; } }
      .empty-note { color:var(--t2); font-size:12px; text-align:center; padding:8px; }
      .brow { display:flex; align-items:center; gap:8px; font-size:13px; margin:5px 0; }
      .brow input[type=checkbox] { width:16px; height:16px; accent-color:var(--accent); margin:0; }
      .bpick { cursor:pointer; }
      .bdot { width:9px; height:9px; border-radius:50%; background:var(--t3); }
      .bdot.on { background:var(--ok); box-shadow:0 0 0 3px rgba(22,163,74,.18); }
      .bcnts { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:10px 0; }
      .bcnt { display:flex; flex-direction:column; align-items:center; padding:6px 2px; border-radius:9px; background:var(--bg); font-size:11px; color:var(--t2); }
      .bcnt b { font-size:17px; color:var(--text); }
      .bcnt.ok b { color:var(--ok); } .bcnt.warn b { color:var(--warn); } .bcnt.info b { color:var(--accent); }
      .bseg { display:flex; padding:3px; border-radius:10px; background:var(--bg); border:1px solid var(--stroke); }
      .bseg button { all:unset; cursor:pointer; flex:1; text-align:center; padding:6px 4px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--t2); }
      .bseg button.on { background:var(--card); color:var(--accent); box-shadow:0 1px 3px rgba(30,27,75,.1); }
      .bidIn { width:54px; height:28px; border-radius:7px; border:1px solid var(--stroke); background:var(--bg); color:var(--text); font:inherit; font-size:12.5px; padding:0 6px; }
      .bitem { all:unset; cursor:pointer; display:flex; gap:8px; align-items:flex-start; width:100%; box-sizing:border-box; padding:6px 0; border-top:1px solid var(--stroke); font-size:12.5px; }
      .bitem:first-of-type { border-top:0; }
      .bst { flex:none; font-size:10.5px; font-weight:700; padding:2px 6px; border-radius:6px; background:var(--bg); color:var(--t2); }
      .bst.submitted { color:var(--ok); } .bst.needs, .bst.failed { color:var(--err); } .bst.review { color:var(--accent); }

      /* Tidy layout: profile switcher in the header, one "more" menu, compact tabs. */
      .brand { margin-right:4px; }
      .who { all:unset; cursor:pointer; display:flex; align-items:center; gap:6px; min-width:0; flex:1; height:30px; padding:0 8px 0 3px; border-radius:15px; border:1px solid var(--stroke); }
      .who:hover { background:var(--hover); }
      .who .ellip { font-weight:600; font-size:12.5px; }
      .who > svg { width:13px; height:13px; color:var(--t3); margin-left:auto; }
      .av.sm { width:24px; height:24px; font-size:10px; box-shadow:inset 0 1px 0 rgba(255,255,255,.3); }
      .menu.wide { min-width:190px; }
      .menu button { display:flex; align-items:center; gap:8px; }
      .menu button svg { width:14px; height:14px; color:var(--t3); }
      .menu .mcap { font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--t3); padding:6px 10px 2px; }
      .menu .msep { height:1px; background:var(--div); margin:4px 2px; }
      .menu .langs { display:flex; gap:2px; padding:0 4px 2px; }
      .menu .langs button { flex:1; justify-content:center; padding:5px 4px; font-size:12px; border:1px solid var(--stroke); }
      .menu .langs button[aria-checked=true] { border-color:var(--accent); background:var(--soft); }
      .menu .pick { width:100%; }
      .menu .pick .t2 { font-size:11px; }
      .tabs button { height:34px; font-size:13px; gap:5px; }
      .tabs button svg { width:16px; height:16px; }
      .panel { container-type:inline-size; }
      @container (max-width: 380px) { .tabs button { font-size:12.5px; } .tabs button:not(.on) svg { display:none; } }
      .tabs .badge { min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:var(--err); color:#fff; font-size:10px; font-weight:700; display:inline-grid; place-items:center; }
      .tabs .badge[hidden] { display:none; }

      .resume { display:flex; flex-direction:column; gap:8px; }
      .rhead { display:flex; align-items:center; gap:8px; }
      .rhead > svg { color:var(--t3); }
      .rstate { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--err); max-width:60%; min-width:0; }
      .rstate.ok { color:var(--ok); }
      .rstate.ai { color:#6346e5; }
      .rstate svg { width:13px; height:13px; }
      .rrow { display:flex; gap:6px; }
      .rrow.select-fixed select { border-color:#6346e5; background:#f3efff; color:#3b2a9e; font-weight:600; }
      .rfixed { display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12px; color:#6346e5; }
      .rfixed svg { width:13px; height:13px; flex:none; }
      .rrow select { flex:1; min-width:0; height:32px; border-radius:8px; border:1px solid var(--stroke); background:var(--bg); color:var(--text); font:inherit; font-size:12.5px; padding:0 8px; }
      .rbtn { all:unset; cursor:pointer; padding:0 12px; height:32px; border-radius:8px; background:var(--soft); color:var(--accent); font-weight:700; font-size:12.5px; display:grid; place-items:center; }
      .rbtn:hover { filter:brightness(1.1); }
      .rbtn[disabled] { opacity:.5; cursor:default; }
      .applied { display:flex; align-items:flex-start; gap:8px; color:var(--err); font-size:13px; line-height:17px; }
      .applied > svg { width:18px; height:18px; margin-top:-1px; }
      .applied b { font-weight:600; display:block; }
      .applied .when { color:var(--t3); font-size:11.5px; }
      .applied.other { color:var(--warn); }
      .fillcard { display:flex; flex-direction:column; gap:10px; }
      .fillcard .fill { height:42px; }
      .next { all:unset; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--err); }
      .next.ai { color:#7c3aed; }
      .aist { display:flex; align-items:center; gap:8px; font-size:12px; padding:7px 10px; border-radius:10px; }
      .aist > svg { width:14px; height:14px; flex:none; }
      .aist.working { background:rgba(124,58,237,.08); color:#6d28d9; }
      .aist.ok { background:rgba(22,163,74,.08); color:var(--ok); }
      .aist.err { background:rgba(220,38,38,.08); color:var(--err); }
      .aist .spin { width:12px; height:12px; border-radius:50%; border:2px solid rgba(124,58,237,.25); border-top-color:#7c3aed; animation:spin .8s linear infinite; flex:none; }
      @keyframes spin { to { transform:rotate(360deg); } }
      .next > svg { width:14px; height:14px; }
      .item .tag.ask { cursor:pointer; display:inline-flex; align-items:center; gap:3px; margin-left:auto; padding:1px 7px; border-radius:8px; font-weight:700; color:#7c3aed; background:rgba(124,58,237,.1); }
      .item .tag.ask svg { width:11px; height:11px; }
      .next svg { width:13px; height:13px; }
      .fold { all:unset; cursor:pointer; display:flex; align-items:center; gap:6px; width:100%; font-weight:700; margin:12px 0 4px; }
      .fold:first-child { margin-top:0; }
      .fold .tag { font-weight:500; margin-left:auto; }
      .fold > svg { width:13px; height:13px; color:var(--t3); transition:transform .15s; }
      .fold[aria-expanded=true] > svg { transform:rotate(90deg); }
      .minis { display:flex; gap:12px; flex-wrap:wrap; }
      .minis .link { display:inline-flex; align-items:center; gap:4px; }
      .minis .link svg { width:13px; height:13px; }
      .bar-info { padding:7px 10px; }
      .bar-info > svg { width:15px; height:15px; flex:none; }
    </style>
    <div class="w">
      <div class="panel">
        <div class="rz" id="rz" title="Drag to resize"></div>
        <header>
          <img class="logo" src="${LOGO}" alt="" title="JobBid"><span class="brand">JobBid</span>
          <span class="langwrap" style="flex:1;min-width:0">
            <button class="who" id="who" title="Switch profile"><span class="av sm" id="whoAv" translate="no"></span><span class="ellip" id="whoName" translate="no"></span>${svg('down')}</button>
            <span class="menu wide" id="whoMenu" style="left:0;right:auto"></span></span>
          <span class="langwrap"><button class="ib" id="more" title="More">${svg('dots')}</button>
            <span class="menu wide" id="moreMenu">
              <div class="mwho" id="mWho" translate="no"></div>
              <button id="mDash">${svg('gear')}Dashboard & settings</button>
              <button id="mSignOut">${svg('user')}Sign out</button>
              <button id="bug">${svg('bug')}Copy debug info</button>
              <div class="msep"></div><div class="mcap">Language</div>
              <span class="langs" role="radiogroup" aria-label="Language"><button data-lang-opt="en" role="radio">English</button><button data-lang-opt="ko" role="radio">한국어</button><button data-lang-opt="zh" role="radio">中文</button></span>
            </span></span>
          <button class="ib" id="collapse" title="Hide panel">${svg('chev')}</button>
        </header>
        <nav class="tabs" role="tablist">
          <button data-tab="job" role="tab">${svg('doc')}<span>Job</span></button>
          <button data-tab="match" role="tab" title="How well this profile fits the job">${svg('target')}<span>Match</span></button>
          <button data-tab="apply" role="tab">${svg('send')}<span>Apply</span><span class="badge" id="missBadge" hidden></span></button>
          <button data-tab="profile" role="tab">${svg('user')}<span>Profile</span></button>
          <button data-tab="auto" role="tab" title="Auto bid">${svg('bot')}<span>Auto</span></button>
        </nav>
        <div class="body" id="body"></div>
      </div>
      <button class="tab" id="tab" title="Open JobBid panel"><img src="${LOGO}" alt=""><span class="tb" id="tabBadge"></span></button>
    </div>`;
  (document.documentElement || document.body).appendChild(host);
  // The panel can be thrown out of the page: by an old copy of JobBid left there by an update (it removes
  // "#jobbid-root-panel" by id), or by React sites that rebuild the whole page when they find something they
  // did not draw (Greenhouse's job-boards pages, Remix: "React recovered from an error during hydration").
  // Put it back, and push the page aside again. Checked on changes and every 1.5 s (the page itself may be new).
  const keepPanel = () => {
    if (host.isConnected || !api.alive()) return;
    (document.documentElement || document.body).appendChild(host);
    pushed = '';
    render();
  };
  new MutationObserver(keepPanel).observe(document, { childList: true, subtree: false });
  new MutationObserver(keepPanel).observe(document.documentElement, { childList: true });
  setInterval(keepPanel, 1500);
  const $ = (id) => root.getElementById(id);
  self.jbI18n?.observe(root);

  function svg(n) {
    const paths = {
      bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
      bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13v1M15 13v1M9.5 17h5"/><circle cx="12" cy="3.5" r="1"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
      chev: '<path d="m9 6 6 6-6 6"/>',
      check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
      excl: '<path d="M12 6v8M12 18v.1"/>',
      dash: '<path d="M7 12h10"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
      spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
      warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
      cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
      err: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
      doc: '<path d="M6 2.5h8l5 5v14H6z"/><path d="M14 2.5v5h5M9 13h7M9 17h5"/>',
      send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
      bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M9 4l1 3M15 4l-1 3M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>',
      building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
      pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
      up: '<path d="m6 12 6-6 6 6M6 18l6-6 6 6"/>',
      brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      money: '<path d="M8 4h8l-2 4h-4z"/><path d="M10 8c-4 2-6 6-6 9a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3c0-3-2-7-6-9"/><path d="M12 12v6M10 13.5c0-.8.9-1.5 2-1.5s2 .7 2 1.5-.9 1.2-2 1.5-2 .7-2 1.5.9 1.5 2 1.5 2-.7 2-1.5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
      phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
      shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z"/>',
      refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
      down: '<path d="m6 9 6 6 6-6"/>',
      dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      save: '<path d="M12 5v14M5 12h14"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
      alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.1"/>',
      clip: '<path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[n]}</svg>`;
  }

  // ---------- State & rendering ----------

  let data = { profiles: [], settings: {}, schedule: null, applications: [], panelCollapsed: undefined, panelTab: '' };
  let pickedResume = ''; // resume chosen in the Apply tab's picker (this page only)
  let coverText = '';
  let coverFor = ''; // the job the cover letter was written for; another job never shows it
  const jobKeyOf = (j) => j.url.split('#')[0] + '|' + j.title + '|' + j.company;
  let applied = [];
  let showOptional = false;
  let missIdx = 0; // which missing field "go to next" jumps to

  // "You already applied before!" (this profile) or "<other> applied before" (another profile), with when.
  const minsAgo = (d) => { const m = Math.floor((Date.now() - new Date(d)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`; };
  const ago = (d) => { const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
  const appliedHtml = () => {
    if (!applied.length) return '';
    const me = activeProfile();
    const mine = applied.find((a) => a.profileId === me?.id);
    const a = mine || applied[0];
    const when = `${new Date(a.date).toLocaleDateString(self.jbI18n?.locale)} · ${ago(a.date)}`;
    return `<div class="applied ${mine ? '' : 'other'}">${svg('alert')}<div class="grow"><b>${mine ? 'You already applied before!' : `${esc(a.profileName)} applied before`}</b>
      <span class="when">${esc(when)}${applied.length > 1 ? ` · ${applied.length} applications` : ''}</span></div></div>`;
  };
  // "Bid by Alice, Bob · last 11/4" (the hub's Job links): teammates who applied to this job. A notice
  // only - you can still fill and apply. Your own bids show in the line above instead.
  let teamBids = { bids: [], choices: [] };
  const teamHtml = () => {
    const others = (teamBids.bids || []).filter((b) => !b.me);
    const planned = (teamBids.choices || []).filter((c) => c.choice === 'bid' && !(teamBids.bids || []).some((b) => b.me && b.userId === c.userId));
    if (!others.length && !planned.length) return '';
    // "Filling" = a teammate pressed Fill on this job (maybe right now); the rest were sent.
    const list = (arr) => { const n = [...new Set(arr.map((b) => b.user))]; return `${n.slice(0, 3).join(', ')}${n.length > 3 ? ` +${n.length - 3}` : ''}`; };
    const sent = others.filter((b) => b.step !== 'fill');
    const busy = others.filter((b) => b.step === 'fill');
    const last = sent.reduce((m, b) => (b.date > m ? b.date : m), '');
    const head = sent.length ? `Bid by ${list(sent)}` : busy.length ? `${list(busy)} started this job` : 'Not bid yet';
    const when = last ? `last ${new Date(last).toLocaleDateString(self.jbI18n?.locale)} · ${ago(last)}` : '';
    const since = (d) => (Date.now() - new Date(d) < 864e5 ? minsAgo(d) : ago(d)); // "5m ago" today, else "2 days ago"
    const filling = busy.length ? `${sent.length ? `${list(busy)} filling` : 'filling'} ${since(busy[0].date)}` : '';
    const will = planned.length ? `Will bid: ${[...new Set(planned.map((c) => c.user))].join(', ')}` : '';
    return `<div class="applied other team">${svg('alert')}<div class="grow"><b>${esc(head)}</b>
      <span class="when">${esc([when, filling, will].filter(Boolean).join(' · '))}</span></div></div>`;
  };
  // Job tab: { key, status: 'loading' | 'done', details, error }
  let jobState = { key: '' };

  async function loadData() {
    data = { ...data, ...(await store.get(['profiles', 'settings', 'schedule', 'applications', 'panelCollapsed', 'panelTab', 'keyHealth', 'ipInfo', 'panelWidth', 'hubConfig', 'hubState', 'panelPos', 'tabTop', 'aiStatus', 'extUpdate'])) };
    panelW = clampW(data.panelWidth);
    pos = data.panelPos && Number.isFinite(data.panelPos.x) ? data.panelPos : null;
    tabTop = Number.isFinite(data.tabTop) ? data.tabTop : null;
    data.profiles ||= [];
    data.settings ||= {};
    data.applications ||= [];
  }

  const activeProfile = () => data.profiles.find((p) => p.id === data.settings.activeProfileId) || data.profiles[0];
  const pname = (p) => p?.label || p?.fullName || 'Profile';
  const initials = (n) => { const w = String(n || '?').trim().split(/\s+/); return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  // Each person keeps the same colour everywhere, so the active profile is recognisable at a glance.
  // Same palette and hashing as the dashboard (ui.js), so a person has one colour everywhere.
  const AV_COLORS = [
    ['#4f46e5', '#7c3aed'], ['#0f6cbd', '#1d4ed8'], ['#0e7490', '#0f766e'], ['#047857', '#15803d'],
    ['#9a3412', '#c2410c'], ['#9f1239', '#be123c'], ['#7e22ce', '#a21caf'], ['#334155', '#475569'],
    ['#4338ca', '#6d28d9'], ['#166534', '#0d9488'], ['#1e40af', '#0e7490'], ['#831843', '#9d174d'],
  ];
  const avColor = (p) => { let h = 0; for (const c of String(pname(p))) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; };
  const avatar = (p, cls = '', dot = false) => {
    const [a, b] = avColor(p);
    return `<span class="av ${cls}" translate="no" style="background:linear-gradient(135deg,${a},${b});--avc:${a}">${esc(initials(pname(p)))}${dot ? '<i class="dot"></i>' : ''}</span>`;
  };

  function currentBlock() {
    const s = data.schedule;
    if (!s?.blocks?.length) return null;
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [h, mm] = String(t).split(':').map(Number); return h * 60 + mm; };
    return s.blocks.find((b) => (b.days || []).includes(now.getDay()) && toMin(b.start) <= m && m < toMin(b.end));
  }

  // 'none' = no API key (AI features off), 'dead' = every key failed, '' = AI usable.
  function aiDown() {
    const s = data.settings, kh = data.keyHealth || {};
    if (s.chatgptWeb === 'backup' || s.chatgptWeb === 'only') return '';
    if (!Array.isArray(s.aiKeys)) return s.apiKey || Object.values(s.keys || {}).some(Boolean) ? '' : 'none';
    const keys = s.aiKeys.filter((k) => k.enabled !== false && k.key);
    return !keys.length ? 'none' : keys.every((k) => kh[k.id] && !kh[k.id].ok) ? 'dead' : '';
  }

  // Public IP vs. the profile's country (free text like "US" / "USA" / "United States").
  const ALIASES = { US: ['usa', 'united states', 'united states of america', 'america'], GB: ['uk', 'united kingdom', 'england', 'great britain'], KR: ['korea', 'south korea'], CN: ['china'] };
  function ipHtml(p) {
    const ip = data.ipInfo;
    if (!ip?.ip) return '';
    const pc = String(p?.country || '').trim().toLowerCase();
    const code = String(ip.country || '').toUpperCase();
    const match = !pc || !code ? null : pc === code.toLowerCase() || pc === String(ip.countryName || '').toLowerCase() || (ALIASES[code] || []).includes(pc);
    const place = [ip.city, ip.country].filter(Boolean).join(', ');
    const tip = match === false ? `Profile country is ${p.country}, but this IP is in ${ip.countryName || code}` : match ? 'Matches the profile country' : ip.org || '';
    return `<div class="ipline ${match === false ? 'warn' : match ? 'ok' : ''}" id="ipline" title="${esc(tip)}">${svg('globe')}<span class="grow ellip">IP ${esc(ip.ip)}${place ? ' · ' + esc(place) : ''}</span>${match === false ? '<b>!</b>' : ''}</div>`;
  }

  let frameWindows = [];
  function allItems() {
    const items = summarize();
    frameWindows = [...frameReports.keys()].filter((w) => !w.closed);
    frameWindows.forEach((w, fi) => items.push(...frameReports.get(w).map((x) => ({ ...x, frame: fi + 1 }))));
    for (const x of items) x.key = `${x.frame || 0}:${x.id}`;
    return items;
  }

  // An application form, not just a search box: a resume upload, personal-detail fields, or (a later
  // step of a multi-page application) two or more screening questions.
  function hasForm(items) {
    return items.some((x) => x.name === 'Resume/CV') || (items.length >= 3 && items.some((x) => /name|e-?mail|phone|linkedin/i.test(x.name)))
      || items.filter((x) => x.question).length >= 2;
  }

  // Start (or reuse) the AI analysis for the job on this page; heuristics show instantly meanwhile.
  function ensureJobAnalysis(job, force = false) {
    const key = job.url.split('#')[0] + '|' + job.title;
    if (!force && jobState.key === key) return;
    const base = guessDetails(job);
    // Real job postings go to the hub's job board (when the hub is switched on).
    const report = (details) => job.found !== 'none' && api.send({ type: 'hubJobSeen', job: { title: job.title, company: job.company, url: job.url, description: job.description }, details });
    // The AI reads the posting only when the user clicks "Analyze with AI" (force).
    if (aiDown() || !force) {
      jobState = { key, status: 'done', details: base, ai: false };
      report(base);
      return;
    }
    jobState = { key, status: 'loading', details: base };
    api.send({ type: 'analyzeJob', job: { title: job.title, company: job.company, url: job.url, description: job.description }, force }).then((r) => {
      if (jobState.key !== key) return;
      const ai = r.ok ? Object.fromEntries(Object.entries(r.details || {}).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))) : {};
      jobState = { key, status: 'done', details: { ...base, ...ai }, ai: r.ok, error: r.ok ? '' : r.error };
      report(jobState.details);
      if (data.panelTab === 'job' || !data.panelTab) render();
    });
  }

  function jobTab(p) {
    const job = api.getJob();
    ensureJobAnalysis(job);
    const d = jobState.details || guessDetails(job);
    const loading = jobState.status === 'loading';
    const match = skillMatch(job, p);
    const sk = (w, h = 14) => `<div class="sk" style="width:${w};height:${h}px"></div>`;
    const row = (icon, value, empty) => `<div class="drow ${value ? '' : 'muted'}">${svg(icon)}<span class="v grow">${value ? esc(value) : (loading ? '' : esc(empty))}</span></div>`;
    const r = 20, circ = 2 * Math.PI * r;
    const ringColor = !match ? '' : match.pct >= 70 ? 'var(--ok)' : match.pct >= 40 ? 'var(--warn)' : 'var(--err)';

    if (loading && !d.title) {
      return `<div class="cap">Job details</div>
        ${sk('100%', 22)}${sk('60%')}
        <div class="pair">${sk('100%')}${sk('70%')}</div><div class="pair">${sk('80%')}${sk('80%')}</div>${sk('70%')}${sk('70%')}${sk('100%', 40)}
        <div class="thinking"><span class="spin"></span>Understanding job context...</div>`;
    }
    const blank = (v) => (loading ? '<span class="sk" style="display:inline-block;width:70%;height:12px;vertical-align:middle"></span>' : '');
    const detail = (icon, value, empty) => value ? row(icon, value, empty) : `<div class="drow muted">${svg(icon)}<span class="v grow">${loading ? blank() : esc(empty)}</span></div>`;
    return `
      <div class="cap">Job details</div>
      <div>
        <div class="jtitle" translate="no">${esc(d.title || job.title)}</div>
        <div class="drow" style="margin-top:6px">${svg('building')}<span class="v grow" translate="no">${d.company ? esc(d.company) : '<span style="color:var(--t3)">No company listed</span>'}</span></div>
      </div>
      ${appliedHtml()}${teamHtml()}
      <div class="card" style="display:flex;flex-direction:column;gap:9px">
        ${detail('pin', d.location ? d.location + (d.workMode ? '' : '') : '', 'Location not listed').replace('</span></div>', d.workMode ? `<span class="pill">${esc(d.workMode)}</span></span></div>` : '</span></div>')}
        <div class="pair">${detail('up', d.seniority, 'Level not listed')}${detail('brief', d.employmentType, 'Type not listed')}</div>
        ${detail('money', d.salary, 'Salary not listed')}
        ${detail('cal', d.posted ? `Posted ${d.posted}` : '', 'Post date not listed')}
        ${d.deadline ? row('clock', `Apply by ${d.deadline}`, '') : ''}
        ${d.visaSponsorship ? row('shield', `Visa sponsorship: ${d.visaSponsorship}`, '') : ''}
      </div>
      ${d.summary ? `<div class="summary" translate="no">${esc(d.summary)}</div>` : loading ? sk('100%', 36) : ''}
      ${match ? `<div class="card match">
          <div class="ring" title="Skill match: ${match.have.length} of ${match.wanted.length} skills in the job description">
            <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--bg)" stroke-width="5"/>
            <circle cx="26" cy="26" r="${r}" fill="none" stroke="${ringColor}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(match.pct / 100) * circ} ${circ}"/></svg>${match.pct}%</div>
          <div class="grow"><div style="display:flex;align-items:center;margin-bottom:4px"><b class="grow">Skill match</b><button class="link" id="toMatch">Full match</button></div>
            <div class="chips" translate="no">${match.have.slice(0, 8).map((s) => `<span class="chip">${esc(skillName(s))}</span>`).join('')}${match.related.slice(0, 4).map((s) => `<span class="chip rel" title="A related skill is in the profile">${esc(skillName(s))}</span>`).join('')}${match.missing.slice(0, 5).map((s) => `<span class="chip miss" title="Not in ${esc(pname(p))}'s profile">${esc(skillName(s))}</span>`).join('')}</div></div>
        </div>` : ''}
      ${loading ? `<div class="thinking"><span class="spin"></span>Understanding job context...</div>`
        : `<div class="row" style="display:flex;align-items:center;gap:8px;color:var(--t3);font-size:11px">${jobState.ai ? 'Analyzed by AI' : jobState.error ? 'AI unavailable - details read from the page' : 'Details read from the page'}
            <span style="flex:1"></span>${aiDown() ? '' : `<button class="link" id="reanalyze">${jobState.ai ? 'Re-analyze' : 'Analyze with AI'}</button>`}</div>`}`;
  }

  // Match tab: { key, status: 'idle' | 'loading' | 'done', ai, error } - the overall fit (quick from the profile, or AI).
  let matchState = { key: '' };
  const matchKeyOf = (job, p) => job.url.split('#')[0] + '|' + job.title + '|' + p.id;
  function runMatchAI(job, p, force) {
    const key = matchKeyOf(job, p);
    const prev = matchState.key === key ? matchState.ai : null;
    matchState = { key, status: 'loading', ai: prev };
    render();
    api.send({ type: 'analyzeMatch', profile: p, job: { title: job.title, company: job.company, url: job.url, description: job.description }, force }).then((r) => {
      if (matchState.key !== key) return;
      matchState = r.ok ? { key, status: 'done', ai: r.match } : { key, status: 'done', error: r.error || 'AI failed', ai: prev };
      render();
    });
  }

  // ---------- Estimated ATS match (ats.js in the background reads the resume file itself) ----------
  // atsState: the score of the profile's resume file for this job. atsMade: the optimizer's last file for this
  // job (kept only in this page, until it is used for the application).
  let atsState = { key: '', status: 'idle' };
  let atsMade = { key: '', file: null, before: null, after: null, used: '' };
  let atsPick = ''; // resume chosen in the Match tab
  const atsResumeId = (p) => {
    const list = p.resumes || [];
    const id = atsPick || pickedResume || api.chooseResume(p)?.id || '';
    return list.some((r) => r.id === id) ? id : list[0]?.id || '';
  };
  const atsKeyOf = (job, p) => matchKeyOf(job, p) + '|' + atsResumeId(p);
  const atsJob = (job) => ({ title: job.title, company: job.company, url: job.url, description: job.description });
  // A score made before (the job already read by the AI) shows again without asking the AI.
  function atsLoad(job, p) {
    const key = atsKeyOf(job, p);
    if (atsState.key === key) return;
    atsState = { key, status: 'idle' };
    if (!atsResumeId(p)) return;
    api.send({ type: 'atsScore', cachedOnly: true, profile: p, resumeId: atsResumeId(p), job: atsJob(job) }).then((r) => {
      if (atsState.key !== key || atsState.status !== 'idle') return;
      if (r.ok && r.result) { atsState = { key, status: 'done', res: r.result }; if (data.panelTab === 'match') render(); }
    });
  }
  function runAts(force) {
    const job = api.getJob(), p = activeProfile();
    const key = atsKeyOf(job, p);
    atsState = { key, status: 'loading', res: atsState.key === key ? atsState.res : null };
    render();
    api.send({ type: 'atsScore', force, profile: p, resumeId: atsResumeId(p), job: atsJob(job) }).then((r) => {
      if (atsState.key !== key) return;
      atsState = r.ok && r.result ? { key, status: 'done', res: r.result } : { key, status: 'error', error: r.error || 'Failed', res: atsState.res };
      render();
    });
  }
  // The optimized file goes into this form's resume box, or waits (session only) for the application form.
  async function useOptimized(file) {
    const p = activeProfile();
    const slot = allItems().find((x) => x.name === 'Resume/CV');
    if (slot) {
      const n = await uploadFixed(slot, file);
      if (n) { atsMade.used = 'uploaded'; setTimeout(schedule, 600); render(); return `${file.name} (score ${file.score}) is in this form's resume box. Only for this application.`; }
      return 'The site would not take the upload. Download it and use the site\'s own upload button.';
    }
    await api.send({ type: 'holdFixedResume', file, profileId: p.id });
    atsMade.used = 'held';
    render();
    return `${file.name} (score ${file.score}) goes into the application form's resume box when you open it and press Fill. Only for this application.`;
  }
  async function uploadFixed(slot, file) {
    if (slot.frame) { frameWindows[slot.frame - 1]?.postMessage({ __jobbid: 'attach', fixed: file }, '*'); return 1; }
    return api.attachResumeNow('', file);
  }
  function openOptimizer(step) {
    const job = api.getJob(), p = activeProfile();
    const opt = window.__jobbidOptimizer;
    if (!opt) return api.toast({ kind: 'warn', title: 'Reload the page', msg: 'The optimizer was added after this page opened.', ms: 6000 });
    if (atsState.status !== 'done') return;
    const key = atsState.key;
    opt.open({
      api, profile: p, job: atsJob(job), resumeId: atsResumeId(p), result: atsState.res, step, theme: data.settings.theme, useFile: useOptimized,
      onScored: (res) => { if (atsState.key === key) { atsState = { key, status: 'done', res }; render(); } },
      onBuilt: (b) => { atsMade = { key, file: b.file, before: b.history[0], after: b.after.score, used: '' }; render(); },
    });
  }
  function downloadFile(f) {
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: f.type }));
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function atsCard(p, job) {
    atsLoad(job, p);
    const list = p.resumes || [];
    const pick = list.length > 1 ? `<select id="atsResume" class="mini" title="Resume file to score">${list.map((r) => `<option value="${esc(r.id)}" ${r.id === atsResumeId(p) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>` : '';
    if (!list.length) return `<div class="card"><b>Estimated ATS match</b><div class="t2" style="margin-top:4px">Add a resume file (PDF or Word) to ${esc(pname(p))} in the dashboard to score it against this job.</div></div>`;
    const s = atsState;
    const st = data.aiStatus || {};
    if (s.status === 'loading') {
      return `<div class="card"><b>Estimated ATS match</b><div class="thinking" style="margin-top:6px"><span class="spin"></span>${esc((st.state === 'working' && st.stage) || 'Reading the job and the resume...')}</div></div>`;
    }
    if (s.status !== 'done') {
      return `<div class="card"><div class="ats"><div class="grow"><b>Estimated ATS match</b>
          <div class="t2">Checks your resume file against this job's requirements: keywords, skills shown in experience, title, years, education and layout. The AI reads the job once; the scoring itself is the same every time.</div></div></div>
        ${s.status === 'error' ? `<div class="bar-info err" style="margin-top:8px">${svg('alert')}<span class="grow">${esc(s.error)}</span></div>` : ''}
        <div class="acts" style="margin-top:8px">${pick}${aiDown() ? '<span class="t2">Needs a working AI key to read the job.</span>' : `<button id="atsRun">${svg('target')}${s.status === 'error' ? 'Try again' : 'Score my resume'}</button>`}</div></div>`;
    }
    const r = s.res.report;
    const made = atsMade.key === s.key && atsMade.file;
    const miss = r.requirements.filter((x) => x.status === 'missing' && x.category !== 'responsibility');
    const part = r.requirements.filter((x) => x.status === 'partial' && x.category !== 'responsibility');
    const listed = r.requirements.filter((x) => x.status === 'matched' && !x.demonstrated && x.category !== 'responsibility' && x.category !== 'soft');
    const c = (v) => (v >= 75 ? 'var(--ok)' : v >= 55 ? 'var(--warn)' : 'var(--err)');
    const chip = (x, cls) => `<span class="chip ${cls}" title="${esc(x.importance)}${x.via ? ' · related: ' + esc(x.via) : ''}">${esc(x.term)}</span>`;
    return `<div class="card">
        <div class="ats"><div class="grow"><b>Estimated ATS match</b><div class="t2 ellip" translate="no">${esc(s.res.resume.name)} · an estimate, not the employer's score</div></div>
          <div class="num" style="color:${c(r.score)}">${Math.round(r.score)}<small>/100</small></div></div>
        ${made ? `<div class="bar-info" style="margin-top:8px">${svg('check')}<span class="grow">Optimized version: <b>${Math.round(atsMade.after)}</b> (was ${Math.round(atsMade.before)})${atsMade.used === 'uploaded' ? ' · uploaded' : atsMade.used === 'held' ? ' · waiting for the form' : ''}</span>
          <button class="link" id="atsUse">Use</button><button class="link" id="atsDown">Download</button></div>` : ''}
        <div class="mbars">${r.components.map((x) => { const pct = x.max ? Math.round((x.points / x.max) * 100) : 0; return `<div class="mbar"><span>${esc(x.label)}</span><b style="color:${c(pct)}">${Math.round(x.points * 10) / 10}/${Math.round(x.max)}</b><span class="tr"><i style="width:${pct}%;background:${c(pct)}"></i></span></div>`; }).join('')}</div>
        <div class="grp" style="margin-top:12px">Requirements: ${r.counts.matched} matched · ${r.counts.partial} partly · ${r.counts.missing} missing</div>
        ${miss.length ? `<div class="chips" translate="no">${miss.slice(0, 10).map((x) => chip(x, 'miss')).join('')}${miss.length > 10 ? `<span class="chip miss">+${miss.length - 10}</span>` : ''}</div>` : ''}
        ${part.length ? `<div class="chips" translate="no" style="margin-top:4px">${part.slice(0, 8).map((x) => chip(x, 'close')).join('')}</div>` : ''}
        ${listed.length ? `<div class="t2" style="margin-top:6px;font-size:11.5px">Listed but not shown in work experience: ${listed.slice(0, 6).map((x) => esc(x.term)).join(', ')}</div>` : ''}
        ${r.warnings.length ? `<div class="bar-info warn" style="margin-top:8px">${svg('warn')}<span class="grow">${r.warnings.length} formatting warning${r.warnings.length === 1 ? '' : 's'}: ${esc(r.warnings[0])}</span></div>` : ''}
        <div class="acts" style="margin-top:10px">${pick}<button id="atsDetail" class="ghost">Details</button><button id="atsOpt">${svg('spark')}Optimize resume</button></div>
        <div class="row" style="display:flex;align-items:center;gap:8px;color:var(--t3);font-size:11px;margin-top:6px">Job read by AI · resume scored by rules<span style="flex:1"></span><button class="link" id="atsRescore">Re-score</button></div>
      </div>`;
  }

  function matchTab(p) {
    const job = api.getJob();
    if (!job.description || job.description.length < 200) {
      return `<div class="card empty-note">Open a job posting to see how well ${esc(pname(p))} fits it.</div>`;
    }
    const key = matchKeyOf(job, p);
    if (matchState.key !== key) {
      // An earlier AI score for this job and profile shows again without asking the AI.
      matchState = { key, status: 'idle' };
      api.send({ type: 'analyzeMatch', cachedOnly: true, profile: p, job: { title: job.title, company: job.company, url: job.url, description: '' } }).then((r) => {
        if (matchState.key === key && r.ok && r.match && !matchState.ai) { matchState = { key, status: 'done', ai: r.match }; if (data.panelTab === 'match') render(); }
      });
    }
    const quick = matchAnalysis(job, p);
    const ai = matchState.ai;
    const aiNums = ai ? Object.fromEntries(['overall', 'experience', 'skills', 'industry', 'title'].map((k) => [k, ai[k]]).filter(([, v]) => typeof v === 'number')) : {};
    const allZero = Object.keys(aiNums).length >= 4 && Object.values(aiNums).every((v) => v === 0);
    const m = ai ? { ...quick, ...(allZero ? {} : aiNums) } : { ...quick };
    // With the resume scored, the Skills bar is its weighted keyword coverage (the job's own requirements).
    const rep = atsState.key === atsKeyOf(job, p) && atsState.res ? atsState.res.report : null;
    const kwc = rep?.components.find((x) => x.key === 'keywords');
    if (kwc && !ai) m.skills = Math.round((kwc.points / kwc.max) * 100);
    const loading = matchState.status === 'loading';
    const color = (v) => (v >= 75 ? 'var(--ok)' : v >= 55 ? 'var(--warn)' : 'var(--err)');
    const verdict = m.overall >= 80 ? 'Strong match' : m.overall >= 65 ? 'Good match' : m.overall >= 50 ? 'Fair match' : 'Low match';
    const r = 30, circ = 2 * Math.PI * r;
    const bar = (label, v, note) => `<div class="mbar"><span>${label}</span><b style="color:${color(v)}">${v}%</b>
      <span class="tr"><i style="width:${v}%;background:${color(v)}"></i></span>${note ? `<span class="note" translate="no">${esc(note)}</span>` : ''}</div>`;
    const expNote = quick.need != null && quick.yrs != null ? `Job asks ~${quick.need}+ yrs · profile has ${quick.yrs}` : quick.yrs != null ? `Profile has ${quick.yrs} yrs` : '';
    const indNote = (ai?.industries?.length ? ai.industries : quick.jobInd).join(', ');
    const skillNote = kwc && !ai ? `${rep.counts.matched} of ${rep.counts.total} job requirements in the resume` : '';
    const li = (arr) => `<ul class="mlist">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    // How to improve: the score's biggest deductions once the resume is scored.
    const tips = ai?.tips?.length ? ai.tips : rep ? rep.components.flatMap((x) => x.deductions.map((d) => ({ ...d }))).sort((a, b) => b.points - a.points).slice(0, 4).map((d) => `${d.text} (-${d.points})`)
      : quick.tips.filter((t) => !/^Add these words/.test(t));
    return `
      <div class="cap">Match for ${esc(pname(p))}</div>
      <div class="card">
        <div class="mhead">
          <div class="ring"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--bg)" stroke-width="7"/>
            <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color(m.overall)}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(m.overall / 100) * circ} ${circ}"/></svg>${m.overall}%</div>
          <div class="grow"><div class="mverdict" style="color:${color(m.overall)}">${verdict}</div>
            <div class="t2 ellip" translate="no">${esc(job.title)}${job.company ? ' · ' + esc(job.company) : ''}</div>
            ${ai?.verdict ? `<div class="t2" style="margin-top:4px">${esc(ai.verdict)}</div>` : ''}</div>
        </div>
        <div class="mbars">
          ${bar('Experience level', m.experience, expNote)}
          ${bar('Skills', m.skills, skillNote)}
          ${bar('Industry experience', m.industry, indNote ? `Job: ${indNote}` : 'No specific industry in the posting')}
          ${bar('Job title', m.title, quick.myTitle ? `Yours: ${quick.myTitle}` : '')}
        </div>
        ${loading ? `<div class="thinking"><span class="spin"></span>AI is scoring the fit...</div>`
    : `<div class="row" style="display:flex;align-items:center;gap:8px;color:var(--t3);font-size:11px;margin-top:8px">${matchState.error ? `AI failed: ${esc(matchState.error)}` : ai ? 'Fit scored by AI from the profile' : 'Quick fit from the profile'}
            <span style="flex:1"></span>${aiDown() ? '' : `<button class="link" id="matchAI">${ai ? 'Re-score' : 'Score with AI'}</button>`}</div>`}
      </div>
      ${atsCard(p, job)}
      ${ai?.strengths?.length ? `<div class="card"><b>Strengths</b>${li(ai.strengths)}</div>` : ''}
      ${(ai?.gaps?.length || 0) + tips.length ? `<div class="card">
          ${ai?.gaps?.length ? `<b>Gaps</b>${li(ai.gaps)}` : ''}
          <b style="display:block;${ai?.gaps?.length ? 'margin-top:8px' : ''}">How to improve</b>${li(tips)}</div>` : ''}`;
  }

  // Apply tab: the optimizer's file for this job, ready to use; else a way to make one.
  function optimizedRow() {
    const job = api.getJob(), p = activeProfile();
    if (atsMade.file && p && atsMade.key.startsWith(matchKeyOf(job, p))) {
      return `<div class="bar-info" style="margin-top:8px">${svg('check')}<span class="grow">Optimized resume for this job: score <b>${Math.round(atsMade.after)}</b>${atsMade.used === 'uploaded' ? ' · uploaded' : ''}</span><button class="link" id="atsUse">Use</button><button class="link" id="atsDown">Download</button></div>`;
    }
    if ((job.description || '').length >= 200 && !aiDown()) return `<div class="minis" style="margin-top:6px"><button class="link" id="toMatch">${svg('target')}Score and optimize the resume for this job</button></div>`;
    return '';
  }

  function applyTab(p, items) {
    // Moved to another job (e.g. LinkedIn changes jobs without reloading): drop the old letter.
    if (coverText && coverFor !== jobKeyOf(api.getJob())) coverText = '';
    const req = items.filter((x) => x.required);
    const reqDone = req.filter((x) => x.status !== 'missing' && x.status !== 'empty').length;
    const pct = req.length ? Math.round((reqDone / req.length) * 100) : 100;
    const down = aiDown();
    const block = currentBlock();
    const blockProfile = block && data.profiles.find((x) => x.id === block.profileId);
    const itemHtml = (x) => `<button class="item" translate="no" data-i="${x.id}" data-frame="${x.frame || ''}" title="${esc(x.name)}">
      <span class="st ${x.status}">${svg({ done: 'check', file: 'check', ai: 'spark', missing: 'excl', empty: 'dash' }[x.status])}</span>
      <span class="nm">${esc(x.name)}</span>${x.status === 'ai' ? '<span class="tag">AI</span>' : ''}${(x.status === 'missing' || x.status === 'empty') && x.ownWords ? '<span class="tag" title="This question asks for your own words - no AI">✍ own words</span>' : (x.status === 'missing' || x.status === 'empty') && !down && !x.isFile ? `<span class="tag ask" data-ai="1" role="button" title="Ask AI to answer this question">${aiAsking.has(x.key) ? '...' : svg('spark') + 'AI'}</span>` : ''}</button>`;
    const opt = items.filter((x) => !x.required);
    const optDone = opt.filter((x) => x.status !== 'missing' && x.status !== 'empty').length;
    const missing = req.filter((x) => x.status === 'missing');
    const optEmpty = opt.filter((x) => x.status === 'empty' && !x.ownWords && !x.isFile);
    // Optional fields stay folded until opened (or when there is nothing required to show).
    const optOpen = showOptional || !req.length;
    return `
      ${items.length ? '' : appliedHtml()}
      ${blockProfile && blockProfile.id !== p.id ? `<div class="bar-info warn">${svg('cal')}<div class="grow">Scheduled now: <b>${esc(pname(blockProfile))}</b> until ${esc(block.end)}</div>
        <button class="link" id="switchNow">Switch</button></div>` : ''}
      ${down ? `<div class="bar-info err">${svg('err')}<div class="grow"><b>AI not working</b> · ${down === 'none'
        ? 'profile and saved answers still fill.'
        : 'every key failed.'} <a id="fixAi">${down === 'none' ? 'Add a key' : 'Fix keys'}</a></div></div>` : ''}
      ${items.length ? `
        <div class="card fillcard">
          <div>
            <div class="prog-head"><span class="grow"><b>${reqDone}/${req.length}</b> required fields filled</span><b>${pct}%</b></div>
            <div class="prog"><i style="width:${pct}%"></i></div>
          </div>
          <button class="fill" id="fill"${fillBusy() ? ' disabled' : ''}>${svg('bolt')}${fillBusy() ? 'Filling...' : reqDone ? 'Fill again' : 'Fill application'}</button>
          ${appliedHtml()}${teamHtml()}
          ${aiStatusHtml()}
          ${!missing.length && optEmpty.length && !down ? `<button class="next ai" id="aiOptional">${svg('spark')}${aiAsking.size ? 'AI is answering...' : `Answer ${optEmpty.length} optional with AI`}</button>` : ''}
          ${missing.length && !down ? `<button class="next ai" id="aiMissing">${svg('spark')}${aiAsking.size ? 'AI is answering...' : missing.length === 1 ? 'Answer it with AI' : `Answer ${missing.length} with AI`}</button>` : ''}
          ${missing.length ? `<button class="next" id="nextMissing">${svg('arrow')}${missing.length === 1 ? '1 field needs you' : `${missing.length} fields need you`} - go to next</button>` : ''}
        </div>
        ${resumeCard(p, items)}
        <div class="card">
          ${req.length ? `<div class="grp">Required</div>${req.map(itemHtml).join('')}` : ''}
          ${opt.length ? `<button class="fold" id="foldOpt" aria-expanded="${optOpen}">${svg('chev')}Optional<span class="tag">${optDone}/${opt.length}</span></button>${optOpen ? opt.map(itemHtml).join('') : ''}` : ''}
        </div>`
        : `<div class="card empty-note">No application form on this page yet. Click the job's Apply button, then come back to this tab.</div>`}
      <div class="acts"><button id="log">Log application</button><button id="cover" ${down === 'none' ? 'disabled title="Add an AI key in the dashboard to write cover letters"' : ''}>Cover letter</button></div>
      ${optimizedRow()}
      ${items.some((x) => x.status === 'missing' || x.status === 'empty') ? `<div class="minis"><button class="link" id="saveQs" title="Add every unanswered question on this page to Saved answers">${svg('save')}Save unanswered questions</button></div>` : ''}
      ${coverText ? `<div class="card"><div class="grp" style="margin-top:0">Cover letter</div><textarea id="coverText">${esc(coverText)}</textarea>
        <div style="display:flex;gap:10px;margin-top:6px"><button class="link" id="copyCover">Copy</button><button class="link" style="color:var(--t2)" id="closeCover">Close</button></div></div>` : ''}`;
  }

  // Which resume goes into this page's upload, with a picker to change it and re-attach.
  function resumeCard(p, items) {
    const slot = items.find((x) => x.name === 'Resume/CV');
    const seen = new Set();
    const list = (p.resumes || []).filter((r) => !seen.has(r.name) && seen.add(r.name));
    if (!slot || !list.length) return '';
    const auto = api.chooseResume(p);
    const sel = list.find((r) => r.id === pickedResume) || list.find((r) => r.name === auto?.name) || list[0];
    const ok = slot.status === 'file' || slot.status === 'done';
    return `<div class="card resume">
      <div class="rhead">${svg('clip')}<b class="grow">Resume</b>
        <span class="rstate ${ok ? (slot.fixed ? 'ai' : 'ok') : ''}">${ok ? `${svg(slot.fixed ? 'spark' : 'check')}<span class="ellip" translate="no">${esc(slot.fixed ? 'AI-fixed' : (slot.file || 'Attached'))}</span>` : 'Not attached'}</span></div>
      <div class="rrow${ok && slot.fixed ? ' select-fixed' : ''}"><select id="resPick" translate="no" title="${ok && slot.fixed ? 'AI-fixed version attached for this job' : ''}">${list.map((r) => `<option value="${esc(r.id)}" ${r.id === sel.id ? 'selected' : ''}>${esc(r.name)}${ok && slot.fixed && r.id === sel.id ? ' · AI-fixed' : ''}</option>`).join('')}</select>
        <button class="rbtn" id="resAttach" data-frame="${slot.frame || ''}">${ok ? 'Replace' : 'Attach'}</button></div>
      ${ok && slot.fixed ? `<div class="rfixed">${svg('spark')}<span class="grow">AI-fixed for this job (one use, not saved). Replace puts the original back.</span></div>` : ''}
    </div>`;
  }

  // ---------- Auto bid tab: the hub's auto-bid queue (settings are saved in the hub) ----------
  let bidView = null, bidErr = '', bidLoading = false;
  const BID_LABEL = { queued: 'Waiting', running: 'Working...', submitted: 'Submitted', review: 'Ready for you', needs: 'Needs you', skipped: 'Skipped', failed: 'Failed' };
  async function loadBid() {
    if (bidLoading || !api.alive()) return;
    bidLoading = true;
    const r = await api.send({ type: 'autobid', action: 'get' }).finally(() => (bidLoading = false));
    if (r.ok) { bidView = r.view; bidErr = ''; } else bidErr = r.error || 'Hub not reachable';
    if (data.panelTab === 'auto' && !root.activeElement?.classList?.contains('bidIn')) render();
  }
  async function bidAct(action, body = {}) {
    const r = await api.send({ type: 'autobid', action, body });
    if (!r.ok) { api.toast({ kind: 'err', title: 'Auto bid', msg: r.error, ms: 8000 }); return; }
    bidView = r.view;
    const st = r.view.stats;
    if (action === 'start' && st) {
      api.toast(st.added
        ? { kind: 'ok', title: `Auto bid started: ${st.added} job${st.added === 1 ? '' : 's'} added`, msg: [st.unsupported && `${st.unsupported} on sites not supported yet`, st.applied && `${st.applied} already applied`, st.company && `${st.company} company taken by another profile`].filter(Boolean).join(' · '), ms: 7000 }
        : { kind: r.view.config.running ? 'info' : 'warn', title: r.view.config.running ? 'Auto bid continues' : 'No jobs for the queue',
          msg: `The queue takes Qualified jobs from the hub's Job board on Greenhouse, Lever and Ashby.${st.unsupported ? ` ${st.unsupported} Qualified job${st.unsupported === 1 ? ' is' : 's are'} on other sites (Workday...).` : ''}${st.applied ? ` ${st.applied} already applied.` : ''}${st.company ? ` ${st.company} skipped: company taken by another profile.` : ''}${st.already ? ` ${st.already} already in the list.` : ''} For the job on this page, use "Auto-apply this job".`, ms: 14000 });
    }
    render();
  }
  // Refresh while the tab is on screen.
  setInterval(() => { if (data.panelTab === 'auto' && document.visibilityState === 'visible' && !data.hubConfig?.offline) loadBid(); }, 5000);

  // "Auto-apply this job": what it is doing right now, and how it ended, right under the button.
  // content.js reports each step through window.__jobbidBidStatus (same page, same extension world).
  let bidLocal = null; // { text, note, kind: 'run' | 'ok' | 'warn' | 'err' }
  const bidHereButton = (style) => bidLocal?.kind === 'run'
    ? `<button class="fill" id="bidHere" disabled style="width:100%;box-sizing:border-box;opacity:.7;cursor:default;${style}">${svg('bolt')}Auto-applying...</button>`
    : `<button class="fill" id="bidHere" style="width:100%;box-sizing:border-box;${style}">${svg('bolt')}Auto-apply this job</button>`;
  function bidStatusHtml() {
    const b = bidLocal;
    if (!b) return '<div id="bidStatus"></div>';
    if (b.kind === 'run') {
      return `<div id="bidStatus" class="fixlive bidst"><div class="fixrow"><b class="fixdots">${esc(b.text)}</b></div>${b.note ? `<div class="fixstage">${esc(b.note)}</div>` : ''}</div>`;
    }
    return `<div id="bidStatus" class="fixlive bidst ${b.kind}">${svg(b.kind === 'ok' ? 'check' : 'alert')}<div class="grow"><b>${esc(b.text)}</b>${b.note ? `<div class="t2">${esc(b.note)}</div>` : ''}</div></div>`;
  }
  window.__jobbidBidStatus = (st) => {
    bidLocal = st;
    const el = $('bidStatus');
    if (!el) return;
    el.outerHTML = bidStatusHtml();
    const btn = $('bidHere');
    if (btn) { btn.outerHTML = bidHereButton(btn.style.marginTop ? `margin-top:${btn.style.marginTop}` : ''); bindBidHere(); }
  };

  function autoTab() {
    // Offline: only this page (the queue lives in the hub).
    if (data.hubConfig?.offline) return `<div class="card">
        <div class="grp">This page</div>
        <div class="bseg"><button data-omode="review" class="${offMode !== 'auto' ? 'on' : ''}">Review first</button><button data-omode="auto" class="${offMode === 'auto' ? 'on' : ''}">Full auto</button></div>
        ${bidHereButton('margin-top:10px')}
        ${bidStatusHtml()}
        <div class="t2" style="margin-top:6px">As ${esc(pname(activeProfile()))} · ${offMode === 'auto' ? 'presses Apply, fills, AI answers the rest, then submits' : 'presses Apply, fills and lets AI answer the rest - you press Submit'}.</div>
        <div class="t2" style="margin-top:6px">The auto-bid queue needs the hub - it is back when you go online.</div>
      </div>`;
    if (!bidView) {
      if (!bidLoading) loadBid();
      return `<div class="card empty-note">${bidErr ? esc(bidErr) : 'Loading auto bid...'}</div>`;
    }
    const v = bidView, c = v.config, n = v.counts;
    const polled = c.lastPoll ? Date.now() - new Date(c.lastPoll).getTime() : Infinity;
    const cur = v.items.find((b) => b.status === 'running');
    const waitS = c.nextAt ? Math.ceil((new Date(c.nextAt).getTime() - Date.now()) / 1000) : 0;
    const count = (k, label, cls = '') => `<span class="bcnt ${cls}"><b>${(n[k] || 0) + (k === 'queued' ? n.running || 0 : 0)}</b>${label}</span>`;
    const latest = v.items.filter((b) => b.status !== 'queued').slice(0, 6);
    return `
      <div class="card">
        <div class="grp">This page</div>
        ${bidHereButton('')}
        ${bidStatusHtml()}
        <div class="t2" style="margin-top:6px">As ${esc(pname(activeProfile()))} · ${c.mode === 'auto' ? 'presses Apply, fills, AI answers the rest, then submits' : 'presses Apply, fills and lets AI answer the rest - you press Submit'}. Works on any site.</div>
      </div>
      <div class="card">
        <div class="grp">Queue (from the hub)</div>
        <div class="brow"><span class="bdot ${c.running ? 'on' : ''}"></span><b>${c.running ? 'Running' : 'Stopped'}</b><span class="grow"></span>
          <span class="tag" style="color:${polled < 90000 ? 'var(--ok)' : 'var(--warn)'}">${polled < 90000 ? 'Chrome connected' : 'Waiting for Chrome...'}</span></div>
        ${c.running && cur ? `<div class="t2 ellip" style="margin-top:4px">Now: ${esc(cur.title)} · ${esc(cur.company)} (${esc(cur.profileName)})</div>` : ''}
        ${c.running && !cur && waitS > 0 ? `<div class="t2" style="margin-top:4px">Next one in ${waitS}s</div>` : ''}
        <div class="bcnts">${count('queued', 'Waiting')}${count('review', 'Ready', 'info')}${count('needs', 'Needs you', 'warn')}${count('submitted', 'Submitted', 'ok')}</div>
        <button class="fill" id="bidGo" style="width:100%;box-sizing:border-box" ${!c.running && !c.profileIds.length ? 'disabled title="Choose at least one profile below"' : ''}>${svg(c.running ? 'stop' : 'bot')}${c.running ? 'Stop auto bid' : 'Start auto bid'}</button>
      </div>
      <div class="card">
        <div class="grp">Profiles to bid with</div>
        ${data.profiles.map((p) => `<label class="brow bpick"><input type="checkbox" class="bidPro" data-pid="${p.id}" ${c.profileIds.includes(p.id) ? 'checked' : ''}>${avatar(p, 'sm')}
          <span class="grow ellip" translate="no">${esc(pname(p))}</span><span class="tag">${n.today?.[p.id] || 0} today</span></label>`).join('')}
        <div class="grp">How</div>
        <div class="bseg"><button data-bmode="review" class="${c.mode !== 'auto' ? 'on' : ''}">Review first</button><button data-bmode="auto" class="${c.mode === 'auto' ? 'on' : ''}">Full auto</button></div>
        <div class="t2" style="margin:6px 0 8px">${c.mode === 'auto' ? 'Fills and submits by itself. Anything unsure is marked "Needs you".' : 'Fills each form and leaves the tab open - you check it and press Submit.'}</div>
        <label class="brow">Per profile per day<span class="grow"></span><input class="bidIn" id="bidPerDay" type="number" min="1" max="500" value="${c.perDay}"></label>
        <label class="brow">Pause (minutes)<span class="grow"></span><input class="bidIn" id="bidGapMin" type="number" min="0" max="120" value="${c.gapMin}"> - <input class="bidIn" id="bidGapMax" type="number" min="0" max="240" value="${c.gapMax}"></label>
        <label class="brow"><input type="checkbox" id="bidOne" ${c.onePerCompany ? 'checked' : ''}>One profile per company</label>
      </div>
      ${latest.length ? `<div class="card"><div class="grp">Latest</div>${latest.map((b) => `<button class="bitem" data-burl="${esc(b.url)}">
          <span class="bst ${b.status}">${BID_LABEL[b.status] || b.status}</span><span class="grow" style="min-width:0"><span class="ellip" style="display:block">${esc(b.title)} · ${esc(b.company)}</span>
          ${b.reason ? `<span class="t2" style="display:block">${esc(b.reason)}</span>` : ''}</span></button>`).join('')}</div>` : ''}
      <div class="acts"><button id="bidPage">Open the Auto bid page</button></div>
      <div class="t2" style="text-align:center">Applies to Qualified jobs on Greenhouse, Lever and Ashby. Keep Chrome open.</div>`;
  }

  function bindBidHere() {
    $('bidHere')?.addEventListener('click', () => {
      if (bidLocal?.kind === 'run') return;
      api.autoBid({ mode: (data.hubConfig?.offline ? offMode : bidView?.config.mode) === 'auto' ? 'auto' : 'review', local: true });
    });
  }

  function bindAutoTab() {
    $('bidGo')?.addEventListener('click', () => (bidView?.config.running ? bidAct('stop') : bidAct('start', { profileIds: bidView.config.profileIds })));
    $('bidPage')?.addEventListener('click', () => openPage('#autobid'));
    bindBidHere();
    root.querySelectorAll('[data-omode]').forEach((b) => b.addEventListener('click', () => { offMode = b.dataset.omode; render(); }));
    root.querySelectorAll('.bidPro').forEach((b) => b.addEventListener('change', () => {
      const ids = [...root.querySelectorAll('.bidPro')].filter((x) => x.checked).map((x) => x.dataset.pid);
      bidAct('config', { profileIds: ids });
    }));
    root.querySelectorAll('[data-bmode]').forEach((b) => b.addEventListener('click', () => bidAct('config', { mode: b.dataset.bmode })));
    const num = (id, key) => $(id)?.addEventListener('change', (e) => bidAct('config', { [key]: Number(e.target.value) }));
    num('bidPerDay', 'perDay'); num('bidGapMin', 'gapMin'); num('bidGapMax', 'gapMax');
    $('bidOne')?.addEventListener('change', (e) => bidAct('config', { onePerCompany: e.target.checked }));
    root.querySelectorAll('[data-burl]').forEach((b) => b.addEventListener('click', () => window.open(b.dataset.burl, '_blank')));
  }

  function profileTab(p) {
    const yn = (v) => (v ? v : '—');
    const resume = (p.resumes || []).find((r) => r.id === p.defaultResumeId) || (p.resumes || [])[0];
    const line = (icon, v) => (v ? `<div class="drow">${svg(icon)}<span class="v grow ellip" translate="no">${esc(v)}</span></div>` : '');
    return `
      <div class="cap">Applying as</div>
      <div class="card" style="display:flex;flex-direction:column;gap:9px">
        <div style="display:flex;align-items:center;gap:10px;padding-bottom:9px;border-bottom:1px solid var(--div)">
          ${avatar(p, 'lg', true)}
          <span class="grow"><b class="ellip" style="display:block" translate="no">${esc(pname(p))}</b><span class="t2 ellip" style="display:block" translate="no">${esc(p.headline || p.currentTitle || '')}</span></span>
          ${data.profiles.length > 1 ? `<button class="link" id="switchProfile">Switch</button>` : ''}
        </div>
        ${line('mail', p.email)}${line('phone', p.phone)}${line('pin', [p.city, p.state, p.country].filter(Boolean).join(', '))}
        ${line('brief', [p.currentTitle || p.headline, p.yearsExperience ? p.yearsExperience + ' yrs' : ''].filter(Boolean).join(' · '))}
        ${line('doc', resume ? resume.name : '')}
        <div class="pair">
          <div class="drow">${svg('shield')}<span class="v grow"><span class="t2">Work authorization</span><br>${esc(yn(p.workAuthorization))}</span></div>
          <div class="drow">${svg('shield')}<span class="v grow"><span class="t2">Sponsorship</span><br>${esc(yn(p.requiresSponsorship))}</span></div>
        </div>
      </div>
      ${ipHtml(p)}
      <div class="acts"><button id="editProfile">Edit profile</button><button id="openDash">Dashboard</button></div>`;
  }

  // ---------- Offline mode (a data file instead of the hub) ----------
  const signedInHere = () => !!(data.hubConfig?.token || data.hubConfig?.offline);
  let offMode = 'review';
  async function saveDataFile() {
    const r = await api.send({ type: 'offlineExport' });
    if (!r.ok) { api.toast({ kind: 'err', title: 'Could not save the data file', msg: r.error }); return false; }
    const blob = new Blob([JSON.stringify(r.snap)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jobbid-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    api.toast({ kind: 'ok', title: 'Data file saved', msg: `${a.download} is in your Downloads. Load it again offline, or import it in the hub (Settings > Import).`, ms: 9000 });
    return true;
  }
  async function goOnline() {
    if (!confirm('Go online? JobBid first saves your offline work to a data file (Downloads) - import it in the hub (Settings > Import) to keep it. Then you sign in to the hub.')) return;
    if (!(await saveDataFile())) return;
    await api.send({ type: 'offlineExit' });
    forceOpen = true;
    await loadData();
    render();
  }
  const offlineBar = () => `<div class="offbar">${svg('globe')}<span class="grow ellip"><b>Offline</b> · ${esc(data.hubConfig.offlineFile || 'data file')}</span>
    <button class="link" id="offSave">Save data file</button><button class="link" id="offExit">Go online</button></div>`;

  function render() {
    const w = root.querySelector('.w');
    if (data.settings.theme === 'light' || data.settings.theme === 'dark') w.dataset.theme = data.settings.theme;
    else delete w.dataset.theme;
    // Not signed in to JobBid: nothing on the page, except the sign-in when opened from the JobBid icon.
    const out = !signedInHere();
    w.classList.toggle('out', out);
    if (out) {
      if (!forceOpen) {
        // Just the JobBid button on the left edge (no information); clicking it opens the sign-in.
        host.style.setProperty('display', 'block', 'important');
        placePanel('left', false);
        root.querySelector('.panel').style.display = 'none';
        $('tab').style.display = 'grid';
        host.style.setProperty('width', '0', 'important');
        if (tabTop != null) $('tab').style.top = Math.max(8, Math.min(innerHeight - 56, tabTop)) + 'px';
        const tb = $('tabBadge');
        tb.className = 'tb lock';
        tb.innerHTML = svg('user');
        $('tab').title = 'Sign in to JobBid';
        api.setUiOffset(20);
        return;
      }
      host.style.setProperty('display', 'block', 'important');
      placePanel('left', true);
      root.querySelector('.panel').style.display = 'flex';
      $('tab').style.display = 'none';
      host.style.setProperty('width', panelW + 'px', 'important');
      w.style.setProperty('--pw', panelW + 'px');
      api.setUiOffset((pos ? pos.x : 12) + panelW + 12, 'left');
      return renderSignIn();
    }
    const items = allItems();
    // Always present on every page: the full panel when shown, the launcher button when hidden.
    host.style.setProperty('display', 'block', 'important');
    const collapsed = data.panelCollapsed ?? data.settings.showPanel === false;
    // JobBid always lives on the left side of the page.
    const side = 'left';
    placePanel(side, !collapsed);
    root.querySelector('.panel').style.display = collapsed ? 'none' : 'flex';
    $('tab').style.display = collapsed ? 'grid' : 'none';
    host.style.setProperty('width', collapsed ? '0' : panelW + 'px', 'important');
    root.querySelector('.w').style.setProperty('--pw', panelW + 'px');
    // Notifications sit on the left, next to the panel when it is open.
    api.setUiOffset(collapsed ? 20 : (pos ? pos.x : 12) + panelW + 12, side);
    if (tabTop != null) $('tab').style.top = Math.max(8, Math.min(innerHeight - 56, tabTop)) + 'px';
    $('mWho').textContent = `Signed in as ${data.hubConfig?.user || '?'}${data.hubState?.lastSyncAt ? ' · synced ' + minsAgo(data.hubState.lastSyncAt) : ''}`;
    const missCount = items.filter((x) => x.required && x.status === 'missing').length;
    if (collapsed) {
      // Badge: red count = required fields still empty, green check = form complete, magnifier = no form here.
      const form = hasForm(items);
      const tb = $('tabBadge');
      tb.className = 'tb ' + (form ? (missCount ? 'miss' : 'ok') : '');
      tb.innerHTML = form ? (missCount ? String(missCount) : svg('check')) : svg('search');
      $('tab').title = form ? (missCount ? `Open JobBid · ${missCount} required fields empty` : 'Open JobBid · form complete') : 'Open JobBid panel';
      if (applied.some((a) => a.profileId === activeProfile()?.id)) {
        tb.className = 'tb miss';
        tb.textContent = '!';
        $('tab').title = 'You already applied before!';
      }
      return;
    }

    const p = activeProfile();
    if (!p) {
      root.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.remove('on'));
      $('body').innerHTML = `<div class="card empty-note">Add a profile in the dashboard to start applying.</div><div class="acts"><button id="openDash">Open dashboard</button></div>`;
      $('openDash').addEventListener('click', () => openPage('#profiles'));
      return;
    }
    // Default: Apply when there's a form to fill, otherwise Job.
    const tab = data.panelTab || (hasForm(items) ? 'apply' : 'job');
    root.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    $('whoName').textContent = pname(p);
    $('whoAv').outerHTML = avatar(p, 'sm').replace('<span class="av sm"', '<span id="whoAv" class="av sm"');
    $('whoMenu').innerHTML = `<div class="mcap">Apply as</div>` + data.profiles.map((x) => `<button class="pick" data-pid="${x.id}" role="menuitemradio" aria-checked="${x.id === p.id}">
        ${avatar(x, 'sm')}<span class="grow" style="min-width:0"><span class="ellip" style="display:block" translate="no">${esc(pname(x))}</span>
        <span class="t2 ellip" style="display:block" translate="no">${esc(x.headline || x.currentTitle || '')}</span></span>${x.id === p.id ? `<span class="check">${svg('check')}</span>` : ''}</button>`).join('');
    $('missBadge').hidden = !missCount || tab === 'apply';
    $('missBadge').textContent = missCount;

    const scroll = $('body').scrollTop;
    $('body').innerHTML = tab === 'job' ? jobTab(p) : tab === 'match' ? matchTab(p) : tab === 'profile' ? profileTab(p) : tab === 'auto' ? autoTab() : applyTab(p, items);
    $('body').scrollTop = scroll;
    const up = data.extUpdate;
    if (up?.latest && up.latest !== chrome.runtime.getManifest().version) {
      $('body').insertAdjacentHTML('afterbegin', `<div class="offbar upd">${svg('down')}<span class="grow"><b>Update ${esc(up.latest)}</b> · ${up.auto ? 'installs by itself within 30 minutes' : `you have ${esc(up.running)}`}</span>
        ${up.auto ? '' : '<button class="link" id="updGet">Auto-update</button><button class="link" id="updZip">Zip</button>'}</div>`);
      $('updGet')?.addEventListener('click', () => window.open(`${up.hub}/api/extension/installer`, '_blank'));
      $('updZip')?.addEventListener('click', () => window.open(`${up.hub}/api/extension/download`, '_blank'));
    }
    if (data.hubConfig?.offline) {
      $('body').insertAdjacentHTML('afterbegin', offlineBar());
      $('offSave').addEventListener('click', saveDataFile);
      $('offExit').addEventListener('click', goOnline);
    }

    $('fill')?.addEventListener('click', onFill);
    if (tab === 'auto') bindAutoTab();
    $('switchNow')?.addEventListener('click', () => setActive(currentBlock().profileId));
    $('fixAi')?.addEventListener('click', () => openPage('#ai'));
    $('ipline')?.addEventListener('click', () => api.send({ type: 'getIp', force: true }));
    $('reanalyze')?.addEventListener('click', () => { ensureJobAnalysis(api.getJob(), true); render(); });
    $('matchAI')?.addEventListener('click', () => runMatchAI(api.getJob(), p, true));
    $('atsRun')?.addEventListener('click', () => runAts(false));
    $('atsRescore')?.addEventListener('click', () => runAts(true));
    $('atsOpt')?.addEventListener('click', () => openOptimizer('choose'));
    $('atsDetail')?.addEventListener('click', () => openOptimizer('score'));
    $('atsResume')?.addEventListener('change', (e) => { atsPick = e.target.value; render(); });
    $('atsUse')?.addEventListener('click', async () => { const msg = await useOptimized(atsMade.file); api.toast({ kind: 'ok', title: 'Optimized resume', msg, ms: 7000 }); });
    $('atsDown')?.addEventListener('click', () => downloadFile(atsMade.file));
    $('toMatch')?.addEventListener('click', () => { data.panelTab = 'match'; store.set({ panelTab: 'match' }); render(); });
    $('log')?.addEventListener('click', () => api.logApplication(activeProfile()));
    $('saveQs')?.addEventListener('click', async () => {
      const r = await api.saveQuestionsNow();
      api.toast(r.added
        ? { kind: 'ok', title: `Saved ${r.added} question${r.added === 1 ? '' : 's'}`, msg: `Answer them once in ${pname(r.profile)}'s Saved answers (dashboard) and they fill automatically next time.`, ms: 7000 }
        : { kind: 'info', title: 'No new questions to save', msg: 'Every unanswered question here is already in Saved answers or comes from the profile.', ms: 5000 });
    });
    $('cover')?.addEventListener('click', onCover);
    $('copyCover')?.addEventListener('click', async () => { await navigator.clipboard.writeText($('coverText').value); api.toast({ kind: 'ok', title: 'Copied', ms: 2500 }); });
    $('closeCover')?.addEventListener('click', () => { coverText = ''; render(); });
    $('foldOpt')?.addEventListener('click', () => { showOptional = !showOptional; render(); });
    $('resPick')?.addEventListener('change', (e) => { pickedResume = e.target.value; });
    $('resAttach')?.addEventListener('click', async (e) => {
      const id = $('resPick').value;
      pickedResume = id;
      const frame = e.currentTarget.dataset.frame;
      e.currentTarget.setAttribute('disabled', '');
      e.currentTarget.textContent = 'Attaching...';
      if (frame) frameWindows[Number(frame) - 1]?.postMessage({ __jobbid: 'attach', resumeId: id }, '*');
      else {
        const n = await api.attachResumeNow(id);
        if (!n) api.toast({ kind: 'warn', title: 'Could not attach the resume', msg: 'Use the site\'s own upload button for this form.', ms: 5000 });
      }
      setTimeout(schedule, 600);
    });
    $('nextMissing')?.addEventListener('click', () => {
      const miss = items.filter((x) => x.required && x.status === 'missing');
      const x = miss[missIdx++ % miss.length];
      if (!x) return;
      if (x.frame) frameWindows[x.frame - 1]?.postMessage({ __jobbid: 'focus', id: x.id }, '*');
      else focusField(x.id);
    });
    $('switchProfile')?.addEventListener('click', (e) => { e.stopPropagation(); openMenu('whoMenu'); });
    $('editProfile')?.addEventListener('click', () => openPage('#profiles'));
    $('openDash')?.addEventListener('click', () => openPage('#home'));
    root.querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => setActive(b.dataset.pid)));
    root.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.frame) frameWindows[Number(b.dataset.frame) - 1]?.postMessage({ __jobbid: 'focus', id: Number(b.dataset.i) }, '*');
      else focusField(Number(b.dataset.i));
    }));
    // Only the AI tag asks the AI (clicking the question itself just jumps to it on the page).
    root.querySelectorAll('.item [data-ai]').forEach((tag) => tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = tag.closest('.item');
      const x = items.find((it) => String(it.id) === b.dataset.i && String(it.frame || '') === b.dataset.frame);
      if (x && (x.status === 'missing' || x.status === 'empty') && !aiDown()) askAI([x]);
    }));
    $('aiOptional')?.addEventListener('click', () => askAI(items.filter((x) => !x.required && x.status === 'empty' && !x.ownWords && !x.isFile)));
    $('aiMissing')?.addEventListener('click', () => askAI(items.filter((x) => x.required && x.status === 'missing' && !x.ownWords)));
    $('aiRetry')?.addEventListener('click', () => { const keys = new Set((aiResult?.list || []).map((x) => x.key)); aiResult = null; askAI(items.filter((x) => keys.has(x.key) && x.status === 'missing')); });
  }

  // Dock the panel on the chosen side and (optionally) push the page aside so nothing is hidden under it.
  const html = document.documentElement;
  const pageStyle = { left: html.style.getPropertyValue('margin-left'), right: html.style.getPropertyValue('margin-right') };
  let pushed = '';
  function placePanel(side, open) {
    root.querySelector('.w').classList.toggle('left', side === 'left');
    // Dragged somewhere: stay there (kept inside the window). Otherwise docked top-left.
    const x = pos ? Math.max(0, Math.min(innerWidth - 120, pos.x)) : 12;
    const y = pos ? Math.max(0, Math.min(innerHeight - 80, pos.y)) : 12;
    host.style.setProperty('left', x + 'px', 'important');
    host.style.setProperty('top', y + 'px', 'important');
    host.style.setProperty('right', 'auto', 'important');
    root.querySelector('.w').style.setProperty('--top', y + 'px');
    // Pushing the page aside only makes sense while docked at the edge.
    const want = open && !pos && data.settings.panelPush !== false ? side : '';
    const key = want && want + ':' + panelW;
    if (key === pushed) return;
    // Undo the previous push, then apply the new one.
    const prevSide = pushed.split(':')[0];
    if (prevSide) html.style.setProperty('margin-' + prevSide, pageStyle[prevSide] || '');
    if (want) html.style.setProperty('margin-' + want, panelW + 24 + 'px', 'important');
    pushed = key;
  }

  async function setActive(id) {
    const { settings = {} } = await store.get('settings');
    settings.activeProfileId = id;
    await store.set({ settings });
  }

  // Ask the AI for these panel items; each frame answers its own fields.
  const aiAsking = new Set();
  let aiResult = null; // last "Answer with AI" outcome, shown under the progress bar
  async function askAI(list) {
    const fresh = list.filter((x) => !aiAsking.has(x.key));
    if (!fresh.length) return;
    fresh.forEach((x) => aiAsking.add(x.key));
    render();
    const byFrame = new Map();
    for (const x of fresh) byFrame.set(x.frame || 0, [...(byFrame.get(x.frame || 0) || []), x.id]);
    const jobs = [...byFrame].map(([frame, ids]) => {
      if (!frame) return api.aiAnswerNow(ids.map((i) => lastFields[i])).catch((e) => ({ ok: false, error: e.message }));
      // The form is in an embedded frame: wait for its real result (ChatGPT can take a minute or two).
      const req = Math.random().toString(36).slice(2);
      return new Promise((resolve) => {
        aiWaits.set(req, resolve);
        frameWindows[frame - 1]?.postMessage({ __jobbid: 'ai', ids, req }, '*');
        // One question can take a couple of minutes. A long list is answered one by one, so allow that time per question.
        setTimeout(() => { if (aiWaits.has(req)) { aiWaits.delete(req); resolve({ ok: false, error: 'No answer from the form frame (timed out). Try again.' }); } }, Math.max(240000, ids.length * 180000));
      });
    });
    const results = await Promise.all(jobs);
    const bad = results.find((r) => r && !r.ok && r.error && r.error !== 'no AI');
    aiResult = bad ? { ok: false, error: bad.error, at: Date.now(), list: fresh } : { ok: true, n: results.reduce((s, r) => s + (r?.n || 0), 0), at: Date.now() };
    fresh.forEach((x) => aiAsking.delete(x.key));
    schedule();
  }

  // Status line: what the AI is doing now (with seconds), or how the last request ended.
  function aiStatusHtml() {
    const st = data.aiStatus || {};
    if (aiAsking.size) {
      const secs = st.startedAt && st.state === 'working' ? Math.max(0, Math.round((Date.now() - new Date(st.startedAt)) / 1000)) : 0;
      return `<div class="aist working"><span class="spin"></span><span class="grow">${esc(st.state === 'working' ? st.stage : 'Starting...')}</span><b>${secs}s</b></div>`;
    }
    if (aiResult && Date.now() - aiResult.at < 60000) {
      return aiResult.ok
        ? `<div class="aist ok">${svg('check')}<span class="grow">AI answered ${aiResult.n} - purple fields, please read them</span></div>`
        : `<div class="aist err">${svg('alert')}<span class="grow">AI failed: ${esc(aiResult.error)}</span><button class="link" id="aiRetry">Try again</button></div>`;
    }
    return '';
  }
  // While the AI works, refresh the seconds once a second.
  setInterval(() => {
    if (aiAsking.size && root.querySelector('.aist.working')) { const el = root.querySelector('.aist.working'); el.outerHTML = aiStatusHtml(); }
  }, 1000);

  // A fill running (from this button, Shift+Alt+F or Auto bid; a form in a frame counts from the button
  // only): the button says "Filling..." and can't be pressed until it's done.
  let panelFilling = false;
  let lastFillRender = 0;
  const fillBusy = () => panelFilling || !!api.isFilling?.();
  // Start: only the button changes (no page scan). End: one full redraw.
  window.__jobbidFillState = (on) => {
    if (!on) return setTimeout(schedule, 50);
    const b = $('fill');
    if (b) { b.setAttribute('disabled', ''); b.innerHTML = `${svg('bolt')}Filling...`; }
  };

  async function onFill() {
    if (fillBusy()) return;
    panelFilling = true;
    const stuck = setTimeout(() => { panelFilling = false; schedule(); }, 120000); // never stays "Filling..." for good
    window.__jobbidFillState(true);
    try { await api.send({ type: 'fillAllFrames' }); }
    finally { clearTimeout(stuck); panelFilling = false; setTimeout(schedule, 300); }
  }

  async function onCover() {
    $('cover').textContent = 'Writing...';
    const job = api.getJob();
    // Always a fresh letter for the job on screen (never a previous one).
    const r = await api.send({ type: 'coverLetter', profile: activeProfile(), job });
    if (!r.ok) { render(); return api.toast({ kind: 'err', title: 'Cover letter failed', msg: r.error }); }
    coverText = r.text;
    coverFor = jobKeyOf(job);
    render();
  }

  // Debug info for reporting a problem: what JobBid saw on this page (no personal data).
  async function copyDebug() {
    const items = allItems();
    const job = api.getJob();
    const info = [
      `JobBid ${api.alive() ? chrome.runtime.getManifest().version : '?'} · ${new Date().toISOString()}`,
      `Page: ${location.href}`,
      `Job: ${job.title} | company: ${job.company || '-'} | description: ${job.found} (${job.description.length} chars)`,
      `Fields (${items.length}): ` + items.map((x) => `${x.name} [${x.status}${x.required ? ', required' : ''}${x.frame ? ', iframe' : ''}]`).join('; '),
      `AI: ${aiDown() || 'ok'} · panel tab: ${data.panelTab || 'auto'}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(info);
      api.toast({ kind: 'ok', title: 'Debug info copied', msg: 'Paste it when you report the problem.', ms: 4000 });
    } catch {
      api.toast({ kind: 'warn', title: 'Could not copy', msg: info.slice(0, 300), ms: 10000 });
    }
  }

  root.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { data.panelTab = b.dataset.tab; store.set({ panelTab: b.dataset.tab }); render(); }));
  // Header menus (profile switcher, "more"): one open at a time; any other click closes them.
  function openMenu(id) {
    const m = $(id);
    const was = m.classList.contains('open');
    root.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
    if (!was) m.classList.add('open');
  }
  $('who').addEventListener('click', (e) => { e.stopPropagation(); openMenu('whoMenu'); });
  $('more').addEventListener('click', (e) => { e.stopPropagation(); openMenu('moreMenu'); });
  root.addEventListener('click', (e) => {
    const path = e.composedPath();
    // Choosing a language keeps the menu open (so the checkmark is visible); everything else closes it.
    if (!path.some((n) => n.classList?.contains('langs'))) root.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open'));
  });
  $('mDash').addEventListener('click', () => openPage('#home'));
  $('bug').addEventListener('click', copyDebug);
  $('rz').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rz = $('rz');
    const left = root.querySelector('.w').classList.contains('left');
    const startX = e.clientX, startW = panelW;
    rz.classList.add('on');
    rz.setPointerCapture(e.pointerId);
    const move = (ev) => {
      panelW = clampW(startW + (left ? ev.clientX - startX : startX - ev.clientX));
      host.style.setProperty('width', panelW + 'px', 'important');
      root.querySelector('.w').style.setProperty('--pw', panelW + 'px');
    };
    const up = () => {
      rz.classList.remove('on');
      rz.removeEventListener('pointermove', move);
      rz.removeEventListener('pointerup', up);
      data.panelWidth = panelW;
      store.set({ panelWidth: panelW });
      render();
    };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up);
  });
  // Double-click the edge: back to the normal width.
  $('rz').addEventListener('dblclick', () => { panelW = DEFAULT_W; data.panelWidth = panelW; store.set({ panelWidth: panelW }); render(); });
  // ---------- Sign in (shown when this Chrome is not signed in) ----------
  function renderSignIn() {
    // Already on screen: keep what was typed (the panel redraws often).
    if ($('siUrl')) return;
    const url = data.hubConfig?.url || 'http://127.0.0.1:4417';
    $('body').innerHTML = `<div class="card signin">
        <div class="t"><b>Sign in to JobBid Hub</b></div>
        <div class="hint">JobBid shows your profiles and fills applications after you sign in.</div>
        <label>Hub address<input id="siUrl" value="${esc(url)}" placeholder="http://192.168.1.20:4417"></label>
        <label>Username<input id="siUser" autocomplete="username"></label>
        <label>Password<input id="siPass" type="password" autocomplete="current-password"></label>
        <button class="go" id="siGo">Sign in &amp; sync</button>
        <div class="or"><span>or</span></div>
        <button class="go alt" id="siOffline">Work offline: load a data file (.json)</button>
        <input type="file" id="siFile" accept=".json,application/json" hidden>
        <div class="hint">No hub? Load a JobBid data file (hub Settings > Export, or "Save data file" from offline mode). Filling and AI work; nothing syncs until you go online.</div>
        <div class="msg" id="siMsg">${esc(data.hubState?.needLogin && data.hubConfig?.token ? data.hubState.lastError || '' : '')}</div>
      </div>`;
    // Signed in on a hub page in this Chrome? Then that sign-in is used; otherwise say why not.
    $('siMsg').textContent = 'Looking for a JobBid Hub sign-in in this Chrome...';
    api.send({ type: 'hubAdoptTabs' }).then(async (r) => {
      if (!$('siMsg')) return;
      if (r.ok && r.adopted) {
        $('siMsg').textContent = '';
        await loadData();
        store.set({ panelCollapsed: false });
        return render();
      }
      $('siMsg').textContent = r.reason || '';
    });
    const go = async () => {
      $('siMsg').textContent = 'Signing in...';
      let url = $('siUrl').value.trim() || 'http://127.0.0.1:4417';
      if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
      // Remember the address even if this attempt fails, so it doesn't jump back to 127.0.0.1.
      await store.set({ hubConfig: { ...(data.hubConfig || {}), url: url.replace(/\/+$/, '') } });
      const r = await api.send({ type: 'hubSignIn', url, username: $('siUser').value.trim(), password: $('siPass').value });
      $('siMsg').textContent = r.ok ? '' : r.error || 'Sign-in failed';
      if (r.ok) { await loadData(); schedule(); }
    };
    $('siGo').addEventListener('click', go);
    $('siOffline').addEventListener('click', () => $('siFile').click());
    $('siFile').addEventListener('change', async (e) => {
      // Keep the input: inside the panel's shadow root, e.target is cleared once the event is over.
      const input = e.target;
      const file = input.files?.[0];
      if (!file) return;
      $('siMsg').textContent = 'Loading the data file...';
      const r = await api.send({ type: 'offlineLoad', text: await file.text(), name: file.name });
      input.value = '';
      if (!r.ok) { $('siMsg').textContent = r.error || 'Could not load the file'; return; }
      $('siMsg').textContent = '';
      api.toast({ kind: 'ok', title: 'Offline mode', msg: `Loaded ${r.profiles} profile${r.profiles === 1 ? '' : 's'} and ${r.applications} application${r.applications === 1 ? '' : 's'} from ${file.name}.`, ms: 7000 });
      await loadData();
      store.set({ panelCollapsed: false });
      render();
    });
    $('siPass').addEventListener('keydown', (e) => e.key === 'Enter' && go());
    setTimeout(() => (data.hubConfig?.url ? $('siUser') : $('siUrl'))?.focus(), 50);
  }

  // ---------- Move: drag the header (double-click puts it back on the left edge) ----------
  const header = root.querySelector('header');
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, .menu, a, select')) return;
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    let moved = false;
    header.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      if (!moved) { moved = true; header.classList.add('dragging'); }
      pos = { x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 80, ev.clientY - dy)) };
      placePanel('left', true);
      api.setUiOffset(pos.x + panelW + 12, 'left');
    };
    const up = () => {
      header.classList.remove('dragging');
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      if (moved) { data.panelPos = pos; store.set({ panelPos: pos }); render(); }
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });
  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, .menu')) return;
    pos = null; data.panelPos = null; store.set({ panelPos: null }); render();
  });

  // The launcher button: drag it up or down the left edge; a plain click opens the panel.
  let tabDragged = false;
  $('tab').addEventListener('pointerdown', (e) => {
    const start = e.clientY, top0 = $('tab').getBoundingClientRect().top;
    tabDragged = false;
    $('tab').setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!tabDragged && Math.abs(ev.clientY - start) < 5) return;
      tabDragged = true;
      tabTop = Math.max(8, Math.min(innerHeight - 56, top0 + ev.clientY - start));
      $('tab').style.top = tabTop + 'px';
    };
    const up = () => {
      $('tab').removeEventListener('pointermove', move);
      $('tab').removeEventListener('pointerup', up);
      if (tabDragged) { data.tabTop = tabTop; store.set({ tabTop }); }
    };
    $('tab').addEventListener('pointermove', move);
    $('tab').addEventListener('pointerup', up);
  });

  // Clicking the JobBid icon in Chrome's toolbar: open the panel (or close it if it is open).
  window.__jobbidPanelToggle = () => {
    const open = host.style.display !== 'none' && root.querySelector('.panel').style.display !== 'none';
    if (open && (forceOpen || signedInHere())) {
      forceOpen = false;
      if (signedInHere()) store.set({ panelCollapsed: true }); else render();
      return;
    }
    forceOpen = true;
    if (signedInHere()) store.set({ panelCollapsed: false });
    render();
  };

  $('mSignOut').addEventListener('click', async () => {
    root.querySelectorAll('.menu').forEach((m) => m.classList.remove('open'));
    if (data.hubConfig?.offline) return goOnline();
    await api.send({ type: 'hubSignOut' });
    forceOpen = true;
    await loadData();
    render();
  });

  $('collapse').addEventListener('click', () => { forceOpen = false; if (signedInHere()) store.set({ panelCollapsed: true }); else render(); });
  $('tab').addEventListener('click', async () => {
    if (tabDragged) return;
    if (!signedInHere()) {
      // Maybe a hub tab in this Chrome is already signed in: use that, else show the sign-in form.
      const r = await api.send({ type: 'hubAdoptTabs' });
      if (r.ok && r.adopted) { await loadData(); if (data.hubConfig?.token) return store.set({ panelCollapsed: false }); }
      forceOpen = true;
      return render();
    }
    store.set({ panelCollapsed: false });
  });

  let timer;
  function schedule() {
    if (!api.alive()) return api.shutDown();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (root.activeElement?.id === 'coverText' || root.activeElement?.classList?.contains('bidIn')) return;
      // Mid-fill: a redraw (a whole-page scan) at most every 2.5 s, so the list turns green as boxes fill
      // without slowing the fill down. The fill's end redraws in full.
      if (fillBusy()) {
        if (Date.now() - lastFillRender < 2500) return;
        lastFillRender = Date.now();
        render();
        return;
      }
      const j = api.getJob();
      const r = await api.send({ type: 'checkApplied', url: location.href, title: j.title, company: j.company });
      applied = r.ok ? r.matches : [];
      const tb = await api.send({ type: 'teamBids', url: location.href, title: j.title, company: j.company });
      teamBids = tb.ok === false ? { bids: [], choices: [] } : tb;
      render();
    }, 400);
  }

  // Throttled (not debounced) so pages that never stop changing still get refreshed.
  let mutTimer = null;
  new MutationObserver((muts) => {
    if (mutTimer || muts.every((m) => m.target === host)) return;
    mutTimer = setTimeout(() => { mutTimer = null; schedule(); }, 1000);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-checked', 'aria-pressed', 'value'] });
  document.addEventListener('input', schedule, true);
  document.addEventListener('change', schedule, true);
  chrome.storage.onChanged.addListener(async (c) => {
    if (c.profiles || c.settings || c.schedule || c.applications || c.panelCollapsed || c.panelTab || c.keyHealth || c.ipInfo || c.hubConfig || c.hubState || c.aiStatus || c.extUpdate) {
      await loadData();
      schedule();
    }
  });

  loadData().then(() => {
    schedule();
    // Refresh the IP if it's missing or stale; the result arrives through storage.onChanged.
    if (!data.ipInfo?.at || Date.now() - new Date(data.ipInfo.at) > 5 * 60 * 1000) api.send({ type: 'getIp' }).catch(() => {});
  });
})();
