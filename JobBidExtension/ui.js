// Shared helpers for the popup and options pages.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const send = (msg) => chrome.runtime.sendMessage(msg);
const store = chrome.storage.local;

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 2.9-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2.1.6 3.5 2.4 3.5 5.2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  sparkle: '<path d="M11 3.5 12.9 9 18.5 11 12.9 13 11 18.5 9.1 13 3.5 11 9.1 9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  cloud: '<path d="M7 19a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 11 4 4 0 0 1 18 19z"/><path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  doc: '<path d="M6 2.5h8l5 5v14H6z"/><path d="M14 2.5v5h5M9 13h7M9 17h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13.5h10L18 7M10 11v6M14 11v6"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  school: '<path d="M2 9 12 4l10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
};

function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

// Replace <i data-icon="name" class="..."> placeholders in static HTML.
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className);
  });
}

const AVATAR_COLORS = ['#0f6cbd', '#8764b8', '#c239b3', '#038387', '#ca5010', '#498205', '#4f6bed', '#986f0b'];

// Deep two-colour gradients: white initials stay readable on every one of them.
const AVATAR_GRADIENTS = [
  ['#4f46e5', '#7c3aed'], ['#0f6cbd', '#1d4ed8'], ['#0e7490', '#0f766e'], ['#047857', '#15803d'],
  ['#9a3412', '#c2410c'], ['#9f1239', '#be123c'], ['#7e22ce', '#a21caf'], ['#334155', '#475569'],
  ['#4338ca', '#6d28d9'], ['#166534', '#0d9488'], ['#1e40af', '#0e7490'], ['#831843', '#9d174d'],
];
const NAME_PREFIX = /^(mr|mrs|ms|miss|dr|prof|sir)\.?$/i;
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|mba|msc|bsc|md|cpa|esq)\.?$/i;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

// "Dr. John Smith Jr." -> JS, "madonna" -> MA, "张伟" -> 张伟, "O'Brien" -> OB.
function nameTokens(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s.-]+/gu, ' ')
    .split(/[\s.-]+/)
    .filter((t) => t && !NAME_PREFIX.test(t) && !NAME_SUFFIX.test(t));
}

function initials(name) {
  const raw = String(name || '');
  // Keep CJK names intact: Unicode decomposition would break Hangul into jamo.
  const cjk = raw.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
  if (cjk) return cjk.slice(0, 2).join('');
  const tokens = nameTokens(raw);
  if (!tokens.length) return '?';
  if (tokens.length > 1) return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
  return [...tokens[0]].slice(0, 2).join('').toUpperCase();
}

// Same name always gets the same colours, so a person is recognisable at a glance.
function avatarGradient(name) {
  let h = 0;
  for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function avatar(name, cls = '') {
  const text = initials(name);
  const cjk = CJK.test(text) ? ' cjk' : '';
  return `<div class="avatar ${cls}${cjk}" style="background:${avatarGradient(name)}" title="${esc(name || '')}" aria-hidden="true">${esc(text)}</div>`;
}

function profileName(p) {
  return p?.label || p?.fullName || [p?.firstName, p?.lastName].filter(Boolean).join(' ') || 'Unnamed profile';
}

// Which profile fields matter for filling applications, grouped for the checklist.
const COMPLETENESS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['city', 'City'], ['country', 'Country'], ['linkedin', 'LinkedIn'], ['headline', 'Headline'],
  ['yearsExperience', 'Years of experience'], ['summary', 'Summary'],
  ['workAuthorization', 'Work authorization'], ['requiresSponsorship', 'Sponsorship'],
  ['salaryExpectation', 'Salary expectation'],
];

function completeness(p) {
  const missing = COMPLETENESS.filter(([k]) => !String(p[k] ?? '').trim()).map(([, l]) => l);
  if (!(p.skills || []).length) missing.push('Skills');
  if (!(p.experience || []).length) missing.push('Experience');
  if (!(p.resumes || []).length) missing.push('Resume file');
  const total = COMPLETENESS.length + 3;
  return { pct: Math.round(((total - missing.length) / total) * 100), missing };
}

function settingsKey(s) {
  if (Array.isArray(s?.aiKeys)) return s.aiKeys.some((k) => k.enabled !== false) ? 'set' : '';
  return s?.keys?.[s?.provider] || s?.apiKey || '';
}

// Overall AI status. kind: 'none' (no key - AI features are disabled), 'dead' (every key failed), 'live', 'untested'.
function aiState(s, keyHealth = {}) {
  const keys = Array.isArray(s?.aiKeys) ? s.aiKeys.filter((k) => k.enabled !== false && k.key) : [];
  if (!keys.length && !(!Array.isArray(s?.aiKeys) && settingsKey(s))) return { kind: 'none', hasKey: false, keys, live: 0, dead: 0 };
  const live = keys.filter((k) => keyHealth[k.id]?.ok).length;
  const dead = keys.filter((k) => keyHealth[k.id] && !keyHealth[k.id].ok).length;
  return { kind: live ? 'live' : keys.length && dead === keys.length ? 'dead' : 'untested', hasKey: true, keys, live, dead };
}

// ---------- Public IP ----------

const COUNTRY_ALIASES = {
  US: ['usa', 'united states', 'united states of america', 'america', 'u.s.', 'u.s.a.'],
  GB: ['uk', 'united kingdom', 'england', 'great britain', 'britain'],
  KR: ['korea', 'south korea', 'republic of korea'],
  CN: ['china', "people's republic of china", 'prc'],
  CA: ['canada'], DE: ['germany'], PL: ['poland'], IN: ['india'], AU: ['australia'], PH: ['philippines'],
};

// true / false when both sides are known, null otherwise. Profile country is free text ("US", "USA", "United States").
function sameCountry(profileCountry, info) {
  const p = String(profileCountry || '').trim().toLowerCase();
  if (!p || !info?.country) return null;
  const code = info.country.toUpperCase();
  return p === code.toLowerCase() || p === String(info.countryName || '').toLowerCase() || (COUNTRY_ALIASES[code] || []).includes(p);
}

// { kind: 'ok' | 'warn' | 'err' | '', text, title } for showing the IP next to the active profile.
function ipView(info, profile, error) {
  if (!info) return { kind: error ? 'err' : '', text: error ? 'IP unknown' : 'Checking IP...', title: error || '' };
  const place = [info.city, info.country].filter(Boolean).join(', ');
  const match = sameCountry(profile?.country, info);
  const title = [`IP ${info.ip}`, [info.city, info.region, info.countryName].filter(Boolean).join(', '), info.org,
    match === false ? `Profile country is ${profile.country}, but this IP is in ${info.countryName || info.country}` : match ? 'Matches the profile country' : ''].filter(Boolean).join('\n');
  return { kind: match === false ? 'warn' : match ? 'ok' : '', text: `${info.ip}${place ? ' · ' + place : ''}`, title };
}

const getIp = (force = false) => send({ type: 'getIp', force });

function timeAgo(date) {
  const s = (Date.now() - new Date(date)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(date).toLocaleDateString(self.jbI18n?.locale);
}

// Theme: 'system' (follow Windows), 'light' or 'dark'.
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
store.get('settings').then(({ settings }) => applyTheme(settings?.theme));
chrome.storage.onChanged.addListener((c) => c.settings && applyTheme(c.settings.newValue?.theme));

const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected', 'No reply'];
const STATUS_BADGE = { Applied: 'accent', Interview: 'warning', Offer: 'success', Rejected: 'danger', 'No reply': '' };

// ---------- Work schedule helpers ----------

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function normalizeSchedule(s) {
  return { blocks: [], autoSwitch: false, reminders: true, ...(s || {}) };
}

function blocksOn(schedule, date) {
  return schedule.blocks.filter((b) => (b.days || []).includes(date.getDay())).sort((a, b) => toMin(a.start) - toMin(b.start));
}

function currentBlock(schedule, d = new Date()) {
  const m = nowMin(d);
  return blocksOn(schedule, d).find((b) => toMin(b.start) <= m && m < toMin(b.end));
}

// Applications logged by the block's profile during the block's time window on a given date.
function blockDone(apps, block, date) {
  return apps.filter((a) => {
    const t = new Date(a.date);
    return a.profileId === block.profileId && sameDay(t, date) && toMin(block.start) <= nowMin(t) && nowMin(t) < toMin(block.end);
  }).length;
}
