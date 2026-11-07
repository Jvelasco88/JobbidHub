// Job board: store found jobs once (same URL or same company + title = same job), score them for
// every profile, link them to applications, and run saved searches on a timer.
import * as db from './db.js';
import { runSources, parseSalary } from './sources.js';
import { scoreAll, seniorityOf } from './match.js';
import { uid, nowIso, normalizeUrl, companyKey, titleKey, sameJob, htmlToText } from './util.js';

const dupKey = (j) => (companyKey(j.company) && titleKey(j.title) ? `${companyKey(j.company)}|${titleKey(j.title)}` : '');

let dupIndex = null; // company|title -> job id, rebuilt lazily
function findExisting(j) {
  const byUrl = db.getJobByKey(normalizeUrl(j.url));
  if (byUrl) return byUrl;
  if (!dupIndex) {
    dupIndex = new Map();
    for (const r of db.getDb().prepare('SELECT id, company, title FROM jobs').all()) { const k = dupKey(r); if (k) dupIndex.set(k, r.id); }
  }
  const k = dupKey(j);
  return k && dupIndex.has(k) ? db.getJob(dupIndex.get(k)) : null;
}

// Which profiles already applied to this job (same rule as the extension's "You already applied before!").
export function appliedFor(job, apps = db.listApplications()) {
  const key = normalizeUrl(job.url), key2 = job.applyUrl ? normalizeUrl(job.applyUrl) : '';
  return apps.filter((a) => a.key === key || (key2 && a.key === key2) || (job.id && a.jobId === job.id) || sameJob(a, job));
}

// Add or refresh jobs. Returns { added, updated, ids }.
export function ingest(found, { searchId = '', seen = false } = {}) {
  const profiles = db.listProfiles();
  const apps = db.listApplications();
  let added = 0, updated = 0;
  const ids = [];
  db.tx(() => {
    for (const f of found) {
      const old = findExisting(f);
      const salary = f.salaryMin || f.salaryMax ? {} : parseSalary(f.salary);
      const job = {
        ...(old || {}),
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))),
        ...salary,
        id: old?.id || uid(),
        key: old?.key || normalizeUrl(f.url),
        foundAt: old?.foundAt || nowIso(),
        status: old?.status || 'new',
        searchIds: [...new Set([...(old?.searchIds || []), ...(searchId ? [searchId] : [])])],
        seenAt: seen ? nowIso() : old?.seenAt || '',
        overrides: old?.overrides || {},
        details: { ...(old?.details || {}), ...(f.details || {}) },
      };
      // Keep the longer description (search APIs often send a short excerpt).
      if (old?.description && (f.description || '').length < old.description.length) job.description = old.description;
      job.seniority ||= seniorityOf(job.title);
      job.scores = scoreAll(profiles, job);
      if (job.status === 'new' && appliedFor(job, apps).length) job.status = 'applied';
      db.upsertJob(job);
      if (dupIndex && dupKey(job)) dupIndex.set(dupKey(job), job.id);
      ids.push(job.id);
      old ? updated++ : added++;
    }
  });
  return { added, updated, ids };
}

// What scoring depends on; when it changes, every job is re-scored.
export const scoringSig = () => JSON.stringify(db.listProfiles().map((p) => [p.id, p.skills, p.headline, p.currentTitle, p.criteria, p.requiresSponsorship, p.country]));

// After the extension synced: mark newly applied jobs, and re-score if profiles changed.
export function afterSync(prevSig) {
  if (prevSig !== scoringSig()) return rescoreAll();
  const apps = db.listApplications();
  db.tx(() => {
    for (const j of db.allJobs()) {
      const applied = appliedFor(j, apps).length > 0;
      if (applied && j.status !== 'applied' && j.status !== 'hidden') db.upsertJob({ ...j, status: 'applied' });
      else if (!applied && j.status === 'applied') db.upsertJob({ ...j, status: 'new' });
    }
  });
  return 0;
}

// Profiles or criteria changed: recompute every job's scores.
export function rescoreAll() {
  const profiles = db.listProfiles();
  const apps = db.listApplications();
  let n = 0;
  db.tx(() => {
    for (const j of db.allJobs()) {
      j.scores = scoreAll(profiles, j);
      const applied = appliedFor(j, apps).length > 0;
      if (applied && j.status !== 'hidden') j.status = 'applied';
      else if (!applied && j.status === 'applied') j.status = 'new';
      db.upsertJob(j);
      n++;
    }
  });
  return n;
}

// A job page opened in Chrome (sent by the extension): add it to the board as "seen".
export function jobSeen(p) {
  if (!p?.url || !/^https?:/.test(p.url)) return null;
  const d = p.details || {};
  const desc = String(p.description || '');
  const r = ingest([{
    source: 'browser', url: p.url, title: d.title || p.title, company: d.company || p.company, location: d.location || '',
    remote: /remote/i.test(`${d.workMode} ${d.location}`), employmentType: d.employmentType || '', seniority: d.seniority || '',
    salary: d.salary || '', description: /<\w/.test(desc) ? htmlToText(desc) : desc, tags: d.skills || [], details: d,
  }], { seen: true });
  return db.getJob(r.ids[0]);
}

// ---------- Saved searches ----------

export const DEFAULT_SEARCH = {
  name: 'New search', keywords: [], exclude: [], location: '', remote: 'any', maxAgeDays: 14,
  sources: ['remoteok', 'jobicy', 'greenhouse', 'lever', 'ashby'], everyHours: 6, enabled: true, profileId: '',
};

const running = new Map();
export const isRunning = (id) => running.has(id);

export function runSearch(id) {
  if (running.has(id)) return running.get(id);
  const p = (async () => {
    const s = db.getSearch(id);
    if (!s) throw new Error('Search not found');
    const startedAt = nowIso();
    const settings = db.getStore('hub', {}) || {};
    const { jobs, total, errors } = await runSources(s, settings);
    const r = ingest(jobs, { searchId: id });
    const run = { id: uid(), searchId: id, startedAt, finishedAt: nowIso(), found: jobs.length, added: r.added, errors };
    db.addRun(run);
    db.saveSearch({ ...db.getSearch(id), lastRun: run.finishedAt, lastFound: jobs.length, lastAdded: r.added, lastErrors: errors, lastTotal: total });
    return run;
  })().finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

// Every few minutes: run searches that are due. Also prune old, untouched jobs.
export function startScheduler(log) {
  const tick = async () => {
    for (const s of db.listSearches()) {
      if (s.enabled === false || !s.everyHours || running.has(s.id)) continue;
      const due = !s.lastRun || Date.now() - new Date(s.lastRun) >= s.everyHours * 3600e3;
      if (due) await runSearch(s.id).then((r) => log.info(`Search "${s.name}": ${r.found} found, ${r.added} new`)).catch((e) => log.warn(`Search "${s.name}" failed: ${e.message}`));
    }
    const keepDays = Number(db.getStore('hub', {})?.keepDays) || 45;
    dupIndex = null;
    db.deleteJobs(`status = 'new' AND found_at < ? AND (seen_at IS NULL OR seen_at = '')`, new Date(Date.now() - keepDays * 864e5).toISOString());
  };
  setTimeout(tick, 15000);
  return setInterval(tick, 5 * 60 * 1000);
}
