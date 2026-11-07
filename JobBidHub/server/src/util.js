// Shared helpers. The job-matching keys are copied from the extension's background.js
// so "already applied" means exactly the same thing in the extension and the hub.

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// "Stripe, Inc." == "stripe"; "Senior Data Engineer (Remote) - US" == "Senior Data Engineer".
export const companyKey = (c) => String(c || '').toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pvt|group|holdings)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
export const titleKey = (t) => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s[-–—|@]\s.*$/, '').replace(/[^a-z0-9+#]+/g, ' ').trim();

export function sameJob(a, job) {
  const c1 = companyKey(a.company), c2 = companyKey(job.company);
  const t1 = titleKey(a.title), t2 = titleKey(job.title);
  if (!c1 || !c2 || !t1 || !t2) return false; // never match on the title alone
  const companyOk = c1 === c2 || (Math.min(c1.length, c2.length) >= 4 && (c1.includes(c2) || c2.includes(c1)));
  return companyOk && t1 === t2;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Keep params that commonly identify a job posting, drop tracking noise.
    const keep = ['jk', 'gh_jid', 'jobid', 'jobId', 'job_id', 'currentJobId', 'id', 'vjk'];
    const params = keep.filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`);
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase() + (params.length ? '?' + params.join('&') : '');
  } catch {
    return String(url || '');
  }
}

export const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

// Same normalisation as answerKey() in the extension.
export function questionKey(q) {
  return String(q ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
    .replace(/\b(required|optional)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', bull: '•', hellip: '…' };
export const decodeEntities = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// HTML job descriptions -> readable plain text (keeps paragraphs and bullets).
export function htmlToText(html) {
  let s = String(html || '');
  if (/&lt;\w/.test(s) && !/<\w/.test(s)) s = decodeEntities(s); // Greenhouse sends escaped HTML
  return decodeEntities(s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|\/p|\/div|\/h\d|\/ul|\/ol|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso)) / 864e5 : Infinity);
