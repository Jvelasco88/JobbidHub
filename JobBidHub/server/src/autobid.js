// Auto bid: a queue of jobs to apply to, worked through by the JobBid extension in Chrome.
// The hub decides WHAT to apply to (each profile's Qualified jobs on supported sites, within the daily
// limit and the pause between applications); the extension does the applying and reports back.
// Every account has its own queue and settings; a Chrome only runs the queue of the account it is signed in to.
import * as db from './db.js';
import * as jobs from './jobs.js';
import { sees, jobFilter } from './scope.js';
import { uid, nowIso, companyKey } from './util.js';
import { addNotice } from './notices.js';

const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });

export const DEFAULT_CONFIG = {
  mode: 'review', // 'review': fill everything, you press Submit · 'auto': submit by itself
  perDay: 40, // per profile
  gapMin: 1, gapMax: 3, // minutes between applications
  onePerCompany: true, // one of your profiles per company
  profileIds: [],
  running: false,
  nextAt: '',
  lastPoll: '',
};
const ACTIVE = ['queued', 'running'];
const DONE_OK = ['submitted', 'review'];
const MAX_OPEN_REVIEWS = 3; // review tabs waiting for you before new ones stop opening
const MAX_FAIL_STREAK = 5; // problems in a row before auto bid stops by itself (keys, proxy or a site broke)
// Submit was pressed but no confirmation was seen: it may have gone through, so it is never sent again by
// itself, and it counts toward the day's limit.
const PRESSED = "json_extract(detail, '$.submitPressed') = 1";
// Applications that count toward a profile's limit for today, over every account that runs this profile.
const doneTodaySql = `(status IN ('submitted', 'review') OR ${PRESSED}) AND finished_at >= ?`;

function initTable() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY, owner_id TEXT, profile_id TEXT, profile_name TEXT, job_id TEXT, title TEXT, company TEXT, url TEXT,
      score REAL, status TEXT, reason TEXT, detail TEXT DEFAULT '{}', created_at TEXT, started_at TEXT, finished_at TEXT);
    CREATE INDEX IF NOT EXISTS bids_owner ON bids(owner_id, status);
  `);
}

const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const rowToBid = (r) => ({ id: r.id, profileId: r.profile_id, profileName: r.profile_name, jobId: r.job_id, title: r.title, company: r.company, url: r.url,
  score: r.score, status: r.status, reason: r.reason || '', detail: J(r.detail, {}), createdAt: r.created_at, startedAt: r.started_at || '', finishedAt: r.finished_at || '' });

const configKey = (ownerId) => `autobid:${ownerId || 'local'}`;
export const getConfig = (ownerId) => ({ ...DEFAULT_CONFIG, ...(db.getStore(configKey(ownerId), {}) || {}) });
// Stored without bumping the sync revision: this is hub-only state, the extension doesn't need a resync.
function saveConfig(ownerId, c) {
  db.getDb().prepare('INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(configKey(ownerId), JSON.stringify(c));
  return c;
}

// The page where the application form is, for the sites auto bid supports. null = not supported yet
// (sites that need an account or have many pages: Workday, iCIMS, Taleo...).
export function bidUrl(job) {
  const raw = job.applyUrl || job.url;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)lever\.co$/.test(host)) {
    if (parts.length < 2) return null;
    return `https://${host}/${parts[0]}/${parts[1]}/apply`;
  }
  if (/(^|\.)ashbyhq\.com$/.test(host)) {
    if (parts.length < 2) return null;
    return `https://${host}/${parts[0]}/${parts[1]}/application`;
  }
  if (/(^|\.)greenhouse\.io$/.test(host)) return u.toString();
  return null;
}
export const siteName = (url) => (/lever\.co/.test(url) ? 'Lever' : /ashbyhq/.test(url) ? 'Ashby' : /greenhouse/.test(url) ? 'Greenhouse' : '');

const startOfDay = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
const listBids = (ownerId, where = '', ...args) => db.getDb().prepare(`SELECT * FROM bids WHERE owner_id = ? ${where} ORDER BY created_at DESC, score DESC LIMIT 1000`).all(ownerId, ...args).map(rowToBid);
function setBid(id, patch) {
  const cols = { status: 'status', reason: 'reason', startedAt: 'started_at', finishedAt: 'finished_at', url: 'url' };
  const sets = [], args = [];
  for (const [k, c] of Object.entries(cols)) if (k in patch) { sets.push(`${c} = ?`); args.push(patch[k]); }
  if ('detail' in patch) { sets.push('detail = ?'); args.push(JSON.stringify(patch.detail || {})); }
  if (sets.length) db.getDb().prepare(`UPDATE bids SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
}

// Build the queue: each chosen profile's Qualified jobs that it hasn't applied to and that aren't queued yet.
function buildQueue(req, profileIds, cfg) {
  const ownerId = req.user.id;
  const apps = db.listApplications();
  const visible = jobFilter(req, db.listSearches(), apps, jobs.appliedFor);
  const profiles = db.listProfiles().filter((p) => profileIds.includes(p.id) && sees(req.scope, p.id));
  const existing = db.getDb().prepare('SELECT profile_id, job_id, company, status FROM bids WHERE owner_id = ?').all(ownerId);
  // A job already in the list for this profile (any result) is not added again: use Retry on it instead.
  const queuedPair = new Set(existing.map((b) => `${b.profile_id}|${b.job_id}`));
  // Companies already taken by one of these profiles (applied, queued or done).
  const myIds = new Set(profiles.map((p) => p.id));
  const takenBy = new Map();
  for (const a of apps) if (myIds.has(a.profileId) && companyKey(a.company)) takenBy.set(companyKey(a.company), a.profileId);
  for (const b of existing) if (!['skipped', 'failed'].includes(b.status) && companyKey(b.company)) takenBy.set(companyKey(b.company), b.profile_id);

  const ins = db.getDb().prepare('INSERT INTO bids (id, owner_id, profile_id, profile_name, job_id, title, company, url, score, status, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const stats = { added: 0, unsupported: 0, applied: 0, company: 0, already: 0 };
  const candidates = [];
  for (const j of db.allJobs()) {
    if (!['new', 'saved'].includes(j.status) || !visible(j)) continue;
    for (const p of profiles) {
      const s = j.scores?.[p.id];
      if (!s?.qualified) continue;
      candidates.push({ j, p, score: s.score || 0 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const now = nowIso();
  db.tx(() => {
    for (const { j, p, score } of candidates) {
      if (queuedPair.has(`${p.id}|${j.id}`)) { stats.already++; continue; }
      if (jobs.appliedFor(j, apps).some((a) => a.profileId === p.id)) { stats.applied++; continue; }
      const url = bidUrl(j);
      if (!url) { stats.unsupported++; continue; }
      const ck = companyKey(j.company);
      if (cfg.onePerCompany && ck && takenBy.has(ck) && takenBy.get(ck) !== p.id) { stats.company++; continue; }
      if (ck) takenBy.set(ck, p.id);
      queuedPair.add(`${p.id}|${j.id}`);
      ins.run(uid(), ownerId, p.id, p.label || p.fullName || '', j.id, j.title || '', j.company || '', url, score, 'queued', '', JSON.stringify({ site: siteName(url) }), now);
      stats.added++;
    }
  });
  return stats;
}

function counts(ownerId) {
  const out = { queued: 0, running: 0, submitted: 0, review: 0, needs: 0, skipped: 0, failed: 0 };
  for (const r of db.getDb().prepare('SELECT status, COUNT(*) AS n FROM bids WHERE owner_id = ? GROUP BY status').all(ownerId)) out[r.status] = r.n;
  const today = db.getDb().prepare('SELECT profile_id, COUNT(*) AS n FROM bids WHERE owner_id = ? AND status IN (\'submitted\', \'review\') AND finished_at >= ? GROUP BY profile_id').all(ownerId, startOfDay());
  out.today = Object.fromEntries(today.map((r) => [r.profile_id, r.n]));
  return out;
}

function view(req) {
  const ownerId = req.user.id;
  const cfg = getConfig(ownerId);
  const items = listBids(ownerId).filter((b) => sees(req.scope, b.profileId));
  return { config: cfg, counts: counts(ownerId), items, now: nowIso() };
}

export default async function autobidRoutes(app) {
  initTable();

  app.get('/api/autobid', async (req) => view(req));

  app.put('/api/autobid/config', async (req) => {
    const b = req.body || {};
    const cfg = getConfig(req.user.id);
    if (b.mode) cfg.mode = b.mode === 'auto' ? 'auto' : 'review';
    if (b.perDay != null) cfg.perDay = Math.max(1, Math.min(500, Number(b.perDay) || 40));
    if (b.gapMin != null) cfg.gapMin = Math.max(0, Math.min(120, Number(b.gapMin) || 0));
    if (b.gapMax != null) cfg.gapMax = Math.max(cfg.gapMin, Math.min(240, Number(b.gapMax) || cfg.gapMin));
    if (b.onePerCompany != null) cfg.onePerCompany = !!b.onePerCompany;
    if (Array.isArray(b.profileIds)) cfg.profileIds = b.profileIds.filter((id) => sees(req.scope, id));
    saveConfig(req.user.id, cfg);
    return view(req);
  });

  // Fill the queue from the chosen profiles' Qualified jobs and start.
  app.post('/api/autobid/start', async (req) => {
    const cfg = getConfig(req.user.id);
    const ids = (Array.isArray(req.body?.profileIds) ? req.body.profileIds : cfg.profileIds).filter((id) => sees(req.scope, id));
    if (!ids.length) throw httpError(400, 'Choose at least one profile.');
    cfg.profileIds = ids;
    const stats = buildQueue(req, ids, cfg);
    const queued = db.getDb().prepare('SELECT COUNT(*) AS n FROM bids WHERE owner_id = ? AND status = \'queued\'').get(req.user.id).n;
    cfg.running = queued > 0;
    cfg.nextAt = '';
    cfg.failStreak = 0;
    cfg.stopReason = '';
    saveConfig(req.user.id, cfg);
    return { ...view(req), stats };
  });

  app.post('/api/autobid/stop', async (req) => {
    const cfg = getConfig(req.user.id);
    cfg.running = false;
    saveConfig(req.user.id, cfg);
    return view(req);
  });

  // Remove waiting items, or finished ones ("clear the list").
  app.post('/api/autobid/clear', async (req) => {
    // Filled-for-you forms and pressed Submits stay: without them the same job could be queued again.
    const which = req.body?.which === 'queued' ? ['queued'] : ['submitted', 'needs', 'skipped', 'failed'];
    const keep = req.body?.which === 'queued' ? '' : ` AND NOT (${PRESSED})`;
    db.getDb().prepare(`DELETE FROM bids WHERE owner_id = ? AND status IN (${which.map(() => '?').join(', ')})${keep}`).run(req.user.id, ...which);
    return view(req);
  });

  app.post('/api/autobid/items/:id/retry', async (req) => {
    const r = db.getDb().prepare('SELECT * FROM bids WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
    if (!r) throw httpError(404, 'Not found');
    // It may already have been sent: only when you say so (you checked the tab or the email).
    const sent = r.status === 'submitted' || r.status === 'review' || !!J(r.detail, {}).submitPressed;
    if (sent && !req.body?.force) throw httpError(409, r.status === 'review' ? 'This form was filled for you. If you pressed Submit in that tab, trying again applies twice.' : 'Submit was already pressed for this job. Trying again may apply twice.');
    const detail = J(r.detail, {});
    delete detail.submitPressed;
    setBid(r.id, { status: 'queued', reason: '', startedAt: '', finishedAt: '', detail });
    return view(req);
  });
  app.delete('/api/autobid/items/:id', async (req) => {
    db.getDb().prepare('DELETE FROM bids WHERE id = ? AND owner_id = ? AND status != \'running\'').run(req.params.id, req.user.id);
    return view(req);
  });

  // ---------- Used by the extension ----------

  // The next job to apply to, or how long to wait. openReviews: review tabs still open in that Chrome.
  app.get('/api/autobid/next', async (req) => {
    const ownerId = req.user.id;
    const cfg = getConfig(ownerId);
    cfg.lastPoll = nowIso();
    saveConfig(ownerId, cfg);
    // An item stuck "running" (Chrome closed, page hung): give up on it.
    const stale = new Date(Date.now() - 12 * 60000).toISOString();
    for (const r of db.getDb().prepare('SELECT id FROM bids WHERE owner_id = ? AND status = \'running\' AND started_at < ?').all(ownerId, stale)) {
      setBid(r.id, { status: 'failed', reason: 'Timed out (the page did not finish).', finishedAt: nowIso() });
    }
    if (!cfg.running) return { idle: true, config: cfg };
    if (db.getDb().prepare('SELECT 1 FROM bids WHERE owner_id = ? AND status = \'running\'').get(ownerId)) return { busy: true, config: cfg };
    // Also in Full auto: forms held back for a check (AI guesses) stay open for you there too.
    if (Number(req.query.openReviews || 0) >= MAX_OPEN_REVIEWS) return { wait: 30000, why: `${MAX_OPEN_REVIEWS} filled forms are waiting for you to submit`, config: cfg };
    const waitMs = cfg.nextAt ? new Date(cfg.nextAt) - Date.now() : 0;
    if (waitMs > 0) return { wait: waitMs, why: 'Pause between applications', config: cfg };

    const today = Object.fromEntries(db.getDb().prepare(`SELECT profile_id, COUNT(*) AS n FROM bids WHERE ${doneTodaySql} GROUP BY profile_id`).all(startOfDay()).map((r) => [r.profile_id, r.n]));
    const queued = db.getDb().prepare('SELECT * FROM bids WHERE owner_id = ? AND status = \'queued\' ORDER BY created_at, score DESC').all(ownerId).map(rowToBid);
    const apps = db.listApplications();
    let limited = 0; // still queued, but their profile reached today's limit
    for (const b of queued) {
      if (!sees(req.scope, b.profileId)) continue;
      if ((today[b.profileId] || 0) >= cfg.perDay) { limited++; continue; } // this profile's limit for today
      // Applied meanwhile (by hand, or from another Chrome): skip.
      const job = db.getJob(b.jobId);
      if (!job) { setBid(b.id, { status: 'skipped', reason: 'The job was removed from the board.', finishedAt: nowIso() }); continue; }
      if (jobs.appliedFor(job, apps).some((a) => a.profileId === b.profileId)) { setBid(b.id, { status: 'skipped', reason: 'Already applied with this profile.', finishedAt: nowIso() }); continue; }
      // Another account runs the same profile and has this job going or done.
      const other = db.getDb().prepare(`SELECT 1 FROM bids WHERE profile_id = ? AND job_id = ? AND id != ? AND (status IN ('running', 'submitted', 'review') OR ${PRESSED})`).get(b.profileId, b.jobId, b.id);
      if (other) { setBid(b.id, { status: 'skipped', reason: 'Another account is applying (or applied) to this job with this profile.', finishedAt: nowIso() }); continue; }
      setBid(b.id, { status: 'running', startedAt: nowIso() });
      return { item: { ...b, status: 'running', mode: cfg.mode }, config: cfg };
    }
    // Only jobs held back by the limit mean waiting; the ones just skipped are done.
    if (limited) return { wait: 10 * 60000, why: 'Daily limit reached for the profiles left in the queue', config: cfg };
    cfg.running = false; // nothing left
    saveConfig(ownerId, cfg);
    return { done: true, config: cfg };
  });

  // The extension's result for one job.
  app.post('/api/autobid/report', async (req) => {
    const b = req.body || {};
    const r = db.getDb().prepare('SELECT * FROM bids WHERE id = ? AND owner_id = ?').get(b.id, req.user.id);
    if (!r) throw httpError(404, 'Not found');
    const status = ['submitted', 'review', 'needs', 'skipped', 'failed'].includes(b.status) ? b.status : 'failed';
    setBid(r.id, { status, reason: String(b.reason || '').slice(0, 500), finishedAt: nowIso(), detail: { ...J(r.detail, {}), ...(b.detail || {}) }, ...(b.url ? { url: String(b.url) } : {}) });
    if (status === 'submitted') {
      const job = db.getJob(r.job_id);
      if (job) db.upsertJob({ ...job, status: 'applied' });
    }
    // The pause before the next application starts now.
    const cfg = getConfig(req.user.id);
    // Problems in a row (not "job closed" or "already applied"): something is broken - stop instead of
    // running through the whole queue.
    // "Needs you" counts only in Full auto: in Review mode those tabs stay open and already pause the queue at 3.
    if ((status === 'failed' || (status === 'needs' && cfg.mode === 'auto')) && !b.detail?.submitPressed) cfg.failStreak = (cfg.failStreak || 0) + 1;
    else if (['submitted', 'review'].includes(status)) cfg.failStreak = 0;
    if (cfg.running && (cfg.failStreak || 0) >= MAX_FAIL_STREAK) {
      cfg.running = false;
      cfg.failStreak = 0;
      cfg.stopReason = `Stopped by itself after ${MAX_FAIL_STREAK} problems in a row. Last one: ${String(b.reason || status).slice(0, 200)}`;
      addNotice({ actor: 'JobBid', audience: `user:${req.user.id}`, kind: 'autobid', changes: [{ label: 'Auto bid', value: cfg.stopReason }] });
    }
    const mins = cfg.gapMin + Math.random() * Math.max(0, cfg.gapMax - cfg.gapMin);
    cfg.nextAt = ['submitted', 'review'].includes(status) ? new Date(Date.now() + mins * 60000).toISOString() : new Date(Date.now() + 5000).toISOString();
    saveConfig(req.user.id, cfg);
    return { ok: true };
  });
}
