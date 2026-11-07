// Local database (one SQLite file). Two kinds of data live here:
//  1. The extension's data (profiles, applications, resume files, settings, schedule...), stored in
//     tables but always convertible back to the exact chrome.storage shape, so syncing with the
//     extension loses nothing and every extension feature keeps working.
//  2. Hub-only data: the job board (jobs found by searches or seen in the browser) and saved searches.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, normalizeUrl, siteOf } from './util.js';

// Never stored in the hub: per-Chrome state (same list as the extension's DS_LOCAL_ONLY).
export const LOCAL_ONLY = ['syncState', 'hubConfig', 'hubState', 'lastBlockKey', 'panelCollapsed', 'panelWidth', 'panelPos', 'tabTop', 'panelTab', 'keyHealth', 'aiStatus', 'jobCache', 'ipInfo', 'lastKeyCheck', 'extUpdate', 'proxyCfg', 'proxyState'];

let db;
let dir = '';
// The data folder (database, secret.key, hub-config.json).
export const dataDir = () => dir;

// ---------- Profile secrets (the job-sites password) are encrypted on disk ----------
// AES-256-GCM with a random key kept next to the database (data/secret.key), made on first start.
// Profiles are encrypted when written and decrypted when read, so every other part sees plain text.
let secretKey = null;
function loadSecretKey(dir, dbFile) {
  const f = path.join(dir, 'secret.key');
  try { secretKey = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); } catch { /* first start */ }
  if (!secretKey || secretKey.length !== 32) {
    // A database without its key: a new key would make every saved password unreadable, silently.
    if (fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0 && process.env.JOBBID_NEW_KEY !== '1') {
      throw new Error([
        `JobBid Hub did not start: ${f} is missing or damaged, but the database already exists.`,
        String.raw`Copy secret.key back from a backup (JobBidHub\backups\<newest>\secret.key) into the data folder, then start again.`,
        'No backup? Start once with JOBBID_NEW_KEY=1 to make a new key - saved job-site and proxy passwords then have to be typed again.',
      ].join('\n'));
    }
    secretKey = crypto.randomBytes(32);
    fs.writeFileSync(f, secretKey.toString('base64'), { mode: 0o600 });
  }
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const out = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${out.toString('base64')}`;
}
function decrypt(s) {
  try {
    const [, iv, tag, data] = String(s).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}
// Other secrets kept by the hub (proxy passwords) use the same key.
export const sealSecret = (t) => encrypt(t);
export const openSecret = (s) => decrypt(s);
const SECRET_FIELDS = ['sitePassword'];
function sealProfile(p) {
  const out = { ...p };
  for (const k of SECRET_FIELDS) {
    if (out[k]) out[k + 'Enc'] = encrypt(out[k]); else delete out[k + 'Enc'];
    delete out[k];
  }
  return JSON.stringify(out);
}
function openProfile(json) {
  const p = J(json, null);
  if (!p) return p;
  for (const k of SECRET_FIELDS) if (p[k + 'Enc']) { p[k] = decrypt(p[k + 'Enc']); delete p[k + 'Enc']; }
  return p;
}
// Set by job writes; the health check turns it into a 'jobs changed' marker for live refresh.
export let jobsChanged = false;
let jobsMark = '';
export function jobsVersion() {
  if (jobsChanged) { jobsChanged = false; jobsMark = Date.now().toString(36); }
  return jobsMark;
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  dir = path.dirname(file);
  loadSecretKey(dir, file);
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, pos INTEGER, name TEXT, data TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, profile_id TEXT, profile_name TEXT, title TEXT, company TEXT, url TEXT, key TEXT, site TEXT,
      status TEXT, notes TEXT, date TEXT, job_id TEXT, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS apps_date ON applications(date);
    CREATE INDEX IF NOT EXISTS apps_profile ON applications(profile_id);
    CREATE INDEX IF NOT EXISTS apps_key ON applications(key);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, key TEXT UNIQUE, source TEXT, ext_id TEXT, url TEXT, apply_url TEXT, title TEXT, company TEXT,
      location TEXT, remote INTEGER DEFAULT 0, employment_type TEXT, seniority TEXT, salary TEXT, salary_min REAL, salary_max REAL,
      description TEXT, tags TEXT, posted_at TEXT, found_at TEXT, seen_at TEXT, updated_at TEXT,
      status TEXT DEFAULT 'new', search_ids TEXT DEFAULT '[]', scores TEXT DEFAULT '{}', overrides TEXT DEFAULT '{}', details TEXT DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS jobs_found ON jobs(found_at);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS searches (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT, version TEXT, last_seen TEXT, last_sync TEXT);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, search_id TEXT, started_at TEXT, finished_at TEXT, found INTEGER, added INTEGER, errors TEXT);
  `);
  return db;
}

export const getDb = () => db;
const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Revision: changes whenever the extension-shared data changes ----------

export function getMeta(key, def = '') {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? def;
}
export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
export const getRev = () => getMeta('rev', '');
export function bumpRev(rev) {
  rev ||= Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  setMeta('rev', rev);
  setMeta('savedAt', nowIso());
  return rev;
}

// ---------- Extension data <-> tables ----------

function appRow(a) {
  return [a.id, a.profileId || '', a.profileName || '', a.title || '', a.company || '', a.url || '', a.key || normalizeUrl(a.url), a.site || siteOf(a.url),
    a.status || 'Applied', a.notes || '', a.date || nowIso(), a.jobId || '', JSON.stringify(a)];
}
const INSERT_APP = `INSERT INTO applications (id, profile_id, profile_name, title, company, url, key, site, status, notes, date, job_id, data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id, profile_name=excluded.profile_name, title=excluded.title, company=excluded.company,
  url=excluded.url, key=excluded.key, site=excluded.site, status=excluded.status, notes=excluded.notes, date=excluded.date, job_id=excluded.job_id, data=excluded.data`;

// The whole extension dataset, in chrome.storage shape.
export function getData() {
  const data = {};
  for (const r of db.prepare('SELECT key, value FROM store').all()) data[r.key] = J(r.value, null);
  data.profiles = db.prepare('SELECT data FROM profiles ORDER BY pos, rowid').all().map((r) => openProfile(r.data) || {});
  data.applications = db.prepare('SELECT data FROM applications ORDER BY date DESC').all().map((r) => J(r.data, {}));
  for (const r of db.prepare('SELECT id, data FROM files').all()) data['file_' + r.id] = r.data;
  return data;
}

// Replace the whole extension dataset (what a sync upload does). Missing keys are deleted.
export function putData(data, rev) {
  return tx(() => {
    db.exec('DELETE FROM store; DELETE FROM profiles; DELETE FROM applications; DELETE FROM files;');
    const st = db.prepare('INSERT INTO store (key, value) VALUES (?, ?)');
    const pr = db.prepare('INSERT INTO profiles (id, pos, name, data, updated_at) VALUES (?, ?, ?, ?, ?)');
    const ap = db.prepare(INSERT_APP);
    const fi = db.prepare('INSERT INTO files (id, data) VALUES (?, ?)');
    for (const [k, v] of Object.entries(data || {})) {
      if (LOCAL_ONLY.includes(k) || v === undefined) continue;
      if (k === 'profiles') (v || []).forEach((p, i) => p?.id && pr.run(p.id, i, p.label || p.fullName || '', sealProfile(p), nowIso()));
      else if (k === 'applications') (v || []).forEach((a) => a?.id && ap.run(...appRow(a)));
      else if (k.startsWith('file_')) fi.run(k.slice(5), String(v));
      else st.run(k, JSON.stringify(v));
    }
    return bumpRev(rev);
  });
}

// ---------- Typed access used by the dashboard API (each write bumps the revision) ----------

export const getStore = (key, def) => J(db.prepare('SELECT value FROM store WHERE key = ?').get(key)?.value, def);
export function setStore(key, value) {
  db.prepare('INSERT INTO store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  bumpRev();
}

export const listProfiles = () => db.prepare('SELECT data FROM profiles ORDER BY pos, rowid').all().map((r) => openProfile(r.data) || {});
export const getProfile = (id) => openProfile(db.prepare('SELECT data FROM profiles WHERE id = ?').get(id)?.data);
export function saveProfile(p) {
  const pos = db.prepare('SELECT pos FROM profiles WHERE id = ?').get(p.id)?.pos ?? (db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM profiles').get().n);
  db.prepare(`INSERT INTO profiles (id, pos, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`)
    .run(p.id, pos, p.label || p.fullName || '', sealProfile(p), nowIso());
  bumpRev();
  return p;
}
// erase: also everything recorded about this candidate (a candidate who leaves asks for this).
export function deleteProfile(id, { erase = false } = {}) {
  const p = getProfile(id);
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  tx(() => {
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    // Resume files that belonged only to this profile.
    for (const r of p?.resumes || []) db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
    if (erase) {
      db.prepare('DELETE FROM applications WHERE profile_id = ?').run(id);
      for (const t of ['fill_problems', 'fill_reports', 'bids', 'job_activity']) if (has(t)) db.prepare(`DELETE FROM ${t} WHERE profile_id = ?`).run(id);
    }
  });
  bumpRev();
}

export function listApplications({ profileId, status, q, from, to, limit = 5000 } = {}) {
  const where = [], args = [];
  if (profileId) { where.push('profile_id = ?'); args.push(profileId); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date < ?'); args.push(to); }
  if (q) { where.push('(title LIKE ? OR company LIKE ? OR site LIKE ? OR notes LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  return db.prepare(`SELECT data FROM applications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC LIMIT ?`)
    .all(...args, limit).map((r) => J(r.data, {}));
}
export const getApplication = (id) => J(db.prepare('SELECT data FROM applications WHERE id = ?').get(id)?.data, null);
export function saveApplication(a) {
  db.prepare(INSERT_APP).run(...appRow(a));
  bumpRev();
  return a;
}
export function deleteApplication(id) {
  db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  bumpRev();
}

export const getFile = (id) => db.prepare('SELECT data FROM files WHERE id = ?').get(id)?.data ?? null;
export function saveFile(id, b64) {
  db.prepare('INSERT INTO files (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, b64);
  bumpRev();
}
export function deleteFile(id) {
  db.prepare('DELETE FROM files WHERE id = ?').run(id);
  bumpRev();
}

// ---------- Job board ----------

const JOB_COLS = ['id', 'key', 'source', 'ext_id', 'url', 'apply_url', 'title', 'company', 'location', 'remote', 'employment_type', 'seniority', 'salary',
  'salary_min', 'salary_max', 'description', 'tags', 'posted_at', 'found_at', 'seen_at', 'updated_at', 'status', 'search_ids', 'scores', 'overrides', 'details'];

export function jobFromRow(r) {
  if (!r) return null;
  return {
    id: r.id, key: r.key, source: r.source, extId: r.ext_id, url: r.url, applyUrl: r.apply_url, title: r.title, company: r.company,
    location: r.location, remote: !!r.remote, employmentType: r.employment_type, seniority: r.seniority, salary: r.salary,
    salaryMin: r.salary_min, salaryMax: r.salary_max, description: r.description, tags: J(r.tags, []), postedAt: r.posted_at,
    foundAt: r.found_at, seenAt: r.seen_at, updatedAt: r.updated_at, status: r.status, searchIds: J(r.search_ids, []),
    scores: J(r.scores, {}), overrides: J(r.overrides, {}), details: J(r.details, {}),
  };
}
function jobToRow(j) {
  return [j.id, j.key, j.source || '', j.extId || '', j.url || '', j.applyUrl || '', j.title || '', j.company || '', j.location || '',
    j.remote ? 1 : 0, j.employmentType || '', j.seniority || '', j.salary || '', j.salaryMin ?? null, j.salaryMax ?? null, j.description || '',
    JSON.stringify(j.tags || []), j.postedAt || '', j.foundAt || nowIso(), j.seenAt || '', nowIso(), j.status || 'new',
    JSON.stringify(j.searchIds || []), JSON.stringify(j.scores || {}), JSON.stringify(j.overrides || {}), JSON.stringify(j.details || {})];
}
export function upsertJob(j) {
  jobsChanged = true;
  db.prepare(`INSERT INTO jobs (${JOB_COLS.join(', ')}) VALUES (${JOB_COLS.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${JOB_COLS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`).run(...jobToRow(j));
  return j;
}
export const getJob = (id) => jobFromRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
export const getJobByKey = (key) => jobFromRow(db.prepare('SELECT * FROM jobs WHERE key = ?').get(key));
export const allJobs = () => db.prepare('SELECT * FROM jobs ORDER BY COALESCE(NULLIF(posted_at, \'\'), found_at) DESC').all().map(jobFromRow);
export function deleteJobs(where, ...args) {
  return db.prepare(`DELETE FROM jobs WHERE ${where}`).run(...args).changes;
}

export const listSearches = () => db.prepare('SELECT data FROM searches ORDER BY rowid').all().map((r) => J(r.data, {}));
export const getSearch = (id) => J(db.prepare('SELECT data FROM searches WHERE id = ?').get(id)?.data, null);
export function saveSearch(s) {
  db.prepare('INSERT INTO searches (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(s.id, JSON.stringify(s));
  return s;
}
export const deleteSearch = (id) => db.prepare('DELETE FROM searches WHERE id = ?').run(id);

export function addRun(r) {
  db.prepare('INSERT INTO runs (id, search_id, started_at, finished_at, found, added, errors) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.searchId, r.startedAt, r.finishedAt, r.found, r.added, JSON.stringify(r.errors || []));
  db.prepare('DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY started_at DESC LIMIT 200)').run();
}
export const listRuns = (limit = 30) => db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit).map((r) => ({ ...r, errors: J(r.errors, []) }));

export function touchClient(id, patch) {
  if (!id) return;
  const old = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) || {};
  const c = { name: old.name || '', version: old.version || '', last_seen: nowIso(), last_sync: old.last_sync || '', ...patch };
  db.prepare(`INSERT INTO clients (id, name, version, last_seen, last_sync) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, last_seen = excluded.last_seen, last_sync = excluded.last_sync`)
    .run(id, c.name, c.version, c.last_seen, c.last_sync);
}
export const listClients = () => db.prepare('SELECT * FROM clients ORDER BY last_seen DESC').all();
