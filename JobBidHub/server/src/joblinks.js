// Job links: every job anyone on the team applied to, so each user sees what was already bid (and by
// whom) before bidding, and can mark "I'll bid" or "Skip". Built from everyone's applications; the same
// job on several addresses (posting page, /apply page, LinkedIn vs the company's site) is one row.
import * as db from './db.js';
import { listUsers } from './auth.js';
import { companyKey, titleKey, normalizeUrl, nowIso, siteOf } from './util.js';

const CHOICES = ['bid', 'skip'];

function initTable() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS job_link_choices (
      link_id TEXT, user_id TEXT, choice TEXT, at TEXT, PRIMARY KEY (link_id, user_id));
    -- Sent by the extension by itself: a fill started on the job, or its Submit button was clicked.
    CREATE TABLE IF NOT EXISTS job_activity (
      user_id TEXT, user_name TEXT, profile_id TEXT, profile_name TEXT, kind TEXT, key TEXT, url TEXT, title TEXT, company TEXT, at TEXT,
      PRIMARY KEY (user_id, profile_id, kind, key));
  `);
}

// Steps before a logged application, from the extension: 'fill' (Fill / Shift+Alt+F / Auto bid) and
// 'submit' (the form's Submit clicked after a fill). A logged application replaces both.
const STEP = { fill: 1, submit: 2, applied: 3 };
const STEP_LABEL = { fill: 'Filling', submit: 'Submitted' };
const ACTIVITY_DAYS = 60;

// The job's id on this page: company + title when both are known (the same on every address), else the address.
export const linkIdOf = (a) => {
  const c = companyKey(a.company), t = titleKey(a.title);
  return c && t ? `ct:${c}|${t}` : `url:${a.key || normalizeUrl(a.url)}`;
};

// Who bid: the hub user stamped on the application (since this version), else the users who have that
// profile (older applications). Admins have every profile, so they are only named when stamped.
function bidderOf(a, users) {
  if (a.byUserId) return [{ id: a.byUserId, name: users.get(a.byUserId)?.name || a.byName || 'Someone' }];
  const owners = [...users.values()].filter((u) => u.role !== 'admin' && u.profileIds.includes(a.profileId));
  return owners.length ? owners.map((u) => ({ id: u.id, name: u.name })) : [{ id: '', name: 'Admin' }];
}

// All applications grouped into job links, newest first.
export function buildLinks() {
  const users = new Map(listUsers().map((u) => [u.id, u]));
  const apps = db.listApplications({ limit: 100000 });
  const byUrl = new Map(), byCt = new Map(), links = [];
  const linkFor = (a) => {
    const key = a.key || normalizeUrl(a.url);
    const ct = linkIdOf(a).startsWith('ct:') ? linkIdOf(a) : '';
    let l = (key && byUrl.get(key)) || (ct && byCt.get(ct));
    if (!l) {
      l = { id: ct || `url:${key}`, title: a.title || '', company: a.company || '', urls: [], site: a.site || siteOf(a.url), bids: [], last: a.date, first: a.date };
      links.push(l);
    }
    if (key) byUrl.set(key, l);
    if (ct) byCt.set(ct, l);
    if (a.url && !l.urls.includes(a.url)) l.urls.push(a.url);
    if (!l.title) l.title = a.title || '';
    if (!l.company) l.company = a.company || '';
    if (a.date > l.last) l.last = a.date;
    if (a.date < l.first) l.first = a.date;
    return l;
  };
  for (const a of apps) {
    const l = linkFor(a);
    for (const u of bidderOf(a, users)) l.bids.push({ userId: u.id, user: u.name, profileId: a.profileId, profileName: a.profileName || '', date: a.date, status: a.status || 'Applied', step: 'applied' });
  }
  // Filling / Submitted: only the furthest step per person and profile, and none once it is logged.
  const since = new Date(Date.now() - ACTIVITY_DAYS * 864e5).toISOString();
  const acts = db.getDb().prepare('SELECT * FROM job_activity WHERE at >= ? ORDER BY at').all(since);
  for (const r of acts) {
    const l = linkFor({ key: r.key, url: r.url, title: r.title, company: r.company, date: r.at });
    const same = l.bids.find((b) => b.userId === r.user_id && b.profileId === r.profile_id);
    if (same && STEP[same.step] >= STEP[r.kind]) continue;
    if (same) l.bids.splice(l.bids.indexOf(same), 1);
    l.bids.push({ userId: r.user_id, user: users.get(r.user_id)?.name || r.user_name || 'Someone', profileId: r.profile_id, profileName: r.profile_name || '', date: r.at, status: STEP_LABEL[r.kind], step: r.kind });
  }
  for (const l of links) l.bids.sort((x, y) => (y.date > x.date ? 1 : -1));
  const choices = db.getDb().prepare('SELECT link_id, user_id, choice, at FROM job_link_choices').all();
  const byLink = new Map();
  for (const c of choices) {
    if (!byLink.has(c.link_id)) byLink.set(c.link_id, []);
    byLink.get(c.link_id).push({ userId: c.user_id, user: users.get(c.user_id)?.name || 'Someone', choice: c.choice, at: c.at });
  }
  for (const l of links) l.choices = byLink.get(l.id) || [];
  return links.sort((x, y) => (y.last > x.last ? 1 : -1));
}

// What a user may see: user names for everyone; candidate profile names only for admins and for the
// user's own profiles.
function forViewer(l, req) {
  const mine = (b) => !req.scope || req.scope.has(b.profileId);
  const bids = l.bids.map((b) => ({ ...b, profileName: mine(b) ? b.profileName : '', profileId: mine(b) ? b.profileId : '', me: b.userId === req.user?.id }));
  const users = [...new Map(bids.map((b) => [b.userId || b.user, b.user])).values()];
  return { ...l, bids, users, count: bids.length, myChoice: l.choices.find((c) => c.userId === req.user?.id)?.choice || '' };
}

const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });

export default async function jobLinkRoutes(app) {
  initTable();

  app.get('/api/joblinks', async (req) => {
    const q = String(req.query.q || '').toLowerCase().trim();
    const days = Number(req.query.days) || 0;
    // since = the viewer's local midnight (Today / Last 3 days); days = a rolling window.
    const since = /^\d{4}-\d\d-\d\dT/.test(String(req.query.since || '')) ? new Date(String(req.query.since)).toISOString() : days ? new Date(Date.now() - days * 864e5).toISOString() : '';
    let links = buildLinks();
    if (since) links = links.filter((l) => l.last >= since);
    if (q) links = links.filter((l) => `${l.title} ${l.company} ${l.urls.join(' ')} ${l.bids.map((b) => b.user).join(' ')}`.toLowerCase().includes(q));
    return links.slice(0, 2000).map((l) => forViewer(l, req));
  });

  // The extension, on a job page: who on the team already bid this job.
  app.get('/api/joblinks/check', async (req) => {
    const { url = '', company = '', title = '' } = req.query || {};
    const key = normalizeUrl(url);
    const ct = linkIdOf({ company, title, key });
    const l = buildLinks().find((x) => x.id === ct || x.urls.some((u) => normalizeUrl(u) === key));
    return l ? forViewer(l, req) : { id: '', bids: [], users: [], count: 0, choices: [] };
  });

  // The extension, by itself: a fill started here, or Submit was clicked (see STEP above).
  app.post('/api/joblinks/touch', async (req) => {
    const { kind, url = '', title = '', company = '', profileId = '', profileName = '' } = req.body || {};
    if (!STEP_LABEL[kind] || !/^https?:\/\//i.test(String(url))) throw httpError(400, 'Missing job');
    if (!req.user) throw httpError(401, 'Please sign in.');
    // A profile this account doesn't have (e.g. made in Chrome, not synced yet): nothing to record.
    if (req.scope && profileId && !req.scope.has(profileId)) return { ok: false };
    const s = (v, n) => String(v || '').slice(0, n);
    db.getDb().prepare(`INSERT INTO job_activity (user_id, user_name, profile_id, profile_name, kind, key, url, title, company, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, profile_id, kind, key) DO UPDATE SET url = excluded.url, title = excluded.title, company = excluded.company, profile_name = excluded.profile_name, at = excluded.at`)
      .run(req.user.id, req.user.name, s(profileId, 80), s(profileName, 120), kind, normalizeUrl(url), s(url, 1000), s(title, 300), s(company, 200), nowIso());
    return { ok: true };
  });

  app.put('/api/joblinks/choice', async (req) => {
    const { id, choice } = req.body || {};
    if (!id || typeof id !== 'string') throw httpError(400, 'Missing job link');
    if (!req.user) throw httpError(401, 'Please sign in.');
    if (!choice) db.getDb().prepare('DELETE FROM job_link_choices WHERE link_id = ? AND user_id = ?').run(id, req.user.id);
    else if (!CHOICES.includes(choice)) throw httpError(400, 'Unknown choice');
    else db.getDb().prepare('INSERT INTO job_link_choices (link_id, user_id, choice, at) VALUES (?, ?, ?, ?) ON CONFLICT(link_id, user_id) DO UPDATE SET choice = excluded.choice, at = excluded.at').run(id, req.user.id, choice, nowIso());
    return { ok: true };
  });
}
