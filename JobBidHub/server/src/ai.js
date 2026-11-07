// AI calls from the hub, using the same AI keys as the extension (settings.aiKeys) and the same
// failover: try live keys first, skip keys that failed in the last 10 minutes, move on when one fails.
import { getStore, getMeta, setMeta } from './db.js';
import { aiFetch } from './proxy.js';

// Gemini and Anthropic (Claude) have their own formats; every other provider speaks the OpenAI
// chat-completions format. "custom" is any OpenAI-compatible server: its address is saved on the key.
export const PROVIDERS = {
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash' },
  openai: { base: 'https://api.openai.com/v1', defaultModel: 'gpt-5-mini' },
  anthropic: { base: 'https://api.anthropic.com/v1', defaultModel: 'claude-opus-5-5' },
  groq: { base: 'https://api.groq.com/openai/v1', defaultModel: 'openai/gpt-oss-120b' },
  openrouter: { base: 'https://openrouter.ai/api/v1', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  xai: { base: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini' },
  deepseek: { base: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  mistral: { base: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest' },
  together: { base: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  custom: { base: '', defaultModel: '' },
};
// The API address for a key: the provider's, or the one typed in for a custom (OpenAI-compatible) server.
const apiBase = (provider, baseUrl) => (provider === 'custom' ? String(baseUrl || '').trim().replace(/\/+$/, '') : PROVIDERS[provider].base);
const anthropicHeaders = (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2026-10-21' });
// Node's default User-Agent is "node", which some providers refuse with a bare 403 before they read the key.
const outbound = (headers = {}) => ({ Accept: 'application/json', 'User-Agent': 'JobBidHub/1.0', ...headers });

function keyPool(s) {
  if (Array.isArray(s.aiKeys)) return s.aiKeys.filter((k) => k.key && PROVIDERS[k.provider]);
  const provider = PROVIDERS[s.provider] ? s.provider : 'gemini';
  const order = [provider, ...Object.keys(PROVIDERS).filter((p) => p !== provider)];
  return order.filter((p) => s.keys?.[p]).map((p) => ({ id: 'legacy-' + p, provider: p, key: s.keys[p], model: s.models?.[p] || PROVIDERS[p].defaultModel, enabled: true }));
}

export const aiKeys = () => keyPool(getStore('settings', {}) || {});
export const hasAi = () => aiKeys().some((k) => k.enabled !== false);

export function keyHealth() {
  try { return JSON.parse(getMeta('keyHealth', '{}')); } catch { return {}; }
}
function recordHealth(k, result) {
  const h = keyHealth();
  h[k.id] = { ...result, model: k.model, at: new Date().toISOString() };
  setMeta('keyHealth', JSON.stringify(h));
}

export function friendlyError(status, body, provider) {
  if (/decommissioned|no longer supported/i.test(body)) return 'This model was shut down. Open the key settings and pick another model.';
  if (status === 401) return 'Invalid API key - check it on the AI keys page.';
  if (status === 402) return 'This model needs paid credits. Pick a free model (names ending in ":free" on OpenRouter).';
  if (status === 403 && /security policy/i.test(body)) return `${provider} refuses this internet connection (a VPN, proxy or data-centre address such as a seedbox). The key is probably fine - use a home connection or another VPN.`;
  if (status === 403 && /"message"\s*:\s*"Forbidden"/.test(body) && !/"type"/.test(body)) return `${provider} refused this connection before it checked the key. That usually means the network region, a VPN, or a proxy.`;
  if (/user location is not supported|unsupported_country|country, region, or territory not supported/i.test(body)) return `${provider} is not available from this network's country. Pick a proxy under Proxies → "The hub's own AI requests", or use Gemini, DeepSeek, or Mistral.`;
  if (status === 403 && /request not allowed/i.test(body)) return `${provider} does not accept requests from this network's country or region. Use another provider, or a connection from a supported country.`;
  if (status === 403 && /network settings|access denied/i.test(body)) return `${provider} blocked the connection from your network (country/region, VPN or proxy).`;
  if (status === 403 && /free tier/i.test(body)) return 'Gemini free tier is not available for this key/project/region. Use OpenRouter instead.';
  if (status === 404) return /no longer available/i.test(body) ? 'This model is no longer available - pick another model in the key settings.' : 'Model not found. Pick another model on the AI keys page.';
  if (status === 429) return /quota/i.test(body) ? `${provider}: this key's free quota for this model is used up. Try another (text) model or key.` : `${provider} rate limit reached (free tier). Wait a minute and try again.`;
  return `${provider} error ${status}: ${String(body).slice(0, 300)}`;
}

export function parseJson(text) {
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

export async function aiRequest({ provider, apiKey, model, baseUrl }, prompt, { json, temperature, signal }) {
  const base = apiBase(provider, baseUrl);
  if (!base) throw new Error('This custom AI key has no server address. Add it on the AI keys page.');
  let res, text;
  if (provider === 'anthropic') {
    // Current Claude models choose their own sampling (a temperature is refused) and always think a
    // little first; low effort keeps answers quick.
    res = await aiFetch(`${base}/messages`, {
      method: 'POST', signal,
      headers: outbound({ 'Content-Type': 'application/json', ...anthropicHeaders(apiKey) }),
      body: JSON.stringify({
        model, max_tokens: 16000, output_config: { effort: 'low' },
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
      method: 'POST', signal,
      headers: outbound({ 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
    });
    if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Gemini'));
    const data = await res.json();
    text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  } else {
    const headers = outbound({ 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` });
    if (provider === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://jobbid.local', 'X-Title': 'JobBid Hub' });
    const send = (withTemperature) => aiFetch(`${base}/chat/completions`, {
      method: 'POST', signal, headers,
      body: JSON.stringify({
        model, ...(withTemperature ? { temperature } : {}),
        messages: [...(json ? [{ role: 'system', content: 'Respond with a single valid JSON object only. No markdown, no commentary.' }] : []), { role: 'user', content: prompt }],
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

const DEAD_COOLDOWN_MS = 10 * 60 * 1000;
let rotateIndex = 0;

export async function ai(prompt, { json = true, temperature = 0.4, timeoutMs = 90000 } = {}) {
  const settings = getStore('settings', {}) || {};
  let keys = keyPool(settings).filter((k) => k.enabled !== false);
  if (!keys.length) throw new Error('No AI key. Add one on the AI keys page.');
  if (settings.aiStrategy === 'rotate' && keys.length > 1) {
    const start = rotateIndex++ % keys.length;
    keys = [...keys.slice(start), ...keys.slice(0, start)];
  }
  const health = keyHealth();
  const dead = (k) => health[k.id] && !health[k.id].ok && Date.now() - new Date(health[k.id].at) < DEAD_COOLDOWN_MS;
  keys = [...keys.filter((k) => !dead(k)), ...keys.filter(dead)];
  const deadline = Date.now() + timeoutMs;
  const errors = [];
  for (const k of keys) {
    const left = deadline - Date.now();
    if (left < 800) break;
    const started = Date.now();
    try {
      const out = await aiRequest({ provider: k.provider, apiKey: k.key, model: k.model || PROVIDERS[k.provider].defaultModel, baseUrl: k.baseUrl }, prompt, { json, temperature, signal: AbortSignal.timeout(left) });
      recordHealth(k, { ok: true, ms: Date.now() - started });
      return out;
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') { errors.push(`${k.provider} too slow`); break; }
      if (!e.badOutput) recordHealth(k, { ok: false, error: e.message });
      errors.push(`${k.provider}: ${e.message}`);
    }
  }
  if (errors.length && errors.every((x) => /too slow/.test(x))) throw new Error(`AI timed out after ${Math.round(timeoutMs / 1000)}s`);
  throw new Error(errors.length === 1 ? errors[0].replace(/^\w+: /, '') : `All ${keys.length} AI keys failed. ${errors.join(' | ')}`);
}

export async function testKeys(ids) {
  const keys = aiKeys().filter((k) => !ids || ids.includes(k.id));
  const results = {};
  await Promise.all(keys.map(async (k) => {
    const started = Date.now();
    try {
      await aiRequest({ provider: k.provider, apiKey: k.key, model: k.model || PROVIDERS[k.provider].defaultModel, baseUrl: k.baseUrl }, 'Reply with the single word OK.', { json: false, temperature: 0, signal: AbortSignal.timeout(20000) });
      results[k.id] = { ok: true, ms: Date.now() - started };
    } catch (e) {
      results[k.id] = { ok: false, error: e.name === 'TimeoutError' ? 'No reply within 20s' : e.message };
    }
    recordHealth(k, results[k.id]);
  }));
  return results;
}

export async function listModels(provider, apiKey, baseUrl) {
  const base = apiBase(provider, baseUrl);
  if (!base) throw new Error('Enter the server address first.');
  if (provider === 'anthropic') {
    const res = await aiFetch(`${base}/models?limit=1000`, { headers: outbound(anthropicHeaders(apiKey)) });
    if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), 'Claude'));
    const data = await res.json();
    return (data.data || []).map((m) => ({ id: m.id, name: m.display_name || '', free: false }));
  }
  if (provider === 'gemini') {
    const all = [];
    let page = '';
    do {
      const res = await aiFetch(`${base}/models?pageSize=1000${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: outbound({ 'x-goog-api-key': apiKey }) });
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
  const res = await aiFetch(`${base}/models`, { headers: outbound(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text(), provider));
  const data = await res.json();
  // Together returns a plain list; the others wrap it in {data: [...]}.
  return (Array.isArray(data) ? data : data.data || [])
    .map((m) => ({ id: m.id, free: provider === 'groq' || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0) }))
    .filter((m) => provider !== 'openrouter' || m.free)
    .filter((m) => !/whisper|tts|guard|orpheus|playai|embed|moderation|image|vision-only|dall-e|davinci|babbage|realtime|transcribe|audio|sora/i.test(m.id));
}

// Profile without the bulky parts, for prompts.
export function profileForPrompt(p) {
  const { customAnswers, answerOptions, resumes, criteria, sitePassword, ...rest } = p || {};
  return rest;
}

export async function coverLetter(profile, job) {
  const prompt = `Write a concise, specific cover letter (under 250 words, 3 short paragraphs, no placeholders like [Company]) for this candidate and job. Use only facts from the profile. Sign with the candidate's full name.

CANDIDATE PROFILE:
${JSON.stringify(profileForPrompt(profile))}

JOB:
Title: ${job.title || ''}
Company: ${job.company || ''}
${(job.description || '').slice(0, 7000)}`;
  return ai(prompt, { json: false, temperature: 0.7 });
}

// Deeper fit check than the keyword score: what matches, what's missing, and a verdict.
export async function aiMatch(profile, job) {
  const prompt = `You are a strict technical recruiter. Judge how well this candidate fits this job.
Return JSON: {"score": 0-100, "verdict": "Strong fit | Good fit | Stretch | Poor fit", "matched": ["up to 8 requirements the candidate meets"],
"missing": ["up to 6 requirements the candidate lacks"], "redFlags": ["deal-breakers such as clearance, location, visa, seniority; [] if none"], "summary": "2 sentences"}

CANDIDATE:
${JSON.stringify(profileForPrompt(profile)).slice(0, 9000)}

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || ''}${job.remote ? ' (remote)' : ''}
${(job.description || '').slice(0, 8000)}`;
  const out = await ai(prompt, { temperature: 0.1, timeoutMs: 45000 });
  out.score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  out.at = new Date().toISOString();
  return out;
}
