// Proxies for AI calls. The admin keeps a list of proxies (HTTP, HTTPS or SOCKS5, with or without a
// login) and decides per account how that account's JobBid uses one:
//   off    - straight to the AI service (default)
//   hub    - the extension sends its AI requests here, and the hub sends them on through the proxy
//   chrome - the extension sets the proxy in that Chrome (only AI sites, or every site)
// The hub's own AI calls (job scoring, resume reading) can use a proxy too.
// Kept in the meta table, not the store: the store is copied to every Chrome, and passwords must not be.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { getMeta, setMeta, getStore, sealSecret, openSecret } from './db.js';
import { listUsers } from './auth.js';
import { uid, nowIso } from './util.js';

const TYPES = ['http', 'https', 'socks5'];
const MODES = ['off', 'hub', 'chrome'];
const SCOPES = ['ai', 'all'];
const httpError = (code, message) => Object.assign(new Error(message), { statusCode: code });
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);

// AI services (and the ChatGPT website, for Chrome mode). Custom keys add their own server.
export const AI_HOSTS = ['generativelanguage.googleapis.com', 'api.openai.com', 'api.anthropic.com', 'api.groq.com', 'openrouter.ai', 'api.x.ai',
  'api.deepseek.com', 'api.mistral.ai', 'api.together.xyz'];
export const CHATGPT_HOSTS = ['chatgpt.com', 'chat.openai.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'];
const customHosts = () => {
  const keys = getStore('settings', {})?.aiKeys || [];
  return keys.filter((k) => k.provider === 'custom' && k.baseUrl).map((k) => { try { return new URL(k.baseUrl).hostname.toLowerCase(); } catch { return ''; } }).filter(Boolean);
};
export const aiHosts = () => [...new Set([...AI_HOSTS, ...customHosts()])];

// ---------- Saved settings ----------

const EMPTY = { proxies: [], defaultRule: { mode: 'off', proxyId: '', scope: 'ai' }, users: {}, hubOwn: '' };
function load() {
  try { return { ...EMPTY, ...JSON.parse(getMeta('proxyConfig', '') || '{}') }; } catch { return { ...EMPTY }; }
}
const save = (cfg) => setMeta('proxyConfig', JSON.stringify(cfg));
const withPassword = (p) => p && { ...p, password: p.passEnc ? openSecret(p.passEnc) : '' };
const proxyById = (cfg, id) => withPassword(cfg.proxies.find((p) => p.id === id));
const cleanRule = (r, cfg) => {
  const mode = MODES.includes(r?.mode) ? r.mode : 'off';
  const proxyId = cfg.proxies.some((p) => p.id === r?.proxyId) ? r.proxyId : '';
  return { mode: proxyId ? mode : 'off', proxyId, scope: SCOPES.includes(r?.scope) ? r.scope : 'ai' };
};

// What one account uses: its own rule, else the default.
export function ruleFor(user) {
  const cfg = load();
  const own = user && cfg.users[user.id];
  const r = cleanRule(own && own.mode !== 'default' ? own : cfg.defaultRule, cfg);
  return { ...r, proxy: r.mode === 'off' ? null : proxyById(cfg, r.proxyId), own: !!(own && own.mode !== 'default') };
}

// Chrome can't sign in to a SOCKS5 proxy, so that combination goes through the hub instead.
const chromeCan = (p) => !(p?.type === 'socks5' && p.username);

// ---------- Connecting through a proxy ----------

// Reads from a socket until test(buffer) says how many bytes make a full reply.
function reader(sock) {
  let buf = Buffer.alloc(0), wake = null, err = null;
  const poke = () => { const w = wake; wake = null; w?.(); };
  const onData = (d) => { buf = Buffer.concat([buf, d]); poke(); };
  const onErr = (e) => { err = e; poke(); };
  const onClose = () => { err = err || new Error('The proxy closed the connection'); poke(); };
  sock.on('data', onData); sock.on('error', onErr); sock.on('close', onClose);
  return {
    async until(test) {
      for (;;) {
        const n = test(buf);
        if (n >= 0) { const out = buf.subarray(0, n); buf = buf.subarray(n); return out; }
        if (err) throw err;
        await new Promise((r) => (wake = r));
      }
    },
    done() { sock.off('data', onData); sock.off('error', onErr); sock.off('close', onClose); if (buf.length) sock.unshift(buf); },
  };
}

const SOCKS_ERR = { 1: 'general failure', 2: 'not allowed by the proxy', 3: 'network unreachable', 4: 'host unreachable', 5: 'connection refused', 6: 'timed out', 7: 'command not supported', 8: 'address type not supported' };

// A socket to host:port through the proxy (not yet TLS to the target).
async function tunnel(proxy, host, port) {
  const sock = await new Promise((resolve, reject) => {
    const opts = { host: proxy.host, port: Number(proxy.port) };
    const c = proxy.type === 'https' ? tls.connect({ ...opts, servername: net.isIP(proxy.host) ? undefined : proxy.host }) : net.connect(opts);
    c.once(proxy.type === 'https' ? 'secureConnect' : 'connect', () => resolve(c));
    c.once('error', (e) => reject(new Error(`Can't reach the proxy ${proxy.host}:${proxy.port} (${e.code || e.message})`)));
  });
  const r = reader(sock);
  try {
    if (proxy.type === 'socks5') {
      const login = !!proxy.username;
      sock.write(Buffer.from(login ? [5, 2, 0, 2] : [5, 1, 0]));
      let b = await r.until((x) => (x.length >= 2 ? 2 : -1));
      if (b[1] === 2) {
        const u = Buffer.from(proxy.username || ''), p = Buffer.from(proxy.password || '');
        sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
        b = await r.until((x) => (x.length >= 2 ? 2 : -1));
        if (b[1] !== 0) throw new Error('The SOCKS5 proxy refused the username or password');
      } else if (b[1] !== 0) throw new Error(b[1] === 0xff ? 'The SOCKS5 proxy needs a username and password' : 'The SOCKS5 proxy asks for a login JobBid does not support');
      const h = Buffer.from(host);
      sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]));
      const rep = await r.until((x) => {
        if (x.length < 5) return -1;
        const len = x[3] === 1 ? 4 : x[3] === 4 ? 16 : x[3] === 3 ? 1 + x[4] : 0;
        return x.length >= 6 + len ? 6 + len : -1;
      });
      if (rep[1] !== 0) throw new Error(`The SOCKS5 proxy could not connect to ${host} (${SOCKS_ERR[rep[1]] || 'code ' + rep[1]})`);
    } else {
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}\r\n` : '';
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
      const head = (await r.until((x) => { const i = x.indexOf('\r\n\r\n'); return i < 0 ? -1 : i + 4; })).toString('latin1');
      const code = Number(head.split(' ')[1]);
      if (code !== 200) throw new Error(code === 407 ? 'The proxy refused the username or password (407)' : `The proxy answered: ${head.split('\r\n')[0]}`);
    }
  } catch (e) {
    sock.destroy();
    throw e;
  }
  r.done();
  return sock;
}

// fetch() through a proxy. Returns what callers of fetch use: ok, status, text(), json().
export async function proxyFetch(proxy, url, { method = 'GET', headers = {}, body, timeoutMs = 120000, signal } = {}) {
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const port = Number(u.port) || (secure ? 443 : 80);
  let timer, sock;
  const abort = () => sock?.destroy(new Error('Cancelled'));
  signal?.addEventListener?.('abort', abort, { once: true });
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => { sock?.destroy(); reject(new Error(`No reply through the proxy within ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
      (async () => {
        const raw = await tunnel(proxy, u.hostname, port);
        sock = secure ? await new Promise((res, rej) => {
          const t = tls.connect({ socket: raw, servername: u.hostname, ALPNProtocols: ['http/1.1'] });
          t.once('secureConnect', () => res(t));
          t.once('error', (e) => rej(new Error(`Secure connection to ${u.hostname} failed through the proxy (${e.code || e.message})`)));
        }) : raw;
        sock.resume();
        const h = { ...Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])), host: u.host, 'accept-encoding': 'identity', connection: 'close' };
        if (body != null) h['content-length'] = String(Buffer.byteLength(body));
        const req = http.request({ method, path: u.pathname + u.search, headers: h, createConnection: () => sock }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let used = false;
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
              headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null }, contentType: res.headers['content-type'] || '',
              get bodyUsed() { return used; },
              text: async () => { used = true; return text; },
              json: async () => { used = true; return JSON.parse(text); },
            });
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        if (body != null) req.write(body);
        req.end();
      })().catch(reject);
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

// The hub's own AI calls: through the chosen proxy, or straight.
export function aiFetch(url, init = {}) {
  const cfg = load();
  const p = cfg.hubOwn && proxyById(cfg, cfg.hubOwn);
  if (!p) return fetch(url, init);
  return proxyFetch(p, url, { ...init, timeoutMs: 180000 });
}

// Which address and country the world sees through a proxy, and whether Gemini / OpenAI answer.
async function testProxy(p) {
  const started = Date.now();
  const out = { ok: false, ms: 0, ip: '', country: '', city: '', org: '', error: '', services: [] };
  // Several address services, in case one is down or blocks the proxy.
  const LOOKUPS = [
    ['https://ipwho.is/', (j) => ({ ip: j.ip, country: j.country, city: j.city, org: j.connection?.org || j.connection?.isp })],
    ['https://ipinfo.io/json', (j) => ({ ip: j.ip, country: j.country, city: j.city, org: j.org })],
    ['https://api.ipify.org?format=json', (j) => ({ ip: j.ip })],
  ];
  for (const [url, read] of LOOKUPS) {
    try {
      const r = await proxyFetch(p, url, { headers: { accept: 'application/json', 'user-agent': 'JobBidHub/1.0' }, timeoutMs: 15000 });
      const info = read(await r.json().catch(() => ({})));
      if (!info.ip) continue;
      Object.assign(out, { ok: true, ms: Date.now() - started, ip: info.ip, country: info.country || '', city: info.city || '', org: info.org || '', error: '' });
      break;
    } catch (e) {
      out.error = e.message;
      // The proxy itself is down or refused the login: the other services won't help.
      if (/reach the proxy|username or password|needs a username/i.test(e.message)) break;
    }
  }
  if (!out.ok) return out;
  // No key is sent: a 400/401/403 "key missing" answer still shows the service is reachable from there.
  const checks = [['Gemini', 'https://generativelanguage.googleapis.com/v1beta/models'], ['OpenAI', 'https://api.openai.com/v1/models'], ['Claude', 'https://api.anthropic.com/v1/models']];
  out.services = await Promise.all(checks.map(async ([name, url]) => {
    try {
      const r = await proxyFetch(p, url, { headers: { 'user-agent': 'JobBidHub/1.0' }, timeoutMs: 15000 });
      const t = await r.text();
      const blocked = /location is not supported|unsupported_country|not supported in your country|region/i.test(t) || (r.status === 403 && !/api key|x-api-key|authentication|unauthorized/i.test(t));
      return { name, ok: !blocked, status: r.status, note: blocked ? 'Blocked from this location' : 'Reachable' };
    } catch (e) {
      return { name, ok: false, status: 0, note: e.message };
    }
  }));
  return out;
}

// ---------- What each Chrome reports back ----------

const chromeStatus = new Map(); // user id -> { at, state, error, version }

// ---------- Routes ----------

const publicProxy = (p) => ({ id: p.id, name: p.name, type: p.type, host: p.host, port: p.port, username: p.username || '', hasPassword: !!p.passEnc, note: p.note || '' });

export default async function proxyRoutes(app) {
  // Admin: the list, the default and every account's choice.
  app.get('/api/admin/proxies', async () => {
    const cfg = load();
    return {
      proxies: cfg.proxies.map(publicProxy), defaultRule: cleanRule(cfg.defaultRule, cfg), hubOwn: cfg.proxies.some((p) => p.id === cfg.hubOwn) ? cfg.hubOwn : '',
      users: listUsers().filter((u) => !u.pending).map((u) => {
        const own = cfg.users[u.id];
        return { id: u.id, name: u.name, username: u.username, role: u.role, disabled: u.disabled, rule: own && own.mode !== 'default' ? cleanRule(own, cfg) : null, status: chromeStatus.get(u.id) || null };
      }),
    };
  });

  app.put('/api/admin/proxies', async (req) => {
    const b = req.body || {};
    const old = load();
    const proxies = (Array.isArray(b.proxies) ? b.proxies : []).slice(0, 50).map((p) => {
      const before = old.proxies.find((x) => x.id === p.id);
      const type = TYPES.includes(p.type) ? p.type : 'http';
      const host = s(p.host, 255).replace(/^[a-z0-9]+:\/\//i, '').replace(/\/.*$/, '');
      const port = Math.round(Number(p.port));
      if (!host) throw httpError(400, 'Every proxy needs an address.');
      if (!(port >= 1 && port <= 65535)) throw httpError(400, `The port of ${host} must be a number from 1 to 65535.`);
      // Password: a new one replaces it, '' keeps the saved one, null removes it.
      const passEnc = p.password === null ? '' : p.password ? sealSecret(String(p.password)) : before?.passEnc || '';
      return { id: before ? before.id : uid(), name: s(p.name, 80) || `${host}:${port}`, type, host, port, username: s(p.username, 255), passEnc, note: s(p.note, 300), updatedAt: nowIso() };
    });
    const cfg = { ...old, proxies };
    // New proxies sent with a temporary id ("new-1") keep their rules.
    const idMap = new Map((b.proxies || []).map((p, i) => [p.id, proxies[i].id]));
    const fixId = (r) => (r ? { ...r, proxyId: idMap.get(r.proxyId) || r.proxyId } : r);
    cfg.defaultRule = cleanRule(fixId(b.defaultRule || old.defaultRule), cfg);
    cfg.hubOwn = proxies.some((p) => p.id === (idMap.get(b.hubOwn) || b.hubOwn)) ? idMap.get(b.hubOwn) || b.hubOwn : '';
    cfg.users = {};
    for (const [id, r] of Object.entries(b.users || old.users || {})) if (r && r.mode !== 'default') cfg.users[id] = cleanRule(fixId(r), cfg);
    save(cfg);
    return { ok: true };
  });

  // Test one saved proxy, or one being typed in (with its password, or the saved one).
  app.post('/api/admin/proxies/test', async (req) => {
    const b = req.body || {};
    const cfg = load();
    const saved = b.id ? proxyById(cfg, b.id) : null;
    const p = b.proxy ? { ...saved, ...b.proxy, password: b.proxy.password || saved?.password || '' } : saved;
    if (!p?.host || !p.port) throw httpError(400, 'Enter the proxy address and port first.');
    return testProxy({ ...p, type: TYPES.includes(p.type) ? p.type : 'http', port: Number(p.port) });
  });

  // The extension: what this account's JobBid should do. The login goes to Chrome only in Chrome mode.
  app.get('/api/proxy/mine', async (req) => {
    if (!req.user) throw httpError(401, 'Please sign in.');
    const r = ruleFor(req.user);
    if (r.mode === 'off' || !r.proxy) return { mode: 'off' };
    let mode = r.mode, note = '';
    if (mode === 'chrome' && !chromeCan(r.proxy)) { mode = 'hub'; note = 'Chrome cannot sign in to a SOCKS5 proxy, so AI goes through the hub.'; }
    const base = { mode, scope: r.scope, name: r.proxy.name, type: r.proxy.type, note, aiHosts: aiHosts(), chatgptHosts: CHATGPT_HOSTS };
    if (mode !== 'chrome') return base;
    return { ...base, proxy: { type: r.proxy.type, host: r.proxy.host, port: r.proxy.port, username: r.proxy.username || '', password: r.proxy.password || '' } };
  });

  app.post('/api/proxy/status', async (req) => {
    if (!req.user) throw httpError(401, 'Please sign in.');
    const b = req.body || {};
    chromeStatus.set(req.user.id, { at: nowIso(), state: s(b.state, 40), error: s(b.error, 300), mode: s(b.mode, 20), version: s(b.version, 20) });
    return { ok: true };
  });

  // Hub mode: one AI request from the extension, sent on through this account's proxy.
  app.post('/api/ai-relay', async (req) => {
    if (!req.user) throw httpError(401, 'Please sign in.');
    const r = ruleFor(req.user);
    if (!r.proxy || r.mode === 'off') throw httpError(400, 'No proxy is set for this account. Ask the admin, or reload JobBid.');
    const b = req.body || {};
    let u;
    try { u = new URL(String(b.url || '')); } catch { throw httpError(400, 'Bad AI address'); }
    // Only AI services: the hub must not become an open proxy for anything else.
    if (u.protocol !== 'https:' || !aiHosts().includes(u.hostname.toLowerCase())) throw httpError(400, `The hub only sends AI requests through the proxy, not to ${u.hostname}.`);
    const method = ['GET', 'POST'].includes(String(b.method || 'GET').toUpperCase()) ? String(b.method || 'GET').toUpperCase() : 'GET';
    const headers = Object.fromEntries(Object.entries(b.headers || {}).filter(([k]) => !/^(host|content-length|connection|accept-encoding|proxy-)/i.test(k)).map(([k, v]) => [k, String(v)]));
    if (!Object.keys(headers).some((k) => /^user-agent$/i.test(k))) headers['user-agent'] = 'JobBid/1.0';
    const timeoutMs = Math.max(5000, Math.min(Number(b.timeoutMs) || 120000, 600000));
    const res = await proxyFetch(r.proxy, u.toString(), { method, headers, body: method === 'POST' && b.body != null ? String(b.body) : undefined, timeoutMs }).catch((e) => {
      throw httpError(502, `Proxy "${r.proxy.name}": ${e.message}`);
    });
    return { status: res.status, contentType: res.contentType, body: await res.text() };
  });
}
