// Accounts and sign-in for the hub dashboard.
// Passwords are stored only as salted scrypt hashes. A session is a random token in an httpOnly cookie.
// Every sign-in attempt (success or not) is kept in login_log for the admin's "Login history".
import crypto from 'node:crypto';
import { getDb, getMeta, setMeta } from './db.js';
import { uid, nowIso } from './util.js';

export const COOKIE = 'jb_session';
const SESSION_DAYS = 14;
const MAX_FAILS = 5; // per username + IP in 10 minutes
const FAIL_WINDOW_MS = 10 * 60 * 1000;

// First admin, created once when the hub has no admin. Change the password after the first sign-in.
const FIRST_ADMIN = { username: 'admin', password: 'sunny20260418', name: 'Administrator' };

const db = () => getDb();

export function initAuth() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, name TEXT, role TEXT DEFAULT 'user', pass TEXT NOT NULL,
      disabled INTEGER DEFAULT 0, note TEXT DEFAULT '', created_at TEXT, updated_at TEXT, last_login TEXT, login_count INTEGER DEFAULT 0, pass_changed_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT, created_at TEXT, last_seen TEXT, expires_at TEXT, ip TEXT, ua TEXT);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, username TEXT, user_id TEXT, ok INTEGER, reason TEXT, ip TEXT, ua TEXT);
    CREATE INDEX IF NOT EXISTS login_log_at ON login_log(at);
  `);
  // Added later: accounts created from the sign-up page wait for an admin (pending = 1).
  const cols = db().prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('pending')) db().exec('ALTER TABLE users ADD COLUMN pending INTEGER DEFAULT 0');
  // Profiles a (non-admin) user may see and use, as a JSON list of profile ids.
  if (!cols.includes('profile_ids')) db().exec("ALTER TABLE users ADD COLUMN profile_ids TEXT DEFAULT '[]'");
  // Contact details and the account's own extension settings (only what differs from the defaults).
  if (!cols.includes('email')) db().exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
  if (!cols.includes('phone')) db().exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
  if (!cols.includes('prefs')) db().exec("ALTER TABLE users ADD COLUMN prefs TEXT DEFAULT '{}'");
  if (!db().prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    const existing = db().prepare('SELECT id FROM users WHERE username = ?').get(FIRST_ADMIN.username);
    if (existing) db().prepare("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?").run(existing.id);
    else createUser({ ...FIRST_ADMIN, role: 'admin' });
  }
  db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}

// ---------- Passwords ----------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [kind, salt, key] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, want);
}
export function verifyPassword(userId, pw) {
  const row = db().prepare('SELECT pass FROM users WHERE id = ?').get(userId);
  return !!row && checkPassword(pw, row.pass);
}
export function passwordProblem(pw) {
  if (String(pw || '').length < 6) return 'Password must be at least 6 characters.';
  if (String(pw).length > 200) return 'Password is too long.';
  return '';
}

// ---------- Users ----------

const PUBLIC = 'id, username, name, role, disabled, pending, profile_ids, email, phone, prefs, note, created_at, updated_at, last_login, login_count, pass_changed_at';
const toUser = (r) => r && ({ id: r.id, username: r.username, name: r.name || r.username, role: r.role, disabled: !!r.disabled, pending: !!r.pending, profileIds: parseIds(r.profile_ids), email: r.email || '', phone: r.phone || '', prefs: parseObj(r.prefs), note: r.note || '',
  createdAt: r.created_at, updatedAt: r.updated_at, lastLogin: r.last_login || '', loginCount: r.login_count || 0, passChangedAt: r.pass_changed_at || '' });

const parseObj = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const parseIds = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const err = (code, message) => Object.assign(new Error(message), { statusCode: code });
const cleanName = (u) => String(u || '').trim();

export function listUsers() {
  const sess = Object.fromEntries(db().prepare('SELECT user_id, COUNT(*) AS n, MAX(last_seen) AS seen FROM sessions WHERE expires_at > ? GROUP BY user_id').all(nowIso()).map((r) => [r.user_id, r]));
  return db().prepare(`SELECT ${PUBLIC} FROM users ORDER BY pending DESC, role = 'admin' DESC, username`).all()
    .map((r) => ({ ...toUser(r), activeSessions: sess[r.id]?.n || 0, lastSeen: sess[r.id]?.seen || '' }));
}
export const getUser = (id) => toUser(db().prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id));

export function createUser({ username, password, name = '', role = 'user', note = '', pending = false, profileIds = [] }) {
  username = cleanName(username);
  if (!/^[A-Za-z0-9._@-]{3,40}$/.test(username)) throw err(400, 'Username: 3-40 letters, numbers or . _ @ -');
  const p = passwordProblem(password);
  if (p) throw err(400, p);
  if (db().prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw err(409, 'That username is already taken.');
  const id = uid(), at = nowIso();
  db().prepare('INSERT INTO users (id, username, name, role, pass, disabled, pending, profile_ids, note, created_at, updated_at, pass_changed_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)')
    .run(id, username, String(name || '').trim() || username, role === 'admin' ? 'admin' : 'user', hashPassword(password), pending ? 1 : 0, JSON.stringify((profileIds || []).map(String)), String(note || ''), at, at, at);
  return getUser(id);
}

const adminCount = (exceptId = '') => db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND COALESCE(pending, 0) = 0 AND id != ?").get(exceptId).n;

// ---------- Sign-up page ----------
// 'approval' (default): new accounts wait until an admin approves them. 'open': they can sign in at once. 'off': no sign-up page.
export const signupMode = () => { const m = getMeta('signupMode', 'approval'); return ['approval', 'open', 'off'].includes(m) ? m : 'approval'; };
export function setSignupMode(m) {
  if (!['approval', 'open', 'off'].includes(m)) throw err(400, 'Unknown sign-up mode');
  setMeta('signupMode', m);
}
export function signup({ username, name, password }, { ip = '' } = {}) {
  const mode = signupMode();
  if (mode === 'off') throw err(403, 'Sign-up is turned off. Ask the admin for an account.');
  // At most 5 sign-ups per hour from one computer.
  const since = new Date(Date.now() - 3600e3).toISOString();
  if (db().prepare("SELECT COUNT(*) AS n FROM login_log WHERE reason = 'signed up' AND ip = ? AND at > ?").get(ip, since).n >= 5) throw err(429, 'Too many sign-ups. Try again later.');
  const u = createUser({ username, password, name, role: 'user', pending: mode === 'approval' });
  logAttempt(u.username, u.id, true, 'signed up', ip, '');
  return u;
}

export function updateUser(id, patch, actor) {
  const u = getUser(id);
  if (!u) throw err(404, 'Account not found');
  const role = patch.role === undefined ? u.role : patch.role === 'admin' ? 'admin' : 'user';
  const disabled = patch.disabled === undefined ? u.disabled : !!patch.disabled;
  // Never lock everyone out: there must always be one active admin.
  if (u.role === 'admin' && (role !== 'admin' || disabled) && adminCount(id) === 0) throw err(400, 'There must be at least one active admin.');
  if (id === actor?.id && disabled) throw err(400, 'You cannot disable your own account.');
  let username = u.username;
  if (patch.username !== undefined && cleanName(patch.username) !== u.username) {
    username = cleanName(patch.username);
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(username)) throw err(400, 'Username: 3-40 letters, numbers or . _ @ -');
    if (db().prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(username, id)) throw err(409, 'That username is already taken.');
  }
  db().prepare('UPDATE users SET username = ?, name = ?, role = ?, disabled = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(username, patch.name !== undefined ? String(patch.name).trim() || username : u.name, role, disabled ? 1 : 0, patch.note !== undefined ? String(patch.note) : u.note, nowIso(), id);
  if (patch.approve) db().prepare('UPDATE users SET pending = 0 WHERE id = ?').run(id);
  if (Array.isArray(patch.profileIds)) setProfileIds(id, patch.profileIds);
  if (disabled) endSessions(id);
  return getUser(id);
}

export function setPassword(id, password, { keepToken = '' } = {}) {
  const p = passwordProblem(password);
  if (p) throw err(400, p);
  db().prepare('UPDATE users SET pass = ?, pass_changed_at = ?, updated_at = ? WHERE id = ?').run(hashPassword(password), nowIso(), nowIso(), id);
  // A new password signs out every other device of that account.
  db().prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, keepToken);
}

export function deleteUser(id, actor) {
  const u = getUser(id);
  if (!u) throw err(404, 'Account not found');
  if (id === actor?.id) throw err(400, 'You cannot delete your own account.');
  if (u.role === 'admin' && adminCount(id) === 0) throw err(400, 'There must be at least one active admin.');
  db().prepare('DELETE FROM users WHERE id = ?').run(id);
  endSessions(id);
}

// ---------- Own details and extension settings ----------

// Extension settings each account can choose for itself (the rest - AI keys etc. - stay shared).
export const PREF_KEYS = ['useAI', 'learnAnswers', 'overwrite', 'showPanel', 'panelPush', 'showButton', 'promptLog', 'autoSubmit', 'chatgptWeb', 'aiTimeout', 'panelSide'];
const cleanPrefs = (p) => Object.fromEntries(Object.entries(p || {}).filter(([k, v]) => PREF_KEYS.includes(k) && v !== undefined && v !== null));

export function updateMe(id, { name, email, phone } = {}) {
  const u = getUser(id);
  if (!u) throw err(404, 'Account not found');
  const e = email === undefined ? u.email : String(email).trim();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw err(400, 'That email address does not look right.');
  db().prepare('UPDATE users SET name = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?')
    .run(name === undefined ? u.name : String(name).trim() || u.username, e, phone === undefined ? u.phone : String(phone).trim().slice(0, 40), nowIso(), id);
  return getUser(id);
}

// prefs: only what differs from the defaults; a value equal to the default is dropped (follows the default again).
export function setPrefs(id, prefs, defaults = {}) {
  const clean = cleanPrefs(prefs);
  for (const [k, v] of Object.entries(clean)) if (JSON.stringify(v) === JSON.stringify(defaults[k])) delete clean[k];
  db().prepare('UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(clean), nowIso(), id);
  return clean;
}

export function setProfileIds(userId, ids) {
  db().prepare('UPDATE users SET profile_ids = ? WHERE id = ?').run(JSON.stringify([...new Set((ids || []).map(String))]), userId);
}
// A user who creates or imports a profile can use it straight away.
export function grantProfile(userId, profileId) {
  const u = getUser(userId);
  if (u && u.role !== 'admin' && !u.profileIds.includes(profileId)) setProfileIds(userId, [...u.profileIds, profileId]);
}

export const endSessions = (userId) => db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;

// ---------- Sign in / sessions ----------

function logAttempt(username, userId, ok, reason, ip, ua) {
  db().prepare('INSERT INTO login_log (at, username, user_id, ok, reason, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)').run(nowIso(), username, userId || '', ok ? 1 : 0, reason, ip, String(ua || '').slice(0, 300));
  db().prepare('DELETE FROM login_log WHERE id NOT IN (SELECT id FROM login_log ORDER BY id DESC LIMIT 5000)').run();
}

export function login(username, password, { ip = '', ua = '' } = {}) {
  username = cleanName(username);
  const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
  const fails = db().prepare('SELECT COUNT(*) AS n FROM login_log WHERE ok = 0 AND username = ? COLLATE NOCASE AND ip = ? AND at > ? AND reason != ?').get(username, ip, since, 'locked').n;
  if (fails >= MAX_FAILS) {
    logAttempt(username, '', false, 'locked', ip, ua);
    throw err(429, 'Too many wrong passwords. Wait 10 minutes and try again.');
  }
  const row = db().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !checkPassword(password, row.pass)) {
    logAttempt(username, row?.id, false, row ? 'wrong password' : 'unknown user', ip, ua);
    throw err(401, 'Wrong username or password.');
  }
  if (row.pending) {
    logAttempt(username, row.id, false, 'waiting for approval', ip, ua);
    throw err(403, 'Your account is waiting for admin approval.');
  }
  if (row.disabled) {
    logAttempt(username, row.id, false, 'account disabled', ip, ua);
    throw err(403, 'This account is disabled. Ask the admin.');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const at = nowIso();
  db().prepare('INSERT INTO sessions (token, user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(token, row.id, at, at, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), ip, String(ua || '').slice(0, 300));
  db().prepare('UPDATE users SET last_login = ?, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?').run(at, row.id);
  logAttempt(row.username, row.id, true, 'signed in', ip, ua);
  return { token, user: getUser(row.id), maxAge: SESSION_DAYS * 86400 };
}

export function logout(token) {
  db().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

let touchTimes = new Map();
export function userFromToken(token) {
  if (!token) return null;
  const s = db().prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || s.expires_at < nowIso()) return null;
  const u = db().prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(s.user_id);
  if (!u || u.disabled || u.pending) return null;
  // Update "last seen" at most once a minute per session.
  if (Date.now() - (touchTimes.get(token) || 0) > 60000) {
    touchTimes.set(token, Date.now());
    db().prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(nowIso(), token);
  }
  return toUser(u);
}

export function listSessions(userId) {
  const q = userId ? 'WHERE s.user_id = ? AND s.expires_at > ?' : 'WHERE s.expires_at > ?';
  const args = userId ? [userId, nowIso()] : [nowIso()];
  return db().prepare(`SELECT s.token, s.user_id, s.created_at, s.last_seen, s.ip, s.ua, u.username, u.name FROM sessions s LEFT JOIN users u ON u.id = s.user_id ${q} ORDER BY s.last_seen DESC`)
    .all(...args).map((r) => ({ id: r.token.slice(0, 12), userId: r.user_id, username: r.username, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen, ip: r.ip, ua: r.ua }));
}
export function endSessionById(shortId) {
  return db().prepare('DELETE FROM sessions WHERE substr(token, 1, 12) = ?').run(shortId).changes;
}

export function loginLog({ limit = 200, userId = '', failedOnly = false } = {}) {
  const where = [], args = [];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (failedOnly) where.push('ok = 0');
  return db().prepare(`SELECT * FROM login_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(1000, Number(limit) || 200))
    .map((r) => ({ id: r.id, at: r.at, username: r.username, userId: r.user_id, ok: !!r.ok, reason: r.reason, ip: r.ip, ua: r.ua }));
}

// Cookie helpers (no extra dependency).
export function readCookie(req, name = COOKIE) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}
export const sessionCookie = (token, maxAge) => `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
