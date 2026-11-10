// JobBid Autofill - background service worker.
importScripts('datasync.js', 'hubsync.js', 'proxy.js', 'lib/pdf-lib.min.js', 'resumefix.js', 'resumedoc.js', 'ats.js');
// Owns storage access, Gemini API calls and the application tracker.

// Gemini and Anthropic (Claude) have their own formats; every other provider speaks the OpenAI
// chat-completions format. "custom" is any OpenAI-compatible server: its address is saved on the key.
const PROVIDERS = {
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash' },
  openai: { base: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini' },
  anthropic: { base: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-5-5' },
  groq: { base: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { base: 'https://openrouter.ai/api/v1', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  xai: { base: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini' },
  deepseek: { base: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  mistral: { base: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest' },
  together: { base: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  custom: { base: '', defaultModel: '' },
};
// The API address for a key: the provider's, or the one typed in for a custom (OpenAI-compatible) server.
const apiBase = (provider, baseUrl) => (provider === 'custom' ? String(baseUrl || '').trim().replace(/\/+$/, '') : PROVIDERS[provider].base);
const ANTHROPIC_VERSION = '2026-10-21';
const anthropicHeaders = (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' });

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  keys: {},
  models: {},
  activeProfileId: '',
  useAI: true,
  overwrite: false,
  showButton: true,
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // Migrate the original Gemini-only settings.
  if (s.apiKey && !s.keys.gemini) s.keys = { ...s.keys, gemini: s.apiKey };
  if (s.model && !s.models.gemini) s.models = { ...s.models, gemini: s.model };
  if (!PROVIDERS[s.provider]) s.provider = 'gemini';
  s.aiKeys = keyPool(s);
  const first = s.aiKeys.find((k) => k.enabled !== false);
  s.chatgptWeb = ['backup', 'only'].includes(s.chatgptWeb) ? s.chatgptWeb : 'off';
  // content.js only asks the AI when settings.apiKey is set; the website mode needs no key.
  s.apiKey = first?.key || (s.chatgptWeb !== 'off' ? 'chatgpt-web' : '');
  s.model = first?.model || '';
  return s;
}

// All API keys, in priority order. Older single-key settings become stable "legacy-<provider>" entries.
function keyPool(s) {
  if (Array.isArray(s.aiKeys)) return s.aiKeys.filter((k) => k.key && PROVIDERS[k.provider]);
  const order = [s.provider, ...Object.keys(PROVIDERS).filter((p) => p !== s.provider)];
  return order.filter((p) => s.keys?.[p]).map((p) => ({ id: 'legacy-' + p, provider: p, key: s.keys[p], model: s.models?.[p] || PROVIDERS[p].defaultModel, enabled: true }));
}

async function getProfiles() {
  const { profiles } = await chrome.storage.local.get('profiles');
  return profiles || [];
}

async function saveProfiles(profiles) {
  await chrome.storage.local.set({ profiles });
}

async function getApplications() {
  const { applications } = await chrome.storage.local.get('applications');
  return applications || [];
}

// Same normalisation as answerKey() in content.js.
function questionKey(q) {
  return String(q ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
    .replace(/\b(required|optional)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// "Stripe, Inc." == "stripe"; "Senior Data Engineer (Remote) - US" == "Senior Data Engineer".
const companyKey = (c) => String(c || '').toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pvt|group|holdings)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
const titleKey = (t) => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s[-–—|@]\s.*$/, '').replace(/[^a-z0-9+#]+/g, ' ').trim();

function sameJob(a, job) {
  const c1 = companyKey(a.company), c2 = companyKey(job.company);
  const t1 = titleKey(a.title), t2 = titleKey(job.title);
  if (!c1 || !c2 || !t1 || !t2) return false; // never match on the title alone
  const companyOk = c1 === c2 || (Math.min(c1.length, c2.length) >= 4 && (c1.includes(c2) || c2.includes(c1)));
  return companyOk && t1 === t2;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // Keep params that commonly identify a job posting, drop tracking noise.
    const keep = ['jk', 'gh_jid', 'jobid', 'jobId', 'job_id', 'currentJobId', 'id', 'vjk'];
    const params = keep.filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`);
    return (u.hostname + u.pathname).replace(/\/+$/, '').toLowerCase() + (params.length ? '?' + params.join('&') : '');
  } catch {
    return url;
  }
}

// ---------- AI providers ----------

function friendlyError(status, body, provider) {
  if (status === 401) return 'Invalid API key - check it on the AI keys page.';
  if (status === 402) return 'This model needs paid credits. Pick a free model (names ending in ":free" on OpenRouter).';
  if (status === 403 && /security policy/i.test(body)) return `${provider} refuses this internet connection (a VPN, proxy or data-centre address such as a seedbox). The key is probably fine - use a home connection or another VPN.`;
  if (/user location is not supported/i.test(body)) return `${provider} is not available from this network's location (VPN/country). Use another connection.`;
  if (status === 403 && /request not allowed/i.test(body)) return `${provider} does not accept requests from this network's country or region. Use another provider, or a connection from a supported country.`;
  if (status === 403 && /network settings|access denied/i.test(body)) return `${provider} blocked the connection from your network (country/region, VPN or proxy).`;
  if (status === 403 && /free tier/i.test(body)) return 'Gemini free tier is not available for this key/project/region. Use Groq or OpenRouter instead.';
  if (status === 404) return 'Model not found. Click "Load models" in Settings and pick one from the list.';
  if (status === 429) return /quota/i.test(body) ? `${provider}: this key's free quota for this model is used up. Try another (text) model or key.` : `${provider} rate limit reached (free tier). Wait a minute and try again.`;
  return `${provider} error ${status}: ${body.slice(0, 300)}`;
}

function parseJson(text) {
  text = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // The reply often has the JSON plus extra text (a note after it, a second block, page text).
    // Take each complete {...} block in turn, ignoring braces inside strings, and use the first valid one.
    const tryParse = (s) => { try { return JSON.parse(s); } catch { try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { return undefined; } } };
    for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          const v = tryParse(text.slice(i, j + 1));
          if (v !== undefined) return v;
          break;
        }
      }
    }
    throw new Error('The AI returned invalid JSON. Try again or pick a stronger model.');
  }
}

// A finished reply whose JSON is broken ({"changes":[{"id":1,"text":"..."}, ... "}"} with a missing "]"):
// every complete flat {...} item in it, as {changes: [...]} (or the plain list) when that passes accept.
function salvageList(text, accept) {
  const items = [];
  for (const m of String(text || '').matchAll(/\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*\}/g)) {
    try { const v = JSON.parse(m[0]); if (v && typeof v === 'object' && !Array.isArray(v)) items.push(v); } catch { /* not a whole item */ }
  }
  if (items.length < 2) return undefined;
  for (const v of [{ changes: items }, items]) if (!accept || accept(v)) return v;
  return undefined;
}

// The last complete top-level JSON object in a page text that is not part of our own question
// (the question shows an example like {"changes":[...]}), and passes accept.
function lastJsonIn(text, question, accept) {
  const s = String(text || '');
  let found;
  for (let i = s.indexOf('{'); i !== -1; ) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = j; break; }
    }
    if (end < 0) { i = s.indexOf('{', i + 1); continue; }
    const raw = s.slice(i, end + 1);
    let v;
    try { v = JSON.parse(raw); } catch { try { v = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch { v = undefined; } }
    if (v !== undefined && !String(question || '').includes(raw) && (!accept || accept(v))) { found = v; i = s.indexOf('{', end + 1); }
    else i = s.indexOf('{', i + 1);
  }
  return found;
}

let rotateIndex = 0;
const DEAD_COOLDOWN_MS = 10 * 60 * 1000;
// A key whose free quota is used up stays used up for hours (Gemini resets daily): don't retry it every 10 minutes.
const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const isQuotaError = (msg) => /quota/i.test(String(msg || ''));

// Keys to try for one request: live/unchecked keys first, recently dead ones last.
async function keysToTry(settings) {
  const { keyHealth = {} } = await chrome.storage.local.get('keyHealth');
  let keys = settings.aiKeys.filter((k) => k.enabled !== false);
  if (settings.aiStrategy === 'rotate' && keys.length > 1) {
    const start = rotateIndex++ % keys.length;
    keys = [...keys.slice(start), ...keys.slice(0, start)];
  }
  const recentlyDead = (k) => {
    const h = keyHealth[k.id];
    return !!h && !h.ok && Date.now() - new Date(h.at) < (isQuotaError(h.error) ? QUOTA_COOLDOWN_MS : DEAD_COOLDOWN_MS);
  };
  return [...keys.filter((k) => !recentlyDead(k)), ...keys.filter(recentlyDead)];
}

// context: instructions + profile; jobText: the job. They are sent with the question every time.
// noWeb: never fall back to the ChatGPT website (the caller asks it differently).
// accept: for the ChatGPT website, a check the parsed JSON must pass before it counts as the answer.
async function ai(question, { json = true, temperature = 0.4, timeoutMs = 0, context = '', jobText = '', noWeb = false, accept } = {}) {
  const prompt = [context, jobText, question].filter(Boolean).join('\n\n');
  const settings = await getSettings();
  const keys = settings.chatgptWeb === 'only' ? [] : await keysToTry(settings);
  if (!noWeb && (settings.chatgptWeb === 'only' || (!keys.length && settings.chatgptWeb === 'backup'))) return chatgptAsk(prompt, { json, timeoutMs, accept });
  if (!keys.length) throw new Error('No AI key. Add one on the AI page of the dashboard.');
  const deadline = timeoutMs ? Date.now() + timeoutMs : 0;
  const errors = [];
  for (const k of keys) {
    const left = deadline ? deadline - Date.now() : 90000;
    if (left < 800) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), left);
    const started = Date.now();
    try {
      aiStage(`Asking ${k.provider} · ${k.model || ''}...`);
      const out = await aiRequest({ provider: k.provider, apiKey: k.key, model: k.model, baseUrl: k.baseUrl }, prompt, { json, temperature, signal: ctrl.signal });
      recordKeyHealth(k, { ok: true, ms: Date.now() - started });
      countKeyUse(k, { ok: true, ms: Date.now() - started });
      return out;
    } catch (e) {
      if (e.name === 'AbortError') {
        // Slow, not broken: the overall time limit is used up.
        errors.push(`${PROVIDERS[k.provider] ? k.provider : ''} too slow`);
        break;
      }
      // A connection/HTTP failure marks the key dead; a bad answer from a working key doesn't.
      if (!e.badOutput) recordKeyHealth(k, { ok: false, error: e.message });
      countKeyUse(k, { ok: !!e.badOutput, error: e.badOutput ? '' : e.message, ms: Date.now() - started });
      errors.push(`${k.provider}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  // Every key failed: use the ChatGPT website if that's allowed as a backup.
  if (settings.chatgptWeb === 'backup' && !noWeb) return chatgptAsk(prompt, { json, timeoutMs: deadline ? Math.max(deadline - Date.now(), 60000) : 0, accept });
  if (errors.length && errors.every((x) => /too slow/.test(x))) throw new Error(`AI timed out after ${Math.round((timeoutMs || 90000) / 1000)}s`);
  throw new Error(errors.length === 1 ? errors[0].replace(/^\w+: /, '') : `All ${keys.length} AI keys failed. ${errors.join(' | ')}`);
}

// Live/dead status per key, shown in the dashboard and popup.
// Writes are queued so results arriving at the same time don't overwrite each other.
let healthQueue = Promise.resolve();
function updateKeyHealth(fn) {
  healthQueue = healthQueue.then(async () => {
    const { keyHealth = {} } = await chrome.storage.local.get('keyHealth');
    fn(keyHealth);
    await chrome.storage.local.set({ keyHealth });
  }).catch(() => {});
  return healthQueue;
}

function recordKeyHealth(k, result) {
  const at = new Date().toISOString();
  return updateKeyHealth((h) => (h[k.id] = { ...result, model: k.model, at }));
}

// Calls per key since the last report to the hub (its AI keys page shows each key's use and alerts the
// admins when one runs out of quota). Uses the same queue as keyHealth so counts are never lost.
function countKeyUse(k, { ok, error = '', ms = 0 }) {
  healthQueue = healthQueue.then(async () => {
    const { keyUsage = {} } = await chrome.storage.local.get('keyUsage');
    const u = (keyUsage[k.id] ||= { keyId: k.id, provider: k.provider, model: k.model || '', calls: 0, ok: 0, fail: 0, quota: 0, ms: 0, lastError: '' });
    u.calls++; u.ms += Math.round(ms); u.model = k.model || u.model;
    if (ok) u.ok++; else { u.fail++; u.lastError = String(error).slice(0, 300); if (isQuotaError(error)) u.quota++; }
    await chrome.storage.local.set({ keyUsage });
  }).catch(() => {});
}

async function flushKeyUsage() {
  const cfg = await hubConfig();
  if (!cfg.on || !cfg.token || cfg.offline) return;
  let items = [];
  healthQueue = healthQueue.then(async () => {
    const { keyUsage = {} } = await chrome.storage.local.get('keyUsage');
    items = Object.values(keyUsage);
    if (items.length) await chrome.storage.local.set({ keyUsage: {} });
  }).catch(() => {});
  await healthQueue;
  if (!items.length) return;
  try { await hubApi('POST', '/api/ai-usage', { items }); } catch {
    // Hub away: put the counts back for the next try.
    healthQueue = healthQueue.then(async () => {
      const { keyUsage = {} } = await chrome.storage.local.get('keyUsage');
      for (const it of items) {
        const u = keyUsage[it.keyId];
        if (!u) keyUsage[it.keyId] = it;
        else for (const f of ['calls', 'ok', 'fail', 'quota', 'ms']) u[f] += it[f] || 0;
      }
      await chrome.storage.local.set({ keyUsage });
    }).catch(() => {});
  }
}

// ---------- Automatic key check (every 2 minutes) ----------
// Uses each provider's key/model listing endpoint: confirms the key is valid and the provider is
// reachable from this network, WITHOUT spending AI quota (a real prompt every 2 min would use
// ~720 requests/day per key). Real AI calls keep updating the status too.

function pingRequest(k) {
  const base = apiBase(k.provider, k.baseUrl);
  const bearer = { Authorization: `Bearer ${k.key}` };
  switch (k.provider) {
    case 'gemini': return [`${base}/models?pageSize=1`, { 'x-goog-api-key': k.key }];
    case 'anthropic': return [`${base}/models?limit=1`, anthropicHeaders(k.key)];
    case 'openrouter': return [`${base}/key`, bearer]; // key info; 401 if the key is invalid
    default: return [`${base}/models`, bearer]; // OpenAI and every OpenAI-compatible provider
  }
}

async function pingKey(k) {
  const [url, headers] = pingRequest(k);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const started = Date.now();
  try {
    let res = await aiFetch(url, { headers, signal: ctrl.signal });
    // Older OpenRouter path, in case /key isn't available.
    if (k.provider === 'openrouter' && res.status === 404) res = await aiFetch(`${PROVIDERS.openrouter.base}/auth/key`, { headers, signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: friendlyError(res.status, await res.text(), k.provider) };
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'No reply within 15s' : `Can't reach ${k.provider} (${e.message})` };
  } finally {
    clearTimeout(timer);
  }
}

async function autoCheckKeys() {
  const settings = await getSettings();
  if (settings.autoCheckKeys === false) return;
  const keys = settings.aiKeys.filter((k) => k.enabled !== false && k.key);
  if (!keys.length) return;
  const results = await Promise.all(keys.map(pingKey));
  const at = new Date().toISOString();
  await updateKeyHealth((h) => keys.forEach((k, i) => {
    // The check only lists models, which still works when the quota is used up: it must not mark such a
    // key "working" again (that would end its rest within 2 minutes). A real AI call or a Test clears it.
    const prev = h[k.id];
    if (results[i].ok && prev && !prev.ok && isQuotaError(prev.error) && Date.now() - new Date(prev.at) < QUOTA_COOLDOWN_MS) return;
    h[k.id] = { ...results[i], model: k.model, at, test: true, auto: true };
  }));
  await chrome.storage.local.set({ lastKeyCheck: at });
}

async function testKeys(ids) {
  const settings = await getSettings();
  const keys = settings.aiKeys.filter((k) => !ids || ids.includes(k.id));
  const results = {};
  await Promise.all(keys.map(async (k) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const started = Date.now();
    try {
      await aiRequest({ provider: k.provider, apiKey: k.key, model: k.model, baseUrl: k.baseUrl }, 'Reply with the single word OK.', { json: false, temperature: 0, signal: ctrl.signal });
      results[k.id] = { ok: true, ms: Date.now() - started, test: true };
    } catch (e) {
      results[k.id] = { ok: false, error: e.name === 'AbortError' ? 'No reply within 20s' : e.message, test: true };
    } finally {
      clearTimeout(timer);
    }
  }));
  const at = new Date().toISOString();
  await updateKeyHealth((h) => { for (const k of keys) h[k.id] = { ...results[k.id], model: k.model, at }; });
  return results;
}

async function aiRequest(settings, prompt, { json, temperature, signal }) {
  const { provider, apiKey, model, baseUrl } = settings;
  if (!apiKey) throw new Error(`No ${provider} API key. Add it in the extension Settings.`);
  const base = apiBase(provider, baseUrl);
  if (!base) throw new Error('This custom AI key has no server address. Add it in the key settings.');
  let res, text;

  if (provider === 'anthropic') {
    // Current Claude models choose their own sampling (a temperature is refused) and always think a
    // little first; low effort keeps form answers quick.
    res = await aiFetch(`${base}/messages`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...anthropicHeaders(apiKey) },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        output_config: { effort: 'low' },
        ...(json ? { system: 'Respond with a single valid JSON object only. No markdown, no commentary.' } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Claude'));
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Claude declined to answer this request.');
    text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } else if (provider === 'gemini') {
    res = await aiFetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Gemini'));
    const data = await res.json();
    text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  } else {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    if (provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://jobbid.local', 'X-Title': 'JobBid Autofill' });
    const send = (withTemperature) => aiFetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model,
        ...(withTemperature ? { temperature } : {}),
        messages: [
          ...(json ? [{ role: 'system', content: 'Respond with a single valid JSON object only. No markdown, no commentary.' }] : []),
          { role: 'user', content: prompt },
        ],
      }),
    });
    res = await send(true);
    if (!res.ok) {
      const body = await res.text();
      // Newer OpenAI models (and some others) accept only their own temperature: ask again without one.
      if (res.status === 400 && /temperature/i.test(body)) res = await send(false);
      if (!res.ok) throw new Error(friendlyError(res.status, res.bodyUsed ? body : await res.text(), provider));
    }
    const data = await res.json();
    if (data.error) throw new Error(`${provider}: ${data.error.message || JSON.stringify(data.error)}`);
    text = data.choices?.[0]?.message?.content || '';
  }

  if (!json) return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return parseJson(text);
  } catch (e) {
    e.badOutput = true;
    throw e;
  }
}

async function listModels(provider, apiKey, baseUrl) {
  const base = apiBase(provider, baseUrl);
  if (!base) throw new Error('Enter the server address first.');
  if (provider === 'anthropic') {
    const res = await aiFetch(`${base}/models?limit=1000`, { headers: anthropicHeaders(apiKey) });
    if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Claude'));
    const data = await res.json();
    return (data.data || []).map((m) => ({ id: m.id, name: m.display_name || '', free: false }));
  }
  if (provider === 'gemini') {
    // Every page of the list; keep only models that can write text (no embedding / image / speech models).
    const all = [];
    let page = '';
    do {
      const res = await aiFetch(`${base}/models?pageSize=1000${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Gemini'));
      const data = await res.json();
      all.push(...(data.models || []));
      page = data.nextPageToken || '';
    } while (page && all.length < 3000);
    return all
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .filter((m) => !/embed|aqa|imagen|veo|tts|image-generation|native-audio|live|robotics|computer-use/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || '', free: false }));
  }
  const res = await aiFetch(`${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), provider));
  const data = await res.json();
  // Together returns a plain list; the others wrap it in {data: [...]}.
  const models = (Array.isArray(data) ? data : data.data || []).map((m) => ({
    id: m.id,
    free: provider === 'groq' || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0),
  }));
  // OpenRouter lists hundreds of paid models; show only the free ones.
  // Drop speech/image/embedding/moderation models that can't chat.
  return models
    .filter((m) => provider !== 'openrouter' || m.free)
    .filter((m) => !/whisper|tts|guard|orpheus|playai|embed|moderation|image|vision-only|dall-e|davinci|babbage|realtime|transcribe|audio|sora/i.test(m.id));
}

const PROFILE_SCHEMA_HINT = `{
  "firstName": "", "lastName": "", "fullName": "", "email": "", "phone": "",
  "address": "", "city": "", "state": "", "zip": "", "country": "",
  "linkedin": "", "github": "", "website": "",
  "headline": "current professional title",
  "summary": "professional summary paragraph",
  "yearsExperience": "number as string, e.g. 10",
  "currentTitle": "", "currentCompany": "",
  "skills": ["skill1", "skill2"],
  "experience": [{ "title": "", "company": "", "location": "", "start": "MM/YYYY", "end": "MM/YYYY or Present", "description": "" }],
  "education": [{ "school": "", "degree": "", "field": "", "start": "MM/YYYY or YYYY if no month", "end": "MM/YYYY or YYYY if no month" }]
}`;

function withHttps(v) {
  v = String(v || '').trim();
  return v && !/^https?:\/\//i.test(v) ? 'https://' + v.replace(/^\/+/, '') : v;
}

async function parseResume({ text }) {
  const prompt = `Extract this resume into JSON matching exactly this shape (use "" for unknown values, never invent data):
${PROFILE_SCHEMA_HINT}
"address" is the street line only (house number and street, e.g. "123 Main St, Apt 4"); leave it "" when the resume shows only a city or region - that goes in city/state.
Keep each experience description to the key bullet points joined by newlines. Return only JSON.`;
  // Whole resumes are long answers for free models: allow up to 2 minutes across all keys.
  const profile = await ai(prompt + '\n\nRESUME:\n' + text.slice(0, 30000), { temperature: 0.1, timeoutMs: 120000 });
  for (const k of ['linkedin', 'github', 'website']) if (profile[k]) profile[k] = withHttps(profile[k]);
  return profile;
}

function profileForPrompt(p) {
  // Birthday / birth year stay local: deterministic field rules fill them, so DOB is never sent to the AI.
  const { resumes, customAnswers, answerOptions, answerTemplates, criteria, defaultResumeId, id, label, birthday, birthYear, sitePassword, ...rest } = p;
  return rest;
}

// Keep an answer under max characters, cut at the end of a sentence when possible.
function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.endsWith('.') ? max - 1 : -1);
  return end > max / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...';
}

// A short fact list for the ChatGPT website. The whole resume makes it open a document instead of answering.
function factsForWeb(p) {
  const skip = new Set(['resumes', 'customAnswers', 'answerOptions', 'answerTemplates', 'id', 'label', 'birthday', 'birthYear',
    'defaultResumeId', 'criteria', 'summary', 'createdAt', 'updatedAt', 'ownerId', 'owner', 'color', 'avatar']);
  const lines = [];
  const put = (k, v) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (s) lines.push(`${k}: ${s}`);
  };
  put('Name', p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '));
  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k) || v == null || typeof v === 'object') continue;
    put(k, v);
  }
  if (Array.isArray(p.skills) && p.skills.length) put('Skills', p.skills.slice(0, 12).join(', '));
  for (const [q, a] of Object.entries(p.customAnswers || {})) if (String(a || '').trim()) put(q, a);
  return lines.join('\n').slice(0, 1600);
}

// Yes/No screening about the candidate's own history (conflicts of interest, government oversight work,
// past applications, clearance, export-control status): when the profile does not say, the usual answer.
const SCREENING_DEFAULT = `Rules when the facts do not answer it directly:
- Past or current history (conflict of interest, government oversight work, applied or worked here before, currently holds or held a security clearance, related to an employee): "No".
- "Authorized to work": use workAuthorization. Visa or sponsorship: use requiresSponsorship.
- Able or eligible to obtain a security clearance, and export-control "protected individual" (US citizen, permanent resident, refugee, asylee): "Yes" if country is United States, workAuthorization is Yes and requiresSponsorship is No; otherwise "No".
- "Willing to" or "able to" (travel, on-site, background check, drug test, share information): "Yes".
- Consent to marketing, SMS or newsletters: "No".`;

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// What the box takes, so ChatGPT replies with exactly that (the reply is put into the box as is).
function answerTypeLine(f) {
  const opts = (f.options || []).map((o) => String(o).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const q = String(f.question || '').toLowerCase();
  if (opts.length) {
    const yesNo = opts.length <= 3 && opts.every((o) => /^(yes|no|n\/a|prefer not.*|decline.*)$/i.test(o)) && opts.some((o) => /^yes$/i.test(o));
    if (yesNo) return `Answer type: ${opts.join(' or ')}. Reply with exactly one of: ${opts.join(' / ')}. No other words.`;
    const many = f.type === 'multi';
    return `Answer type: ${many ? 'one or more options, separated by commas' : 'exactly one option'}. You must choose. Copy the option text exactly, no other words. Options:\n${opts.map((o) => `- ${o}`).join('\n')}`;
  }
  if (f.type === 'number' || /how many|number of|years of/.test(q)) return 'Answer type: a number only (digits). No words.';
  if (f.type === 'date' || /\bdate\b|when can you start|start date|available to start/.test(q)) return 'Answer type: a date, MM/DD/YYYY only. If not in the facts, reply UNKNOWN.';
  // Not UNKNOWN when the candidate has any link: "Links to Proven Research" takes the closest one.
  if (/\burl\b|link|website|portfolio|github|linkedin/.test(q)) return 'Answer type: one URL only, copied from the facts (website, github, linkedin...). If no link matches exactly, give the closest one: website or GitHub for work, projects, research or publications. Reply UNKNOWN only if the facts have no link at all.';
  if (/salary|compensation|pay|rate/.test(q)) return 'Answer type: an amount only (e.g. 150000). If not in the facts, reply UNKNOWN.';
  if (f.type === 'textarea') return 'Answer type: a paragraph of 2-4 sentences in first person, plain text, under 600 characters. Not a document.';
  return 'Answer type: a short text value, one line, under 150 characters. No explanation.';
}

// "UNKNOWN" and a refusal are not an answer to type into the form.
const NO_FACT = /^(unknown|n\/a|none|not specified|i (do not|don't|cant|can't|cannot) know|i (can't|cannot|can not)|not enough information|no information)\b/i;

async function answerFields({ profile, fields, job, timeoutMs }) {
  const me = JSON.stringify(profileForPrompt(profile));
  const jobText = `Now applying to: ${job.title || 'a job'}${job.company ? ' at ' + job.company : ''}\n${(job.description || '').slice(0, 5000)}`;
  const settings = await getSettings();

  // API keys: all questions at once, short instructions.
  const useWeb = settings.chatgptWeb === 'only' || (settings.chatgptWeb === 'backup' && !(await keysToTry(settings)).length);
  if (!useWeb) {
    const context = `Answer these job application questions as the candidate below (first person).
Use only facts from the profile; never invent anything. For questions with options, copy one option exactly ("multi": comma-separated options).
${SCREENING_DEFAULT}
Otherwise unknown: "".
Return JSON: {"answers": {"<field id>": "<value>"}}

Candidate:
${me}`;
    try {
      const out = await ai(`Questions:\n${JSON.stringify(fields)}`, { timeoutMs, context, jobText, noWeb: true });
      return out.answers || {};
    } catch (e) {
      if (settings.chatgptWeb !== 'backup') throw e;
    }
  }

  // ChatGPT website: the profile and the rules go once per chat. Several questions then go together in
  // one message (numbered, each says exactly what kind of answer its box takes) and come back as one
  // JSON object: one round trip instead of one per question. A question the reply leaves out is asked
  // on its own afterwards.
  const answers = {};
  const facts = factsForWeb(profile || {});
  const marker = `JOBBID PROFILE ${simpleHash(facts + SCREENING_DEFAULT)}`;
  const context = {
    marker,
    text: `${marker}\nI am filling job applications for this candidate. Remember these facts and rules for every question I send in this chat.\nUse the facts; do not invent names, numbers, dates or links. Answer in first person as the candidate.\n${SCREENING_DEFAULT}\n\nFacts:\n${facts}\n\nReply with only: OK`,
  };
  const ask = (f) => String(f.question).replace(/\s+/g, ' ').trim();
  const webAnswer = (v) => {
    let answer = stripPageChrome(String(Array.isArray(v) ? v.join(', ') : v ?? '').replace(/^["'“”]+|["'“”]+$/g, ''));
    // The page footer is not an answer, and neither is "UNKNOWN" when the profile has no fact.
    if (NO_FACT.test(answer)) answer = '';
    return answer && !CGPT_STATUS.test(answer) ? shorten(answer, 400) : '';
  };
  let lastError = null;
  if (fields.length > 1) {
    const q = `Answer each numbered question below. Reply with ONLY one JSON object that maps every question number to its answer, e.g. {"1": "Yes", "2": "5"}. Use "" when the facts do not answer it.\n\n`
      + fields.map((f, i) => `${i + 1}. Question: ${ask(f)}\n${answerTypeLine(f)}`).join('\n\n');
    try {
      const out = await chatgptAsk(q, { json: true, timeoutMs, context, accept: (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => /^\d+$/.test(k.trim())) });
      const byNum = Object.fromEntries(Object.entries(out).map(([k, v]) => [k.trim(), v]));
      fields.forEach((f, i) => { if (String(i + 1) in byNum) answers[f.id] = webAnswer(byNum[String(i + 1)]); });
    } catch (e) {
      lastError = e;
    }
  }
  for (const f of fields.filter((x) => !(x.id in answers))) {
    try {
      answers[f.id] = webAnswer(await chatgptAsk(`Question: ${ask(f)}\n${answerTypeLine(f)}`, { json: false, timeoutMs, context }));
    } catch (e) {
      answers[f.id] = '';
      lastError = e;
      if (fields.length === 1) throw e;
    }
  }
  // Nothing at all and ChatGPT reported why (signed out, limit reached): say so instead of "no answer".
  if (lastError && !Object.values(answers).some(Boolean)) throw lastError;
  return answers;
}

// Structured job details for the side panel's Job tab, cached per job URL.
async function analyzeJob({ job, force }) {
  const key = normalizeUrl(job.url);
  const { jobCache = {} } = await chrome.storage.local.get('jobCache');
  if (!force && jobCache[key]) return jobCache[key];
  const prompt = `Extract the key facts of this job posting. Use "" when the posting doesn't say; never guess.
Return JSON: {"title": "", "company": "", "location": "city, region or country", "workMode": "Remote | Hybrid | On-site | ''",
"seniority": "e.g. Entry, Mid, Senior, Lead, Principal", "employmentType": "Full-time | Part-time | Contract | Internship | ''",
"salary": "as written, e.g. $150k-$180k/yr", "posted": "as written, e.g. 3 days ago", "deadline": "",
"visaSponsorship": "Yes | No | ''", "skills": ["up to 10 key required skills"], "summary": "2 short sentences: what the role does and what they want"}

Page title: ${job.title}
Company (from page): ${job.company}
URL: ${job.url}

${(job.description || '').slice(0, 9000)}`;
  const details = await ai(prompt, { temperature: 0.1, timeoutMs: 25000 });
  details.at = new Date().toISOString();
  jobCache[key] = details;
  // Keep the cache small: newest 60 jobs.
  const keys = Object.keys(jobCache).sort((a, b) => (jobCache[b].at || '').localeCompare(jobCache[a].at || ''));
  for (const k of keys.slice(60)) delete jobCache[k];
  await chrome.storage.local.set({ jobCache });
  return details;
}

function matchPromptForWeb(profile, job, resumeText = '') {
  const p = profile || {};
  const work = (p.experience || []).slice(0, 6).map((e) => `- ${[e.title, e.company].filter(Boolean).join(' at ')} (${[e.start, e.end].filter(Boolean).join(' - ')})${e.description ? ': ' + String(e.description).replace(/\s+/g, ' ').slice(0, 220) : ''}`).join('\n');
  const edu = (p.education || []).slice(0, 2).map((e) => `- ${[e.degree, e.field, e.school].filter(Boolean).join(', ')}`).join('\n');
  const desc = String(job.description || '').replace(/\s+/g, ' ').slice(0, 4000);
  const resume = String(resumeText || '').replace(/\s+/g, ' ').trim().slice(0, 5000);
  return `Score how well this candidate fits this job, like a recruiter and an ATS. Skills count by meaning. A keyword is "have" only if the exact word is in the candidate text${resume ? ' or the resume below' : ''}. "industry" is real work experience in the job's industry.
"ats" (0-10) = 60% keywords (main skills count double; an equivalent name gives partial credit), 15% title match, 15% years of experience vs required, 10% industry.
Reply with ONLY this JSON, filled in, no other text:
{"overall":N,"experience":N,"skills":N,"industry":N,"title":N,"ats":A,"industries":[],"keywords":[{"k":"","have":false}],"strengths":[],"gaps":[],"tips":[],"verdict":""}
Replace every N with your score from 0 to 100 and A with the ATS score from 0 to 10 (one decimal). Do not leave any score at 0 unless it really is 0.
Scores 0-100, ats 0-10. 8-14 keywords. Up to 3 strengths, gaps and tips. Verdict: one short sentence.
"industries" lists the JOB's industries (the employer's business, e.g. Logistics), not the candidate's.

CANDIDATE
Title: ${p.headline || p.currentTitle || ''}
Years of experience: ${p.yearsExperience || ''}
Skills: ${(p.skills || []).slice(0, 40).join(', ')}
Work:
${work}
Education:
${edu}
Summary: ${String(p.summary || '').replace(/\s+/g, ' ').slice(0, 600)}
${resume ? `\nRESUME (tailored for this job - use this for ATS keywords and strengths/gaps):\n${resume}\n` : ''}
JOB
${job.title || ''}${job.company ? ' at ' + job.company : ''}
${desc}`;
}

// How well a profile fits a job (side panel's Match tab), cached per job URL + profile.
async function analyzeMatch({ profile, job, force, cachedOnly, resumeText, keywords }) {
  const key = normalizeUrl(job.url) + '|' + (profile.id || '');
  const { matchCache = {} } = await chrome.storage.local.get('matchCache');
  if (!force && matchCache[key]) return matchCache[key];
  if (cachedOnly) return null;
  const resume = String(resumeText || '').trim();
  // Re-scoring after Fix resume: the same keywords as before, so the two scores compare.
  const fixedKw = (Array.isArray(keywords) ? keywords : []).map((k) => String(k || '').trim()).filter(Boolean).slice(0, 16);
  const kwRule = fixedKw.length ? `\nUse exactly these keywords, in this order, and no others: ${fixedKw.join(', ')}.` : '';  const prompt = `You are a recruiter and an ATS (applicant tracking system). Score how well this candidate fits this job.
Judge skills by meaning (a related tool or a clear equivalent counts). A keyword is "have" only if the exact word appears in the candidate text${resume ? ' or the resume text' : ''}.
"ats" (0-10) = 60% keywords (main skills count double, nice-to-have half; an equivalent name gives partial credit), 15% title match, 15% years of experience vs required, 10% industry experience.
Return JSON: {"overall": 0-100, "experience": 0-100, "skills": 0-100, "industry": 0-100, "title": 0-100, "ats": 0-10 with one decimal,
"industries": ["industries of this job"], "keywords": [{"k": "important job keyword", "have": true}], "strengths": ["up to 3 short points"],
"gaps": ["up to 3 short points"], "tips": ["up to 3 concrete resume changes for this job"], "verdict": "one short sentence"}
"experience" compares required years and level with the candidate's; "industry" is experience in the job's industry; "title" is how close the candidate's titles are to the job title.
List 8-14 keywords. Use only facts from the profile${resume ? ' and resume' : ''}.${kwRule}

CANDIDATE:
${JSON.stringify(profileForPrompt(profile)).slice(0, 12000)}
${resume ? `\nRESUME (tailored for this job - prefer this for ATS keywords and strengths/gaps):\n${resume.slice(0, 9000)}\n` : ''}
JOB:
Title: ${job.title || ''}
Company: ${job.company || ''}
${(job.description || '').slice(0, 8000)}`;
  const settings = await getSettings();
  const web = settings.chatgptWeb === 'only' || (settings.chatgptWeb === 'backup' && !(await keysToTry(settings)).length);
  // The ChatGPT website gets a short version: a 20,000-character message with the raw profile makes it
  // finish with no visible answer.
  const out = web
    ? await chatgptAsk(matchPromptForWeb(profile, job, resume) + kwRule, { json: true, timeoutMs: 180000, accept: (v) => v && typeof v === 'object' && 'overall' in v })
    : await ai(prompt, { temperature: 0.1, timeoutMs: 45000 });
  // AIs write scores in many ways ("85", "85%", "8.5/10", {"score": 85}) and sometimes under "scores": {...}.
  // A score that can't be read stays null, so the quick score is shown for it instead of 0.
  const src = { ...(out.scores && typeof out.scores === 'object' ? out.scores : {}), ...out };
  const readNum = (v) => {
    if (v && typeof v === 'object') v = v.score ?? v.value ?? v.pct;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const m = String(v ?? '').match(/(-?\d+(?:\.\d+)?)\s*(%|\/\s*(\d+))?/);
    if (!m) return null;
    const n = Number(m[1]);
    return m[3] ? (n / Number(m[3])) * 100 : n;
  };
  const pct = (v) => { const n = readNum(v); return n == null ? null : Math.round(Math.max(0, Math.min(100, n))); };
  const ats10 = (v) => {
    let n = readNum(v);
    if (n == null) return null;
    if (/\/\s*10\b/.test(String(v))) n = n / 10; // "8.5/10" was turned into a percentage above
    else if (n > 10) n = n / 10; // given out of 100
    return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
  };
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, n);
  const result = {
    overall: pct(src.overall), experience: pct(src.experience), skills: pct(src.skills),
    industry: pct(src.industry), title: pct(src.title), ats: ats10(src.ats),
    industries: list(out.industries, 5), strengths: list(out.strengths, 3), gaps: list(out.gaps, 3), tips: list(out.tips, 3),
    keywords: (Array.isArray(out.keywords) ? out.keywords : []).filter((x) => x && x.k).slice(0, 16).map((x) => ({ k: String(x.k), have: !!x.have })),
    verdict: String(out.verdict || '').trim(), at: new Date().toISOString(),
  };
  // The AI may still rename or swap a keyword: keep the asked list, with its "have" where it gave one.
  if (fixedKw.length) {
    const said = new Map(result.keywords.map((x) => [x.k.toLowerCase(), x.have]));
    result.keywords = fixedKw.map((k) => ({ k, have: !!said.get(k.toLowerCase()) }));
  }
  matchCache[key] = result;
  const keys = Object.keys(matchCache).sort((a, b) => (matchCache[b].at || '').localeCompare(matchCache[a].at || ''));
  for (const k of keys.slice(60)) delete matchCache[k];
  await chrome.storage.local.set({ matchCache });
  return result;
}

async function coverLetter({ profile, job }) {
  const prompt = `Write a concise, specific cover letter (under 250 words, 3 short paragraphs, no placeholders like [Company]) for this candidate and job. Use only facts from the profile. Sign with the candidate's full name. Reply with only the letter, as plain text in the chat.

CANDIDATE PROFILE:
${JSON.stringify(profileForPrompt(profile))}

JOB:
Title: ${job.title || ''}
Company: ${job.company || ''}
${(job.description || '').slice(0, 7000)}`;
  aiStage('Writing the cover letter...', { state: 'working', startedAt: new Date().toISOString(), questions: 1 });
  try {
    const text = await ai(prompt, { json: false, temperature: 0.7, timeoutMs: 180000 });
    if (!String(text || '').trim()) throw new Error('The AI returned an empty letter. Try again.');
    aiStage('Cover letter ready', { state: 'done' });
    return String(text).trim();
  } catch (e) {
    aiStage(e.message, { state: 'error' });
    throw e;
  }
}

// ---------- ATS matcher and resume optimizer (ats.js, resumedoc.js) ----------
// The AI reads each job once (cached); the resume file itself is scored without the AI, the same way every time,
// so the score before and after the optimizer compares. Optimized files live only in the page that asked
// (and the session hold for its application form), never in the profile.

// The job's requirements, checked against its text. Cached per job text.
async function atsJobAnalysis(job, { force = false, cachedOnly = false } = {}) {
  const key = 'j' + JobBidATS.hash(`${job.title || ''}\n${job.description || ''}`);
  const { atsJobs = {} } = await chrome.storage.local.get('atsJobs');
  if (!force && atsJobs[key]?.version === JobBidATS.VERSION) return atsJobs[key];
  if (cachedOnly) return null;
  if (String(job.description || '').length < 200) throw new Error('Open the job posting first: there is no job description on this page');
  aiStage('Reading the job\'s requirements...', { state: 'working', startedAt: new Date().toISOString(), questions: 1 });
  try {
    const out = await ai(JobBidATS.analysisPrompt(job), { temperature: 0.1, timeoutMs: 150000, accept: (v) => Array.isArray(v?.requirements) });
    const a = JobBidATS.validateAnalysis(out, job);
    if (a.requirements.length < 3) throw new Error(`The AI found only ${a.requirements.length} requirement${a.requirements.length === 1 ? '' : 's'} it could show in the posting. Try again.`);
    atsJobs[key] = a;
    for (const k of Object.keys(atsJobs).sort((x, y) => (atsJobs[y].at || '').localeCompare(atsJobs[x].at || '')).slice(40)) delete atsJobs[k];
    await chrome.storage.local.set({ atsJobs });
    aiStage(`Job read: ${a.requirements.length} requirements`, { state: 'done' });
    return a;
  } catch (e) {
    aiStage(e.message, { state: 'error' });
    throw e;
  }
}

// The resume to score: an optimized version the page holds, or the profile's file.
async function atsSource(profile, resumeId, file) {
  if (file?.data) return { name: file.name, type: file.type, data: file.data, id: file.id || '', optimized: true };
  const list = profile?.resumes || [];
  const meta = list.find((r) => r.id === resumeId) || list.find((r) => r.id === profile?.defaultResumeId) || list[0];
  if (!meta) throw new Error('This profile has no resume file. Add a PDF or Word resume in the dashboard first.');
  const key = 'file_' + meta.id;
  const data = (await chrome.storage.local.get(key))[key];
  if (!data) throw new Error(`${meta.name} is not on this computer yet. Wait for the sync, then try again.`);
  return { name: meta.name, type: meta.type, data, id: meta.id, optimized: false };
}
const atsWeights = async () => ({ ...JobBidATS.DEFAULT_WEIGHTS, ...((await chrome.storage.local.get('atsWeights')).atsWeights || {}) });

async function atsRead(src, analysis) {
  const doc = await rdOpen(src);
  const model = JobBidATS.buildModel(doc.lines, doc.meta);
  const report = JobBidATS.score(model, analysis, await atsWeights());
  return { doc, model, report };
}
const atsLines = (model) => model.lines.map((l) => ({ id: l.id, text: l.text, zone: l.zone, kind: l.kind, lock: l.lock, bullet: l.bullet }));

async function atsScore({ profile, resumeId, file, job, force, cachedOnly }) {
  const analysis = await atsJobAnalysis(job, { force, cachedOnly });
  if (!analysis) return null;
  const src = await atsSource(profile, resumeId, file);
  const { doc, model, report } = await atsRead(src, analysis);
  const sections = ['summary', 'skills', 'experience', 'projects'].filter((z) => model.lines.some((l) => l.zone === z && !l.lock && l.kind !== 'heading'));
  return { analysis, report, resume: { id: src.id, name: src.name, type: doc.type, kind: doc.kind, optimized: src.optimized }, lines: atsLines(model), sections };
}

async function atsOptimize({ profile, resumeId, file, job, sections, targets = [], mode }) {
  const analysis = await atsJobAnalysis(job, {});
  const src = await atsSource(profile, resumeId, file);
  const { doc, model, report } = await atsRead(src, analysis);
  const sel = (sections || []).filter((z) => ['summary', 'skills', 'experience', 'projects'].includes(z));
  if (!sel.length) throw new Error('Choose at least one section to improve');
  const fitsOnly = doc.kind === 'pdf' && mode === 'keep';
  aiStage('Tailoring the resume to the job...', { state: 'working', startedAt: new Date().toISOString(), questions: 1 });
  try {
    const out = await ai(JobBidATS.optimizePrompt({ model, analysis, report, sections: sel, targets, job, fitsOnly }), { temperature: 0.35, timeoutMs: 280000, accept: (v) => Array.isArray(v?.changes) });
    const res = JobBidATS.validateChanges(out, { model, analysis, report, sections: sel, targets, kind: doc.kind, fits: doc.fits });
    aiStage(`${res.changes.length} change${res.changes.length === 1 ? '' : 's'} proposed`, { state: 'done' });
    return { ...res, kind: doc.kind };
  } catch (e) {
    aiStage(e.message, { state: 'error' });
    throw e;
  }
}

// Writes the accepted changes into the file, reads the new file back and scores it the same way. The bytes
// returned are exactly the ones scored, and they are what gets downloaded or attached.
async function atsBuild({ profile, resumeId, file, job, changes = [], mode = 'keep', targets = [], history = [] }) {
  const analysis = await atsJobAnalysis(job, {});
  const src = await atsSource(profile, resumeId, file);
  const base = await atsRead(src, analysis);
  if (!changes.length) throw new Error('No change accepted');
  aiStage('Writing the new resume and scoring it again...', { state: 'working', startedAt: new Date().toISOString(), questions: 1 });
  try {
    const built = await base.doc.build(changes, base.doc.kind === 'pdf' ? mode : 'keep', base.model);
    const leftIds = new Set(built.left.map((c) => c.cid));
    const applied = changes.filter((c) => !leftIds.has(c.cid));
    if (!applied.length) throw new Error(`None of the changes could be written into this file: ${built.left[0]?.why || ''}`);
    const outFile = { name: src.name, type: base.doc.type, data: rdB64(built.bytes) };
    const after = await atsRead(outFile, analysis);
    const verify = JobBidATS.verify({ before: base.report, after: after.report, beforeModel: base.model, afterModel: after.model, targets, changes: applied });
    // Scores of every pass so far (the panel sends the earlier ones): the start, then each result.
    const hist = history.filter((n) => typeof n === 'number');
    if (hist[hist.length - 1] !== base.report.score) hist.push(base.report.score);
    hist.push(after.report.score);
    const next = JobBidATS.nextStep(after.report, hist, targets.map((t) => t.term));
    aiStage(`New resume scored: ${base.report.score} -> ${after.report.score}`, { state: 'done' });
    return {
      file: { ...outFile, changed: applied.length, text: after.model.fullText, score: after.report.score, mode: built.mode, scoredAt: new Date().toISOString() },
      before: base.report, after: after.report, verify, next, left: built.left, mode: built.mode, rebuilt: built.mode === 'rebuild',
      compare: JobBidATS.compareRows(base.model, applied), finalLines: atsLines(after.model), history: hist,
    };
  } catch (e) {
    aiStage(e.message, { state: 'error' });
    throw e;
  }
}

// ---------- The JobBid icon ----------
// Opens JobBid's panel on the page (left side, can be dragged). Chrome's own pages can't show it,
// so there a small separate window opens instead (it can be moved anywhere too).
chrome.action.onClicked.addListener(async (tab) => {
  let r = await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }).catch(() => null);
  if (!r?.ok && /^https?:/.test(tab.url || '')) {
    // Page opened before the extension was (re)loaded: add JobBid to it now.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js', 'panel.js', 'optimizer.js'] }).catch(() => {});
    await new Promise((res) => setTimeout(res, 300));
    r = await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }).catch(() => null);
  }
  if (!r?.ok) chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 380, height: 640 }).catch(() => {});
});

// ---------- JobBid Hub pages ----------
// Old dashboard addresses (options.html#ai...) map to the hub's pages.
const HUB_PAGES = { home: '/', profiles: '/profiles', ai: '/ai', applications: '/applications', schedule: '/schedule', daylog: '/daylog', settings: '/settings', jobs: '/jobs', answers: '/answers', autobid: '/autobid' };
async function openHub(path = '/') {
  const cfg = await hubConfig();
  const page = HUB_PAGES[String(path).replace(/^[#/]+/, '')] || (String(path).startsWith('/') ? path : '/');
  const ping = await hubPing(cfg.url);
  if (!ping.ok) return { ok: false, error: 'JobBid Hub is not running. Start it with start.bat in the JobBidHub folder.' };
  // Reuse an open hub tab instead of piling up new ones.
  const [tab] = await chrome.tabs.query({ url: [cfg.url + '/*'] }).catch(() => []);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true, url: cfg.url + page });
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  } else await chrome.tabs.create({ url: cfg.url + page });
  return { ok: true };
}

// ---------- ChatGPT website (no API key) ----------
// JobBid keeps its own ChatGPT tab (pinned, in the background), keeps using one chat, and asks one
// question at a time. chatgpt.js does the typing and reading inside that tab.

const CGPT_URL = 'https://chatgpt.com/?temporary-chat=true';
let cgptQueue = Promise.resolve();
const teamBidCache = new Map();
const jobTouchSent = new Map();

// Exactly one ChatGPT tab: the one JobBid used last, else any ChatGPT tab that is already open
// (e.g. the one you opened yourself), else a new one. Extra pinned ChatGPT tabs JobBid opened
// earlier are closed.
async function cgptTab() {
  const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  const { cgptTabId } = await chrome.storage.session.get('cgptTabId').catch(() => ({}));
  let tab = tabs.find((t) => t.id === cgptTabId) || tabs.find((t) => t.pinned) || tabs.find((t) => !t.active) || tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: CGPT_URL, active: false, pinned: true });
  await chrome.storage.session.set({ cgptTabId: tab.id }).catch(() => {});
  const extra = tabs.filter((t) => t.id !== tab.id && t.pinned).map((t) => t.id);
  if (extra.length) chrome.tabs.remove(extra).catch(() => {});
  return tab;
}

async function cgptWaitReady(tabId, ms = 30000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error('The ChatGPT tab was closed.');
    if (t.status === 'complete') {
      last = await chrome.tabs.sendMessage(tabId, { type: 'cgptPing' }).catch(() => null);
      if (last?.ready) return;
      if (last?.problem) throw new Error(last.problem);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(last ? 'The ChatGPT page did not get ready. Open the ChatGPT tab and check it.' : 'Could not reach the ChatGPT page. Reload the extension and try again.');
}

// Short, separate messages only ("send", then "what does the page show?" once a second), so a closed
// message channel or a page re-render never loses the answer: the next check simply tries again.
const cgptRead = (tabId, ref) => chrome.tabs.sendMessage(tabId, { type: 'cgptRead', ref }).catch(() => null);

// One chat is kept and reused: every prompt is complete on its own (just the question), so a new chat
// is only opened when the page is not usable or the chat got very long. The length is read from the
// page itself, so it survives Chrome stopping and restarting the extension's background worker.
const CGPT_REUSE = 60;
const CGPT_STATUS = /^\s*((chatgpt|you)\s+said:?|(chatgpt\s+is\s+)?(responding|thinking|typing|writing|generating|searching|reasoning|analy[sz]ing|working|loading)(\s+the\s+web)?|thought\s+for\s+[\w\s.]+|stopped\s+thinking|check important info\.?)[\s:.…]*$/i;
// The ChatGPT page footer is not a reply. Current wording: "ChatGPT is AI and can make mistakes."
const CGPT_DISCLAIMER = /chatgpt(?:'s)?(?:\s+is(?:\s+an?)?\s+ai(?:\s+and)?)?\s+can make mistakes/i;
// "…" and "Show more" / "Show less" are the buttons of a folded long question, not answer text.
const CGPT_FOLD_LINE = /^\s*(show (more|less)|\.{2,}|…+)\s*$/i;
function stripPageChrome(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const at = s.search(CGPT_DISCLAIMER);
  if (at >= 0) s = s.slice(0, at);
  s = s.split(/\r?\n/).filter((l) => !CGPT_FOLD_LINE.test(l) && !/^\s*ref:\s*q[a-z0-9]{4,}\b/i.test(l)).join('\n');
  return s.replace(/\n?\s*check important info\.?\s*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function cgptFreshChat(tabId) {
  await chrome.tabs.update(tabId, { url: CGPT_URL });
  await new Promise((r) => setTimeout(r, 400));
  await cgptWaitReady(tabId);
}

// Open and load the ChatGPT tab ahead of time, so the first question doesn't wait for the page.
async function chatgptWarmUp() {
  if (!(await signedIn())) return;
  const s = await getSettings();
  if (s.chatgptWeb === 'off') return;
  const tab = await cgptTab();
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  if (!(await cgptRead(tab.id))?.ready) await cgptFreshChat(tab.id).catch(() => {});
}

// context: { marker, text } sent once per chat (the profile). The chat keeps it, so every later
// question is short. A fresh chat (or one where the marker isn't on the page) gets it again first.
async function chatgptAskOnce(prompt, { json, timeoutMs, context, accept }) {
  const tab = await cgptTab();
  // Keep Chrome from unloading the background tab to save memory.
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  // A ChatGPT tab opened before the extension was (re)loaded has no JobBid script yet: add it now.
  if (!(await cgptRead(tab.id))) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chatgpt.js'] }).catch(() => {});
  aiStage('ChatGPT: getting the chat ready...');
  let now = await cgptRead(tab.id);
  if (now?.streaming) { // still writing an earlier answer: let it finish
    for (let i = 0; i < 60 && now?.streaming; i++) { await new Promise((r) => setTimeout(r, 500)); now = await cgptRead(tab.id); }
  }
  if (!now || now.problem || !now.ready || now.count >= CGPT_REUSE) {
    aiStage('ChatGPT: opening a new chat...');
    await cgptFreshChat(tab.id);
    now = await cgptRead(tab.id);
  }
  if (context?.marker) {
    const has = await chrome.tabs.sendMessage(tab.id, { type: 'cgptHas', text: context.marker }).catch(() => null);
    if (!has?.found) {
      aiStage('ChatGPT: sending the profile once...');
      await cgptExchange(tab, context.text, { json: false, timeoutMs: 90000, now });
      now = await cgptRead(tab.id);
    }
  }
  const full = json ? `${prompt}\n\nReply with ONLY one valid JSON object. No explanation, no markdown.` : prompt;
  return cgptExchange(tab, full, { json, timeoutMs, now, accept });
}

// Send one message in the open chat and wait for ChatGPT's complete reply to it.
// Every message starts with its own reference ("Ref: Q7K2M9"). The reply is read from right after the
// question with that reference, so two questions with the same answer ("No", "No") can't be mixed up.
async function cgptExchange(tab, full, { json, timeoutMs, now, accept }) {
  const limit = Math.max(Number(timeoutMs) || 0, 120000);
  const start = Date.now();
  const end = start + limit;
  const ref = 'Q' + Date.now().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  full = `Ref: ${ref} (do not repeat it)\n${full}`;

  let before = now?.count ?? 0;
  let beforeText = now?.text || '';
  aiStage('ChatGPT: sending the question...');
  const sendIt = () => chrome.tabs.sendMessage(tab.id, { type: 'cgptSend', prompt: full }).catch((e) => ({ ok: false, closed: true, error: e.message }));
  let sent = await sendIt();
  // The text didn't reach the message box (e.g. an editable "Writing" answer took it): a fresh chat, once.
  if (!sent?.ok && /could not type/.test(sent?.error || '')) {
    aiStage('ChatGPT: opening a new chat...');
    await cgptFreshChat(tab.id);
    now = await cgptRead(tab.id);
    before = now?.count ?? 0;
    beforeText = now?.text || '';
    aiStage('ChatGPT: sending the question...');
    sent = await sendIt();
  }
  // A real problem (signed out, page not ready) stops here; a closed channel may still have sent the question.
  if (!sent?.ok && !sent?.closed) throw new Error(`ChatGPT website: ${sent?.error || 'could not send the question'}`);

  let last = '', sameSince = Date.now(), seenNew = false, seen = null;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    let r = await cgptRead(tab.id, ref);
    if (!r) continue; // page busy or re-rendering: try again
    if (r.problem) throw new Error(`ChatGPT website: ${r.problem}`);
    let text = '';
    if (r.refSent) {
      // Our question is on the page: its reply is exactly what follows it.
      text = (json && r.code) || r.text || '';
      // JSON in a code block, or a reply that finished with nothing readable after the question
      // (a "Writing" document box): read the newest answer the usual way. ChatGPT drops old turns
      // from the page in long chats, so the answer count may not grow: a text unlike the one before
      // the question is new enough.
      if ((json && text && !/^[[{]/.test(text.trim())) || (!text && (r.done || (!r.streaming && Date.now() - start > 20000)))) {
        const plain = await cgptRead(tab.id);
        const got = plain && ((json && plain.code) || plain.text);
        const fresh = got && plain.text !== beforeText && got !== beforeText && (plain.count > before || (plain.text && !beforeText.includes(plain.text.slice(0, 80))));
        if (fresh) text = got;
      }
      // Still nothing usable: the page text after our reference holds the reply whatever the layout is.
      if (json && r.after) {
        let ok;
        try { const v = text && parseJson(stripPageChrome(text)); ok = v !== undefined && (!accept || accept(v)); } catch { ok = false; }
        if (!ok) {
          const v = lastJsonIn(r.after, full, accept);
          if (v !== undefined) text = JSON.stringify(v);
        }
      }
    } else {
      // The reference is not visible (a layout we don't know): the old way, by answer count and text.
      const p = await cgptRead(tab.id);
      if (!p) continue;
      r = p;
      const newText = r.text && r.text !== beforeText && r.text.trim() !== full.trim();
      text = r.count > before || newText ? (r.code || r.text) : '';
      if (!text && r.after && r.after !== beforeText) text = r.after;
    }
    seen = r;
    // Started: a new (maybe still empty) reply is there, or our question shows in the chat. Thinking
    // models can show only "Thinking..." for a long time before the first word.
    if (r.count > before || r.streaming || r.asked || r.refSent) seenNew = true;
    if (!text) {
      // Nothing at all 60s after sending: the question never went out.
      if (!seenNew && Date.now() - start > 60000) throw new Error('ChatGPT website: ChatGPT did not start answering. Check the ChatGPT tab.');
      if (seenNew) aiStage('ChatGPT is thinking...');
      continue;
    }
    seenNew = true;
    aiStage(`ChatGPT is writing... (${(text || '').length} characters)`);
    if (text !== last) { last = text; sameSince = Date.now(); }
    const still = Date.now() - sameSince;
    // Finished: the Copy/thumbs buttons are shown (only under a complete answer, so no extra wait), or
    // the Stop button is gone and the text stayed still for a moment, or the text hasn't changed for a
    // while (in case a "stop" button stays on screen). A long JSON reply pauses mid-way, and half of it
    // parses as a smaller object, so JSON waits much longer for that last case.
    // Only a label, status line, or the page footer ("ChatGPT is AI and can make mistakes") so far.
    const usable = stripPageChrome(text);
    if (!usable || CGPT_STATUS.test(usable)) continue;
    if ((r.done && !r.streaming) || (!r.streaming && still >= 600) || still >= (json ? 8000 : 2500)) {
      if (!json) return usable;
      // A JSON answer that doesn't parse yet, or isn't the shape asked for, is not finished (or not ours):
      // keep waiting until the limit.
      let v;
      try { v = parseJson(usable); } catch { v = undefined; }
      if (v !== undefined && (!accept || accept(v))) return v;
      // ChatGPT has finished (Copy buttons shown, text still) but the JSON is broken: keep the complete
      // items, or say so now instead of waiting for the time limit.
      if (r.done && !r.streaming && still >= 1500) {
        const saved = salvageList(usable, accept);
        if (saved !== undefined) return saved;
        if (still >= 10000) throw new Error('ChatGPT website: the answer was not valid JSON (it may have been cut off). Try again.');
      }
      aiStage(`ChatGPT is writing... (${usable.length} characters, waiting for the full answer)`);
    }
  }
  // Say what was seen, so a ChatGPT layout change can be fixed quickly.
  throw new Error(`ChatGPT website: no complete answer within ${Math.round(limit / 1000)}s (seen: ${seen ? `answers ${seen.count} (before ${before}), found by ${seen.how}, text ${seen.text.length} chars, typing ${seen.streaming ? 'yes' : 'no'}, done-buttons ${seen.done ? 'yes' : 'no'}` : 'no reply from the ChatGPT tab - reload that tab'})`);
}

// One question at a time (the page can only answer one), in arrival order.
function chatgptAsk(prompt, opts = {}) {
  const run = () => chatgptAskOnce(prompt, opts);
  const p = cgptQueue.then(run, run);
  cgptQueue = p.catch(() => {});
  return p;
}

// What the AI is doing right now, for the side panel's status line.
function aiStage(stage, extra = {}) {
  chrome.storage.local.get('aiStatus').then(({ aiStatus = {} }) => {
    const keep = extra.state === 'working' && extra.startedAt ? {} : { startedAt: aiStatus.startedAt, questions: aiStatus.questions, state: aiStatus.state };
    return chrome.storage.local.set({ aiStatus: { ...keep, ...extra, stage, at: new Date().toISOString() } });
  }).catch(() => {});
}

// ---------- Auto bid ----------
// The hub keeps the queue (Auto bid page); this Chrome works through it, one job at a time: ask the hub
// for the next job, open it in a background tab with that job's profile, let content.js fill (and in
// auto mode submit), report the result, wait the pause the hub asks for. State lives in session storage
// so a restart of this background worker picks up where it was.

const BID_TIMEOUT = 10 * 60000;
let bidTicking = false;
let bidTimer = null;

async function bidGet() {
  const { bidState: s = {} } = await chrome.storage.session.get('bidState').catch(() => ({}));
  return { current: null, reviews: [], tabs: {}, ...s };
}
const bidSet = (s) => chrome.storage.session.set({ bidState: s }).catch(() => {});

async function hubApi(method, path, body) {
  const cfg = await hubConfig();
  if (!cfg.on || !cfg.token) throw new Error('Not signed in to the hub');
  const res = await fetch(cfg.url + path, {
    method,
    headers: hubHeaders(cfg, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Hub error ${res.status}`);
  return j;
}

// The profile a tab works as: an auto-bid tab uses its job's profile, every other tab the active one.
async function bidProfileFor(tabId) {
  if (tabId == null) return '';
  const s = await bidGet();
  return s.tabs[tabId] || '';
}

function bidSoon(ms) {
  clearTimeout(bidTimer);
  bidTimer = setTimeout(() => bidTick().catch(() => {}), Math.max(1000, Math.min(ms, 55000)));
}

async function waitTabLoaded(tabId, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) throw new Error('The job tab was closed.');
    if (t.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function bidTick() {
  if (bidTicking) return;
  bidTicking = true;
  try {
    if (!(await signedIn())) return;
    const s = await bidGet();
    // Forms left open for you: forget the ones you closed.
    const open = [];
    for (const id of s.reviews) if (await chrome.tabs.get(id).catch(() => null)) open.push(id); else delete s.tabs[id];
    s.reviews = open;
    if (s.current) {
      // The job's tab is on Chrome's error page (e.g. the form after Apply failed to load): reload it,
      // a few times per job; the job page itself then carries on (the pending fill is still there).
      // (The first 90 seconds belong to bidStart, which reloads a page that failed to open by itself.)
      if (Date.now() - s.current.startedAt > 90000 && await chrome.tabs.get(s.current.tabId).catch(() => null) && (await onErrorPage(s.current.tabId))) {
        if ((s.current.reloads || 0) < BID_RELOADS) {
          s.current.reloads = (s.current.reloads || 0) + 1;
          await bidSet(s);
          await chrome.tabs.reload(s.current.tabId).catch(() => {});
          return;
        }
        const cur = s.current;
        await bidSet(s);
        await bidFinish(cur.tabId, { status: 'failed', reason: `The page did not load (network or proxy error) - reloaded ${BID_RELOADS} times.` });
        return;
      }
      if (Date.now() - s.current.startedAt < BID_TIMEOUT && (await chrome.tabs.get(s.current.tabId).catch(() => null))) { await bidSet(s); return; }
      // Hung or closed: report and move on.
      const cur = s.current;
      s.current = null;
      await bidSet(s);
      await bidReport(cur, { status: 'failed', reason: 'The page did not finish in time (or the tab was closed).' });
      return;
    }
    await bidSet(s);
    const r = await hubApi('GET', `/api/autobid/next?openReviews=${s.reviews.length}`);
    if (r.item) return await bidStart(r.item);
    if (r.wait) bidSoon(r.wait + 500);
  } catch {
    // Hub not reachable: the alarm tries again.
  } finally {
    bidTicking = false;
  }
}

// Chrome's own error page ("This site can't be reached", ERR_TUNNEL_CONNECTION_FAILED from a proxy...):
// Chrome refuses to run scripts there and says so.
async function onErrorPage(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => 1 });
    return false;
  } catch (e) {
    return /error page/i.test(e.message || '');
  }
}

// Reload a failed page a few times (proxies and VPNs often fail once, then work). true = loaded now.
const BID_RELOADS = 3;
async function reloadUntilLoaded(tabId, tries = BID_RELOADS) {
  for (let i = 0; i < tries; i++) {
    if (!(await onErrorPage(tabId))) return true;
    await new Promise((r) => setTimeout(r, [3000, 8000, 15000][i] || 15000));
    await chrome.tabs.reload(tabId).catch(() => {});
    await waitTabLoaded(tabId).catch(() => {});
  }
  return !(await onErrorPage(tabId));
}

async function bidStart(item) {
  const s = await bidGet();
  const tab = await chrome.tabs.create({ url: item.url, active: false });
  s.current = { id: item.id, tabId: tab.id, profileId: item.profileId, mode: item.mode, startedAt: Date.now() };
  s.tabs[tab.id] = item.profileId;
  await bidSet(s);
  try {
    await waitTabLoaded(tab.id);
    if (!(await reloadUntilLoaded(tab.id))) throw new Error(`The page did not load (network or proxy error) - reloaded ${BID_RELOADS} times.`);
    await new Promise((r) => setTimeout(r, 2500));
    const go = () => chrome.tabs.sendMessage(tab.id, { type: 'autoBid', mode: item.mode, bidId: item.id }, { frameId: 0 }).catch(() => null);
    let ok = await go();
    if (!ok?.ok) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js', 'panel.js', 'optimizer.js'] }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      ok = await go();
    }
    if (!ok?.ok) throw new Error('JobBid could not run on this page.');
  } catch (e) {
    await bidFinish(tab.id, { status: 'failed', reason: e.message });
  }
}

async function bidReport(cur, result) {
  await hubApi('POST', '/api/autobid/report', { id: cur.id, status: result.status, reason: result.reason || '', detail: result.detail || {}, url: result.url || '' }).catch(() => {});
}

// The result from the job tab (or a failure found here).
async function bidFinish(tabId, result) {
  const s = await bidGet();
  const cur = s.current;
  if (!cur || cur.tabId !== tabId) return;
  s.current = null;
  // Review mode keeps the filled form open for you (also when something needs you); auto mode closes it,
  // except when you have to act in it.
  const keep = result.status === 'review' || (result.status === 'needs' && cur.mode !== 'auto');
  if (keep) s.reviews = [...s.reviews.filter((id) => id !== tabId), tabId];
  else delete s.tabs[tabId];
  await bidSet(s);
  await bidReport(cur, result);
  if (!keep) setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), result.status === 'submitted' ? 4000 : 1500);
  bidSoon(6000);
}

// ---------- Extension updates ----------
// The "JobBid Updater" task (installed from the hub) replaces this extension's files when the hub has a
// newer version; we notice the new manifest and reload. Without the updater, the panel says an update
// is available (extUpdate) and links to the download.
const verNum = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);
const newerVer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function extUpdateCheck() {
  const running = chrome.runtime.getManifest().version;
  // Installed from the Chrome Web Store (it adds update_url): Chrome updates it, the hub's copy is not used.
  if (chrome.runtime.getManifest().update_url) return chrome.storage.local.set({ extUpdate: null });
  // 1. New files on disk (put there by the updater): reload, but not in the middle of an auto-bid job.
  const onDisk = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
  if (onDisk?.version && newerVer(onDisk.version, running)) {
    const s = await bidGet();
    if (!s.current) return chrome.runtime.reload();
  }
  // 2. What the hub offers.
  const cfg = await hubConfig();
  if (!cfg.on || cfg.offline) return;
  const info = await fetch(`${cfg.url}/api/extension/info`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  if (!info?.version) return;
  const auto = await fetch(chrome.runtime.getURL('updater.json'), { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  await chrome.storage.local.set({ extUpdate: newerVer(info.version, running) ? { latest: info.version, running, auto, hub: cfg.url } : null });
}

// ---------- Messages ----------

async function getActiveProfile() {
  const settings = await getSettings();
  const profiles = await getProfiles();
  return profiles.find((p) => p.id === settings.activeProfileId) || profiles[0] || null;
}

// Public IP + location, so you can see which network / VPN location job sites see. Cached for 5 minutes.
const IP_SOURCES = [
  ['https://ipwho.is/', (j) => j.success !== false && { ip: j.ip, city: j.city, region: j.region, country: j.country_code, countryName: j.country, org: j.connection?.org || j.connection?.isp }],
  ['https://ipapi.co/json/', (j) => !j.error && { ip: j.ip, city: j.city, region: j.region, country: j.country_code, countryName: j.country_name, org: j.org }],
  ['https://api.ipify.org?format=json', (j) => ({ ip: j.ip })],
];

async function getIp(force) {
  const { ipInfo } = await chrome.storage.local.get('ipInfo');
  if (!force && ipInfo?.ip && Date.now() - new Date(ipInfo.at) < 5 * 60 * 1000) return ipInfo;
  for (const [url, parse] of IP_SOURCES) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      const info = r.ok && parse(await r.json());
      if (info?.ip) {
        const fresh = { ...info, at: new Date().toISOString() };
        await chrome.storage.local.set({ ipInfo: fresh });
        return fresh;
      }
    } catch {}
  }
  throw new Error('Could not look up your IP address (offline?)');
}

// What works before signing in: only signing in and the things around it.
const OPEN_MESSAGES = new Set(['offlineLoad', 'offlineExport', 'offlineExit', 'hubSignIn', 'hubSignOut', 'hubAdopt', 'hubAdoptTabs', 'hubSync', 'hubPing', 'openHub', 'getIp']);
const signedIn = async () => { const c = await hubConfig(); return !!(c.token || c.offline); };

async function handle(msg, sender) {
  if (!OPEN_MESSAGES.has(msg.type) && !(await signedIn())) throw new Error('Sign in to JobBid first: click the JobBid icon in the Chrome toolbar.');
  switch (msg.type) {
    case 'getIp':
      return { info: await getIp(msg.force) };
    case 'getContext': {
      const settings = await getSettings();
      // An auto-bid tab works as its job's profile (and auto bid decides itself when to submit).
      const bidPid = await bidProfileFor(sender?.tab?.id);
      const profile = (bidPid && (await getProfiles()).find((p) => p.id === bidPid)) || (await getActiveProfile());
      // Job-site pages never get the actual keys.
      return { settings: { ...settings, ...(bidPid ? { autoSubmit: false } : {}), apiKey: settings.apiKey ? 'set' : '', aiKeys: undefined, keys: undefined }, profile, bid: !!bidPid };
    }
    case 'autobid': {
      // The panel's Auto bid tab: read and change the hub's queue and settings.
      const routes = { get: ['GET', '/api/autobid'], config: ['PUT', '/api/autobid/config'], start: ['POST', '/api/autobid/start'], stop: ['POST', '/api/autobid/stop'] };
      const [method, path] = routes[msg.action] || routes.get;
      const view = await hubApi(method, path, method === 'GET' ? undefined : msg.body || {});
      if (msg.action === 'start') bidSoon(1500); // begin right away, not at the next half-minute check
      return { view };
    }
    case 'fillAfterApply': {
      // JobBid pressed a job's Apply button: if the form opens on the next page or in a new tab, fill it there.
      const tabId = sender.tab.id;
      const { applyPending: ap = {} } = await chrome.storage.session.get('applyPending');
      const prev = ap[tabId];
      const count = prev && Date.now() - prev.at < 90000 ? prev.count + 1 : 1;
      if (count > 3) return { ok: false, loop: true }; // pressing Apply keeps reloading the same kind of page
      const s = await bidGet();
      ap[tabId] = { at: Date.now(), count, bidMode: s.current?.tabId === tabId ? s.current.mode : '', localMode: msg.localMode || '' };
      await chrome.storage.session.set({ applyPending: ap });
      return { ok: true };
    }
    case 'takePendingFill': {
      const tab = sender.tab;
      const { applyPending: ap = {} } = await chrome.storage.session.get('applyPending');
      const key = ap[tab.id] && !ap[tab.id].taken ? tab.id : tab.openerTabId != null && ap[tab.openerTabId] && !ap[tab.openerTabId].taken ? tab.openerTabId : null;
      if (key == null) return { pending: false, taken: !!ap[tab.id]?.taken };
      const p = ap[key];
      ap[key] = { ...p, taken: true };
      if (key !== tab.id) ap[tab.id] = { ...p, taken: true };
      await chrome.storage.session.set({ applyPending: ap });
      if (Date.now() - p.at > 90000) return { pending: false };
      // Auto bid: the job moved to a new tab - follow it there.
      if (key !== tab.id && p.bidMode) {
        const s = await bidGet();
        if (s.current?.tabId === key) {
          s.current.tabId = tab.id;
          s.tabs[tab.id] = s.tabs[key];
          await bidSet(s);
          chrome.tabs.remove(key).catch(() => {});
        }
      }
      return { pending: true, bidMode: p.bidMode, localMode: p.localMode || '' };
    }
    case 'offlineLoad':
      return await offlineLoad(msg.text, msg.name);
    case 'offlineExport':
      return { snap: await offlineSnapshot() };
    case 'offlineExit':
      await offlineExit();
      return { ok: true };
    case 'autoBidResult':
      await bidFinish(sender.tab.id, msg.result || { status: 'failed', reason: 'No result' });
      return { ok: true };
    case 'fillAllFrames':
      // The panel lives in the top frame, but the form may be inside an iframe.
      await chrome.tabs.sendMessage(sender.tab.id, { type: 'fill', resumeId: msg.resumeId }).catch(() => {});
      return { ok: true };
    case 'getFile': {
      const key = 'file_' + msg.fileId;
      const data = await chrome.storage.local.get(key);
      return { data: data[key] || null };
    }
    case 'parseResume':
      return { profile: await parseResume(msg) };
    case 'answerFields': {
      // Live status for the side panel (any frame), then the result.
      const n = (msg.fields || []).length;
      const one = n === 1 ? String(msg.fields[0]?.question || '').replace(/\s+/g, ' ').trim().slice(0, 90) : '';
      aiStage(one ? `Answering: ${one}` : `Asking about ${n} questions...`, { state: 'working', startedAt: new Date().toISOString(), questions: n });
      try {
        const answers = await answerFields(msg);
        const got = Object.values(answers || {}).filter(Boolean).length;
        aiStage(got ? `Answered ${got} of ${n}` : 'The AI gave no usable answer', { state: got ? 'done' : 'error' });
        return { answers };
      } catch (e) {
        aiStage(e.message, { state: 'error' });
        throw e;
      }
    }
    case 'coverLetter':
      return { text: await coverLetter(msg) };
    case 'atsScore':
      return { result: await atsScore(msg) };
    case 'atsOptimize':
      return { result: await atsOptimize(msg) };
    case 'atsBuild':
      return { result: await atsBuild(msg) };
    case 'atsWeights':
      if (msg.set || msg.reset) await chrome.storage.local.set({ atsWeights: msg.reset ? {} : msg.set });
      return { weights: await atsWeights(), defaults: JobBidATS.DEFAULT_WEIGHTS, labels: JobBidATS.WEIGHT_LABELS };
    // A fixed resume made on the job posting waits (session memory only, never synced) for the application
    // form in this tab, or in the tab the job opens, and is dropped once it is in the upload box.
    case 'holdFixedResume': {
      const { fixedHold: h = {} } = await chrome.storage.session.get('fixedHold');
      h[sender.tab.id] = { file: msg.file, profileId: msg.profileId, at: Date.now() };
      await chrome.storage.session.set({ fixedHold: h });
      return { ok: true };
    }
    case 'takeFixedResume': {
      const tab = sender.tab;
      const { fixedHold: h = {} } = await chrome.storage.session.get('fixedHold');
      const key = h[tab.id] ? tab.id : tab.openerTabId != null && h[tab.openerTabId] ? tab.openerTabId : null;
      const held = key != null && h[key];
      if (!held || held.profileId !== msg.profileId || Date.now() - held.at > 3 * 3600e3) return { file: null };
      if (key !== tab.id) { h[tab.id] = held; delete h[key]; await chrome.storage.session.set({ fixedHold: h }); }
      return { file: held.file };
    }
    case 'dropFixedResume': {
      const { fixedHold: h = {} } = await chrome.storage.session.get('fixedHold');
      delete h[sender.tab.id];
      await chrome.storage.session.set({ fixedHold: h });
      return { ok: true };
    }
    case 'analyzeJob':
      return { details: await analyzeJob(msg) };
    case 'analyzeMatch':
      return { match: await analyzeMatch(msg) };
    case 'savePendingQuestions': {
      // Questions nobody could answer: store them empty so the user can answer once in the dashboard.
      const profiles = await getProfiles();
      const p = profiles.find((x) => x.id === msg.profileId);
      let added = 0;
      if (p) {
        p.customAnswers ||= {};
        p.answerOptions ||= {};
        const known = new Set(Object.keys(p.customAnswers).map(questionKey));
        for (const { q, options } of msg.questions) {
          if (known.has(questionKey(q))) continue;
          known.add(questionKey(q));
          p.customAnswers[q] = '';
          // Blank options ("" when the page's option words weren't readable) would only show an empty list.
          const opts = (options || []).map((o) => String(o ?? '').trim()).filter(Boolean);
          if (opts.length >= 2) p.answerOptions[q] = opts;
          added++;
        }
        if (added) await saveProfiles(profiles);
      }
      return { ok: true, added };
    }
    case 'saveAnswers': {
      // Cache AI/user answers per profile so repeated questions skip the API.
      const profiles = await getProfiles();
      const p = profiles.find((x) => x.id === msg.profileId);
      if (p) {
        const answers = { ...(p.customAnswers || {}) };
        // fromAI: the AI's guess, marked until a person checks it (Answers page). A person's own answer clears the mark.
        const guess = new Set(p.aiGuessKeys || []);
        for (const [q, a] of Object.entries(msg.answers)) {
          // Replace an existing entry for the same question (e.g. a pending one) instead of duplicating it.
          const old = Object.keys(answers).find((k) => questionKey(k) === questionKey(q));
          if (old && old !== q) {
            delete answers[old];
            guess.delete(old);
            if (p.answerOptions?.[old]) { p.answerOptions[q] = p.answerOptions[old]; delete p.answerOptions[old]; }
          }
          answers[q] = a;
          if (msg.fromAI) guess.add(q); else guess.delete(q);
        }
        p.customAnswers = answers;
        p.aiGuessKeys = [...guess];
        await saveProfiles(profiles);
      }
      return { ok: true };
    }
    case 'updateProfileField': {
      const profiles = await getProfiles();
      const p = profiles.find((x) => x.id === msg.profileId);
      if (!p) throw new Error('Profile not found');
      p[msg.key] = msg.value;
      await saveProfiles(profiles);
      return { ok: true };
    }
    case 'removeAnswers': {
      const profiles = await getProfiles();
      const p = profiles.find((x) => x.id === msg.profileId);
      if (p) {
        for (const k of msg.keys) delete (p.customAnswers || {})[k];
        await saveProfiles(profiles);
      }
      return { ok: true };
    }
    case 'logApplication': {
      teamBidCache.clear(); // the Job links notice shows this bid next time
      const apps = await getApplications();
      const app = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        profileId: msg.profileId,
        profileName: msg.profileName,
        title: msg.title || '',
        company: msg.company || '',
        url: msg.url,
        key: normalizeUrl(msg.url),
        site: (() => { try { return new URL(msg.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
        notes: msg.notes || '',
        status: 'Applied',
      };
      apps.unshift(app);
      await chrome.storage.local.set({ applications: apps });
      return { ok: true, app };
    }
    case 'openHub': {
      // All settings, profiles and history live in the JobBid Hub dashboard (the extension has none of its own).
      const r = await openHub(msg.path);
      if (!r.ok) throw new Error(r.error);
      return r;
    }
    case 'hubSync':
      return hubSync({ force: !!msg.force });
    case 'hubSignIn': {
      const r = await hubSignIn(msg.url, msg.username, msg.password);
      if (!r.ok) throw new Error(r.error);
      const s = await hubSync({ force: true });
      proxyRefresh().catch(() => {});
      return { user: r.user, sync: s };
    }
    case 'hubAdopt':
      return hubAdopt(msg);
    case 'hubAdoptTabs': {
      const r = await hubAdoptReport();
      return { adopted: r.ok, reason: r.reason || '', user: r.user?.name || '' };
    }
    case 'hubSignOut':
      await hubSignOut();
      proxyRefresh().catch(() => {});
      hubSync().catch(() => {});
      return { ok: true };
    case 'hubPing':
      return hubPing(msg.url);
    case 'hubJobSeen':
      hubJobSeen(msg.job, msg.details);
      return { ok: true };
    case 'checkApplied': {
      // Same job = same page address, or same company + same job title (job sites use many URLs per job).
      const apps = await getApplications();
      const key = normalizeUrl(msg.url);
      return { matches: apps.filter((a) => a.key === key || sameJob(a, msg)).map((a) => ({ ...a, how: a.key === key ? 'url' : 'title' })) };
    }
    // For the hub's extension card: this version, and whether the JobBid Updater keeps it current.
    case 'extInfo': {
      const auto = await fetch(chrome.runtime.getURL('updater.json'), { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
      return { version: chrome.runtime.getManifest().version, auto };
    }
    // Who on the team already bid this job (the hub's Job links page). Kept for 2 minutes per job, since
    // the panel asks again on every page change; nothing when offline or not signed in to the hub.
    case 'teamBids': {
      const id = `${normalizeUrl(msg.url)}|${msg.company || ''}|${msg.title || ''}`;
      const hit = teamBidCache.get(id);
      if (hit && Date.now() - hit.at < 120000) return hit.r;
      const cfg = await hubConfig();
      if (!cfg.on || !cfg.token || cfg.offline) return { bids: [] };
      const qs = new URLSearchParams({ url: msg.url || '', company: msg.company || '', title: msg.title || '' });
      const r = await hubApi('GET', `/api/joblinks/check?${qs}`).catch(() => ({ bids: [] }));
      teamBidCache.set(id, { at: Date.now(), r });
      if (teamBidCache.size > 200) teamBidCache.delete(teamBidCache.keys().next().value);
      return r;
    }
    // Fill started / Submit clicked on a job (Job links "Filling" / "Submitted"). Sent in the background,
    // at most once per job and step every 10 minutes; a hub that can't be reached is simply skipped.
    case 'jobTouch': {
      const id = `${msg.kind}|${msg.profileId}|${normalizeUrl(msg.url)}`;
      if (Date.now() - (jobTouchSent.get(id) || 0) < 600000) return { sent: false };
      const cfg = await hubConfig();
      if (!cfg.on || !cfg.token || cfg.offline) return { sent: false };
      jobTouchSent.set(id, Date.now());
      if (jobTouchSent.size > 300) jobTouchSent.delete(jobTouchSent.keys().next().value);
      teamBidCache.clear();
      hubApi('POST', '/api/joblinks/touch', { kind: msg.kind, url: msg.url, title: msg.title, company: msg.company, profileId: msg.profileId, profileName: msg.profileName })
        .catch(() => jobTouchSent.delete(id));
      return { sent: true };
    }
    // After every fill: what went wrong on the page, for the hub's Problems page. Sent in the background;
    // a hub that can't be reached is simply skipped.
    case 'fillReport': {
      const cfg = await hubConfig();
      if (!cfg.on || !cfg.token || cfg.offline || !msg.report) return { sent: false };
      const version = chrome.runtime.getManifest().version;
      hubApi('POST', '/api/fill-reports', { ...msg.report, version }).catch(() => {});
      return { sent: true };
    }
    case 'testKey': {
      const text = await ai('Reply with the single word OK.', { json: false });
      return { ok: true, text };
    }
    case 'testKeys':
      return { results: await testKeys(msg.ids) };
    case 'testChatgpt': {
      const started = Date.now();
      const text = await chatgptAsk('Reply with the single word OK.', { json: false, timeoutMs: 90000 });
      return { text, ms: Date.now() - started };
    }
    case 'listModels':
      return { models: await listModels(msg.provider, msg.apiKey, msg.baseUrl) };
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg, _sender)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'fill' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openHub('/').catch(() => {});
  // Chrome does not put an updated extension back into pages that are already open: they would show no
  // JobBid until reloaded. Add it to them now (no reload, so half-filled forms are kept).
  if (reason === 'update') setTimeout(() => reinjectOpenTabs().catch(() => {}), 1500);
});

async function reinjectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) {
    if (t.discarded || t.status === 'unloaded') continue; // Chrome loads these fresh, with JobBid
    const chat = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(t.url || '');
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: !chat }, files: chat ? ['chatgpt.js'] : ['i18n.js', 'content.js', 'panel.js', 'optimizer.js'] }).catch(() => {});
  }
}

// ---------- Work schedule ----------
// Every minute: when a scheduled block starts, optionally switch the active
// profile to that block's profile and show a reminder notification.

const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + m; };

async function scheduleTick() {
  if (!(await signedIn())) return;
  const { schedule, lastBlockKey, profiles = [], settings = {} } = await chrome.storage.local.get(['schedule', 'lastBlockKey', 'profiles', 'settings']);
  const sch = { blocks: [], autoSwitch: false, reminders: true, ...(schedule || {}) };
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const block = sch.blocks.find((b) => (b.days || []).includes(now.getDay()) && toMin(b.start) <= mins && mins < toMin(b.end));
  if (!block) return;
  const key = now.toDateString() + '|' + block.id;
  if (lastBlockKey === key) return;
  await chrome.storage.local.set({ lastBlockKey: key });

  const p = profiles.find((x) => x.id === block.profileId);
  const name = p ? p.label || p.fullName : 'your profile';
  if (sch.autoSwitch && p && settings.activeProfileId !== p.id) {
    await chrome.storage.local.set({ settings: { ...settings, activeProfileId: p.id } });
  }
  if (sch.reminders) {
    chrome.notifications.create('block|' + key, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Time to apply as ${name}`,
      message: `${block.start}-${block.end}${block.target ? ` · goal ${block.target} applications` : ''}${block.task ? ` · ${block.task}` : ''}`,
      priority: 1,
    });
  }
}

function ensureAlarm() {
  chrome.alarms.get('schedule', (a) => { if (!a) chrome.alarms.create('schedule', { periodInMinutes: 1 }); });
  chrome.alarms.get('datasync', (a) => { if (!a) chrome.alarms.create('datasync', { periodInMinutes: 2 }); });
  chrome.alarms.get('keycheck', (a) => { if (!a) chrome.alarms.create('keycheck', { delayInMinutes: 0.1, periodInMinutes: 2 }); });
  chrome.alarms.get('hubsync', (a) => { if (!a) chrome.alarms.create('hubsync', { delayInMinutes: 0.2, periodInMinutes: 1 }); });
  chrome.alarms.get('extupdate', (a) => { if (!a) chrome.alarms.create('extupdate', { delayInMinutes: 0.5, periodInMinutes: 5 }); });
  chrome.alarms.get('autobid', (a) => { if (!a) chrome.alarms.create('autobid', { delayInMinutes: 0.3, periodInMinutes: 0.5 }); });
}
// Not signed in, but a hub tab in this Chrome is: take over that sign-in (also works for hub tabs
// opened before the extension was updated, whose own JobBid script can no longer reach us).
async function hubAdoptFromOpenTabs() {
  return (await hubAdoptReport()).ok;
}
// Same, with the reason when it can't: { ok, reason, user }. Looks at every open tab that is a JobBid Hub
// page (any address: a hub page is recognised by its own marker, then checked by hubAdopt).
async function hubAdoptReport() {
  const cfg = await hubConfig();
  if (cfg.token) return { ok: true, already: true };
  const tabs = await chrome.tabs.query({}).catch(() => []);
  let reason = 'No JobBid Hub tab with a sign-in is open in this Chrome. Sign in below, or sign in on the hub page in this Chrome.';
  for (const t of tabs) {
    if (!t.url || !/^https?:/.test(t.url)) continue;
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: () => (document.querySelector('meta[name="jobbid-hub"]') ? localStorage.getItem('jbhub.token') || '' : ''),
    }).catch(() => []);
    if (!r?.result) continue;
    const a = await hubAdopt({ url: new URL(t.url).origin, token: r.result, prevToken: '' });
    if (a.ok) return { ok: true, user: a.user };
    reason = a.reason || reason;
  }
  return { ok: false, reason };
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'schedule') scheduleTick();
  if (a.name === 'keycheck') autoCheckKeys().catch(() => {});
  if (a.name === 'datasync') dsSync({ quiet: true }).catch(() => {}); // pick up changes saved by another Chrome
  if (a.name === 'extupdate') extUpdateCheck().catch(() => {});
  if (a.name === 'autobid') bidTick().catch(() => {}); // the hub's auto-bid queue
  if (a.name === 'hubsync') { hubAdoptFromOpenTabs().catch(() => {}).finally(() => hubSync().catch(() => {})); proxyRefresh().catch(() => {}); flushKeyUsage().catch(() => {}); } // pick up changes made in the hub dashboard (and the proxy setting)
});

// Save local changes to the data file a few seconds after they happen.
let dsTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || Object.keys(changes).every((k) => DS_LOCAL_ONLY.includes(k))) return;
  clearTimeout(dsTimer);
  dsTimer = setTimeout(() => { dsSync({ quiet: true }).catch(() => {}); hubSync().catch(() => {}); }, 4000);
});
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('block|')) openHub('/schedule').catch(() => {});
});

// Chrome start / extension reload or update: read the data file right away.
// After a restart Chrome may need the user's OK again; the background can't ask, so point them to the dashboard.
async function startupSync() {
  await dsSync({ quiet: true }).catch(() => {});
}
chrome.runtime.onStartup.addListener(() => { proxyRefresh().catch(() => {}); hubAdoptFromOpenTabs().catch(() => {}); ensureAlarm(); startupSync(); hubSync().catch(() => {}); setTimeout(() => chatgptWarmUp().catch(() => {}), 5000); });
// Downloaded from a hub (its Download button): hub.json names that hub, so the sign-in already points there.
async function hubFromPackage() {
  const j = await fetch(chrome.runtime.getURL('hub.json')).then((r) => r.json()).catch(() => null);
  if (!j?.url || !/^https?:\/\//.test(j.url)) return;
  const { hubConfig: c = {} } = await chrome.storage.local.get('hubConfig');
  if (c.token || (c.url && c.url !== HUB_DEFAULT_URL)) return; // signed in, or an address chosen by hand
  await chrome.storage.local.set({ hubConfig: { ...c, url: j.url.replace(/\/+$/, '') } });
}
chrome.runtime.onInstalled.addListener(({ reason }) => { proxyRefresh().catch(() => {}); hubFromPackage().catch(() => {}); hubAdoptFromOpenTabs().catch(() => {}); ensureAlarm(); if (reason !== 'install') startupSync(); hubSync().catch(() => {}); setTimeout(() => chatgptWarmUp().catch(() => {}), 3000); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings && c.settings.newValue?.chatgptWeb !== c.settings.oldValue?.chatgptWeb) chatgptWarmUp().catch(() => {});
});
