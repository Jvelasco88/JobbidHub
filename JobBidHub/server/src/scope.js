// What one account may see. scope = null: everything (admin, or the extension on the hub's own PC).
// scope = Set of profile ids: a user sees only those profiles and what belongs to them (applications,
// resume files, schedule blocks, job scores), and can only change those.
import * as db from './db.js';

export const sees = (scope, profileId) => !scope || scope.has(profileId);

// AI keys are the admin's: users get the list (to know AI works) but never the secret keys.
export function publicSettings(settings, scope) {
  if (!scope || !settings) return settings || {};
  const { keys, models, ...rest } = settings;
  return { ...rest, aiKeys: (settings.aiKeys || []).map(({ key, ...k }) => ({ ...k, key: '' })) };
}

export function scopeJob(scope, j) {
  if (!scope || !j) return j;
  const only = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => scope.has(k)));
  return {
    ...j,
    scores: only(j.scores),
    overrides: only(j.overrides),
    details: { ...(j.details || {}), ai: only(j.details?.ai), letters: only(j.details?.letters) },
    ...(j.appliedBy ? { appliedBy: j.appliedBy.filter((a) => scope.has(a.profileId)) } : {}),
  };
}

// ---------- Saved searches and the job board for one account ----------

// A search belongs to its profile (anyone with that profile sees it) and to whoever created it.
export const searchVisible = (req, s) => !req.scope || (!!s.profileId && req.scope.has(s.profileId)) || (!!req.user && s.ownerId === req.user.id);

// Which jobs an account sees: found by its searches, opened in its Chrome, added by it, or applied to
// with its profiles. Admins see every job.
export function jobFilter(req, searches, apps, appliedFor) {
  if (!req.scope) return () => true;
  const mine = new Set(searches.filter((s) => searchVisible(req, s)).map((s) => s.id));
  const myApps = apps.filter((a) => req.scope.has(a.profileId));
  const uid = req.user?.id;
  return (j) => (j.searchIds || []).some((id) => mine.has(id))
    || (j.details?.seenBy || []).includes(uid) || j.details?.addedBy === uid
    || appliedFor(j, myApps).length > 0;
}

// ---------- Extension sync for one account ----------

// The account's slice of the data, in the extension's storage shape.
export function scopedData(scope) {
  const all = db.getData();
  if (!scope) return all;
  const profiles = (all.profiles || []).filter((p) => scope.has(p.id));
  const files = new Set(profiles.flatMap((p) => (p.resumes || []).map((r) => r.id)));
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('file_')) { if (files.has(k.slice(5))) out[k] = v; continue; }
    out[k] = v;
  }
  out.profiles = profiles;
  out.applications = (all.applications || []).filter((a) => scope.has(a.profileId));
  if (out.schedule) out.schedule = { ...out.schedule, blocks: (out.schedule.blocks || []).filter((b) => scope.has(b.profileId)) };
  // The extension needs the AI keys to answer questions, so a signed-in extension gets them (unlike the dashboard).
  return out;
}

// Put back an account's slice: its own profiles / applications / files / blocks are replaced,
// everything else in the hub stays exactly as it is. New profiles made in that Chrome join the account.
export function mergeScoped(scope, incoming) {
  const all = db.getData();
  const mine = (p) => scope.has(p.id);
  const inProfiles = (incoming.profiles || []).filter((p) => p?.id);
  const newIds = inProfiles.filter((p) => !(all.profiles || []).some((x) => x.id === p.id)).map((p) => p.id);
  const allowed = new Set([...scope, ...newIds]);
  const out = { ...all };
  out.profiles = [...(all.profiles || []).filter((p) => !mine(p)), ...inProfiles.filter((p) => allowed.has(p.id))];
  out.applications = [...(all.applications || []).filter((a) => !scope.has(a.profileId)), ...(incoming.applications || []).filter((a) => allowed.has(a.profileId))]
    .sort((x, y) => new Date(y.date) - new Date(x.date));
  // Files: keep everyone else's; take this account's from the upload.
  const myFiles = new Set(out.profiles.filter((p) => allowed.has(p.id)).flatMap((p) => (p.resumes || []).map((r) => r.id)));
  for (const k of Object.keys(out)) if (k.startsWith('file_') && myFiles.has(k.slice(5)) && !(k in incoming)) delete out[k];
  for (const [k, v] of Object.entries(incoming)) if (k.startsWith('file_') && myFiles.has(k.slice(5))) out[k] = v;
  // Schedule: only this account's blocks change.
  if (incoming.schedule) {
    const others = (all.schedule?.blocks || []).filter((b) => !scope.has(b.profileId));
    out.schedule = { ...(all.schedule || {}), blocks: [...others, ...(incoming.schedule.blocks || []).filter((b) => allowed.has(b.profileId))] };
  }
  // Shared settings: a user's Chrome may change its own preferences, never the admin's AI keys.
  if (incoming.settings) {
    const cur = all.settings || {};
    out.settings = { ...cur, ...incoming.settings, aiKeys: cur.aiKeys, keys: cur.keys, models: cur.models, activeProfileId: cur.activeProfileId };
  }
  // Notes and caches: keep both sides.
  if (incoming.dayNotes) out.dayNotes = { ...(all.dayNotes || {}), ...incoming.dayNotes };
  return { data: out, newIds };
}
