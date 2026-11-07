// Fill reports: after every Fill the extension sends what went wrong on the page (an answer the site
// cleared or refused, a red error under a box, a required question with no answer), with the question's
// page code. The Problems page groups them by question, so a whole kind of problem is fixed at once.
import * as db from './db.js';
import { nowIso, siteOf } from './util.js';

const KEEP_DAYS = 60;
const STATUSES = ['failed', 'cleared', 'site-error', 'unanswered'];

function initTable() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS fill_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id TEXT, user_name TEXT, profile_id TEXT, profile_name TEXT,
      url TEXT, page_url TEXT, site TEXT, platform TEXT, title TEXT, company TEXT, version TEXT, fields INTEGER, filled INTEGER, problems INTEGER);
    CREATE INDEX IF NOT EXISTS fill_reports_at ON fill_reports(at);
    CREATE TABLE IF NOT EXISTS fill_problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER, at TEXT, profile_id TEXT, platform TEXT, qkey TEXT, q TEXT, status TEXT,
      kind TEXT, required INTEGER, options TEXT, value TEXT, error TEXT, html TEXT);
    CREATE INDEX IF NOT EXISTS fill_problems_key ON fill_problems(qkey);
    CREATE INDEX IF NOT EXISTS fill_problems_at ON fill_problems(at);
    -- "Fixed": the question is hidden until it goes wrong again after this time.
    CREATE TABLE IF NOT EXISTS fill_problem_done (qkey TEXT PRIMARY KEY, at TEXT, by_name TEXT);
  `);
  // Added later: how long the fill took, and its slowest boxes.
  for (const col of ['ms INTEGER', 'slow TEXT']) { try { db.getDb().exec(`ALTER TABLE fill_reports ADD COLUMN ${col}`); } catch { /* already there */ } }
}

// The application system behind an address (many companies, one form builder), else the site itself.
const PLATFORMS = [
  [/myworkdayjobs|workday/, 'Workday'], [/smartrecruiters/, 'SmartRecruiters'], [/greenhouse/, 'Greenhouse'], [/lever\.co/, 'Lever'],
  [/ashbyhq/, 'Ashby'], [/icims/, 'iCIMS'], [/successfactors|sapsf/, 'SuccessFactors'], [/taleo/, 'Taleo'], [/oraclecloud/, 'Oracle'],
  [/jobvite/, 'Jobvite'], [/workable/, 'Workable'], [/bamboohr/, 'BambooHR'], [/paylocity/, 'Paylocity'], [/adp\.com/, 'ADP'],
  [/ultipro|ukg/, 'UKG'], [/service-now|servicenow/, 'ServiceNow'], [/dayforce|ceridian/, 'Dayforce'], [/jazzhr|applytojob/, 'JazzHR'],
  [/linkedin/, 'LinkedIn'], [/indeed/, 'Indeed'], [/dice\.com/, 'Dice'],
];
export const platformOf = (url) => {
  const h = siteOf(url);
  return PLATFORMS.find(([re]) => re.test(h))?.[1] || h;
};
// The same question on every site: "1 * . Are you 18?" and "Are you 18" are one.
export const questionKey = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^\s*\d+\s+/, '').trim().slice(0, 200);

const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const s = (v, n) => String(v ?? '').slice(0, n);
const J = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const sinceOf = (days) => new Date(Date.now() - (Number(days) || 30) * 864e5).toISOString();
// A user sees reports for their own profiles only; an admin sees everyone's.
const scopeSql = (req, col) => (req.scope ? { sql: ` AND ${col} IN (${[...req.scope].map(() => '?').join(',') || "''"})`, args: [...req.scope] } : { sql: '', args: [] });

let lastPrune = 0;
function prune() {
  if (Date.now() - lastPrune < 3600e3) return;
  lastPrune = Date.now();
  const old = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  db.getDb().prepare('DELETE FROM fill_problems WHERE at < ?').run(old);
  db.getDb().prepare('DELETE FROM fill_reports WHERE at < ?').run(old);
}

export default async function fillReportRoutes(app) {
  initTable();

  // The extension, by itself after each fill.
  app.post('/api/fill-reports', async (req) => {
    if (!req.user) throw httpError(401, 'Please sign in.');
    const r = req.body || {};
    if (!/^https?:\/\//i.test(String(r.url || ''))) throw httpError(400, 'Missing page');
    if (req.scope && r.profileId && !req.scope.has(r.profileId)) return { ok: false };
    prune();
    const at = nowIso();
    const problems = (Array.isArray(r.problems) ? r.problems : []).slice(0, 40).filter((p) => STATUSES.includes(p?.status) && questionKey(p.q));
    // A form in a frame: the frame's system (iCIMS, Workday...), else the page around it.
    const own = platformOf(r.url);
    const platform = own !== siteOf(r.url) || !r.pageUrl ? own : platformOf(r.pageUrl);
    const conn = db.getDb();
    return db.tx(() => {
      const { lastInsertRowid: id } = conn.prepare(`INSERT INTO fill_reports (at, user_id, user_name, profile_id, profile_name, url, page_url, site, platform, title, company, version, fields, filled, problems, ms, slow)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(at, req.user.id, s(req.user.name, 120), s(r.profileId, 80), s(r.profileName, 120), s(r.url, 1000), s(r.pageUrl, 1000), siteOf(r.url), s(platform, 80),
          s(r.title, 300), s(r.company, 200), s(r.version, 20), Number(r.fields) || 0, Number(r.filled) || 0, problems.length,
          Math.max(0, Math.round(Number(r.ms) || 0)), JSON.stringify((Array.isArray(r.slow) ? r.slow : []).slice(0, 15).map((x) => ({ q: s(x?.q, 160), kind: s(x?.kind, 20), ms: Math.round(Number(x?.ms) || 0), ok: !!x?.ok }))));
      const add = conn.prepare(`INSERT INTO fill_problems (report_id, at, profile_id, platform, qkey, q, status, kind, required, options, value, error, html)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of problems) {
        const options = (Array.isArray(p.options) ? p.options : []).slice(0, 40).map((o) => s(o, 120));
        add.run(id, at, s(r.profileId, 80), s(platform, 80), questionKey(p.q), s(p.q, 300), p.status, s(p.kind, 20), p.required ? 1 : 0,
          JSON.stringify(options), s(p.value, 300), s(p.error, 300), s(p.html, 6000));
      }
      return { ok: true, id: Number(id) };
    });
  });

  // Problems grouped by question, most frequent first. Questions marked Fixed are hidden until they
  // go wrong again (pass done=1 to see them too).
  app.get('/api/fill-problems', async (req) => {
    const since = sinceOf(req.query.days);
    const sc = scopeSql(req, 'profile_id');
    const rows = db.getDb().prepare(`SELECT p.*, r.url, r.title, r.company, r.profile_name, r.version FROM fill_problems p LEFT JOIN fill_reports r ON r.id = p.report_id
      WHERE p.at >= ?${sc.sql.replace('profile_id', 'p.profile_id')} ORDER BY p.at DESC LIMIT 20000`).all(since, ...sc.args);
    const done = new Map(db.getDb().prepare('SELECT qkey, at, by_name FROM fill_problem_done').all().map((d) => [d.qkey, d]));
    const groups = new Map();
    for (const row of rows) {
      let g = groups.get(row.qkey);
      if (!g) {
        g = { key: row.qkey, q: row.q, count: 0, last: row.at, first: row.at, statuses: {}, platforms: {}, kinds: {}, samples: [], done: null };
        groups.set(row.qkey, g);
      }
      const d = done.get(row.qkey);
      // After "Fixed": only newer cases count; older ones stay as history.
      if (d && row.at <= d.at) { g.done = { at: d.at, by: d.by_name }; continue; }
      g.count++;
      g.first = row.at;
      g.statuses[row.status] = (g.statuses[row.status] || 0) + 1;
      g.platforms[row.platform] = (g.platforms[row.platform] || 0) + 1;
      g.kinds[row.kind] = (g.kinds[row.kind] || 0) + 1;
      if (g.samples.length < 5) {
        g.samples.push({ id: row.id, at: row.at, status: row.status, kind: row.kind, required: !!row.required, options: J(row.options, []), value: row.value, error: row.error,
          html: row.html, url: row.url, title: row.title, company: row.company, profileName: req.scope && !req.scope.has(row.profile_id) ? '' : row.profile_name, version: row.version, platform: row.platform });
      }
    }
    let list = [...groups.values()];
    if (req.query.done !== '1') list = list.filter((g) => g.count > 0);
    for (const g of list) if (g.count > 0 && g.done) g.done = { ...g.done, again: true };
    const status = String(req.query.status || '');
    if (STATUSES.includes(status)) list = list.filter((g) => g.statuses[status]);
    const platform = String(req.query.platform || '');
    if (platform) list = list.filter((g) => g.platforms[platform]);
    return list.sort((a, b) => b.count - a.count || (b.last > a.last ? 1 : -1)).slice(0, 500);
  });

  // How well Fill works per application system: fills, boxes filled, problems.
  app.get('/api/fill-reports/stats', async (req) => {
    const since = sinceOf(req.query.days);
    const sc = scopeSql(req, 'profile_id');
    const rows = db.getDb().prepare(`SELECT platform, COUNT(*) AS fills, SUM(fields) AS fields, SUM(filled) AS filled, SUM(problems) AS problems,
      SUM(CASE WHEN problems = 0 THEN 1 ELSE 0 END) AS clean, MAX(at) AS last, ROUND(AVG(CASE WHEN ms > 0 THEN ms END)) AS avgMs FROM fill_reports WHERE at >= ?${sc.sql} GROUP BY platform ORDER BY fills DESC`).all(since, ...sc.args);
    return rows.map((r) => ({ ...r, fields: r.fields || 0, filled: r.filled || 0, problems: r.problems || 0, clean: r.clean || 0 }));
  });

  // The slowest boxes lately (where fill time goes), most time first.
  app.get('/api/fill-reports/slow', async (req) => {
    const sc = scopeSql(req, 'profile_id');
    const rows = db.getDb().prepare(`SELECT platform, url, ms, slow, at FROM fill_reports WHERE at >= ? AND slow IS NOT NULL${sc.sql} ORDER BY at DESC LIMIT 500`).all(sinceOf(req.query.days), ...sc.args);
    const by = new Map();
    for (const r of rows) for (const x of J(r.slow, [])) {
      const k = `${r.platform}|${x.kind}|${x.q}`;
      const g = by.get(k) || { platform: r.platform, q: x.q, kind: x.kind, count: 0, totalMs: 0, maxMs: 0, failed: 0, url: r.url };
      g.count++; g.totalMs += x.ms; g.maxMs = Math.max(g.maxMs, x.ms); if (!x.ok) g.failed++;
      by.set(k, g);
    }
    return [...by.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 100);
  });

  // Mark a question Fixed (or not): hidden until it goes wrong again.
  app.put('/api/fill-problems/done', async (req) => {
    const { key, done } = req.body || {};
    if (!key || typeof key !== 'string') throw httpError(400, 'Missing question');
    if (done) db.getDb().prepare('INSERT INTO fill_problem_done (qkey, at, by_name) VALUES (?, ?, ?) ON CONFLICT(qkey) DO UPDATE SET at = excluded.at, by_name = excluded.by_name').run(key, nowIso(), s(req.user?.name, 120));
    else db.getDb().prepare('DELETE FROM fill_problem_done WHERE qkey = ?').run(key);
    return { ok: true };
  });

  // Admins: forget a question's cases entirely.
  app.delete('/api/fill-problems', async (req) => {
    if (req.scope) throw httpError(403, 'Only an admin can do this.');
    const key = String(req.query.key || '');
    if (!key) throw httpError(400, 'Missing question');
    db.getDb().prepare('DELETE FROM fill_problems WHERE qkey = ?').run(key);
    db.getDb().prepare('DELETE FROM fill_problem_done WHERE qkey = ?').run(key);
    return { ok: true };
  });
}
