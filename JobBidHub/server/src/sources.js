// Job sources: public job-board APIs (no scraping, so they don't break when a site changes its design).
// Each source returns jobs in one shape:
// { source, extId, url, applyUrl, title, company, location, remote, employmentType, salary, salaryMin, salaryMax, description, tags, postedAt }
import { htmlToText } from './util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobBidHub/1.0';

async function getJson(url, { timeout = 25000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (res.status === 403 || res.status === 429) throw new Error(res.status === 429 ? 'too many requests, try later' : 'blocked from this network');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const iso = (v) => {
  if (v == null || v === '') return '';
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return isNaN(d) ? '' : d.toISOString();
};
const money = (min, max, cur = 'USD', per = 'year') => {
  const f = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  if (!min && !max) return '';
  const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : (cur || '') + ' ';
  return `${sym}${f(min || max)}${max && min && max !== min ? '-' + sym + f(max) : ''}${per === 'hour' ? '/hr' : '/yr'}`;
};
// "$120,000 - $150,000" / "120k-150k" -> numbers (yearly).
export function parseSalary(text) {
  const m = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:-|–|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return {};
  let a = +m[1] * (m[2] ? 1000 : 1), b = +m[3] * (m[4] || m[2] ? 1000 : 1);
  if (b < 500) { a *= 2080; b *= 2080; } // hourly
  return a > 5000 && b >= a ? { salaryMin: a, salaryMax: b } : {};
}
// A one-word keyword ("python") may appear anywhere. A phrase ("data engineer") must be in the title
// (all its words) or appear as the exact phrase in the description, so it doesn't match every job
// that happens to say "data" and "engineer" somewhere.
const textMatches = (job, keywords) => {
  if (!keywords.length) return true;
  const title = ` ${String(job.title || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ')} `;
  const tags = (job.tags || []).join(' ').toLowerCase();
  const desc = String(job.description || '').toLowerCase().replace(/\s+/g, ' ');
  return keywords.some((k) => {
    const words = k.split(/\s+/).filter(Boolean);
    if (words.length === 1) return title.includes(` ${words[0]} `) || tags.includes(words[0]) || new RegExp(`(^|[^a-z0-9])${words[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(desc);
    return words.every((w) => title.includes(` ${w} `) || title.includes(` ${w}s `)) || desc.includes(k);
  });
};

// Companies checked when the user hasn't chosen their own (all verified to have public job boards).
export const STARTER_BOARDS = {
  greenhouse: ['stripe', 'airbnb', 'discord', 'coinbase', 'databricks', 'datadog', 'cloudflare', 'gitlab', 'figma', 'robinhood', 'dropbox', 'reddit', 'pinterest', 'instacart',
    'lyft', 'twilio', 'mongodb', 'elastic', 'okta', 'asana', 'samsara', 'affirm', 'gusto', 'brex', 'chime', 'duolingo', 'squarespace', 'toast', 'anthropic', 'scaleai', 'waymo',
    'nuro', 'flexport', 'carta', 'vercel', 'zscaler', 'roblox', 'twitch', 'checkr', 'faire', 'mercury', 'sofi', 'appian'],
  lever: ['spotify', 'palantir', 'outreach', 'zoox', 'shieldai', 'veeva', 'sonarsource', 'pattern', 'ro', 'jobgether'],
  ashby: ['openai', 'notion', 'ramp', 'linear', 'replit', 'posthog', 'modal', 'zapier', 'sentry', 'vanta', 'supabase', 'perplexity', 'cursor', 'plaid', 'docker',
    'elevenlabs', 'cohere', 'harvey', 'pinecone'],
};

export const SOURCES = {
  remotive: {
    name: 'Remotive', remoteOnly: true, keywordSearch: true, mayBlock: true,
    async fetch({ keywords }) {
      const qs = keywords.length ? keywords : [''];
      const out = [];
      for (const q of qs.slice(0, 5)) {
        const d = await getJson(`https://remotive.com/api/remote-jobs?limit=150${q ? '&search=' + encodeURIComponent(q) : ''}`);
        for (const j of d.jobs || []) out.push({
          source: 'remotive', extId: String(j.id), url: j.url, title: j.title, company: j.company_name, location: j.candidate_required_location || 'Remote',
          remote: true, employmentType: (j.job_type || '').replace(/_/g, '-'), salary: j.salary || '', ...parseSalary(j.salary),
          description: htmlToText(j.description), tags: [j.category, ...(j.tags || [])].filter(Boolean), postedAt: iso(j.publication_date),
        });
      }
      return out;
    },
  },
  remoteok: {
    name: 'Remote OK', remoteOnly: true,
    async fetch() {
      const d = await getJson('https://remoteok.com/api');
      return (Array.isArray(d) ? d : []).filter((j) => j && j.id && j.position).map((j) => ({
        source: 'remoteok', extId: String(j.id), url: j.url || `https://remoteok.com/remote-jobs/${j.id}`, applyUrl: j.apply_url || '', title: j.position, company: j.company,
        location: j.location || 'Remote', remote: true, salary: money(j.salary_min, j.salary_max), salaryMin: j.salary_min || null, salaryMax: j.salary_max || null,
        description: htmlToText(j.description), tags: j.tags || [], postedAt: iso(j.date || j.epoch),
      }));
    },
  },
  jobicy: {
    name: 'Jobicy', remoteOnly: true, keywordSearch: true,
    async fetch({ keywords }) {
      const out = [];
      for (const q of (keywords.length ? keywords : ['']).slice(0, 5)) {
        const d = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=100${q ? '&tag=' + encodeURIComponent(q) : ''}`);
        for (const j of d.jobs || []) out.push({
          source: 'jobicy', extId: String(j.id), url: j.url, title: htmlToText(j.jobTitle), company: j.companyName, location: j.jobGeo || 'Remote', remote: true,
          employmentType: [].concat(j.jobType || []).join(', '), seniority: j.jobLevel || '',
          salary: money(j.annualSalaryMin, j.annualSalaryMax, j.salaryCurrency), salaryMin: j.annualSalaryMin || null, salaryMax: j.annualSalaryMax || null,
          description: htmlToText(j.jobDescription || j.jobExcerpt), tags: [].concat(j.jobIndustry || []), postedAt: iso(j.pubDate),
        });
      }
      return out;
    },
  },
  himalayas: {
    name: 'Himalayas', remoteOnly: true, keywordSearch: true, mayBlock: true,
    async fetch({ keywords }) {
      const out = [];
      for (const q of (keywords.length ? keywords : ['']).slice(0, 5)) {
        const d = await getJson(q ? `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent` : 'https://himalayas.app/jobs/api?limit=100');
        for (const j of d.jobs || []) out.push({
          source: 'himalayas', extId: String(j.guid || j.applicationLink || j.title), url: j.applicationLink || j.guid, title: j.title, company: j.companyName,
          location: (j.locationRestrictions || []).join(', ') || 'Remote', remote: true, employmentType: j.employmentType || '',
          seniority: [].concat(j.seniority || []).join(', '), salary: money(j.minSalary, j.maxSalary, j.currency), salaryMin: j.minSalary || null, salaryMax: j.maxSalary || null,
          description: htmlToText(j.description || j.excerpt), tags: [...(j.categories || []), ...(j.parentCategories || [])], postedAt: iso(j.pubDate),
        });
      }
      return out;
    },
  },
  arbeitnow: {
    name: 'Arbeitnow', mayBlock: true,
    async fetch() {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
        for (const j of d.data || []) out.push({
          source: 'arbeitnow', extId: j.slug, url: j.url, title: j.title, company: j.company_name, location: j.location || '', remote: !!j.remote,
          employmentType: (j.job_types || []).join(', '), description: htmlToText(j.description), tags: j.tags || [], postedAt: iso(j.created_at),
        });
        if (!d.links?.next) break;
      }
      return out;
    },
  },
  greenhouse: {
    name: 'Greenhouse boards', boards: true,
    async fetch({ boards }) {
      const out = [];
      await each(boards, async (b) => {
        const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}/jobs?content=true`);
        for (const j of d.jobs || []) {
          const loc = j.location?.name || '';
          out.push({
            source: 'greenhouse', extId: String(j.id), url: j.absolute_url, title: j.title, company: j.company_name || titleCase(b), location: loc,
            remote: /remote/i.test(loc), description: htmlToText(j.content), tags: (j.departments || []).map((x) => x.name), postedAt: iso(j.first_published || j.updated_at),
          });
        }
      });
      return out;
    },
  },
  lever: {
    name: 'Lever boards', boards: true,
    async fetch({ boards }) {
      const out = [];
      await each(boards, async (b) => {
        const d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b)}?mode=json`);
        for (const j of Array.isArray(d) ? d : []) {
          const loc = j.categories?.location || (j.categories?.allLocations || []).join(', ') || '';
          const lists = (j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
          const sr = j.salaryRange || {};
          out.push({
            source: 'lever', extId: j.id, url: j.hostedUrl, applyUrl: j.applyUrl, title: j.text, company: titleCase(b), location: loc,
            remote: j.workplaceType === 'remote' || /remote/i.test(loc), employmentType: j.categories?.commitment || '',
            salary: money(sr.min, sr.max, sr.currency, sr.interval === 'per-hour-wage' ? 'hour' : 'year'), salaryMin: sr.min || null, salaryMax: sr.max || null,
            description: `${j.descriptionPlain || htmlToText(j.description)}\n\n${lists}\n\n${j.additionalPlain || ''}`.trim(),
            tags: [j.categories?.team, j.categories?.department].filter(Boolean), postedAt: iso(j.createdAt),
          });
        }
      });
      return out;
    },
  },
  ashby: {
    name: 'Ashby boards', boards: true,
    async fetch({ boards }) {
      const out = [];
      await each(boards, async (b) => {
        const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b)}?includeCompensation=true`);
        for (const j of d.jobs || []) {
          if (j.isListed === false) continue;
          const loc = [j.location, ...(j.secondaryLocations || []).map((x) => x.location)].filter(Boolean).join(' · ');
          out.push({
            source: 'ashby', extId: j.id, url: j.jobUrl, applyUrl: j.applyUrl, title: j.title, company: titleCase(b), location: loc,
            remote: !!j.isRemote || j.workplaceType === 'Remote', employmentType: j.employmentType || '',
            salary: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || '',
            ...parseSalary(j.compensation?.compensationTierSummary),
            description: j.descriptionPlain || htmlToText(j.descriptionHtml), tags: [j.department, j.team].filter(Boolean), postedAt: iso(j.publishedAt),
          });
        }
      });
      return out;
    },
  },
  adzuna: {
    name: 'Adzuna (needs free key)', keywordSearch: true, needsKey: true,
    async fetch({ keywords, location, settings }) {
      const { adzunaId, adzunaKey, adzunaCountry = 'us' } = settings || {};
      if (!adzunaId || !adzunaKey) throw new Error('Add your free Adzuna app id and key in Settings');
      const out = [];
      for (const q of (keywords.length ? keywords : ['']).slice(0, 5)) {
        for (let page = 1; page <= 2; page++) {
          const d = await getJson(`https://api.adzuna.com/v1/api/jobs/${adzunaCountry}/search/${page}?app_id=${encodeURIComponent(adzunaId)}&app_key=${encodeURIComponent(adzunaKey)}&results_per_page=50&max_days_old=30&content-type=application/json${q ? '&what=' + encodeURIComponent(q) : ''}${location ? '&where=' + encodeURIComponent(location) : ''}`);
          for (const j of d.results || []) out.push({
            source: 'adzuna', extId: String(j.id), url: j.redirect_url, title: htmlToText(j.title), company: j.company?.display_name || '', location: j.location?.display_name || '',
            remote: /remote/i.test(`${j.title} ${j.location?.display_name}`), employmentType: [j.contract_time, j.contract_type].filter(Boolean).join(', ').replace(/_/g, '-'),
            salary: money(j.salary_min, j.salary_max), salaryMin: j.salary_min || null, salaryMax: j.salary_max || null,
            description: htmlToText(j.description), tags: [j.category?.label].filter(Boolean), postedAt: iso(j.created),
          });
          if ((d.results || []).length < 50) break;
        }
      }
      return out;
    },
  },
};

function titleCase(slug) {
  return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// A few boards at a time; one company's board failing must not stop the others.
async function each(list, fn, size = 6) {
  const errors = [];
  for (let i = 0; i < list.length; i += size) {
    await Promise.all(list.slice(i, i + size).map((b) => fn(b).catch((e) => errors.push(`${b}: ${e.message}`))));
  }
  if (errors.length && errors.length === list.length) throw new Error(errors.slice(0, 3).join('; '));
}

// Run one search across its sources. Returns { jobs, errors }.
export async function runSources(search, settings) {
  const keywords = (search.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const errors = [];
  const jobs = [];
  await Promise.all((search.sources || []).map(async (id) => {
    const src = SOURCES[id];
    if (!src) return;
    try {
      const boards = src.boards ? (settings?.boards?.[id] ?? STARTER_BOARDS[id] ?? []).map((b) => String(b).trim()).filter(Boolean) : [];
      if (src.boards && !boards.length) return;
      const found = await src.fetch({ keywords, location: search.location || '', boards, settings });
      jobs.push(...found.filter((j) => j.url && j.title));
    } catch (e) {
      errors.push(`${src.name}: ${e.message === 'fetch failed' ? 'connection refused' : e.name === 'TimeoutError' ? 'no answer' : e.message}`);
    }
  }));
  // Every source is filtered the same way, even the ones that can't search by keyword.
  const loc = String(search.location || '').toLowerCase();
  const filtered = jobs.filter((j) => {
    if (!textMatches(j, keywords)) return false;
    if ((search.exclude || []).some((w) => w && `${j.title}`.toLowerCase().includes(String(w).toLowerCase()))) return false;
    if (search.remote === 'remote' && !j.remote) return false;
    if (search.remote === 'onsite' && j.remote) return false;
    if (loc && !j.remote && !String(j.location || '').toLowerCase().includes(loc)) return false;
    if (search.maxAgeDays && j.postedAt && (Date.now() - new Date(j.postedAt)) / 864e5 > search.maxAgeDays) return false;
    return true;
  });
  return { jobs: filtered, total: jobs.length, errors };
}
