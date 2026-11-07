// HTTP API for the dashboard (web/) and the JobBid extension.
import * as db from './db.js';
import * as jobs from './jobs.js';
import { mergeData } from './merge.js';
import { importResume } from './resume.js';
import { SOURCES, STARTER_BOARDS } from './sources.js';
import { ai, aiMatch, coverLetter, testKeys, listModels, keyHealth, aiKeys, PROVIDERS } from './ai.js';
import { uid, nowIso, normalizeUrl, siteOf } from './util.js';
import { sees, publicSettings, scopeJob, scopedData, mergeScoped, searchVisible, jobFilter } from './scope.js';
import { grantProfile, listUsers, updateMe, setPrefs } from './auth.js';
import { settingsFor, takePrefsFromUpload, effectivePrefs, defaultPrefs, freshUser } from './prefs.js';
import { addNotice, listNotices, markRead, settingsChanges, hubChanges, prefChanges } from './notices.js';

const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const need = (v, what) => { if (!v) throw httpError(404, `${what} not found`); return v; };
// Access to one profile (and everything that belongs to it) for this request's account.
const mustSee = (req, profileId) => { if (!sees(req.scope, profileId)) throw httpError(403, 'Your account has no access to this profile.'); };
const myProfiles = (req) => db.listProfiles().filter((p) => sees(req.scope, p.id));
// Jobs this account may see (see jobFilter), and a 404 for any other job.
const canSeeJob = (req) => jobFilter(req, db.listSearches(), db.listApplications(), jobs.appliedFor);
const needJob = (req, id) => { const j = need(db.getJob(id), 'Job'); if (!canSeeJob(req)(j)) throw httpError(404, 'Job not found'); return j; };
const myApps = (req, list) => (req.scope ? list.filter((a) => req.scope.has(a.profileId)) : list);

// Who bid (for the Job links page): a new application gets the hub user whose Chrome sent it; one the
// hub already has keeps its stamp (that Chrome's copy may not have it yet).
function stampBidders(apps, user) {
  if (!Array.isArray(apps)) return;
  const known = new Map(db.getDb().prepare('SELECT id, data FROM applications').all().map((r) => {
    try { const a = JSON.parse(r.data); return [r.id, a.byUserId ? { byUserId: a.byUserId, byName: a.byName } : null]; } catch { return [r.id, null]; }
  }));
  for (const a of apps) {
    if (!a?.id || a.byUserId) continue;
    const had = known.get(a.id);
    if (had) Object.assign(a, had);
    else if (!known.has(a.id) && user) Object.assign(a, { byUserId: user.id, byName: user.name });
  }
}

// Re-score jobs after a profile change, without making the request wait.
let rescoreTimer;
function rescoreSoon() {
  clearTimeout(rescoreTimer);
  rescoreTimer = setTimeout(() => { try { jobs.rescoreAll(); } catch { /* next change retries */ } }, 1500);
}

// Lighter job object for lists.
function jobListItem(j, profileId) {
  const { description, details, ...rest } = j;
  const s = profileId ? j.scores?.[profileId] : null;
  return { ...rest, excerpt: String(description || '').slice(0, 260), score: s?.score ?? null, qualified: s ? s.qualified : null };
}

export default async function routes(app, { version }) {
  // ---------- Health / sync (used by the extension) ----------

  app.get('/api/health', async () => ({ ok: true, app: 'JobBidHub', version, rev: db.getRev(), jobs: db.jobsVersion() }));

  // Two-way sync with the same rules as the extension's data file: the hub stores a revision; a client
  // that uploads must send the revision it last saw, so two Chromes can't overwrite each other blindly.
  app.get('/api/sync', async (req) => {
    const { rev, client, name, ext } = req.query;
    db.touchClient(client, { name: name || '', version: ext || '' });
    const cur = db.getRev();
    if (!cur) return { app: 'JobBid', version: 1, rev: '', data: null };
    if (rev && rev === cur) return { app: 'JobBid', version: 1, rev: cur, unchanged: true };
    const data = scopedData(req.scope);
    // This account's own extension settings on top of the shared defaults.
    if (req.user && data.settings) data.settings = settingsFor(freshUser(req.user.id), data.settings);
    return { app: 'JobBid', version: 1, rev: cur, savedAt: db.getMeta('savedAt'), data };
  });

  app.put('/api/sync', async (req, reply) => {
    const { baseRev = '', rev, data, client } = req.body || {};
    if (!data || typeof data !== 'object') throw httpError(400, 'Missing data');
    const cur = db.getRev();
    if (cur && baseRev !== cur) return reply.code(409).send({ error: 'conflict', rev: cur });
    const sig = jobs.scoringSig();
    const settingsBefore = db.getStore('settings', null);
    // Personal extension settings from this Chrome go to the account, not to everyone's defaults.
    const personal = req.user && settingsBefore ? takePrefsFromUpload(freshUser(req.user.id), data.settings) : [];
    stampBidders(data.applications, req.user);
    let newRev;
    if (req.scope) {
      // A signed-in user's Chrome: only that account's part changes.
      const m = mergeScoped(req.scope, data);
      newRev = db.putData(m.data, rev);
      for (const id of m.newIds) grantProfile(req.user.id, id);
    } else newRev = db.putData(data, rev);
    db.touchClient(client, { last_sync: nowIso(), ...(req.user ? { name: `${req.user.name} (${req.user.username})` } : {}) });
    // Shared extension settings changed in someone's Chrome: everyone's extension follows, so tell everyone.
    if (settingsBefore) {
      const changes = settingsChanges(settingsBefore, db.getStore('settings', {}));
      if (changes.length) addNotice({ actorId: req.user?.id || '', actor: req.user ? req.user.name : 'Extension on the hub PC', audience: 'all', kind: 'settings', via: 'extension', changes });
    }
    if (personal.length) {
      const eff = effectivePrefs(freshUser(req.user.id));
      addNotice({ actorId: req.user.id, actor: req.user.name, audience: 'admins', kind: 'prefs', via: 'extension', changes: prefChanges(personal, eff) });
    }
    setTimeout(() => { try { jobs.afterSync(sig); } catch { /* ignore */ } }, 50);
    return { ok: true, rev: newRev };
  });

  // ---------- Dashboard bootstrap ----------

  app.get('/api/bootstrap', async (req) => ({
    version,
    rev: db.getRev(),
    profiles: myProfiles(req),
    settings: publicSettings(db.getStore('settings', {}) || {}, req.scope),
    schedule: (() => { const s = db.getStore('schedule', null); return s && req.scope ? { ...s, blocks: (s.blocks || []).filter((b) => req.scope.has(b.profileId)) } : s; })(),
    hub: db.getStore('hub', {}) || {},
    starterBoards: STARTER_BOARDS,
    clients: req.scope ? [] : db.listClients(),
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { name: s.name, remoteOnly: !!s.remoteOnly, boards: !!s.boards, needsKey: !!s.needsKey, mayBlock: !!s.mayBlock }])),
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { defaultModel: p.defaultModel }])),
    modelCache: db.getStore('modelCache', {}) || {},
  }));

  // ---------- Profiles ----------

  app.get('/api/profiles', async (req) => myProfiles(req));
  app.get('/api/profiles/:id', async (req) => { mustSee(req, req.params.id); return need(db.getProfile(req.params.id), 'Profile'); });
  app.post('/api/profiles', async (req) => {
    const p = { skills: [], experience: [], education: [], resumes: [], customAnswers: {}, answerOptions: {}, ...(req.body || {}), id: uid() };
    db.saveProfile(p);
    if (req.user) grantProfile(req.user.id, p.id);
    rescoreSoon();
    return p;
  });
  app.put('/api/profiles/:id', async (req) => {
    mustSee(req, req.params.id);
    const old = need(db.getProfile(req.params.id), 'Profile');
    // Resume list is managed by the resume endpoints, so a stale editor can't drop files.
    const p = { ...req.body, id: old.id, resumes: req.body?.resumes ?? old.resumes };
    db.saveProfile(p);
    rescoreSoon();
    return p;
  });
  app.delete('/api/profiles/:id', async (req) => {
    mustSee(req, req.params.id);
    db.deleteProfile(req.params.id, { erase: req.query?.erase === '1' });
    rescoreSoon();
    return { ok: true };
  });

  // Saved answers: change single questions without sending the whole profile (no lost updates).
  app.patch('/api/profiles/:id/answers', async (req) => {
    mustSee(req, req.params.id);
    const p = need(db.getProfile(req.params.id), 'Profile');
    const { set = {}, remove = [], rename, confirm = [] } = req.body || {};
    p.customAnswers = { ...(p.customAnswers || {}) };
    p.answerOptions = { ...(p.answerOptions || {}) };
    // Answers the AI guessed stay marked until a person sets, confirms or removes them (Full auto won't
    // send a form with one unchecked).
    const guess = new Set(p.aiGuessKeys || []);
    for (const q of [...Object.keys(set), ...remove, ...confirm, ...(rename?.from ? [rename.from] : [])]) guess.delete(q);
    p.aiGuessKeys = [...guess];
    if (rename?.from && rename?.to && rename.from !== rename.to) {
      p.customAnswers[rename.to] = p.customAnswers[rename.from] ?? '';
      if (p.answerOptions[rename.from]) p.answerOptions[rename.to] = p.answerOptions[rename.from];
      delete p.customAnswers[rename.from];
      delete p.answerOptions[rename.from];
    }
    for (const [q, a] of Object.entries(set)) p.customAnswers[q] = String(a ?? '');
    for (const q of remove) { delete p.customAnswers[q]; delete p.answerOptions[q]; }
    db.saveProfile(p);
    return { customAnswers: p.customAnswers, answerOptions: p.answerOptions, aiGuessKeys: p.aiGuessKeys };
  });

  // Resume files are stored like the extension stores them: base64 under file_<id>.
  app.post('/api/profiles/:id/resumes', async (req) => {
    mustSee(req, req.params.id);
    const p = need(db.getProfile(req.params.id), 'Profile');
    const { name, type, data, sites = '' } = req.body || {};
    if (!name || !data) throw httpError(400, 'Missing file');
    const id = uid();
    db.saveFile(id, data);
    const size = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    p.resumes = [...(p.resumes || []), { id, name, type: type || 'application/octet-stream', size, sites, addedAt: nowIso() }];
    if (!p.defaultResumeId) p.defaultResumeId = id;
    db.saveProfile(p);
    return p;
  });
  // Import from resume: text is read in the browser; the server reads it with AI and creates / updates the profile.
  app.post('/api/profiles/import', async (req) => {
    const r = await importResume(req.body || {}, { profiles: myProfiles(req) });
    if (req.user) grantProfile(req.user.id, r.profileId);
    rescoreSoon();
    return r;
  });
  // Daily log notes (one note per day, shared with the extension's data).
  app.get('/api/daynotes', async () => db.getStore('dayNotes', {}) || {});
  app.put('/api/daynotes/:day', async (req) => {
    const notes = db.getStore('dayNotes', {}) || {};
    const text = String(req.body?.text || '');
    if (text.trim()) notes[req.params.day] = text; else delete notes[req.params.day];
    db.setStore('dayNotes', notes);
    return { ok: true };
  });
  app.delete('/api/profiles/:id/resumes/:rid', async (req) => {
    mustSee(req, req.params.id);
    const p = need(db.getProfile(req.params.id), 'Profile');
    p.resumes = (p.resumes || []).filter((r) => r.id !== req.params.rid);
    if (p.defaultResumeId === req.params.rid) p.defaultResumeId = p.resumes[0]?.id || '';
    db.saveProfile(p);
    db.deleteFile(req.params.rid);
    return p;
  });
  app.get('/api/files/:id', async (req, reply) => {
    const b64 = need(db.getFile(req.params.id), 'File');
    const owner = db.listProfiles().find((p) => (p.resumes || []).some((r) => r.id === req.params.id));
    if (owner) mustSee(req, owner.id);
    else if (req.scope) throw httpError(403, 'No access to this file.');
    const meta = (owner?.resumes || []).find((r) => r.id === req.params.id) || {};
    reply.header('Content-Type', meta.type || 'application/octet-stream');
    reply.header('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(meta.name || req.params.id)}"`);
    return reply.send(Buffer.from(b64, 'base64'));
  });

  // ---------- Applications ----------

  app.get('/api/applications', async (req) => myApps(req, db.listApplications(req.query)));
  app.post('/api/applications', async (req) => {
    const b = req.body || {};
    mustSee(req, b.profileId);
    const p = need(db.getProfile(b.profileId), 'Profile');
    const job = b.jobId ? db.getJob(b.jobId) : null;
    const url = b.url || job?.applyUrl || job?.url || '';
    const a = {
      id: uid(), date: b.date || nowIso(), profileId: p.id, profileName: p.label || p.fullName || '',
      title: b.title ?? job?.title ?? '', company: b.company ?? job?.company ?? '', url, key: normalizeUrl(job?.url || url), site: siteOf(url),
      notes: b.notes || '', status: b.status || 'Applied', ...(job ? { jobId: job.id } : {}),
      ...(req.user ? { byUserId: req.user.id, byName: req.user.name } : {}),
    };
    db.saveApplication(a);
    if (job) db.upsertJob({ ...job, status: 'applied' });
    return a;
  });
  app.patch('/api/applications/:id', async (req) => {
    const a = need(db.getApplication(req.params.id), 'Application');
    mustSee(req, a.profileId);
    const allowed = ['status', 'notes', 'title', 'company', 'url', 'date', 'followUp', 'contact', 'salary'];
    for (const k of allowed) if (k in (req.body || {})) a[k] = req.body[k];
    if ('url' in (req.body || {})) { a.key = normalizeUrl(a.url); a.site = siteOf(a.url); }
    a.updatedAt = nowIso();
    db.saveApplication(a);
    return a;
  });
  app.delete('/api/applications/:id', async (req) => {
    const a = db.getApplication(req.params.id);
    if (a) mustSee(req, a.profileId);
    db.deleteApplication(req.params.id);
    if (a) setTimeout(() => { try { jobs.afterSync(jobs.scoringSig()); } catch { /* ignore */ } }, 50);
    return { ok: true };
  });

  // ---------- Job board ----------

  app.get('/api/jobs', async (req) => {
    let { profileId = '', status = 'active', q = '', source = '', qualified = '', remote = '', days = '', sort = 'best', limit = '200', offset = '0', searchId = '' } = req.query;
    if (profileId && !sees(req.scope, profileId)) profileId = '';
    const visible = canSeeJob(req);
    let list = db.allJobs().filter(visible).map((j) => scopeJob(req.scope, j));
    if (status === 'active') list = list.filter((j) => j.status === 'new' || j.status === 'saved');
    else if (status !== 'all') list = list.filter((j) => j.status === status);
    if (source) list = list.filter((j) => j.source === source);
    if (searchId) list = list.filter((j) => j.searchIds.includes(searchId));
    if (remote === '1') list = list.filter((j) => j.remote);
    if (days) list = list.filter((j) => (Date.now() - new Date(j.postedAt || j.foundAt)) / 864e5 <= Number(days));
    if (q) {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((j) => { const h = `${j.title} ${j.company} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    }
    if (profileId && qualified === '1') list = list.filter((j) => j.scores?.[profileId]?.qualified);
    if (!profileId && qualified === '1') list = list.filter((j) => Object.values(j.scores || {}).some((s) => s.qualified));
    if (profileId && qualified === '0') list = list.filter((j) => j.scores?.[profileId] && !j.scores[profileId].qualified);
    const when = (j) => new Date(j.postedAt || j.foundAt).getTime() || 0;
    if (sort === 'best' && profileId) list.sort((a, b) => (b.scores?.[profileId]?.qualified - a.scores?.[profileId]?.qualified) || ((b.scores?.[profileId]?.score ?? 0) - (a.scores?.[profileId]?.score ?? 0)) || when(b) - when(a));
    else if (sort === 'best') {
      // Qualified for someone beats any disqualified score.
      const rank = (j) => Math.max(0, ...Object.values(j.scores || {}).map((s) => (s.qualified ? 1000 : 0) + s.score));
      list.sort((a, b) => rank(b) - rank(a) || when(b) - when(a));
    }
    else if (sort === 'company') list.sort((a, b) => String(a.company).localeCompare(String(b.company)));
    else list.sort((a, b) => when(b) - when(a));
    const counts = { total: list.length };
    return { counts, jobs: list.slice(Number(offset), Number(offset) + Number(limit)).map((j) => jobListItem(j, profileId)) };
  });

  app.get('/api/jobs/stats', async (req) => {
    const list = db.allJobs().filter(canSeeJob(req));
    const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const byStatus = {};
    for (const j of list) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
    return { byStatus, foundToday: list.filter((j) => j.foundAt >= since).length };
  });

  app.get('/api/jobs/:id', async (req) => {
    const j = needJob(req, req.params.id);
    return scopeJob(req.scope, { ...j, appliedBy: jobs.appliedFor(j) });
  });

  app.patch('/api/jobs/:id', async (req) => {
    const j = needJob(req, req.params.id);
    const b = req.body || {};
    if (b.status) j.status = b.status;
    if (b.override) {
      const { profileId, value } = b.override; // 'qualified' | 'disqualified' | '' (back to automatic)
      mustSee(req, profileId);
      j.overrides = { ...j.overrides };
      if (value) j.overrides[profileId] = value; else delete j.overrides[profileId];
      j.scores = (await import('./match.js')).scoreAll(db.listProfiles(), j);
    }
    if (b.notes !== undefined) j.details = { ...j.details, notes: b.notes };
    db.upsertJob(j);
    return scopeJob(req.scope, { ...j, appliedBy: jobs.appliedFor(j) });
  });

  app.post('/api/jobs/bulk', async (req) => {
    const { ids = [], status } = req.body || {};
    let n = 0;
    const visible = canSeeJob(req);
    db.tx(() => { for (const id of ids) { const j = db.getJob(id); if (j && visible(j)) { db.upsertJob({ ...j, status }); n++; } } });
    return { ok: true, n };
  });

  // Job pages opened in Chrome: the extension sends them here so they show up on the board.
  app.post('/api/jobs/seen', async (req) => {
    const j = jobs.jobSeen(req.body || {});
    // Remember who opened it, so it shows on that account's job board.
    if (j && req.user && !(j.details?.seenBy || []).includes(req.user.id)) db.upsertJob({ ...j, details: { ...j.details, seenBy: [...(j.details?.seenBy || []), req.user.id] } });
    return j ? { ok: true, id: j.id, scores: scopeJob(req.scope, j).scores } : { ok: false };
  });

  app.post('/api/jobs/manual', async (req) => {
    const b = req.body || {};
    if (!b.url || !b.title) throw httpError(400, 'Title and link are needed');
    const r = jobs.ingest([{ source: 'manual', ...b, remote: !!b.remote, details: { addedBy: req.user?.id || '' } }], { seen: true });
    return scopeJob(req.scope, db.getJob(r.ids[0]));
  });

  app.post('/api/jobs/:id/ai-match', async (req) => {
    mustSee(req, req.body?.profileId);
    const j = needJob(req, req.params.id);
    const p = need(db.getProfile(req.body?.profileId), 'Profile');
    const out = await aiMatch(p, j);
    j.details = { ...j.details, ai: { ...(j.details?.ai || {}), [p.id]: out } };
    db.upsertJob(j);
    return out;
  });

  app.post('/api/jobs/:id/cover-letter', async (req) => {
    mustSee(req, req.body?.profileId);
    const j = needJob(req, req.params.id);
    const p = need(db.getProfile(req.body?.profileId), 'Profile');
    const text = await coverLetter(p, j);
    j.details = { ...j.details, letters: { ...(j.details?.letters || {}), [p.id]: { text, at: nowIso() } } };
    db.upsertJob(j);
    return { text };
  });

  app.post('/api/jobs/rescore', async () => ({ n: jobs.rescoreAll() }));
  app.delete('/api/jobs', async (req) => ({ n: db.deleteJobs('status = ?', req.query.status || 'hidden') }));

  // ---------- Saved searches ----------

  // Saved searches: an account sees those for its profiles and those it created.
  const needSearch = (req, id) => { const s = need(db.getSearch(id), 'Search'); if (!searchVisible(req, s)) throw httpError(404, 'Search not found'); return s; };
  app.get('/api/searches', async (req) => db.listSearches().filter((s) => searchVisible(req, s)).map((s) => ({ ...s, running: jobs.isRunning(s.id) })));
  app.post('/api/searches', async (req) => {
    const b = req.body || {};
    if (b.profileId) mustSee(req, b.profileId);
    return db.saveSearch({ ...jobs.DEFAULT_SEARCH, ...b, id: uid(), ownerId: req.user?.id || '', createdAt: nowIso() });
  });
  app.put('/api/searches/:id', async (req) => {
    const s = needSearch(req, req.params.id);
    const b = req.body || {};
    if (b.profileId && b.profileId !== s.profileId) mustSee(req, b.profileId);
    return db.saveSearch({ ...s, ...b, id: s.id, ownerId: s.ownerId });
  });
  app.delete('/api/searches/:id', async (req) => { needSearch(req, req.params.id); db.deleteSearch(req.params.id); return { ok: true }; });
  app.post('/api/searches/:id/run', async (req) => { needSearch(req, req.params.id); return jobs.runSearch(req.params.id); });
  app.get('/api/runs', async (req) => {
    const mine = new Set(db.listSearches().filter((s) => searchVisible(req, s)).map((s) => s.id));
    return db.listRuns().filter((r) => !req.scope || mine.has(r.search_id));
  });

  // ---------- Settings, schedule, AI ----------

  app.put('/api/settings', async (req) => {
    const { settings, hub } = req.body || {};
    const beforeS = db.getStore('settings', {}) || {}, beforeH = db.getStore('hub', {}) || {};
    if (settings) {
      const cur = db.getStore('settings', {}) || {};
      // Which profile is active is per Chrome; the dashboard never changes it.
      db.setStore('settings', { ...cur, ...settings, activeProfileId: cur.activeProfileId });
    }
    if (hub) db.setStore('hub', { ...(db.getStore('hub', {}) || {}), ...hub });
    const sc = settingsChanges(beforeS, db.getStore('settings', {}));
    if (sc.length) addNotice({ actorId: req.user?.id, actor: req.user?.name, audience: 'all', kind: 'settings', via: 'dashboard', changes: sc });
    const hc = hubChanges(beforeH, db.getStore('hub', {}));
    if (hc.length) addNotice({ actorId: req.user?.id, actor: req.user?.name, audience: 'admins', kind: 'settings', via: 'dashboard', changes: hc });
    return { settings: db.getStore('settings', {}), hub: db.getStore('hub', {}) };
  });
  app.get('/api/schedule', async (req) => {
    const s = db.getStore('schedule', null) || { blocks: [], autoSwitch: false, reminders: true };
    return req.scope ? { ...s, blocks: (s.blocks || []).filter((b) => req.scope.has(b.profileId)) } : s;
  });
  app.put('/api/schedule', async (req) => {
    let next = req.body || {};
    if (req.scope) {
      // A user changes only the blocks of their own profiles; everyone else's stay.
      const cur = db.getStore('schedule', null) || { blocks: [] };
      next = { ...cur, ...next, blocks: [...(cur.blocks || []).filter((b) => !req.scope.has(b.profileId)), ...(next.blocks || []).filter((b) => req.scope.has(b.profileId))] };
    }
    db.setStore('schedule', next);
    return req.scope ? { ...next, blocks: next.blocks.filter((b) => req.scope.has(b.profileId)) } : next;
  });

  app.get('/api/ai/health', async () => ({ keys: aiKeys().map((k) => ({ id: k.id, provider: k.provider, model: k.model })), health: keyHealth() }));
  app.post('/api/ai/test', async (req) => testKeys(req.body?.ids));
  app.post('/api/ai/models', async (req) => {
    const { provider, apiKey, baseUrl } = req.body || {};
    if (!PROVIDERS[provider]) throw httpError(400, 'Unknown provider');
    const models = await listModels(provider, apiKey, baseUrl);
    db.setStore('modelCache', { ...(db.getStore('modelCache', {}) || {}), [provider]: models });
    return models;
  });
  app.post('/api/ai/ask', async (req) => ({ text: await ai(String(req.body?.prompt || ''), { json: false }) }));

  // ---------- Import / export (JobBid data file format) ----------

  app.post('/api/import', async (req) => {
    const body = req.body || {};
    const incoming = body.app === 'JobBid' ? body.data : body.data || body;
    if (!incoming || typeof incoming !== 'object' || (!incoming.profiles && !incoming.settings)) throw httpError(400, 'This is not a JobBid data file.');
    const sig = jobs.scoringSig();
    const current = db.getData();
    const merged = body.mode === 'replace' ? incoming : mergeData(incoming, current);
    db.putData(merged);
    jobs.afterSync(sig);
    return { ok: true, profiles: (merged.profiles || []).length, applications: (merged.applications || []).length };
  });
  app.get('/api/export', async (req, reply) => {
    const snap = { app: 'JobBid', version: 1, rev: db.getRev(), savedAt: nowIso(), data: db.getData() };
    reply.header('Content-Disposition', `attachment; filename="jobbid-data-${new Date().toISOString().slice(0, 10)}.json"`);
    return snap;
  });
  app.get('/api/clients', async () => db.listClients());

  // ---------- My account ----------
  app.get('/api/me', async (req) => {
    const u = freshUser(req.user.id);
    const names = Object.fromEntries(db.listProfiles().map((p) => [p.id, p.label || p.fullName || '']));
    return { user: u, prefs: effectivePrefs(u), own: u.prefs || {}, defaults: defaultPrefs(), profiles: u.role === 'admin' ? 'all' : u.profileIds.map((id) => ({ id, name: names[id] || '' })) };
  });
  app.put('/api/me', async (req) => {
    const { name, email, phone, prefs } = req.body || {};
    let u = updateMe(req.user.id, { name, email, phone });
    if (prefs) {
      const before = effectivePrefs(u);
      setPrefs(u.id, { ...(u.prefs || {}), ...prefs }, defaultPrefs());
      u = freshUser(u.id);
      const after = effectivePrefs(u);
      const changed = Object.keys(prefs).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length) {
        db.bumpRev(); // this account's Chromes pick the change up at their next sync
        addNotice({ actorId: u.id, actor: u.name, audience: 'admins', kind: 'prefs', via: 'dashboard', changes: prefChanges(changed, after) });
      }
    }
    return { user: u, prefs: effectivePrefs(u), own: u.prefs || {}, defaults: defaultPrefs() };
  });
  // Back to the defaults: one setting (key) or all of them.
  app.post('/api/me/reset', async (req) => {
    const u = freshUser(req.user.id);
    const key = req.body?.key;
    const own = { ...(u.prefs || {}) };
    if (key) delete own[key]; else for (const k of Object.keys(own)) delete own[k];
    setPrefs(u.id, own, defaultPrefs());
    db.bumpRev();
    const nu = freshUser(u.id);
    return { user: nu, prefs: effectivePrefs(nu), own: nu.prefs || {}, defaults: defaultPrefs() };
  });

  // ---------- Alerts (bell) ----------
  app.get('/api/notices', async (req) => ({
    ...listNotices(req.user),
    // Admins: sign-ups waiting for approval (the red number on Accounts).
    pendingSignups: req.user.role === 'admin' ? listUsers().filter((u) => u.pending).length : 0,
  }));
  app.post('/api/notices/read', async (req) => { markRead(req.user, req.body?.upTo); return { ok: true }; });
}
