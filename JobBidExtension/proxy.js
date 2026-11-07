// Proxy for AI requests, set per account by the hub admin (hub dashboard > Proxies).
//   off    - AI requests go straight out
//   hub    - AI requests go to the hub, which sends them on through the proxy (aiFetch below)
//   chrome - this Chrome uses the proxy itself (a PAC script): only AI sites, or every site
// The setting is read from the hub every minute (proxyRefresh) and kept only on this computer.

const PROXY_PAC_MARK = '/* jobbid-proxy */';
let proxyCreds = null; // { username, password } for the proxy's login prompt in Chrome mode
const proxyAuthTries = new Map();

async function proxyCfgNow() {
  const { proxyCfg } = await chrome.storage.local.get('proxyCfg');
  return proxyCfg || { mode: 'off' };
}

// fetch() for AI services: through the hub in hub mode, else the normal fetch (which Chrome's own
// proxy setting already covers in Chrome mode).
async function aiFetch(url, init = {}) {
  const pc = await proxyCfgNow();
  if (pc.mode !== 'hub') return fetch(url, init);
  const cfg = await hubConfig();
  if (!cfg.on || !cfg.token) return fetch(url, init);
  const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers || {}) };
  let res;
  try {
    res = await fetch(`${cfg.url}/api/ai-relay`, {
      method: 'POST',
      headers: hubHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url: String(url), method: init.method || 'GET', headers, body: init.body ?? null, timeoutMs: 300000 }),
      signal: init.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Can't reach the JobBid Hub to send the AI request through the proxy (${e.message})`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Hub proxy error ${res.status}`);
  return new Response(j.body ?? '', { status: j.status >= 200 && j.status <= 599 ? j.status : 502, headers: { 'Content-Type': j.contentType || 'application/json' } });
}

// The PAC script: AI sites (or everything) through the proxy; the hub and local addresses always direct.
function proxyPac(pc, hubHost) {
  const p = pc.proxy;
  const target = `${p.type === 'socks5' ? 'SOCKS5' : p.type === 'https' ? 'HTTPS' : 'PROXY'} ${p.host}:${p.port}`;
  const hosts = [...new Set([...(pc.aiHosts || []), ...(pc.chatgptHosts || [])])];
  return `${PROXY_PAC_MARK}
var HOSTS = ${JSON.stringify(hosts)};
var HUB = ${JSON.stringify(hubHost || '')};
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (isPlainHostName(host) || host === 'localhost' || host === HUB || /^127\\./.test(host) || /^10\\./.test(host) || /^192\\.168\\./.test(host) || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(host)) return 'DIRECT';
  if (${pc.scope === 'all' ? 'true' : 'false'}) return '${target}';
  for (var i = 0; i < HOSTS.length; i++) if (host === HOSTS[i] || dnsDomainIs(host, '.' + HOSTS[i])) return '${target}';
  return 'DIRECT';
}`;
}

const proxyGet = () => new Promise((r) => chrome.proxy.settings.get({ incognito: false }, (d) => r(d || {})));

// Puts this Chrome's proxy in line with the setting. Only removes a proxy JobBid itself set.
async function proxyApply(pc) {
  if (!chrome.proxy?.settings) return { state: pc.mode === 'chrome' ? 'error' : pc.mode === 'hub' ? 'hub' : 'off', error: pc.mode === 'chrome' ? 'Reload JobBid so Chrome gives it the proxy permission' : '' };
  const cur = await proxyGet();
  const ours = cur.levelOfControl === 'controlled_by_this_extension';
  if (pc.mode !== 'chrome' || !pc.proxy) {
    proxyCreds = null;
    if (ours) await chrome.proxy.settings.clear({ scope: 'regular' });
    return { state: pc.mode === 'hub' ? 'hub' : 'off', error: '' };
  }
  if (cur.levelOfControl === 'controlled_by_other_extensions') return { state: 'error', error: 'Another extension (a VPN or proxy extension) controls the proxy in this Chrome. Turn it off.' };
  if (cur.levelOfControl === 'not_controllable') return { state: 'error', error: 'Chrome does not let extensions set the proxy here (a company policy?)' };
  const cfg = await hubConfig();
  let hubHost = '';
  try { hubHost = new URL(cfg.url).hostname.toLowerCase(); } catch {}
  proxyCreds = pc.proxy.username ? { username: pc.proxy.username, password: pc.proxy.password || '' } : null;
  const data = proxyPac(pc, hubHost);
  if (cur.value?.mode !== 'pac_script' || cur.value?.pacScript?.data !== data || !ours) {
    await chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data } }, scope: 'regular' });
  }
  return { state: 'on', error: '' };
}

// Read the setting from the hub, apply it, and tell the hub how it went (shown on its Proxies page).
let proxyLastReport = '';
async function proxyRefresh({ report = true } = {}) {
  const cfg = await hubConfig();
  let pc = { mode: 'off' };
  if (cfg.on && cfg.token && !cfg.offline) {
    try { pc = await hubApi('GET', '/api/proxy/mine'); } catch { pc = await proxyCfgNow(); } // hub away: keep the last setting
  }
  await chrome.storage.local.set({ proxyCfg: pc });
  let st;
  try { st = await proxyApply(pc); } catch (e) { st = { state: 'error', error: e.message }; }
  st = { ...st, mode: pc.mode, note: pc.note || '', at: new Date().toISOString() };
  await chrome.storage.local.set({ proxyState: st });
  const key = `${st.mode}|${st.state}|${st.error}`;
  // Report on change, and every 10 minutes so the hub knows this Chrome is alive.
  if (report && cfg.token && (key !== proxyLastReport || Date.now() - (proxyRefresh.lastAt || 0) > 600000)) {
    proxyLastReport = key;
    proxyRefresh.lastAt = Date.now();
    hubApi('POST', '/api/proxy/status', { state: st.state, error: st.error, mode: st.mode, version: chrome.runtime.getManifest().version }).catch(() => {});
  }
  return st;
}

// The proxy's own login prompt (Chrome mode). Registered at start-up, as Chrome requires.
if (chrome.webRequest?.onAuthRequired) {
  chrome.webRequest.onAuthRequired.addListener((details, done) => {
    if (!details.isProxy) return done({});
    const go = (creds) => {
      if (!creds) return done({});
      const n = (proxyAuthTries.get(details.requestId) || 0) + 1;
      proxyAuthTries.set(details.requestId, n);
      if (proxyAuthTries.size > 500) proxyAuthTries.clear();
      // A wrong password would ask forever: give up after the second try.
      if (n > 2) return done({ cancel: true });
      done({ authCredentials: creds });
    };
    if (proxyCreds) return go(proxyCreds);
    // The worker restarted: read the login again.
    proxyCfgNow().then((pc) => go(pc.mode === 'chrome' && pc.proxy?.username ? { username: pc.proxy.username, password: pc.proxy.password || '' } : null)).catch(() => done({}));
  }, { urls: ['<all_urls>'] }, ['asyncBlocking']);
}
chrome.proxy?.onProxyError?.addListener((e) => {
  chrome.storage.local.set({ proxyState: { state: 'error', mode: 'chrome', error: `Proxy error: ${e.error}${e.details ? ' - ' + e.details : ''}`, at: new Date().toISOString() } }).catch(() => {});
});
