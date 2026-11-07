// Alerts about settings changes, shown under the bell in the dashboard.
// Only settings-type changes: shared extension settings, AI keys, job-board settings, account access,
// sign-ups, office network. Each alert says who did it, what changed, and who should see it:
//   'all'      every account (shared settings that affect everyone's extension)
//   'admins'   admins only (sign-ups, admin-only settings)
//   'user:<id>' one account (their access was changed), admins see these too
import { getDb } from './db.js';
import { nowIso } from './util.js';

const db = () => getDb();

export function initNotices() {
  db().exec(`CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor_id TEXT, actor TEXT, audience TEXT, kind TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS notice_reads (user_id TEXT PRIMARY KEY, last_id INTEGER DEFAULT 0);`);
}

export function addNotice({ actorId = '', actor = '', audience = 'admins', kind, ...data }) {
  db().prepare('INSERT INTO notices (at, actor_id, actor, audience, kind, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nowIso(), actorId, actor, audience, kind, JSON.stringify(data));
  db().prepare('DELETE FROM notices WHERE id NOT IN (SELECT id FROM notices ORDER BY id DESC LIMIT 1000)').run();
}

const visible = (user) => (user.role === 'admin'
  ? { where: '1 = 1', args: [] }
  : { where: "(audience = 'all' OR audience = ?)", args: [`user:${user.id}`] });

export function listNotices(user, limit = 40) {
  const v = visible(user);
  const last = db().prepare('SELECT last_id FROM notice_reads WHERE user_id = ?').get(user.id)?.last_id || 0;
  // Your own changes are never "unread" for you.
  const unread = db().prepare(`SELECT COUNT(*) AS n FROM notices WHERE ${v.where} AND id > ? AND actor_id != ?`).get(...v.args, last, user.id).n;
  const items = db().prepare(`SELECT * FROM notices WHERE ${v.where} ORDER BY id DESC LIMIT ?`).all(...v.args, limit)
    .map((r) => ({ id: r.id, at: r.at, actor: r.actor, actorId: r.actor_id, mine: r.actor_id === user.id, audience: r.audience, kind: r.kind, unread: r.id > last && r.actor_id !== user.id, ...JSON.parse(r.data || '{}') }));
  return { items, unread, lastId: items[0]?.id || 0 };
}

export function markRead(user, upTo) {
  const max = db().prepare('SELECT COALESCE(MAX(id), 0) AS n FROM notices').get().n;
  db().prepare('INSERT INTO notice_reads (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)')
    .run(user.id, Math.min(Number(upTo) || max, max));
}

// ---------- What changed in the shared extension settings ----------

const SETTING_NAMES = {
  useAI: 'Use AI for questions', learnAnswers: 'Learn my answers', overwrite: 'Overwrite filled fields', showPanel: 'Open the side panel by default',
  panelPush: 'Push the page aside', showButton: 'Floating Fill button', promptLog: 'Ask to log after submitting', autoSubmit: 'Auto-submit',
  chatgptWeb: 'ChatGPT website (no API key)', aiStrategy: 'How keys are used', aiTimeout: 'AI time limit', panelSide: 'Side panel position',
};
// Same words as the settings screen.
const VALUE_NAMES = {
  chatgptWeb: { off: 'Off', backup: 'Backup (when API keys fail)', only: 'Only (no API keys)' },
  aiStrategy: { failover: 'In order', rotate: 'Take turns' },
  panelSide: { left: 'Left', right: 'Right' },
};
const fmt = (v) => (v === true ? 'On' : v === false ? 'Off' : v == null || v === '' ? '—' : String(v));
const DEFAULTS = { useAI: true, learnAnswers: true, overwrite: false, showPanel: true, panelPush: true, showButton: true, promptLog: true, autoSubmit: false, chatgptWeb: 'off' };

export function settingsChanges(before = {}, after = {}) {
  const out = [];
  for (const [k, label] of Object.entries(SETTING_NAMES)) {
    const a = before?.[k] ?? DEFAULTS[k], b = after?.[k] ?? DEFAULTS[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ label, value: VALUE_NAMES[k]?.[b] || fmt(b) });
  }
  // AI keys: say what happened, never show a key.
  const ka = (before?.aiKeys || []), kb = (after?.aiKeys || []);
  const ids = (l) => l.map((k) => k.id).join(',');
  if (kb.length > ka.length) out.push({ label: 'AI keys', value: `+${kb.length - ka.length} added (${kb.length} total)` });
  else if (kb.length < ka.length) out.push({ label: 'AI keys', value: `${ka.length - kb.length} removed (${kb.length} left)` });
  else if (ids(ka) !== ids(kb)) out.push({ label: 'AI keys', value: 'order changed' });
  else {
    const toggled = kb.filter((k) => (ka.find((x) => x.id === k.id)?.enabled !== false) !== (k.enabled !== false));
    const remodel = kb.filter((k) => { const o = ka.find((x) => x.id === k.id); return o && (o.model !== k.model || o.key !== k.key); });
    if (toggled.length) out.push({ label: 'AI keys', value: toggled.map((k) => `${k.provider} ${k.enabled !== false ? 'On' : 'Off'}`).join(', ') });
    if (remodel.length) out.push({ label: 'AI keys', value: `${remodel.length} changed` });
  }
  return out;
}

// One account's own extension settings changed (shown to admins).
export function prefChanges(keys, prefs) {
  return keys.map((k) => ({ label: SETTING_NAMES[k] || k, value: VALUE_NAMES[k]?.[prefs[k]] || fmt(prefs[k]) }));
}

const HUB_NAMES = { keepDays: 'Remove untouched jobs after (days)', boards: 'Company career pages', adzunaId: 'Adzuna', adzunaKey: 'Adzuna', adzunaCountry: 'Adzuna' };
export function hubChanges(before = {}, after = {}) {
  const out = new Map();
  for (const [k, label] of Object.entries(HUB_NAMES)) {
    if (JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)) out.set(label, { label, value: k === 'adzunaKey' ? 'key changed' : k === 'boards' ? 'list changed' : fmt(after?.[k]) });
  }
  return [...out.values()];
}
