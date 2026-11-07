hydrateIcons();

const PROVIDER_NAMES = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', groq: 'Groq', openrouter: 'OpenRouter', xai: 'xAI Grok', deepseek: 'DeepSeek', mistral: 'Mistral', together: 'Together AI', custom: 'Custom' };
let state = { profiles: [], settings: {}, job: null, tab: null };

function status(msg, kind = '') {
  $('status').textContent = msg;
  $('status').className = 'status ' + kind;
}

function setPageStatus(kind, iconName, title, detail = '') {
  const el = $('pageStatus');
  el.className = 'infobar ' + kind;
  el.innerHTML = `${icon(iconName)}<div><b>${esc(title)}</b>${detail ? esc(detail) : ''}</div>`;
}

// The Fill button says what it will do on this page.
const setFillLabel = (text) => ($('fillLabel').textContent = text);

const currentProfile = () => state.profiles.find((p) => p.id === $('profile').value);

function renderProfile() {
  const p = currentProfile();
  $('pAvatar').innerHTML = avatar(profileName(p));
  $('pName').textContent = profileName(p);
  const c = completeness(p);
  $('pSub').textContent = (p.headline || p.currentTitle || 'No headline') + (c.pct < 100 ? ` · ${c.pct}% complete` : '');
  const list = p.resumes || [];
  $('resume').innerHTML = list.length
    ? '<option value="">Attach: best resume for this site (auto)</option>' + list.map((r) => `<option value="${r.id}">Attach: ${esc(r.name)}</option>`).join('')
    : '<option value="">No resume file on this profile</option>';
}

async function renderStats() {
  const { applications = [] } = await store.get('applications');
  const mine = applications.filter((a) => a.profileId === $('profile').value);
  const now = new Date();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startWeek = new Date(startDay - 6 * 864e5);
  $('today').textContent = mine.filter((a) => new Date(a.date) >= startDay).length;
  $('week').textContent = mine.filter((a) => new Date(a.date) >= startWeek).length;
  $('total').textContent = mine.length;
}

// Counts form fields in every frame of the page (application forms often live in iframes).
function countFields() {
  const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=search]), textarea, select')].filter(visible);
  return {
    fields: fields.length,
    required: fields.filter((f) => f.required || f.getAttribute('aria-required') === 'true').length,
    file: document.querySelectorAll('input[type=file]').length > 0,
  };
}

async function scanPage() {
  const tab = state.tab;
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('fill').disabled = true;
    setFillLabel('Open a job page to fill');
    return setPageStatus('', 'info', 'Not a web page', ' Open a job application to use autofill.');
  }
  const host = new URL(tab.url).hostname.replace(/^www\./, '');
  let total = { fields: 0, required: 0, file: false };
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: countFields });
    for (const r of results) {
      if (!r.result) continue;
      total.fields += r.result.fields;
      total.required += r.result.required;
      total.file ||= r.result.file;
    }
  } catch {
    return setPageStatus('warning', 'warning', `Can't read ${host}`, ' Reload the tab and try again.');
  }

  const applied = await send({ type: 'checkApplied', url: tab.url });
  if (applied.ok && applied.matches.length) {
    const who = applied.matches.map((m) => `${m.profileName} (${timeAgo(m.date)})`).join(', ');
    setFillLabel('Fill again');
    return setPageStatus('warning', 'warning', 'Already applied here', ` ${who}`);
  }
  if (total.fields >= 3 || total.file) {
    const parts = [`${total.fields} field${total.fields === 1 ? '' : 's'}`];
    if (total.required) parts.push(`${total.required} required`);
    if (total.file) parts.push('resume upload');
    setPageStatus('success', 'checkCircle', 'Application form detected', ` ${host} · ${parts.join(' · ')}`);
    setFillLabel(`Fill ${total.fields} field${total.fields === 1 ? '' : 's'}${total.file ? ' + resume' : ''}`);
  } else {
    setFillLabel('Try to fill anyway');
    setPageStatus('', 'info', 'No application form yet', ` On ${host}, click "Apply" first, then fill.`);
  }
}

async function init() {
  // Not signed in: only the JobBid Hub sign-in box, no profile or numbers.
  const { hubConfig: hc = {} } = await store.get('hubConfig');
  const out = !hc.token;
  $('welcome').hidden = true;
  // Inline styles (not the hidden attribute): the main area is shown with display:contents further down.
  $('main').style.display = 'none';
  document.querySelector('.strip').style.display = out ? 'none' : '';
  if (out) {
    $('hubForm').hidden = false;
    return;
  }
  const data = await store.get(['profiles', 'settings']);
  state.profiles = data.profiles || [];
  state.settings = data.settings || {};

  const s = state.settings;
  const { keyHealth = {} } = await store.get('keyHealth');
  const ai = aiState(s, keyHealth);
  const keys = ai.keys;
  $('aiDot').className = 'dot ' + { none: 'err', dead: 'err', live: 'on', untested: 'untested' }[ai.kind];
  $('aiChip').classList.toggle('bad', ai.kind === 'none' || ai.kind === 'dead');
  $('aiText').textContent = ai.kind === 'none' ? 'AI not working · no key'
    : ai.kind === 'dead' ? 'AI not working · keys failed'
    : !keys.length ? 'AI key saved'
    : keys.length === 1 ? `${PROVIDER_NAMES[keys[0].provider]} · ${keys[0].model}${ai.kind === 'untested' ? ' · not checked' : ''}`
    : `AI: ${ai.live}/${keys.length} keys live${ai.dead ? ` · ${ai.dead} dead` : ''}`;
  $('aiChip').title = ai.kind === 'none' ? 'No API key - AI answers and cover letters are off. Click to add a key.'
    : keys.map((k) => `${PROVIDER_NAMES[k.provider]} ${k.model}: ${keyHealth[k.id] ? (keyHealth[k.id].ok ? 'live' : 'dead - ' + keyHealth[k.id].error) : 'not checked'}`).join('\n');
  // Without a key the AI features can't work, so they're switched off instead of failing.
  $('coverTile').disabled = !ai.hasKey;
  $('coverNote').hidden = ai.hasKey;
  $('coverTile').title = ai.hasKey ? '' : 'Add an AI key in the dashboard to write cover letters';

  if (!state.profiles.length) {
    $('welcome').hidden = false;
    return renderIp();
  }
  $('main').style.display = 'contents';
  $('profile').innerHTML = state.profiles.map((p) => `<option value="${p.id}">${esc(profileName(p))}</option>`).join('');
  $('profile').value = state.profiles.some((p) => p.id === s.activeProfileId) ? s.activeProfileId : state.profiles[0].id;
  renderProfile();
  renderStats();
  renderNow();
  renderIp();

  [state.tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  scanPage();
  if (state.tab && /^https?:/.test(state.tab.url || '')) {
    try {
      const r = await chrome.tabs.sendMessage(state.tab.id, { type: 'getJob' }, { frameId: 0 });
      state.job = r?.job;
    } catch {}
    state.job ||= { url: state.tab.url, title: state.tab.title };
    $('jobTitle').value = state.job.title || '';
    $('company').value = state.job.company || '';
  }
}

async function setActive(id) {
  const { settings = {} } = await store.get('settings');
  settings.activeProfileId = id;
  await store.set({ settings });
  $('profile').value = id;
  renderProfile();
  renderStats();
  renderNow();
  renderIp();
}

// Public IP, coloured by whether it's in the active profile's country.
let ipInfo = null, ipError = '';
async function renderIp(force = false) {
  if (force || !ipInfo) {
    const r = await getIp(force).catch((e) => ({ ok: false, error: e.message }));
    ipInfo = r?.ok ? r.info : null;
    ipError = r?.ok ? '' : r?.error || 'IP lookup failed';
  }
  const v = ipView(ipInfo, currentProfile(), ipError);
  $('ipDot').className = 'dot ' + (v.kind === 'err' ? 'err' : v.kind);
  $('ipChip').className = 'chip-stat' + (v.kind === 'warn' ? ' warn' : '');
  $('ipText').textContent = ipInfo ? 'IP ' + v.text : v.text;
  $('ipChip').title = (v.title ? v.title + '\n' : '') + 'Click to check again';
}
$('ipChip').addEventListener('click', () => {
  $('ipText').textContent = 'Checking IP...';
  renderIp(true);
});
$('profile').addEventListener('change', () => setActive($('profile').value));

// Shows the schedule block running right now, with a one-click switch to its profile.
async function renderNow() {
  const { schedule, applications = [] } = await store.get(['schedule', 'applications']);
  const b = currentBlock(normalizeSchedule(schedule));
  const el = $('nowBlock');
  const p = b && state.profiles.find((x) => x.id === b.profileId);
  if (!p) return (el.hidden = true);
  const n = blockDone(applications, b, new Date());
  const wrong = p.id !== $('profile').value;
  el.hidden = false;
  el.className = 'infobar' + (wrong ? ' warning' : '');
  el.innerHTML = `${icon('calendar')}<div><b>Scheduled now: ${esc(profileName(p))}</b>${esc(b.start)}–${esc(b.end)} · ${n}${b.target ? ' / ' + b.target : ''} applied${b.task ? ' · ' + esc(b.task) : ''}</div>` +
    (wrong ? '<button class="btn" id="switchNow">Switch</button>' : '');
  $('switchNow')?.addEventListener('click', () => setActive(p.id));
}

document.querySelectorAll('.item[data-panel]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const open = $(btn.dataset.panel).hidden;
    // Only one panel open at a time keeps the popup short.
    document.querySelectorAll('.item[data-panel]').forEach((b) => {
      $(b.dataset.panel).hidden = !(open && b === btn);
      b.setAttribute('aria-expanded', String(open && b === btn));
    });
    if (open) $(btn.dataset.panel).querySelector('input, button')?.focus();
  })
);

$('fill').addEventListener('click', async () => {
  const msg = { type: 'fill', resumeId: $('resume').value || undefined };
  // Don't wait for the whole fill (AI can take a while); only for "no receiver" errors.
  const trySend = () => Promise.race([
    chrome.tabs.sendMessage(state.tab.id, msg).then(() => null, (e) => e),
    new Promise((r) => setTimeout(() => r(null), 400)),
  ]);
  if (await trySend()) {
    // Tab was open before the extension was installed: inject the script now.
    try {
      await chrome.scripting.executeScript({ target: { tabId: state.tab.id, allFrames: true }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 300));
      if (await trySend()) throw new Error();
    } catch {
      return status('Could not reach this page. Reload the tab and try again.', 'err');
    }
  }
  window.close();
});

$('log').addEventListener('click', async () => {
  const p = currentProfile();
  const r = await send({
    type: 'logApplication',
    profileId: p.id,
    profileName: profileName(p),
    title: $('jobTitle').value,
    company: $('company').value,
    url: state.tab.url,
  });
  if (!r.ok) return status(r.error, 'err');
  status('Saved to tracker.', 'ok');
  renderStats();
  scanPage();
});

$('cover').addEventListener('click', async () => {
  $('cover').disabled = true;
  status('Writing cover letter...');
  const job = { ...(state.job || {}), title: $('jobTitle').value, company: $('company').value };
  const r = await send({ type: 'coverLetter', profile: currentProfile(), job });
  $('cover').disabled = false;
  if (!r.ok) return status(r.error, 'err');
  $('coverText').value = r.text;
  $('coverText').hidden = false;
  $('copyCover').hidden = false;
  status('');
});

$('copyCover').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('coverText').value);
  status('Copied.', 'ok');
});

async function renderThemeBtn() {
  const { settings = {} } = await store.get('settings');
  const t = settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('themeBtn').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return dark;
}
$('themeBtn').addEventListener('click', async () => {
  const dark = await renderThemeBtn();
  const { settings = {} } = await store.get('settings');
  settings.theme = dark ? 'light' : 'dark';
  applyTheme(settings.theme);
  await store.set({ settings });
  renderThemeBtn();
});
renderThemeBtn();

// The dashboard is the JobBid Hub (start.bat); the extension has no settings pages of its own.
const openDash = async (hash = '') => {
  const r = await chrome.runtime.sendMessage({ type: 'openHub', path: hash.replace('#', '') || '/' }).catch((e) => ({ ok: false, error: e.message }));
  if (r?.ok) window.close();
  else alert(r?.error || 'JobBid Hub is not running. Start it with start.bat in the JobBidHub folder.');
};
$('openDash').addEventListener('click', () => openDash());
$('aiChip').addEventListener('click', () => openDash('#ai'));
$('getStarted').addEventListener('click', () => openDash('#profiles'));
$('openApps').addEventListener('click', () => openDash('#applications'));
$('openSchedule').addEventListener('click', () => openDash('#schedule'));

// ---------- JobBid Hub connection ----------
// On the hub's own PC nothing is needed. On another PC: enter the hub's address and sign in.
async function renderHub() {
  const { hubConfig: c = {}, hubState: st = {} } = await chrome.storage.local.get(['hubConfig', 'hubState']);
  const failing = st.lastError && (!st.lastSyncAt || st.lastErrorAt > st.lastSyncAt);
  const ok = !!c.token && !!st.lastSyncAt && !failing;
  $('hubDot').className = 'dot ' + (ok ? 'ok' : failing && c.token ? 'bad' : '');
  $('hubText').textContent = !c.token ? 'Not signed in - sign in to use JobBid'
    : ok ? `Synced ${timeAgo(st.lastSyncAt)} · ${c.user || 'signed in'}` : failing ? st.lastError : 'Connecting...';
  $('hubToggle').textContent = c.token ? 'Account' : 'Sign in';
  $('hubSignOut').hidden = !c.token;
  if (!$('hubUrl').value) $('hubUrl').value = c.url || HUB_DEFAULT_URL;
  $('hubToggle').hidden = !c.token;
  if (st.needLogin && $('hubForm').hidden) $('hubForm').hidden = false;
}
$('hubToggle').addEventListener('click', () => { $('hubForm').hidden = !$('hubForm').hidden; });
$('hubConnect').addEventListener('click', async () => {
  $('hubMsg').textContent = 'Signing in...';
  const r = await chrome.runtime.sendMessage({ type: 'hubSignIn', url: $('hubUrl').value.trim() || HUB_DEFAULT_URL, username: $('hubUser').value.trim(), password: $('hubPass').value })
    .catch((e) => ({ ok: false, error: e.message }));
  $('hubPass').value = '';
  $('hubMsg').textContent = r?.ok ? `Signed in as ${r.user?.name || $('hubUser').value}. Your profiles are syncing.` : r?.error || 'Sign-in failed';
  if (r?.ok) { $('hubForm').hidden = true; setTimeout(init, 300); }
  renderHub();
});
$('hubSignOut').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'hubSignOut' }).catch(() => {});
  $('hubMsg').textContent = 'Signed out. Nothing of your account is left in this Chrome.';
  renderHub();
  init();
});
chrome.storage.onChanged.addListener((c) => { if (c.hubState || c.hubConfig) renderHub(); });
renderHub();

init();
// Pick up the hub's latest data whenever the popup opens.
chrome.runtime.sendMessage({ type: 'hubSync' }).catch(() => {});
