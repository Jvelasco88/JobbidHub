// Sign-in endpoints, the access guard for the whole API, and the admin's account management.
import fp from 'fastify-plugin';
import * as auth from './auth.js';
import { networkOn, saveNetworkConfig, lanAddresses, tunnelConfig } from './network.js';
import { startTunnel, stopTunnel, tunnelStatus } from './tunnel.js';
import { addNotice } from './notices.js';
import { listProfiles } from './db.js';

const profileNames = (ids) => { const all = listProfiles(); return (ids || []).map((id) => { const p = all.find((x) => x.id === id); return p ? p.label || p.fullName : 'deleted'; }).join(', ') || 'none'; };

// Reachable without signing in.
const PUBLIC = new Set(['GET /api/health', 'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/signup', 'GET /api/auth/options', 'GET /api/extension/info', 'GET /api/extension/download', 'GET /api/extension/installer', 'GET /api/extension/install.ps1', 'GET /api/extension/update.ps1']);
// The JobBid extension syncs without a dashboard sign-in. It marks its calls with a header that a web
// page cannot send to this server (the browser would need a CORS preflight, which is refused).
const EXTENSION = new Set(['GET /api/sync', 'PUT /api/sync', 'POST /api/jobs/seen']);

const clientIp = (req) => String(req.ip || '').replace(/^::ffff:/, '');
// The request comes from this computer itself (not another PC on the network).
export const isLocal = (req) => ['127.0.0.1', '::1'].includes(String(req.socket?.remoteAddress || '').replace(/^::ffff:/, ''));

// Shared settings and whole-database actions: admins only.
const ADMIN_ONLY = [/^PUT \/api\/settings$/, /^(GET|POST) \/api\/ai\//, /^POST \/api\/import$/, /^GET \/api\/export$/, /^GET \/api\/clients$/,
  /^DELETE \/api\/jobs$/, /^POST \/api\/jobs\/rescore$/];

// Some browsers (anti-detect / privacy browsers) drop cookies, so the dashboard also sends the session
// token in a header. File downloads opened in a new tab can pass it as ?token= instead.
function tokenOf(req) {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.method === 'GET' && /^\/api\/(files\/|export)/.test(req.url) && req.query?.token) return String(req.query.token);
  return auth.readCookie(req);
}

async function authRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return; // the dashboard page itself; it shows the sign-in screen
    const key = `${req.method} ${req.url.split('?')[0]}`;
    if (req.method === 'OPTIONS' || PUBLIC.has(key)) return;
    const token = tokenOf(req);
    // The extension always signs in (also on the hub PC): an admin gets everything, a user only their profiles.
    if (EXTENSION.has(key) && req.headers['x-jobbid-ext'] === '1') req.viaExtension = true;
    const user = auth.userFromToken(token);
    if (!user) return reply.code(401).send({ error: 'Please sign in.' });
    req.user = user;
    req.token = token;
    // null = every profile (admin); otherwise the profile ids this account was given.
    req.scope = user.role === 'admin' ? null : new Set(user.profileIds);
    if (user.role !== 'admin' && (req.url.startsWith('/api/admin/') || ADMIN_ONLY.some((r) => r.test(key)))) return reply.code(403).send({ error: 'Only an admin can do this.' });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body || {};
    const r = auth.login(username, password, { ip: clientIp(req), ua: req.headers['user-agent'] });
    reply.header('Set-Cookie', auth.sessionCookie(r.token, r.maxAge));
    return { user: r.user, token: r.token };
  });
  app.get('/api/auth/options', async () => ({ signup: auth.signupMode() }));
  app.post('/api/auth/signup', async (req, reply) => {
    const u = auth.signup(req.body || {}, { ip: clientIp(req) });
    addNotice({ actor: u.name, audience: 'admins', kind: 'signup', changes: [{ label: 'Username', value: u.username }], waiting: !!u.pending });
    if (u.pending) return { pending: true };
    // Open sign-up: sign the new account in straight away.
    const r = auth.login(u.username, req.body.password, { ip: clientIp(req), ua: req.headers['user-agent'] });
    reply.header('Set-Cookie', auth.sessionCookie(r.token, r.maxAge));
    return { user: r.user, token: r.token };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    // End the header session AND any older cookie session, so nothing signs this browser back in.
    const h = String(req.headers.authorization || '');
    if (h.startsWith('Bearer ')) auth.logout(h.slice(7).trim());
    const c = auth.readCookie(req);
    if (c) auth.logout(c);
    reply.header('Set-Cookie', auth.clearCookie());
    return { ok: true };
  });
  app.get('/api/auth/me', async (req) => ({ user: req.user }));
  app.post('/api/auth/password', async (req) => {
    const { current, password } = req.body || {};
    // Re-check the current password before changing it.
    if (!auth.verifyPassword(req.user.id, current)) throw Object.assign(new Error('Current password is wrong.'), { statusCode: 400 });
    auth.setPassword(req.user.id, password, { keepToken: req.token });
    return { ok: true };
  });

  // ---------- Admin: accounts ----------

  // Office-network access. Changing it restarts the hub (start.bat starts it again by itself).
  // Internet access through a Cloudflare Tunnel (the token is never sent back to the page).
  const tunnelView = () => { const c = tunnelConfig(); return { on: c.on, mode: c.mode, url: c.url, hasToken: !!c.token, status: tunnelStatus() }; };
  app.get('/api/admin/tunnel', async () => tunnelView());
  app.put('/api/admin/tunnel', async (req) => {
    const b = req.body || {};
    const patch = {};
    if (b.url !== undefined) {
      let url = String(b.url || '').trim().replace(/\/+$/, '');
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (url) { try { url = new URL(url).origin; } catch { throw Object.assign(new Error('That address is not valid.'), { statusCode: 400 }); } }
      patch.publicUrl = url;
    }
    if (b.token !== undefined && String(b.token).trim()) {
      // The dashboard shows "cloudflared.exe service install <token>": keep only the token.
      patch.tunnelToken = String(b.token).trim().split(/\s+/).pop();
    }
    if (b.mode !== undefined) patch.tunnelMode = b.mode === 'token' ? 'token' : 'quick';
    if (b.on !== undefined) patch.tunnel = !!b.on;
    saveNetworkConfig(patch);
    stopTunnel();
    startTunnel(app.log);
    addNotice({ actorId: req.user.id, actor: req.user.name, audience: 'admins', kind: 'settings', via: 'dashboard', changes: [{ label: 'Internet access', value: tunnelConfig().on ? `On (${tunnelConfig().url || 'no address'})` : 'Off' }] });
    return tunnelView();
  });
  app.get('/api/admin/network', async () => ({ network: networkOn(), port: Number(process.env.PORT) || 4417, addresses: lanAddresses() }));
  app.put('/api/admin/network', async (req) => {
    const network = !!req.body?.network;
    if (network === networkOn()) return { network, restarting: false };
    saveNetworkConfig({ network });
    addNotice({ actorId: req.user.id, actor: req.user.name, audience: 'admins', kind: 'settings', via: 'dashboard', changes: [{ label: 'Office network', value: network ? 'On' : 'Off' }] });
    setTimeout(() => process.exit(3), 600);
    return { network, restarting: true };
  });
  app.get('/api/admin/users', async () => auth.listUsers());
  app.get('/api/admin/signup', async () => ({ mode: auth.signupMode() }));
  app.put('/api/admin/signup', async (req) => {
    const before = auth.signupMode();
    auth.setSignupMode(req.body?.mode);
    if (before !== auth.signupMode()) addNotice({ actorId: req.user.id, actor: req.user.name, audience: 'admins', kind: 'settings', via: 'dashboard', changes: [{ label: 'Sign-up page', value: { approval: 'Needs approval', open: 'Open', off: 'Off' }[auth.signupMode()] }] });
    return { mode: auth.signupMode() };
  });
  app.post('/api/admin/users', async (req) => auth.createUser(req.body || {}));
  app.patch('/api/admin/users/:id', async (req) => {
    const before = auth.getUser(req.params.id);
    const after = auth.updateUser(req.params.id, req.body || {}, req.user);
    // Tell that person (and the admins) what changed about their access.
    const ch = [];
    if (before.pending && !after.pending) ch.push({ label: 'Account', value: 'Approved' });
    if (before.role !== after.role) ch.push({ label: 'Role', value: after.role === 'admin' ? 'Admin' : 'User' });
    if (before.disabled !== after.disabled) ch.push({ label: 'Account', value: after.disabled ? 'Disabled' : 'Enabled' });
    if (JSON.stringify([...before.profileIds].sort()) !== JSON.stringify([...after.profileIds].sort())) ch.push({ label: 'Profiles', value: profileNames(after.profileIds) });
    if (ch.length) addNotice({ actorId: req.user.id, actor: req.user.name, audience: `user:${after.id}`, kind: 'access', target: after.name, changes: ch });
    return after;
  });
  app.delete('/api/admin/users/:id', async (req) => { auth.deleteUser(req.params.id, req.user); return { ok: true }; });
  app.post('/api/admin/users/:id/password', async (req) => {
    auth.setPassword(req.params.id, req.body?.password, { keepToken: req.params.id === req.user.id ? req.token : '' });
    const u = auth.getUser(req.params.id);
    if (u && u.id !== req.user.id) addNotice({ actorId: req.user.id, actor: req.user.name, audience: `user:${u.id}`, kind: 'access', target: u.name, changes: [{ label: 'Password', value: 'Reset by admin' }] });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/signout', async (req) => ({ n: auth.endSessions(req.params.id) }));
  // An account's own extension settings back to the defaults.
  app.post('/api/admin/users/:id/reset-prefs', async (req) => {
    auth.setPrefs(req.params.id, {});
    const { bumpRev } = await import('./db.js');
    bumpRev();
    const u = auth.getUser(req.params.id);
    if (u) addNotice({ actorId: req.user.id, actor: req.user.name, audience: `user:${u.id}`, kind: 'access', target: u.name, changes: [{ label: 'My extension settings', value: 'Back to the defaults' }] });
    return { ok: true };
  });
  app.get('/api/admin/sessions', async (req) => auth.listSessions(req.query.userId));
  app.delete('/api/admin/sessions/:id', async (req) => ({ n: auth.endSessionById(req.params.id) }));
  app.get('/api/admin/logins', async (req) => auth.loginLog({ limit: req.query.limit, userId: req.query.userId, failedOnly: req.query.failed === '1' }));
}

// fastify-plugin: the guard hook applies to every route in the app, not just the ones in this file.
export default fp(authRoutes);
