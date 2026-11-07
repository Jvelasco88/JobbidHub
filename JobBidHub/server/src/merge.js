// Merge two extension datasets: keep everything that exists on either side, "local" wins conflicts.
// Same rules as dsMerge() in the extension's datasync.js.
import { LOCAL_ONLY } from './db.js';

function mergeById(a = [], b = []) {
  const map = new Map((a || []).map((x) => [x.id, x]));
  for (const x of b || []) map.set(x.id, x);
  return [...map.values()];
}

// Same profile on both sides: local fields win, saved answers from both are kept.
function mergeProfiles(remote = [], local = []) {
  const byId = new Map((remote || []).map((p) => [p.id, p]));
  return mergeById(remote, local).map((p) => {
    const r = byId.get(p.id);
    if (!r || r === p) return p;
    return { ...p, customAnswers: { ...(r.customAnswers || {}), ...(p.customAnswers || {}) }, answerOptions: { ...(r.answerOptions || {}), ...(p.answerOptions || {}) } };
  });
}

export function mergeData(local, remote) {
  const out = { ...remote };
  for (const [k, v] of Object.entries(local || {})) {
    if (LOCAL_ONLY.includes(k)) continue;
    const r = remote?.[k];
    if (k === 'profiles') out[k] = mergeProfiles(r, v);
    else if (k === 'applications') out[k] = mergeById(r, v).sort((x, y) => new Date(y.date) - new Date(x.date));
    else if (k === 'settings') out[k] = { ...r, ...v, keys: { ...(r?.keys || {}), ...(v?.keys || {}) }, models: { ...(r?.models || {}), ...(v?.models || {}) } };
    else if (k === 'schedule') out[k] = { ...r, ...v, blocks: mergeById(r?.blocks, v?.blocks) };
    else if (v && typeof v === 'object' && !Array.isArray(v) && r && typeof r === 'object' && !Array.isArray(r)) out[k] = { ...r, ...v };
    else out[k] = v;
  }
  return out;
}
