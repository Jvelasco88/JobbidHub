// JobBid Hub: two-way sync with the local hub server (JobBidHub, http://127.0.0.1:4417), using the same
// rules as the data file (datasync.js): "dirty" = local data changed since the last sync (by hash);
// the hub keeps a revision, and an upload must name the revision it was based on, so two Chromes
// can't overwrite each other. Loaded by the background worker and the dashboard after datasync.js.

const HUB_DEFAULT_URL = 'http://127.0.0.1:4417';
// Tells the hub this call comes from the extension (it syncs without a dashboard sign-in).
const HUB_HEADERS = { 'X-JobBid-Ext': '1' };

// token/user: set when this Chrome signed in to a hub on another computer (office network).
async function hubConfig() {
  const { hubConfig: c = {} } = await chrome.storage.local.get('hubConfig');
  return { on: c.on !== false, url: String(c.url || HUB_DEFAULT_URL).replace(/\/+$/, ''), name: c.name || '', token: c.token || '', user: c.user || '', offline: !!c.offline && !c.token };
}
const hubHeaders = (cfg, extra = {}) => ({ ...HUB_HEADERS, ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}), ...extra });

// Sign in to a hub (popup). Starts a fresh sync with it: what this Chrome has and what the hub has are merged.
async function hubSignIn(url, username, password) {
  url = String(url || HUB_DEFAULT_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  let res;
  try {
    res = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, error: `Can't reach ${url}. Is the hub running, with office-network access on? Using a proxy or VPN? Add ${new URL(url).hostname} to its bypass list (see "Using a proxy or VPN?" on the hub's sign-in page).` };
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: j.error || `Hub error ${res.status}` };
  const { hubConfig: c = {} } = await chrome.storage.local.get('hubConfig');
  // Start clean: this Chrome gets exactly what this account may see from the hub.
  await hubClearLocal();
  await chrome.storage.local.set({ hubConfig: { ...c, on: true, offline: false, url, token: j.token, user: j.user?.name || username, userId: j.user?.id || '' } });
  const { hubState: st = {} } = await chrome.storage.local.get('hubState');
  await chrome.storage.local.set({ hubState: { clientId: st.clientId } });
  return { ok: true, user: j.user };
}

// Everything synced from the hub (profiles, applications, resumes, settings...), not per-Chrome state.
async function hubClearLocal() {
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => !DS_LOCAL_ONLY.includes(k));
  if (drop.length) await chrome.storage.local.remove(drop);
}

// The hub page in this Chrome is signed in (or out): follow it. Only for a hub on this PC, the configured
// hub, or one on the local network - never an arbitrary website.
function hubTrustedUrl(url, cfg) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (cfg?.url && new URL(cfg.url).origin === u.origin) return true;
    return /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
  } catch { return false; }
}

// The hub's internet address (Cloudflare tunnel, e.g. https://xyz.trycloudflare.com) is trusted only when
// the hub this Chrome already knows (configured address or this PC) reports it as its own public address.
let hubPublicCache = { at: 0, origins: [] };
async function hubPublicOrigins(cfg) {
  if (Date.now() - hubPublicCache.at < 60000) return hubPublicCache.origins;
  const origins = [];
  for (const base of [...new Set([cfg?.url, HUB_DEFAULT_URL].filter(Boolean))]) {
    try {
      const j = await (await fetch(`${base}/api/extension/info`, { signal: AbortSignal.timeout(5000) })).json();
      if (j.publicUrl) origins.push(new URL(j.publicUrl).origin);
    } catch { /* that hub isn't reachable from here */ }
  }
  hubPublicCache = { at: Date.now(), origins };
  return origins;
}
async function hubIsPublicUrl(url, cfg) {
  try { return (await hubPublicOrigins(cfg)).includes(new URL(url).origin); } catch { return false; }
}
const hubTrusted = async (url, cfg) => hubTrustedUrl(url, cfg) || hubIsPublicUrl(url, cfg);

async function hubAdopt({ url, token, prevToken }) {
  const cfg = await hubConfig();
  if (!(await hubTrusted(url, cfg))) return { ok: false, reason: `This extension is set to the hub at ${cfg.url}, not ${url}. Sign in below with that address.` };
  if (cfg.offline) return { ok: false, offline: true, reason: 'This Chrome works offline. Choose "Go online" in the panel first, then the hub sign-in is used.' }; // offline work is only replaced when you choose "Go online"
  if (!token) {
    // Signed out on the hub page: sign the extension out too, if it was using that same sign-in.
    if (cfg.token && prevToken && cfg.token === prevToken) await hubSignOut();
    return { ok: true };
  }
  if (cfg.token === token) return { ok: true };
  let user;
  try {
    const res = await fetch(`${url}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: 'The sign-in on the hub page has ended. Sign in on the hub page again.' };
    user = (await res.json()).user;
  } catch { return { ok: false, reason: `Can't reach the hub at ${url}.` }; }
  if (!user?.id) return { ok: false, reason: 'The hub did not say who is signed in.' };
  const { hubConfig: c = {}, hubState: st = {} } = await chrome.storage.local.get(['hubConfig', 'hubState']);
  // Another account than before: nothing of the previous one stays in this Chrome.
  const switched = c.userId !== user.id;
  if (switched) await hubClearLocal();
  await chrome.storage.local.set({ hubConfig: { ...c, on: true, url, token, user: user.name || user.username, userId: user.id } });
  if (switched) await chrome.storage.local.set({ hubState: { clientId: st.clientId } });
  hubSync({ force: true }).catch(() => {});
  return { ok: true, user };
}

async function hubSignOut() {
  const cfg = await hubConfig();
  if (cfg.token) fetch(`${cfg.url}/api/auth/logout`, { method: 'POST', headers: hubHeaders(cfg), signal: AbortSignal.timeout(8000) }).catch(() => {});
  const { hubConfig: c = {} } = await chrome.storage.local.get('hubConfig');
  // Nothing of this account stays in this Chrome.
  await hubClearLocal();
  await chrome.storage.local.set({ hubConfig: { ...c, token: '', user: '', userId: '' } });
  const { hubState: st = {} } = await chrome.storage.local.get('hubState');
  await chrome.storage.local.set({ hubState: { clientId: st.clientId } });
}

async function hubSetState(patch) {
  const { hubState = {} } = await chrome.storage.local.get('hubState');
  const st = { ...hubState, ...patch };
  await chrome.storage.local.set({ hubState: st });
  return st;
}

function hubErrorText(e) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'The hub did not answer in time.';
  if (e instanceof TypeError) return 'JobBid Hub is not running (start it with start.bat).';
  return e?.message || String(e);
}

let hubBusy = null;
function hubSync(opts = {}) {
  hubBusy ||= hubSyncInner(opts).finally(() => (hubBusy = null));
  return hubBusy;
}

async function hubSyncInner({ force = false, retried = false } = {}) {
  const cfg = await hubConfig();
  if (!cfg.on) return { ok: false, off: true };
  if (cfg.offline) return { ok: false, offline: true }; // offline mode: nothing syncs
  const { hubState: st = {} } = await chrome.storage.local.get('hubState');
  const clientId = st.clientId || crypto.randomUUID();
  // Not signed in: nothing is synced (and the extension shows nothing).
  if (!cfg.token) {
    await hubSetState({ clientId, needLogin: true, lastError: 'Not signed in. Click the JobBid icon and sign in.', lastErrorAt: new Date().toISOString() });
    return { ok: false, needLogin: true };
  }
  try {
    const local = await chrome.storage.local.get(null);
    const dirty = !st.hash || dsHash(local) !== st.hash;
    const q = new URLSearchParams({ rev: st.syncedRev || '', client: clientId, name: cfg.name || 'Chrome', ext: chrome.runtime.getManifest().version });
    const res = await fetch(`${cfg.url}/api/sync?${q}`, { headers: hubHeaders(cfg), signal: AbortSignal.timeout(20000) });
    if (res.status === 401) {
      await hubSetState({ clientId, needLogin: true, lastError: cfg.token ? 'Your hub sign-in ended. Click the JobBid icon and sign in again.' : 'This hub needs a sign-in. Click the JobBid icon and sign in.', lastErrorAt: new Date().toISOString() });
      return { ok: false, needLogin: true };
    }
    if (!res.ok) throw new Error(`Hub error ${res.status}`);
    const remote = await res.json();
    const remoteChanged = !!remote.rev && remote.rev !== st.syncedRev && !!remote.data;

    if (remoteChanged && !dirty) {
      // No unsaved local edits: the hub is the truth (this also carries over deletions).
      const keep = Object.fromEntries(DS_LOCAL_ONLY.map((k) => [k, local[k]]).filter(([, v]) => v !== undefined));
      const settings = { ...remote.data.settings, activeProfileId: local.settings?.activeProfileId ?? remote.data.settings?.activeProfileId };
      const stale = Object.keys(local).filter((k) => !(k in remote.data) && !DS_LOCAL_ONLY.includes(k));
      if (stale.length) await chrome.storage.local.remove(stale);
      await chrome.storage.local.set({ ...remote.data, settings, ...keep });
      await hubSetState({ clientId, hash: dsHash(remote.data), syncedRev: remote.rev, lastSyncAt: new Date().toISOString(), lastError: '', needLogin: false, action: 'loaded' });
      return { ok: true, action: 'loaded' };
    }
    let action = 'none';
    if (remoteChanged && dirty) {
      // Both sides changed: keep everything, this Chrome wins on conflicts.
      await chrome.storage.local.set(dsMerge(local, remote.data));
      action = 'merged';
    }
    if (action === 'merged' || dirty || force || !remote.rev) {
      const snap = await dsSnapshot();
      const put = await fetch(`${cfg.url}/api/sync`, {
        method: 'PUT',
        headers: hubHeaders(cfg, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ baseRev: remote.rev || '', rev: snap.rev, data: snap.data, client: clientId }),
        signal: AbortSignal.timeout(60000),
      });
      if (put.status === 409 && !retried) {
        // Someone saved in between (dashboard or another Chrome): merge their version and try once more.
        await hubSetState({ clientId });
        return hubSyncInner({ force, retried: true });
      }
      if (!put.ok) throw new Error(`Hub error ${put.status}`);
      await hubSetState({ clientId, hash: dsHash(snap.data), syncedRev: snap.rev, lastSyncAt: new Date().toISOString(), lastError: '', needLogin: false, action: action === 'none' ? 'saved' : action });
      return { ok: true, action: action === 'none' ? 'saved' : action };
    }
    await hubSetState({ clientId, lastSyncAt: new Date().toISOString(), lastError: '', needLogin: false });
    return { ok: true, action };
  } catch (e) {
    // Hub not started (yet): just wait for it, that's not an error worth showing.
    const down = e instanceof TypeError || e?.name === 'TimeoutError';
    await hubSetState({ clientId, lastError: hubErrorText(e), lastErrorAt: new Date().toISOString(), down });
    return { ok: false, error: hubErrorText(e), down };
  }
}

// Is the hub reachable? (Settings page "Test" button.)
async function hubPing(url) {
  try {
    const res = await fetch(`${String(url || HUB_DEFAULT_URL).replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    return j.app === 'JobBidHub' ? { ok: true, version: j.version } : { ok: false, error: 'Something else is running at that address.' };
  } catch (e) {
    return { ok: false, error: hubErrorText(e) };
  }
}

// A job posting opened in Chrome: add it to the hub's job board (best effort, never blocks the page).
async function hubJobSeen(job, details) {
  const cfg = await hubConfig();
  if (!cfg.on || cfg.offline || !job?.url) return;
  fetch(`${cfg.url}/api/jobs/seen`, {
    method: 'POST',
    headers: hubHeaders(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url: job.url, title: job.title, company: job.company, description: String(job.description || '').slice(0, 20000), details: details || {} }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

// ---------- Offline mode ----------
// Work without the hub: load a JobBid data file (the hub's Settings > Export, or "Save data file" from
// the panel) into this Chrome. Nothing syncs while offline, and the hub's sign-in is not taken over, so
// the hub can never replace the offline work. "Go online" saves a data file first (import it in the hub).

async function offlineLoad(text, name = '') {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('This file is not JSON.'); }
  const data = j && j.app === 'JobBid' ? j.data : j && j.data && Array.isArray(j.data.profiles) ? j.data : j;
  if (!data || typeof data !== 'object' || !Array.isArray(data.profiles)) throw new Error('This is not a JobBid data file (it has no profiles).');
  if (!data.profiles.length) throw new Error('This data file has no profiles.');
  const { hubConfig: c = {}, hubState: st = {} } = await chrome.storage.local.get(['hubConfig', 'hubState']);
  await hubClearLocal();
  const put = {};
  for (const [k, v] of Object.entries(data)) if (!DS_LOCAL_ONLY.includes(k) && v !== undefined && v !== null) put[k] = v;
  const settings = { ...(put.settings || {}) };
  if (!put.profiles.some((p) => p.id === settings.activeProfileId)) settings.activeProfileId = put.profiles[0].id;
  put.settings = settings;
  put.applications = Array.isArray(put.applications) ? put.applications : [];
  await chrome.storage.local.set(put);
  await chrome.storage.local.set({
    hubConfig: { ...c, token: '', userId: '', user: 'Offline', offline: true, offlineFile: String(name || 'data file').slice(0, 80), offlineAt: new Date().toISOString() },
    hubState: { clientId: st.clientId },
  });
  return { profiles: put.profiles.length, applications: put.applications.length };
}

// Everything this Chrome has, in the data file format the hub imports.
async function offlineSnapshot() {
  const all = await chrome.storage.local.get(null);
  const data = {};
  for (const [k, v] of Object.entries(all)) if (!DS_LOCAL_ONLY.includes(k)) data[k] = v;
  return { app: 'JobBid', version: 1, savedAt: new Date().toISOString(), data };
}

async function offlineExit() {
  const { hubConfig: c = {}, hubState: st = {} } = await chrome.storage.local.get(['hubConfig', 'hubState']);
  await hubClearLocal();
  const { offline, offlineFile, offlineAt, ...rest } = c;
  await chrome.storage.local.set({ hubConfig: { ...rest, token: '', user: '', userId: '' }, hubState: { clientId: st.clientId } });
}
