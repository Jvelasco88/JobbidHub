// JobBid data file: keeps all extension data in one JSON file on disk (e.g. in a OneDrive/Dropbox
// folder) so other Chrome profiles or computers can open the same file and stay in sync.
// Loaded by the dashboard (<script>) and the background worker (importScripts).

const DS_FILE_KEY = 'dataFileHandle';
// Per-Chrome state that never goes into the shared file.
const DS_LOCAL_ONLY = ['syncState', 'hubConfig', 'hubState', 'lastBlockKey', 'panelCollapsed', 'panelWidth', 'panelPos', 'tabTop', 'panelTab', 'keyHealth', 'aiStatus', 'jobCache', 'ipInfo', 'lastKeyCheck', 'extUpdate', 'proxyCfg', 'proxyState', 'keyUsage'];

function dsIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jobbid', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dsIdbCall(mode, fn) {
  const db = await dsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const dsGetHandle = () => dsIdbCall('readonly', (s) => s.get(DS_FILE_KEY));
const dsSetHandle = (h) => dsIdbCall('readwrite', (s) => s.put(h, DS_FILE_KEY));
const dsClearHandle = () => dsIdbCall('readwrite', (s) => s.delete(DS_FILE_KEY));

async function dsState() {
  const { syncState } = await chrome.storage.local.get('syncState');
  return syncState || {};
}

async function dsSetState(patch) {
  const st = { ...(await dsState()), ...patch };
  await chrome.storage.local.set({ syncState: st });
  return st;
}

async function dsPermission(handle, request) {
  if (typeof handle.queryPermission !== 'function') return 'unsupported';
  const opts = { mode: 'readwrite' };
  let p = await handle.queryPermission(opts);
  if (p !== 'granted' && request) p = await handle.requestPermission(opts);
  return p;
}

async function dsRead(handle) {
  const text = await (await handle.getFile()).text();
  if (!text.trim()) return null;
  const json = JSON.parse(text);
  if (json.app !== 'JobBid' || !json.data) throw new Error('This file is not a JobBid data file.');
  return json;
}

async function dsSnapshot() {
  const data = await chrome.storage.local.get(null);
  for (const k of DS_LOCAL_ONLY) delete data[k];
  // rev identifies this exact save (timestamps alone can collide).
  const rev = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  return { app: 'JobBid', version: 1, rev, savedAt: new Date().toISOString(), data };
}

async function dsWrite(handle, snap) {
  const w = await handle.createWritable();
  await w.write(JSON.stringify(snap));
  await w.close();
}

// Stable JSON (sorted keys) + FNV-1a hash, so "changed?" doesn't depend on key order.
function dsStable(v) {
  if (Array.isArray(v)) return '[' + v.map(dsStable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + dsStable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

// What is shared between Chromes: everything except per-Chrome state (and which profile is active here).
function dsCanon(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (DS_LOCAL_ONLY.includes(k)) continue;
    out[k] = k === 'settings' && v ? { ...v, activeProfileId: undefined } : v;
  }
  return out;
}

function dsHash(data) {
  const str = dsStable(dsCanon(data));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16) + ':' + str.length;
}

function dsMergeById(a = [], b = []) {
  // b wins for the same id; keeps everything that exists on either side.
  const map = new Map(a.map((x) => [x.id, x]));
  for (const x of b) map.set(x.id, x);
  return [...map.values()];
}

// Same profile changed on both sides: this side's fields win, but saved answers from both are kept
// (the extension learns answers while the user may be answering others elsewhere).
function dsMergeProfiles(remote = [], local = []) {
  const byId = new Map((remote || []).map((p) => [p.id, p]));
  return dsMergeById(remote, local).map((p) => {
    const r = byId.get(p.id);
    if (!r || r === p) return p;
    return { ...p, customAnswers: { ...(r.customAnswers || {}), ...(p.customAnswers || {}) }, answerOptions: { ...(r.answerOptions || {}), ...(p.answerOptions || {}) } };
  });
}

// Both sides changed since the last sync: keep everything, local wins on conflicts.
function dsMerge(local, remote) {
  const out = { ...remote };
  for (const [k, v] of Object.entries(local)) {
    if (DS_LOCAL_ONLY.includes(k)) continue;
    const r = remote[k];
    if (k === 'profiles') out[k] = dsMergeProfiles(r, v);
    else if (k === 'applications') out[k] = dsMergeById(r, v).sort((x, y) => new Date(y.date) - new Date(x.date));
    else if (k === 'settings') out[k] = { ...r, ...v, keys: { ...(r?.keys || {}), ...(v.keys || {}) }, models: { ...(r?.models || {}), ...(v.models || {}) } };
    else if (k === 'schedule') out[k] = { ...r, ...v, blocks: dsMergeById(r?.blocks, v.blocks) };
    else if (v && typeof v === 'object' && !Array.isArray(v) && r && typeof r === 'object') out[k] = { ...r, ...v };
    else out[k] = v;
  }
  return out;
}

let dsBusy = null;

// Two-way sync. Returns { ok, action, error, needsPermission, notConnected }.
// "Dirty" = local data differs from what was last synced (by hash), so it works across
// the dashboard, the background worker and other Chromes without ping-pong writes.
function dsSync({ request = false, force = false, quiet = false } = {}) {
  dsBusy ||= dsSyncInner({ request, force, quiet }).finally(() => (dsBusy = null));
  return dsBusy;
}

async function dsSyncInner({ request, force, quiet }) {
  const handle = await dsGetHandle().catch(() => null);
  if (!handle) return { ok: false, notConnected: true };
  let perm;
  try {
    perm = await dsPermission(handle, request);
  } catch {
    perm = 'prompt';
  }
  if (perm === 'unsupported') return { ok: false, unsupported: true };
  if (perm !== 'granted') {
    // The background worker can't show a permission prompt; only pages report "needs permission".
    if (!quiet) await dsSetState({ needsPermission: true, fileName: handle.name });
    return { ok: false, needsPermission: true };
  }
  try {
    const st = await dsState();
    const remote = await dsRead(handle).catch((e) => (e instanceof SyntaxError ? null : Promise.reject(e)));
    const local = await chrome.storage.local.get(null);
    const dirty = !st.hash || dsHash(local) !== st.hash;
    const remoteRev = remote && (remote.rev || remote.savedAt);
    const remoteChanged = !!remote && remoteRev !== st.syncedRev;
    let action = 'none';

    if (remoteChanged && !dirty) {
      // No unsaved local edits: the file is the truth (this also carries over deletions).
      const keep = Object.fromEntries(DS_LOCAL_ONLY.map((k) => [k, local[k]]).filter(([, v]) => v !== undefined));
      const settings = { ...remote.data.settings, activeProfileId: local.settings?.activeProfileId ?? remote.data.settings?.activeProfileId };
      const stale = Object.keys(local).filter((k) => !(k in remote.data) && !DS_LOCAL_ONLY.includes(k));
      if (stale.length) await chrome.storage.local.remove(stale);
      await chrome.storage.local.set({ ...remote.data, settings, ...keep });
      await dsSetState({ hash: dsHash(remote.data), syncedRev: remoteRev, lastSyncAt: new Date().toISOString(), needsPermission: false, lastError: '', fileName: handle.name });
      return { ok: true, action: 'loaded' };
    }
    if (remoteChanged && dirty) {
      // Both sides changed: keep everything, this Chrome wins on conflicts.
      await chrome.storage.local.set(dsMerge(local, remote.data));
      action = 'merged';
    }
    if (action === 'merged' || dirty || force || !remote) {
      const snap = await dsSnapshot();
      await dsWrite(handle, snap);
      await dsSetState({ hash: dsHash(snap.data), syncedRev: snap.rev, lastSyncAt: new Date().toISOString(), needsPermission: false, lastError: '', fileName: handle.name });
      return { ok: true, action: action === 'none' ? 'saved' : action };
    }
    await dsSetState({ lastSyncAt: new Date().toISOString(), needsPermission: false, lastError: '', fileName: handle.name });
    return { ok: true, action };
  } catch (e) {
    await dsSetState({ lastError: e.message, lastErrorAt: new Date().toISOString() });
    return { ok: false, error: e.message };
  }
}
