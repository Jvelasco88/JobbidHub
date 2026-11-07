// How much each AI key is used, per day: by every Chrome (sent with its regular sync) and by the hub itself.
// The first time a key runs out of quota (or fails all day) the admins get an alert in the bell.
import { getDb, getMeta, setMeta } from './db.js';
import { addNotice } from './notices.js';

const db = () => getDb();
let ready = false;
function init() {
  if (ready) return;
  db().exec(`CREATE TABLE IF NOT EXISTS ai_usage (
    day TEXT, key_id TEXT, user_id TEXT, provider TEXT, model TEXT,
    calls INTEGER DEFAULT 0, ok INTEGER DEFAULT 0, fail INTEGER DEFAULT 0, quota INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
    last_error TEXT DEFAULT '', updated_at TEXT, PRIMARY KEY (day, key_id, user_id))`);
  ready = true;
}

// This PC's date (the team works in one time zone; free quotas reset daily).
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v) => Math.max(0, Math.min(1e6, Math.round(Number(v) || 0)));

export function recordUsage(userId, items) {
  init();
  const day = today();
  const up = db().prepare(`INSERT INTO ai_usage (day, key_id, user_id, provider, model, calls, ok, fail, quota, ms, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, key_id, user_id) DO UPDATE SET calls = calls + excluded.calls, ok = ok + excluded.ok, fail = fail + excluded.fail,
      quota = quota + excluded.quota, ms = ms + excluded.ms, provider = excluded.provider, model = excluded.model,
      last_error = CASE WHEN excluded.last_error != '' THEN excluded.last_error ELSE last_error END, updated_at = excluded.updated_at`);
  for (const it of (Array.isArray(items) ? items : []).slice(0, 50)) {
    const keyId = String(it.keyId || '').slice(0, 80);
    if (!keyId) continue;
    const row = { calls: num(it.calls), ok: num(it.ok), fail: num(it.fail), quota: num(it.quota), ms: num(it.ms) };
    if (!row.calls && !row.fail) continue;
    up.run(day, keyId, String(userId || ''), String(it.provider || '').slice(0, 40), String(it.model || '').slice(0, 120),
      row.calls, row.ok, row.fail, row.quota, row.ms, String(it.lastError || '').slice(0, 300), new Date().toISOString());
    alertIfBad(day, keyId, it);
  }
}

// One alert per key per day: out of quota, or failing with no success at all today.
function alertIfBad(day, keyId, it) {
  const sums = db().prepare('SELECT SUM(ok) AS ok, SUM(fail) AS fail, SUM(quota) AS quota FROM ai_usage WHERE day = ? AND key_id = ?').get(day, keyId);
  const problem = sums.quota > 0 ? 'Free quota used up - JobBid uses the other keys until it resets'
    : sums.fail >= 5 && !sums.ok ? `Failing all day: ${String(it.lastError || 'no answer').slice(0, 160)}` : '';
  if (!problem) return;
  const mark = `aialert:${keyId}`;
  if (getMeta(mark, '') === day) return;
  setMeta(mark, day);
  addNotice({ actor: 'JobBid', audience: 'admins', kind: 'ai-key', changes: [
    { label: 'AI key', value: [it.provider, it.model].filter(Boolean).join(' · ') || keyId },
    { label: 'Problem', value: problem },
  ] });
}

// Per key: today, the last 7 days, and the latest error.
export function usageView(days = 7) {
  init();
  const from = today(new Date(Date.now() - (days - 1) * 864e5));
  const rows = db().prepare('SELECT * FROM ai_usage WHERE day >= ? ORDER BY day').all(from);
  const out = {};
  const d0 = today();
  for (const r of rows) {
    const k = (out[r.key_id] ||= { today: { calls: 0, ok: 0, fail: 0, quota: 0 }, week: { calls: 0, ok: 0, fail: 0, quota: 0, ms: 0 }, byDay: {}, lastError: '', lastErrorAt: '' });
    for (const f of ['calls', 'ok', 'fail', 'quota']) { k.week[f] += r[f]; if (r.day === d0) k.today[f] += r[f]; }
    k.week.ms += r.ms;
    k.byDay[r.day] = (k.byDay[r.day] || 0) + r.calls;
    if (r.last_error && (r.updated_at || '') > k.lastErrorAt) { k.lastError = r.last_error; k.lastErrorAt = r.updated_at; }
  }
  return { from, today: d0, keys: out };
}

export default async function aiUsageRoutes(app) {
  // From the extension (any signed-in account): counts since its last report.
  app.post('/api/ai-usage', async (req) => { recordUsage(req.user.id, req.body?.items); return { ok: true }; });
  app.get('/api/admin/ai-usage', async (req) => usageView(Math.min(30, Math.max(1, Number(req.query.days) || 7))));
}
