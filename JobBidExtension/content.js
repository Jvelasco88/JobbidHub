// JobBid Autofill - content script. Runs in every page/frame.
// Finds application form fields, fills them from the active profile using
// rules first, cached answers second, and the AI provider for whatever is left.

(() => {
  if (window.__jobBidLoaded) return;
  window.__jobBidLoaded = true;

  // JobBid Hub dashboard (marked with <meta name="jobbid-hub">): no autofill or side panel here.
  // The page can ask the extension to do things that only the extension can (e.g. test the ChatGPT tab).
  if (window === window.top && document.querySelector('meta[name="jobbid-hub"]')) {
    const HUB_ACTIONS = { testChatgpt: { type: 'testChatgpt' }, ping: null };
    const extAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
    window.addEventListener('message', async (e) => {
      const m = e.data;
      if (e.source !== window || e.origin !== location.origin || m?.source !== 'jobbid-hub' || !(m.action in HUB_ACTIONS)) return;
      const reply = (r) => window.postMessage({ source: 'jobbid-ext', id: m.id, ...r }, location.origin);
      // After the extension is reloaded/updated, this copy of the script is cut off from it
      // (Chrome only adds the new copy when the page is reloaded).
      if (!extAlive()) return reply({ ok: false, reload: true, error: 'The extension was updated. Reload this page.' });
      try {
        if (!m.action || m.action === 'ping') return reply({ ok: true, version: chrome.runtime.getManifest().version });
        reply(await chrome.runtime.sendMessage(HUB_ACTIONS[m.action]));
      } catch (err) {
        const gone = /context invalidated/i.test(err.message);
        reply({ ok: false, reload: gone, error: gone ? 'The extension was updated. Reload this page.' : err.message });
      }
    });
    if (extAlive()) window.postMessage({ source: 'jobbid-ext', id: 'hello', ok: true, version: chrome.runtime.getManifest().version }, location.origin);
    // Signing in (or out) on this hub page signs the JobBid extension in this Chrome in (or out) too.
    let lastTok = null;
    const followSignIn = () => {
      if (!extAlive()) return;
      let tok = '';
      try { tok = localStorage.getItem('jbhub.token') || ''; } catch { /* no storage */ }
      if (tok === lastTok) return;
      const prevToken = lastTok || '';
      lastTok = tok;
      chrome.runtime.sendMessage({ type: 'hubAdopt', url: location.origin, token: tok, prevToken }).catch(() => {});
    };
    followSignIn();
    setInterval(followSignIn, 2000);
    window.addEventListener('storage', followSignIn);
    return;
  }

  const IS_TOP = window === window.top;

  // The hub's "JobBid Chrome extension" card shows which version this Chrome runs (and whether it updates
  // by itself) next to the latest one. Any page can read this; it is only the version number.
  if (IS_TOP) {
    const stamp = (auto) => {
      const v = chrome.runtime.getManifest().version;
      document.documentElement.setAttribute('data-jobbid-version', v);
      if (auto != null) document.documentElement.setAttribute('data-jobbid-auto', auto ? '1' : '0');
      window.postMessage({ __jobbid: 'version', version: v, auto }, location.origin);
    };
    try { stamp(null); chrome.runtime.sendMessage({ type: 'extInfo' }).then((r) => stamp(!!r?.auto)).catch(() => {}); } catch { /* extension reloading */ }
    // A React site that rebuilds the page drops the mark: put it back.
    setInterval(() => { try { if (!document.documentElement.hasAttribute('data-jobbid-version') && chrome.runtime?.id) stamp(null); } catch { /* cut off */ } }, 3000);
  }

  // When the extension is reloaded or updated, scripts already running in open tabs lose their
  // connection ("Extension context invalidated"). Detect that, remove the old UI and ask for a reload.
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  let dead = false;
  function shutDown() {
    if (dead) return;
    dead = true;
    document.getElementById('jobbid-root')?.remove();
    if (document.getElementById('jobbid-root-panel')) {
      document.getElementById('jobbid-root-panel').remove();
      // The side panel pushed the page aside; put it back.
      document.documentElement.style.removeProperty('margin-left');
      document.documentElement.style.removeProperty('margin-right');
    }
    if (IS_TOP) showUpdatedNotice();
  }

  function showUpdatedNotice() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;left:20px;bottom:20px;';
    const r = host.attachShadow({ mode: 'open' });
    const ko = /^ko/i.test(navigator.language), zh = /^zh/i.test(navigator.language);
    const msg = ko ? 'JobBid가 업데이트되었습니다. 계속 사용하려면 이 페이지를 새로 고치세요.'
      : zh ? 'JobBid 已更新。请刷新此页面以继续使用。' : 'JobBid was updated. Reload this page to keep using it.';
    r.innerHTML = `<style>
        .b { font: 13px/18px "Segoe UI", system-ui, sans-serif; display: flex; gap: 10px; align-items: center; max-width: 360px; padding: 10px 10px 10px 14px;
          border-radius: 8px; background: #1f1f1f; color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
        button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 4px; font-weight: 600; }
        .go { background: #60cdff; color: #000; } .x { color: #bbb; }
      </style><div class="b"><span>⚡ ${msg}</span><button class="go">${ko ? '새로 고침' : zh ? '刷新' : 'Reload'}</button><button class="x" title="Close">✕</button></div>`;
    r.querySelector('.go').addEventListener('click', () => location.reload());
    r.querySelector('.x').addEventListener('click', () => host.remove());
    (document.body || document.documentElement).appendChild(host);
  }

  const send = (msg) =>
    new Promise((resolve) => {
      if (!alive()) {
        shutDown();
        return resolve({ ok: false, error: 'JobBid was updated - reload this page.' });
      }
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message }));
      } catch (e) {
        if (!alive()) shutDown();
        resolve({ ok: false, error: e.message });
      }
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (n) => (n ? (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();
  const answerKey = (label) => {
    let k = norm(label).replace(/\b(required|optional)\b/g, '').replace(/\s+/g, ' ').trim();
    // Older saves have the question twice ("Gender Gender"): count it once.
    const w = k.split(' ');
    if (w.length % 2 === 0 && w.slice(0, w.length / 2).join(' ') === w.slice(w.length / 2).join(' ')) k = w.slice(0, w.length / 2).join(' ');
    return k.slice(0, 120);
  };

  // A verification code ("Digit 1 of 6", "Enter the code we sent you"): new every time, never saved or reused.
  const ONE_TIME = /\bdigit \d+ of \d+\b|verification code|confirmation code|one ?time (pass ?)?(code|password)|\botp\b|passcode|security code|enter (the )?(\d+ ?digit )?code/;
  const isOneTime = (f) => ONE_TIME.test(norm(`${f.label || ''} ${f.hint || ''}`));

  // Words that carry the meaning of a question, for "same question, other words" matching.
  const Q_STOP = new Set('a an the of to in for and or at on with by is are you your do does have has be been this that our we us as from will would please if any can select one following which'.split(' '));
  const qWords = (k) => new Set(answerKey(k).split(' ').filter((w) => w.length > 1 && !Q_STOP.has(w)));
  // Numbers and single letters tell questions apart ("Digit 1 of 6" / "Digit 2 of 6", "Response A" / "Response B").
  const qNumbers = (k) => (answerKey(k).match(/\b(\d+|[a-hj-z])\b/g) || []).join(' ');
  const qNegated = (k) => /\b(not|no|non|never|without|none|unable|cannot|t)\b/.test(answerKey(k));
  // The saved question this box takes its answer from: the same words, else a question worded almost the
  // same ("How did you first hear about this opportunity?" / "How did you hear about this opportunity?",
  // "...text message updates from Arine" / "...from Mapbox"). Only when no other saved question comes as
  // close, the numbers are the same ("Digit 1 of 6" is not "Digit 2 of 6") and both ask it the same way
  // round (one with "not" is the opposite question). Never for essays: those differ per job.
  const wordCache = new WeakMap(); // the saved questions' words, worked out once per fill
  function savedKey(f, answers) {
    if (!usefulLabel(f.label) || isOneTime(f)) return null;
    const k = answerKey(f.label);
    if (k.length <= 3) return null;
    if (answers[k] != null && String(answers[k]).trim() !== '') return k;
    // An empty one is a question waiting for an answer: a reworded saved one may have it.
    if (f.kind === 'textarea') return answers[k] !== undefined ? k : null;
    const qw = qWords(f.label);
    if (qw.size < 3) return null;
    let best = null, bestScore = 0, second = 0;
    let list = wordCache.get(answers);
    if (!list) {
      // Not a date ("11/05/2026" for "earliest start date" is out of date on the next form).
      list = Object.entries(answers).filter(([, v]) => v != null && String(v).trim() !== '' && !/\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}/.test(String(v)))
        .map(([key]) => [key, qWords(key)]);
      wordCache.set(answers, list);
    }
    for (const [key, kw] of list) {
      let common = 0;
      for (const w of qw) if (kw.has(w)) common++;
      const score = common / (qw.size + kw.size - common);
      if (score > bestScore) { second = bestScore; bestScore = score; best = key; } else if (score > second) second = score;
    }
    if (!best || bestScore < 0.8 || bestScore - second < 0.05) return null;
    if (qNumbers(best) !== qNumbers(f.label) || qNegated(best) !== qNegated(f.label)) return null;
    // A list the answer is not in is another question.
    return fitsOptions(f, answers[best]) ? best : null;
  }
  const savedAnswer = (f, answers) => { const k = savedKey(f, answers); return k == null ? undefined : answers[k]; };

  // ---------- Profile rules ----------

  const yn = (v) => {
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    const s = norm(v);
    if (/^(yes|y|true)$/.test(s)) return 'Yes';
    if (/^(no|n|false)$/.test(s)) return 'No';
    return v || '';
  };
  const edu = (p) => (p.education || [])[0] || {};

  // Forms often reject "linkedin.com/in/x" - they want a full URL.
  const withHttps = (v) => {
    v = String(v || '').trim();
    return v && !/^https?:\/\//i.test(v) ? 'https://' + v.replace(/^\/+/, '') : v;
  };
  const LINK_DOMAINS = /^(www\.)?(linkedin|github|gitlab|bitbucket|behance|dribbble|medium|twitter|x|facebook|instagram|kaggle|stackoverflow|youtube)\.(com|io|org)\b/i;
  function fixUrl(f, value) {
    if (/^https?:\/\//i.test(value) || /\s|@/.test(value)) return value;
    const urlField = f.el.type === 'url' || /url|link|website|portfolio|profile|github|linkedin/.test(norm(f.label + ' ' + f.hint));
    const looksLikeUrl = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value);
    return looksLikeUrl && (urlField || LINK_DOMAINS.test(value) || /^www\./i.test(value)) ? 'https://' + value : value;
  }
  // Today for a date box, or one part of it ("Month" 11, "Day" 06, "Year" 2026; else MM/DD/YYYY).
  const todayPart = (f) => {
    const d = new Date(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    const l = norm(`${f.label} ${f.el?.getAttribute?.('data-automation-id') || ''}`);
    if (/\bmonth\b|\bmm\b/.test(l)) return mm;
    if (/\bday\b|\bdd\b/.test(l)) return dd;
    if (/\byear\b|yyyy/.test(l)) return String(d.getFullYear());
    return f.el?.type === 'date' ? `${d.getFullYear()}-${mm}-${dd}` : `${mm}/${dd}/${d.getFullYear()}`;
  };

  // The city alone: a profile city saved as "Chicago,IL" or "Chicago, Illinois" loses the state part.
  const cityOnly = (p) => String(p.city || '').replace(/\s*,\s*([A-Za-z .]+?)\s*$/, (m, s) => {
    const k = s.trim().toLowerCase();
    return US_STATES[k] || Object.values(US_STATES).includes(k) ? '' : m;
  }).trim();
  // "Chicago, IL" (never "Chicago,IL, IL").
  const cityState = (p) => [cityOnly(p), p.state || stateIn(p.city)].filter(Boolean).join(', ');
  const HEAR_RE = /how did you (first |initially |originally )?(hear|learn|find out|find us|come across)|where did you (first )?(hear|find|learn|see)|referral source|source of (application|referral|hire)|how were you referred|^\s*source\s*$/;
  // Tried in this order when the list has no item for the answer itself (also on each level of a nested
  // Workday list: "Job Board" > "LinkedIn").
  const HEAR_ALTS = ['LinkedIn', 'Job Board', 'Online Job Board', 'Job Posting', 'Social Media', 'Internet', 'Online', 'Company Website', 'Careers Site', 'Website', 'Other'];
  const CLEARANCE_HELD_RE = /(level|type|kind|which|what).{0,60}clearance.{0,60}(hold|have|held|possess)|(currently|presently|now) (hold|have|possess).{0,40}clearance|(active|current) (\w+ ){0,4}clearance|(do|does) you (currently |presently )?(have|hold|possess) (an? |any )?(\w+ ){0,4}clearance/;
  const CLEARANCE_ALTS = ['None', 'No clearance', 'No', 'N/A', 'Not applicable', 'I do not have a clearance'];
  const CITIZEN_STATUS_RE = /export control|export compliance|\bitar\b|\bu ?s ?person\b|citizenship status|(select|which|what).{0,60}(citizenship|citizen status|immigration status)/;
  const CITIZEN_ALTS = ['U.S. Citizen', 'United States Citizen', 'Citizen', 'U.S. Person', 'US Person', 'Yes'];
  const altsFor = (f) => (HEAR_RE.test(norm(f.label)) ? HEAR_ALTS : CLEARANCE_HELD_RE.test(norm(f.label)) ? CLEARANCE_ALTS : CITIZEN_STATUS_RE.test(norm(f.label)) ? CITIZEN_ALTS : []);
  // A street line has a house number or a street word: "123 Main St" yes, "Chicago, IL" / "Chicago, IL 60601" no
  // (a resume often shows only the city, and the resume reader may store that as the address).
  // Not the street: email / IP / line 2+, and "Mailing address city" (a part of the address).
  const STREET_NOT = /e-?mail|line ?[2-9]|ip address|web ?address|address (city|state|zip|postal|country|county|province)/;
  const STREET_FIELD = /street|address line ?1|^address\b|(mailing|home|residential|current|permanent|physical) address|first line of (your |the )?(home |street |mailing |current )?address/;
  const isStreet = (v) => {
    const s = String(v || '').trim().replace(/,?\s*[A-Za-z]{2}\s+\d{5}(-\d{4})?\s*$/, '').replace(/\b\d{5}(-\d{4})?\s*$/, '');
    return /\d/.test(s) || /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|sq|square|trl|trail|apt|suite|ste|unit|p\.?\s?o\.? box)\b/i.test(s);
  };
  // Address Line 1 / Street: only the street part ("123 Main St, Chicago, IL 60601" -> "123 Main St") when the
  // form asks for the city separately; a plain "Address" box gets the whole address. No street -> left for you.
  const streetLine = (p, f) => {
    const a = String(p.address || '').trim();
    if (!isStreet(a)) return null;
    if (!/street|line ?1/.test(norm((f && f.label) || '') + ' ' + norm((f && f.hint) || ''))) return a;
    const parts = a.split(',').map((x) => x.trim()).filter(Boolean);
    const cut = parts.findIndex((x, k) => k > 0 && ((p.city && norm(x) === norm(p.city)) || !isStreet(x)));
    return cut > 0 ? parts.slice(0, cut).join(', ') : a;
  };
  // "123 Main St, Chicago, IL 60601": the street line plus city, state and ZIP from the profile.
  // No street on file -> "Chicago, IL 60601" (still better than an empty required box).
  const fullAddress = (p) => {
    const street = streetLine(p, { label: 'street' }) || '';
    const tail = stateIn(p.city) ? [p.city, p.zip].filter(Boolean).join(' ') : [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const out = [street, tail].filter(Boolean).join(', ');
    return out || String(p.address || '').trim() || null;
  };
  // The state at the end of an address: "Little Falls Township, NJ" / "..., NJ 07424" -> "NJ".
  const stateIn = (t) => (String(t || '').match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/) || [])[1]?.toUpperCase() || null;

  // ---------- Birthday / age ----------
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_RE = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i;

  // Accepts "1990-05-18", "05/18/1990" or "May 18, 1990"; returns { y, m, d } (m/d may be '').
  function birthParts(p) {
    const raw = String(p.birthday || '').trim();
    if (!raw) return /^\d{4}$/.test(String(p.birthYear || '').trim()) ? { y: String(p.birthYear).trim(), m: '', d: '' } : null;
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return { y: m[1], m: m[2].padStart(2, '0'), d: m[3].padStart(2, '0') };
    m = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return { y: m[3], m: m[1].padStart(2, '0'), d: m[2].padStart(2, '0') };
    m = raw.match(MONTH_RE);
    if (m) return { y: m[3], m: String(MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(m[1].toLowerCase())) + 1).padStart(2, '0'), d: m[2].padStart(2, '0') };
    m = raw.match(/^(\d{4})$/);
    return m ? { y: m[1], m: '', d: '' } : null;
  }

  function birthYearOf(p) {
    const manual = String(p.birthYear || '').trim().match(/\d{4}/);
    return manual ? manual[0] : birthParts(p)?.y || '';
  }

  function ageFromBirthday(p) {
    const b = birthParts(p);
    if (!b?.m || !b?.d) return '';
    const today = new Date();
    let age = today.getFullYear() - Number(b.y);
    const before = today.getMonth() + 1 < Number(b.m) || (today.getMonth() + 1 === Number(b.m) && today.getDate() < Number(b.d));
    if (before) age--;
    return age >= 0 && age < 130 ? String(age) : '';
  }

  // "Date of birth (MM/DD/YYYY)" names all three parts, so it is one field, not a split month/day/year.
  // Note: norm() turns separators into spaces, hence \s* below instead of [\/.-].
  const FULL_DATE_FORMAT = /(mm|month)\s*(dd|day)\s*(yyyy|year)|(dd|day)\s*(mm|month)\s*(yyyy|year)|(yyyy)\s*(mm|month)\s*(dd|day)/;

  // Format matching what the field asks for (date input, mm/dd/yyyy, dd/mm/yyyy or ISO).
  // A year-only profile value never goes into a full-date field; the birth-year rule handles those.
  function dobValue(p, f) {
    const b = birthParts(p);
    if (!b?.m || !b?.d) return '';
    if (f?.kind === 'date') return `${b.y}-${b.m}-${b.d}`;
    const text = norm(f?.label) + ' ' + norm(f?.hint);
    if (/(yyyy|year)\s*(mm|month|dd|day)/.test(text)) return `${b.y}-${b.m}-${b.d}`;
    if (/(mm|month)\s*(dd|day)\s*(yyyy|year)/.test(text)) return `${b.m}/${b.d}/${b.y}`;
    if (/(dd|day)\s*(mm|month)\s*(yyyy|year)/.test(text)) return `${b.d}/${b.m}/${b.y}`;
    const us = /^(us|usa|u\.s\.|united states|united states of america|canada|ca)$/i.test(String(p.country || '').trim());
    return us ? `${b.m}/${b.d}/${b.y}` : `${b.y}-${b.m}-${b.d}`;
  }

  // Month/day dropdowns list either numbers or month names; return whichever the field uses.
  function monthValue(f, mm) {
    const n = Number(mm);
    const name = MONTH_NAMES[n - 1] || '';
    const opts = f?.options || [];
    if (!opts.length) return mm;
    const want = [name.toLowerCase(), String(n), mm];
    return opts.find((o) => want.includes(norm(o))) || name;
  }

  function dayValue(f, dd) {
    const n = String(Number(dd));
    const opts = f?.options || [];
    return opts.length ? opts.find((o) => [n, dd].includes(norm(o))) || n : n;
  }

  // A form with its own "Country Phone Code" box (Workday and others) rejects "+1 442 432 4069" in the
  // number box: then only the national number goes there.
  function hasPhoneCodeField() {
    if (deepQueryAll('[data-automation-id*="countryPhoneCode" i], [name*="countryCode" i], [id*="countryCode" i], [name*="phoneCode" i], [id*="phoneCode" i], [name*="dialCode" i], [id*="dialCode" i]').length) return true;
    return deepQueryAll('label, legend, [data-automation-id*="formLabel" i]')
      .some((l) => !l.closest('#jobbid-root') && /(country|phone)\s*(phone\s*)?code|dial(l?ing)?\s*code|calling code/i.test(textOf(l)));
  }
  function nationalNumber(phone) {
    const s = String(phone || '').trim();
    if (/^\+1[\s.-]*/.test(s) || /^001[\s.-]*/.test(s)) return s.replace(/^(\+1|001)[\s.-]*/, '');
    if (/^\+\d/.test(s)) return s.replace(/^\+\d{1,3}[\s.-]*(\(0\)\s*)?/, '');
    const digits = s.replace(/\D/g, '');
    // "1 442 432 4069" written without the plus.
    if (digits.length === 11 && digits[0] === '1' && /^1[\s.-]/.test(s)) return s.replace(/^1[\s.-]*/, '');
    return s;
  }
  const phoneFor = (p) => (p.phone && hasPhoneCodeField() ? nationalNumber(p.phone) : p.phone);
  // The phone number box itself (not "Country Phone Code", "Phone Device Type" or "Extension").
  const isPhoneField = (f) => (f.kind === 'text' || f.kind === 'number') && ruleFor(f)?.key === 'phone'
    && !/code|country|ext|type|device/.test(norm(f.label + ' ' + f.hint));

  // Lives in the US, may work there, and needs no visa: true / false, or null when the profile does not say.
  function usPerson(p) {
    const us = /^(united states( of america)?|usa?|u s a?)$/i.test(norm(p.country || ''));
    const auth = norm(yn(p.workAuthorization)), spon = norm(yn(p.requiresSponsorship));
    if (!p.country && !auth) return null;
    return us && auth === 'yes' && spon !== 'yes';
  }

  // Order matters: specific patterns before general ones.
  // The choice that agrees ("I understand", "I acknowledge", "I attest", "Continue"); "Yes" when the box has no list.
  const ACK_OPTION = /^(yes|i (understand|acknowledge|agree|accept|consent|attest|certify|have read)|acknowledged?|agreed?|accept(ed)?|continue|understood)\b/i;
  const ackOption = (f) => {
    const opts = (f?.options || []).filter((o) => !/\b(not|don t|do not|decline|disagree)\b/i.test(norm(o)));
    return opts.find((o) => ACK_OPTION.test(String(o).trim())) || (f?.options?.length ? null : 'Yes');
  };
  const COLOR_WORDS = /^(red|blue|green|yellow|orange|purple|pink|black|white|brown|gr[ae]y|violet|indigo|cyan|magenta)$/i;
  const CURRENCIES = { 'united states': 'USD', usa: 'USD', canada: 'CAD', 'united kingdom': 'GBP', india: 'INR', philippines: 'PHP', australia: 'AUD',
    mexico: 'MXN', brazil: 'BRL', germany: 'EUR', france: 'EUR', spain: 'EUR', italy: 'EUR', netherlands: 'EUR', ireland: 'EUR', portugal: 'EUR', poland: 'PLN' };

  const RULES = [
    // Birthday / age. Split year/month/day fields come first so a field named "dob_month"
    // gets the month, not the whole date. A field naming all three parts (MM/DD/YYYY)
    // is excluded and handled as one date. Plain "birthday" matches the full-date rule.
    { re: /(birth|dob|date of birth).{0,15}(year|yr)|(year|yr).{0,15}(birth|dob)|year of birth|born in \d{4}/, ex: FULL_DATE_FORMAT, key: 'birthYear', value: (p) => birthYearOf(p) },
    { re: /(birth|dob|date of birth).{0,15}(month|mon)|(month|mon).{0,15}(birth|dob)|month of birth/, ex: FULL_DATE_FORMAT, key: 'birthday', value: (p, f) => { const b = birthParts(p); return b?.m ? monthValue(f, b.m) : ''; } },
    { re: /\bbirth\s+day\b|(dob|date of birth).{0,15}day|day.{0,15}(birth|dob)|day of birth/, ex: FULL_DATE_FORMAT, key: 'birthday', value: (p, f) => { const b = birthParts(p); return b?.d ? dayValue(f, b.d) : ''; } },
    { re: /date of birth|birth ?date|birthday|\bdob\b|when were you born/, key: 'birthday', value: (p, f) => dobValue(p, f) },
    // "What is your current age?" (Under 30 / 30-39 / 40-49...): the age from the birthday, else 35 (-> "30-39").
    { re: /^age\b|your (current |present )?age\b|how old are you|age (range|group|bracket)/, ex: /18|eighteen|legal|minimum age|of age or older/, value: (p) => ageFromBirthday(p) || '35' },
    // Common screening questions (Yes/No), checked first so e.g. "contact your current employer"
    // isn't mistaken for "current employer name".
    // "Do you consent to receiving text communications related to your job application via SMS...?": Yes.
    { re: /consent.{0,60}\b(text|sms)\b|\b(text|sms)\b.{0,40}(communications?|messages?|messaging).{0,80}(job|application|recruit)|(receive|receiving) (text|sms)|(receive|receiving) .{0,40}\b(sms|whatsapp)\b|\b(sms|whatsapp)\b.{0,80}(number provided|your application)/, ex: /newsletter|marketing|promotional/, value: () => 'Yes' },
    // "May we contact you via text about this position?", "Can NinjaOne text you updates?", "Text/SMS": Yes.
    { re: /(contact|reach|update|message) you (via|by|over|through) (text|sms)|\btext you\b|^(text )?sms\b(?! (marketing|newsletter))|^text messages?\b/, ex: /newsletter|marketing|promotional/, value: () => 'Yes' },
    // Human check: "To confirm you are a human, which of the following is a real color".
    { re: /real colou?r|which .{0,40}(is|are) an? colou?r/, value: (p, f) => (f?.options || []).find((o) => COLOR_WORDS.test(String(o).trim())) || null },
    // Acknowledgements: "I understand that X may use AI tools...", "Candidate Privacy Policy", "AI Usage Attestation",
    // "By selecting continue ... you acknowledge", "I am allowing X to share my information", interview recording tools.
    { re: /^i (understand|acknowledge|certify|attest)\b|privacy (policy|notice)|attestation|by selecting .{0,12}continue|you acknowledge|i am allowing|allow .{0,60}to share my (information|data)|records? and transcribes?/,
      ex: /\b(sms|text messages?|whatsapp|marketing|newsletter)\b/, value: (p, f) => ackOption(f) },
    // Agreements with a former employer and its secrets: No.
    { re: /agreement.{0,120}(restrict|limit|prevent|prohibit)|covenants? not to compete|subject to any agreement/, key: 'nonCompete', value: (p) => yn(p.nonCompete) || 'No' },
    { re: /confidential information.{0,80}(trade secrets?|proprietary)|trade secrets?.{0,80}(previous|former|prior) employ/, value: () => 'No' },
    // Government work, audits of the company, licenses, family at the company's auditors: No.
    { re: /government official|government (entity|agency|employee)|employed (with|by) the federal|federal (government|housing)/, ex: /contractor|clearance|security/, value: () => 'No' },
    { re: /external (accounting )?audit|real estate or broker license|broker license/, value: () => 'No' },
    { re: /(spouse|domestic partner|dependent|sibling|immediate family).{0,80}(employ|principal|shareholder|work)/, key: 'relatives', value: (p) => yn(p.relatives) || 'No' },
    // "Are you able to work US East Coast time zone hours?": Yes (not nights / weekends / overtime).
    { re: /(able|willing) to work .{0,40}(time ?zone|hours)|(east|west) coast .{0,20}hours/, ex: /weekend|night|overtime|on ?call|shift/, value: () => 'Yes' },
    // "Are you a transitioning service member?": from the veteran answer (not a veteran -> No).
    { re: /transitioning service ?member/, value: (p) => (/\b(i am a|yes|protected veteran)\b/i.test(p.veteran || '') && !/\bnot\b/i.test(p.veteran || '') ? 'Yes' : 'No') },
    // "Language" (the application's language, a list holding English): English.
    { re: /^(preferred |application |correspondence )?language\b(?! (skills?|proficien))/, value: (p, f) => (f?.options || []).find((o) => /^english\b/i.test(String(o).trim())) || null },
    // "Are you a person of transgender experience?": the profile's answer, else the "prefer not to answer" choice.
    { re: /transgender|gender identity .{0,20}(same|differ)/, value: (p, f) => p.transgender || (f?.options || []).find((o) => /prefer not|decline|don.?t wish|not to (answer|say|disclose)/i.test(String(o))) || null },
    // "Salary Expectation - Currency": the profile country's currency.
    { re: /\bcurrency\b/, value: (p) => CURRENCIES[norm(p.country)] || 'USD' },
    { re: /(18|eighteen) (years|yrs)|at least 18|of legal (working )?age|over the age of 18/, key: 'over18', value: (p) => (p.over18 ? yn(p.over18) : 'Yes') },
    { re: /reliable (transportation|transport|means of transportation)|(own|have) (a )?(reliable )?(car|vehicle)\b/, ex: /license|licence|insurance/, value: () => 'Yes' },
    { re: /contact.{0,40}(current|most recent|present) (employer|supervisor|manager)/, key: 'contactCurrent', value: (p) => yn(p.contactCurrent) },
    { re: /contact.{0,40}(past|previous|prior|former) (employer|supervisor|manager)s?/, key: 'contactPast', value: (p) => yn(p.contactPast) },
    { re: /(been|ever) (fired|terminated|dismissed|discharged)|asked to resign/, key: 'everFired', value: (p) => yn(p.everFired) },
    { re: /essential functions/, key: 'essentialFunctions', value: (p) => yn(p.essentialFunctions) },
    { re: /background (check|investigation|screening)/, key: 'backgroundCheck', value: (p) => (p.backgroundCheck ? yn(p.backgroundCheck) : 'Yes') },
    // "Drug Free Workplace" (agree to the policy / a drug test): the profile's answer, else Yes.
    { re: /drug (test|screen)|drug ?free (workplace|work place|environment|policy)|drug (and|&) alcohol (policy|test|screen)|substance (abuse )?(test|screen|policy)/, key: 'drugTest', value: (p) => (p.drugTest ? yn(p.drugTest) : 'Yes') },
    // US export rules: "Are you a citizen of Cuba, Iran, Syria, or North Korea?" (your own answer, once saved, wins).
    { re: /\b(citizen|national|resident)s?\b.{0,60}\b(cuba|iran|syria|north korea|crimea)\b|embargoed countr|sanctioned countr/, value: () => 'No' },
    // "For purposes of complying with Federal Export Control Laws, please select one of the following": US Citizen
    // (not for a profile that is clearly not a US person; your own saved answer wins). Yes/No form -> CITIZEN_ALTS.
    { re: CITIZEN_STATUS_RE, ex: /country of citizenship|citizenship country|which countr|sponsor/, value: (p) => (usPerson(p) === false ? null : 'US Citizen') },
    { re: /convicted|felony|criminal (record|offense|conviction)/, key: 'convicted', value: (p) => yn(p.convicted) },
    // Also "Have you entered into any agreement or understanding that will prevent you from joining X?" Default No.
    { re: /non ?compete|non ?solicitation|restrictive covenant|agreement or understanding .{0,80}prevent|prevent you from (joining|working for|fully performing)/, key: 'nonCompete', value: (p) => yn(p.nonCompete) || 'No' },
    // Conflict-of-interest screening (Xplor and others): outside work, boards, patents, close ties. Default No.
    { re: /outside employment|consulting arrangements?|board of directors|advisory board|board memberships?|intellectual propert(y|ies)|own or have a (partial )?interest|personal relationships?.{0,120}(vendor|supplier|contractor|competitor|within)|financial interest in/, key: 'conflictOfInterest', value: (p) => yn(p.conflictOfInterest || 'No') },
    // "Do you consent to BrightHire's Interview Integrity feature analyzing your interview...?" (recording / AI
    // review of the interview): Yes. Its words "location checks" must not make it a location question.
    { re: /do you consent to .{0,120}(interview|recording|analy[sz])/, ex: /\b(sms|text messages?|whatsapp|marketing|newsletter)\b/, value: () => 'Yes' },
    // "Please select the status that allows you to work and live in that country": the sentence for a citizen
    // (none for a profile that is not a US person; your saved answer wins).
    { re: /status that allows you to work|select (the |your )?(status|option) .{0,40}(work and live|live and work)/, value: (p) => (usPerson(p) === false ? null : 'I am a citizen / permanent resident') },
    // "What country or countries do you have work authorization in?" asks for a country, not Yes/No.
    { re: /(what|which) countr(y|ies).{0,50}(work authori[sz]ation|authori[sz]ed to work|right to work|eligible to work|work permit)|countr(y|ies) (of|for|with) (work authori[sz]ation|right to work)/, value: (p) => p.workCountries || p.country || 'United States' },
    // "Do you currently work at Wave?" / "Were you referred by a Wave employee?": No (your saved answer wins).
    { re: /do you currently work (at|for) |are you (currently )?an? (current )?(employee|team member) (of|at) /, value: () => 'No' },
    { re: /were you referred (to [^?]{0,60})?by |referred by an? .{0,40}(employee|team member|staff)/, value: () => 'No' },
    // "By selecting 'I agree', you agree that X may process my data under its privacy notice."
    { re: /by selecting .{0,6}i agree|consent to (collect|store|process)|consent for .{0,60}\bto (collect|store|process|use)\b|(collect|store|process).{0,30}my (sensitive |personal )*data.{0,80}(privacy|monitoring|equal opportunit)/,
      value: (p, f) => (f?.options || []).find((o) => /^(yes|i (agree|consent|accept)|agree|accept)\b/i.test(String(o).trim())) || 'I agree' },
    // "Have you applied to or been referred to X for another role in the past 12 months?" (your saved answer wins).
    { re: /(applied|been referred) (to|for|with) .{0,60}(past|last) \d+ (months?|years?)|referred to .{0,40}for another (role|position)|have you (ever )?(previously )?applied (to|for|with) (this|our|us)\b.{0,40}(before|past|previously)?/, ex: /how many|which|what|when/, value: () => 'No' },
    { re: /relatives?|family members?.{0,30}(work|employ)|related to (anyone|an employee)/, key: 'relatives', value: (p) => yn(p.relatives) },
    // "Have you been employed by Capgemini Group before?" too. Default No (the profile's own answer wins).
    { re: /(previously|ever|formerly) (worked|been employed)|former employee|worked (for|at) .{0,30} (before|previously)|been employed (by|with|at) .{0,50}(before|in the past|previously)|worked (for|at) .{0,40}in the past|(currently|presently) (work|working|employed) (at|for|by|with) |in the (past|last) .{0,20}(months?|years?) .{0,30}(worked|been employed|work) (at|for|by|with) /, key: 'workedHereBefore', value: (p) => yn(p.workedHereBefore) || 'No' },
    // "This role requires travel... Are you able and willing to travel as needed?" Default Yes.
    { re: /(able|willing) (and (able|willing) )?to travel|willingness to travel|requires? (some )?travel/, ex: /percent|%|how much|how often/, value: (p) => (p.willingToTravel != null && p.willingToTravel !== '' ? yn(p.willingToTravel) : 'Yes') },
    // "Are you looking for full-time or part-time work?": full-time (a choice whose text has "full").
    { re: /full.?time,? or part.?time|part.?time,? or full.?time|full.?time ?\/ ?part.?time|part.?time ?\/ ?full.?time/, ex: /employ(ed|ee)|currently|dedicate|student|intern/,
      value: (p, f) => (f?.options || []).find((o) => /full/i.test(String(o))) || 'Full-time' },
    { re: /countr(y|ies).{0,40}(want|like|wish|prefer|willing|open|interested|able) to work|(want|like|prefer|willing) to work in|preferred (work )?countr|countries (of|for) work/, ex: /hybrid|remote|on ?site|office|shifts?|weekends?|nights?|hours|environment|team|fast paced|startup/, key: 'workCountries', value: (p) => p.workCountries || p.country },
    // "Which of the following communities do you belong to? (Person with disability, Veteran, Parent...)": None of the above.
    { re: /communit(y|ies) (do )?you (belong|identify)|belong to any of the following (communities|groups)/, value: (p, f) => (f?.options || []).find((o) => /^none( of (the|these) (above|options))?\.?$/i.test(o.trim())) || 'None of the above' },
    // A list of orientations ("Heterosexual / straight"): that one, unless the profile says otherwise.
    // A Yes/No "Do you identify as LGBTQ+?": the profile's answer, else No.
    { re: /lgbt|sexual orientation|queer/, key: 'lgbtq', value: (p, f) => {
      const opts = f?.options || [];
      const straight = opts.find((o) => /heterosexual|straight/i.test(o));
      const own = String(p.lgbtq || '').trim();
      if (own && !/^(yes|no)$/i.test(own)) return straight || opts.length > 3 ? own : /heterosexual|straight/i.test(own) ? 'No' : own;
      if (straight) return /^yes$/i.test(own) ? null : straight;
      return own ? yn(own) : 'No';
    } },
    { re: /e-?mail/, key: 'email', value: (p) => p.email },
    { re: /linked\s?in/, key: 'linkedin', value: (p) => withHttps(p.linkedin) },
    { re: /github/, key: 'github', value: (p) => withHttps(p.github) },
    // "How did you hear about us?": the profile's source, else LinkedIn (HEAR_ALTS when the list has no such item).
    { re: HEAR_RE, value: (p) => p.heardAbout || 'LinkedIn' },
    { re: /portfolio|personal (web)?site|website|blog|other url/, value: (p) => withHttps(p.website || p.github || p.linkedin) },
    // "Links to Proven Research" / "Link to your work samples / publications / projects": the candidate's
    // own work lives on the website or GitHub (a saved answer to the exact question wins, see fill).
    { re: /\b(links?|urls?)\b.{0,40}\b(research|publications?|papers?|projects?|work|samples?|examples?|accomplishments?|contributions?)\b|\b(research|publications?|papers?|projects?|work samples?)\b.{0,30}\b(links?|urls?)\b/, textOk: true,
      value: (p) => withHttps(p.website || p.github || p.linkedin) || null },
    { re: /phone.*(country|code|ext)|country.*code/, value: (p, f) => (f && /^(select|combobox|dropdown|listbox)$/.test(f.kind) && /code/.test(norm(f.label)) && !/ext/.test(norm(f.label)) ? p.country || null : null) },
    // "Phone Device Type" / "Phone Type" (Workday and others): always a mobile number.
    { re: /phone.{0,10}(device|type)|device type|phone kind/, value: () => 'Mobile' },
    { re: /phone|mobile|cell|telephone/, key: 'phone', value: (p) => phoneFor(p) },
    // Workday's "Prefix" / "Suffix" (Mr., Jr.) lists: left empty (they once got the full name).
    { re: /^(name )?(prefix|suffix|salutation)\b/, value: () => null },
    // Workday's disability form: "Date signed" Month / Day / Year is today. Before the disability rule: the
    // box's id ("selfIdentifiedDisabilityData--dateSignedOn") also says "disability".
    { re: /date ?signed ?on|signed ?on date|signature date|today s date/, value: (p, f) => todayPart(f) },
    { re: /first.?name|given.?name|fname|forename/, ex: /prefer/, key: 'firstName', value: (p) => p.firstName },
    { re: /last.?name|surname|family.?name|lname/, key: 'lastName', value: (p) => p.lastName },
    { re: /middle.?name/, value: () => null },
    { re: /preferred.?full.?name/, value: (p) => p.fullName || [p.firstName, p.lastName].join(' ') },
    { re: /preferred.?name|nick.?name/, key: 'firstName', value: (p) => p.firstName },
    { re: /full.?name|legal.?name|your name|^name\b|candidate name|applicant name/, ex: /company|employer|school|university|reference|manager|recruiter|\brefer|emergency|user.?name|file|project/, value: (p) => p.fullName || [p.firstName, p.lastName].join(' ') },
    { re: /sponsor/, key: 'requiresSponsorship', value: (p) => yn(p.requiresSponsorship) },
    // "Are you currently based in the United States?" - from the profile's country.
    { re: /\b(based|located|live|living|reside|residing|currently) in (the )?(united states|us|usa|u s)\b/, ex: /sponsor|authori[sz]ed/, value: (p) => (p.country ? (/^(united states( of america)?|usa?|u s a?)$/i.test(norm(p.country)) ? 'Yes' : 'No') : null) },
    { re: /authori[sz](ed|ation)|legally (eligible|allowed|able|entitled|permitted)|(able|allowed|eligible|permitted) to legally work|\blegally work\b|(entitled|permitted) to work|right to work|eligible to work|work permit/, ex: /background|consent|sms|text message/, key: 'workAuthorization', value: (p) => yn(p.workAuthorization) },
    { re: /conflicts? of interest/, key: 'conflictOfInterest', value: (p) => yn(p.conflictOfInterest || 'No') },
    // "What is the highest level of US Government security clearance you currently hold?" / "Do you hold
    // an active clearance?": None (a Yes/No list takes "No"; CLEARANCE_ALTS when the list words it otherwise).
    // Your own answer, once saved for the question, wins.
    { re: CLEARANCE_HELD_RE, ex: /eligib|able to (obtain|get)|willing to|obtain and maintain|ability to obtain/, value: () => 'None' },
    // "Eligible to obtain and maintain a U.S. security clearance": a US citizen working without sponsorship.
    { re: /(eligib|able|obtain|maintain|qualif).{0,40}(security )?clearance|clearance eligib/, ex: /(currently|presently|now) (hold|have)|active clearance|held a/, key: 'clearanceEligible',
      value: (p) => (p.clearanceEligible ? yn(p.clearanceEligible) : usPerson(p) == null ? null : usPerson(p) ? 'Yes' : 'No') },
    { re: /relocat/, key: 'willingToRelocate', value: (p) => yn(p.willingToRelocate) },
    // "Are you able to come into the office four days a week?" Remote-only profiles say No; everyone else can.
    { re: /(come|go|work).{0,40}(in|into|from|at) the office|\bin[- ]office\b|on[- ]?site|\bonsite\b|days? (a |per )?week|hybrid (schedule|role|work)|commute/, ex: /home office|remote only|fully remote/, value: (p) => (String(p.criteria?.workMode || '').toLowerCase() === 'remote' ? 'No' : 'Yes') },
    { re: /salary|compensation|pay (expectation|requirement)|desired pay|expected (pay|rate)/, key: 'salaryExpectation', value: (p) => p.salaryExpectation },
    { re: /notice period/, key: 'noticePeriod', value: (p) => p.noticePeriod },
    { re: /gender|sex\b/, ex: /orientation|transgender/, key: 'gender', value: (p) => p.gender },
    { re: /hispanic|latino/, key: 'hispanic', value: (p) => p.hispanic },
    { re: /race|ethnic/, key: 'ethnicity', value: (p) => p.ethnicity },
    { re: /veteran|military/, key: 'veteran', value: (p) => p.veteran },
    { re: /disabilit/, key: 'disability', value: (p) => p.disability },
    // "Complete current mailing address - Full address including street, city, state, & zip code" (often a big
    // text box): the whole address in one line. Kept per question once filled, like other derived answers.
    { re: /(complete|full|entire|whole) (current |present |permanent |home |mailing |residential |physical )*(mailing |home |residential |street |physical )?address|address including|including street/, ex: /e-?mail|ip address|line ?2|web ?address/, textOk: true, value: (p) => fullAddress(p) },
    { re: STREET_FIELD, ex: STREET_NOT, key: 'address', value: (p, f) => streetLine(p, f) },
    { re: /zip|postal|post code/, key: 'zip', value: (p) => p.zip },
    // "Location (City)" is a place search (Greenhouse): "Chicago, IL" from the location rule below.
    { re: /\bcity\b|town/, ex: /location/, key: 'city', value: (p) => cityOnly(p) || p.city },
    // County is not the state: empty until the profile has one (typed once on a form, it is saved to the profile).
    { re: /\bcounty\b/, ex: /country/, key: 'county', value: (p) => (notCounty(p.county) ? null : p.county || null) },
    { re: /\bstate\b|province|\bregion\b/, ex: /statement|united states|\bcounty\b/, key: 'state', value: (p) => p.state || stateIn(p.address) || stateIn(p.city) },
    { re: /country/, ex: /phone/, key: 'country', value: (p) => p.country },
    // Where the candidate lives. Not "Which (office) location are you applying for?": that is the job's office.
    { re: /current location|location|where are you (based|located)/, ex: /relocat|willing|preferred|consent|location checks?|applying (for|to)|office location|work location|which location/, value: (p) => cityState(p) },
    { re: /years.{0,20}experience|experience.{0,10}years|how many years/, ex: /\b(with|in|using)\b/, key: 'yearsExperience', value: (p) => p.yearsExperience },
    { re: /current (company|employer)|most recent (company|employer)|employer name/, value: (p) => p.currentCompany || (p.experience || [])[0]?.company },
    { re: /current (job )?title|current (position|role)|job title|most recent title/, value: (p) => p.currentTitle || p.headline },
    { re: /headline/, key: 'headline', value: (p) => p.headline },
    { re: /school|university|college|institution/, value: (p) => edu(p).school },
    { re: /field of study|major|discipline/, value: (p) => edu(p).field },
    { re: /degree/, ex: /field/, value: (p) => edu(p).degree },
    { re: /graduation year|year of graduation/, value: (p) => (String(edu(p).end || '').match(/\d{4}/) || [''])[0] },
    { re: /graduation date|date of graduation/, value: (p) => edu(p).end },
    // Not Workday's "Type to Add Skills" list: each skill is a separate search there (slow, and optional).
    { re: /skills|technolog(y|ies)|tech stack|keywords|tools (you|and technologies)/, ex: /describe|explain|tell|years|\brate\b|\blevel\b|type to add/, textOk: true, value: (p) => (p.skills || []).join(', ') },
    { re: /summary|about (you|yourself)|professional profile/, value: (p) => p.summary, onlyTextarea: true },
    { re: /pronoun/, key: 'pronouns', value: (p) => p.pronouns },
  ];

  function ruleFor(field) {
    const fits = (text) => (r) => r.re.test(text) && !(r.ex && r.ex.test(text)) && !(r.onlyTextarea && field.kind !== 'textarea')
      // A big text box ("How many years...? Please describe in detail") is a question, not a one-word profile field.
      && !(field.kind === 'textarea' && !r.onlyTextarea && !r.textOk);
    const hit = RULES.find(fits(norm(field.label) + ' ' + norm(field.hint)));
    if (hit || !field.desc) return hit;
    // A short heading ("U.S. WORK AUTHORIZATION") with the question printed under it. Only Yes/No
    // screening rules read that text: a word like "military" in it must not fill Veteran status.
    return RULES.find((r) => YESNO_KEYS.includes(r.key) && fits(norm(field.label) + ' ' + norm(field.desc))(r));
  }

  // The box's own complete list (a <select>, radio buttons, Yes/No buttons), without "Select...".
  const fixedOptions = (f) => (['select', 'radio', 'choice', 'multi'].includes(f.kind) || (f.kind === 'dropdown' && f.options?.length)
    ? (f.options || []).filter((o) => norm(o) && !PLACEHOLDER.test(String(o).trim())) : []);
  const fitsOptions = (f, v) => {
    const o = fixedOptions(f);
    if (o.length < 2) return true;
    // Tick boxes ("mark all that apply"): one of the answer's parts is a box.
    const parts = f.kind === 'multi' ? String(v).split(/\s*(?:,|;|\n)\s*/).filter(Boolean) : [String(v)];
    return parts.some((x) => pickWith(o, x, altsFor(f)) >= 0);
  };

  // The first rule for the question whose answer is one of the box's options. A word in a long question
  // picks the wrong rule ("...sensitive data, such as gender" -> the gender; "Is current position?" -> the
  // job title; "...work in the region" -> the state): when its answer is not in the list, the next rule
  // that matches is tried, and with none, the question is left for a saved answer or the AI.
  function fittingRule(field, p) {
    const first = ruleFor(field);
    if (!first || fixedOptions(field).length < 2) return first;
    const text = norm(field.label) + ' ' + norm(field.hint);
    const fits = (r) => r.re.test(text) && !(r.ex && r.ex.test(text)) && !r.onlyTextarea;
    for (const r of [first, ...RULES.filter((r) => r !== first && fits(r))]) {
      const v = r.value(p, field);
      if (v == null || v === '' || fitsOptions(field, v)) return r;
    }
    return null;
  }

  function ruleValue(field, p) {
    const none = noneOfCountries(field);
    if (none) return none;
    const r = fittingRule(field, p);
    if (!r) return null;
    const v = r.value(p, field);
    return v == null ? null : String(v);
  }

  const FIELD_NAMES = {
    email: 'email', linkedin: 'LinkedIn', github: 'GitHub', phone: 'phone', firstName: 'first name', lastName: 'last name',
    requiresSponsorship: 'sponsorship answer', workAuthorization: 'work authorization', willingToRelocate: 'relocation answer',
    salaryExpectation: 'salary expectation', noticePeriod: 'notice period', gender: 'gender', hispanic: 'Hispanic/Latino answer',
    ethnicity: 'race/ethnicity', veteran: 'veteran status', disability: 'disability status', address: 'address', county: 'county', zip: 'ZIP code',
    city: 'city', state: 'state', country: 'country', yearsExperience: 'years of experience', headline: 'headline', pronouns: 'pronouns',
    birthday: 'birthday', birthYear: 'birth year',
  };
  const TEXT_KEYS = /^(firstName|lastName|email|phone|linkedin|github|address|zip|city|county|state|country|workCountries|salaryExpectation|noticePeriod|yearsExperience|headline|pronouns)$/;
  // "United States" or "Virginia" saved as the county: a state or country, not a county.
  const notCounty = (v) => {
    const t = norm(v).replace(/\bcounty\b/, '').trim();
    return !t || /^(united states|usa|us|america|canada|united kingdom)$/.test(t) || !!US_STATES[t] || Object.values(US_STATES).includes(t);
  };
  // A value typed into a box is only saved to the profile when it looks like that kind of value: a skill
  // typed into "Preferred country" on another site became Biniam's "countries to work in".
  const NOT_PLACE = /\d|@|https?:|www\.|\b(systems?|engineer(ing)?|developer|development|software|learning|data|science|design|analyst|management|python|java|cloud|ai|ml|devops|frontend|backend|full ?stack)\b/i;
  function plausible(key, v) {
    const t = String(v || '').trim();
    switch (key) {
      case 'email': return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t);
      case 'phone': return !/[a-z]{2}/i.test(t) && t.replace(/\D/g, '').length >= 7;
      case 'linkedin': return /linkedin\.com\//i.test(t);
      case 'github': return /github\.com\//i.test(t);
      case 'zip': return /^[a-z0-9][a-z0-9 -]{2,9}$/i.test(t) && /\d/.test(t);
      case 'yearsExperience': return /^\d{1,2}(\.\d)?\+?(\s*years?)?$/i.test(t);
      case 'salaryExpectation': return /\d/.test(t);
      case 'firstName': case 'lastName': return t.length <= 40 && !/\d|@|https?:/.test(t);
      case 'county': return t.length <= 80 && !NOT_PLACE.test(t) && !notCounty(t);
      case 'city': case 'state': case 'country': case 'workCountries': return t.length <= 80 && !NOT_PLACE.test(t);
      default: return t.length <= 200;
    }
  }
  const YESNO_KEYS = ['requiresSponsorship', 'workAuthorization', 'willingToRelocate', 'over18', 'contactCurrent', 'contactPast',
    'everFired', 'essentialFunctions', 'backgroundCheck', 'drugTest', 'convicted', 'nonCompete', 'relatives', 'workedHereBefore', 'conflictOfInterest', 'clearanceEligible'];
  Object.assign(FIELD_NAMES, {
    over18: '"18 or older" answer', contactCurrent: '"contact current employer" answer', contactPast: '"contact past employers" answer',
    everFired: '"ever fired" answer', essentialFunctions: '"essential functions" answer', backgroundCheck: 'background check answer',
    drugTest: 'drug test answer', convicted: 'conviction answer', nonCompete: 'non-compete answer', relatives: 'relatives answer',
    workedHereBefore: '"worked here before" answer', conflictOfInterest: 'conflict of interest answer', clearanceEligible: 'clearance eligibility answer', workCountries: 'countries to work in', lgbtq: 'LGBTQ+ answer',
  });

  // ---------- Field discovery ----------

  // Open shadow roots, and closed ones too (web components such as SmartRecruiters' boxes may close theirs;
  // an extension can still open them).
  const shadowOf = (el) => {
    if (el.shadowRoot) return el.shadowRoot;
    if (!el.tagName || !el.tagName.includes('-')) return null; // only custom elements get closed roots in practice
    try { return chrome.dom?.openOrClosedShadowRoot?.(el) || null; } catch { return null; }
  };

  // Every shadow root on the page (open, and closed ones of web components), page order. Finding them
  // means walking every element, so one walk serves all the searches made within a moment (a fill makes
  // dozens: inputs, radios, buttons, labels...). JobBid's own UI (toast, button, side panel) is skipped.
  let rootsCache = null;
  function shadowRoots() {
    if (rootsCache && performance.now() - rootsCache.at < 300) return rootsCache.roots;
    const roots = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        // getAttribute, not el.id: a <form> with an input named "id" returns that input.
        if (!el.tagName.includes('-') && !el.shadowRoot) continue;
        if ((el.getAttribute('id') || '').startsWith('jobbid-root')) continue;
        const sr = shadowOf(el);
        if (sr) { roots.push(sr); walk(sr); }
      }
    };
    walk(document);
    rootsCache = { at: performance.now(), roots };
    return roots;
  }

  function deepQueryAll(selector) {
    const out = [...document.querySelectorAll(selector)];
    for (const sr of shadowRoots()) for (const el of sr.querySelectorAll(selector)) out.push(el);
    return out;
  }

  function isVisible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  function byId(el, id) {
    const root = el.getRootNode();
    return (root.getElementById && root.getElementById(id)) || document.getElementById(id);
  }

  // Text of a <label>, without the text of controls inside it (e.g. all <option>s of a wrapped <select>).
  function labelText(lab) {
    if (!lab) return '';
    if (!lab.querySelector('select, textarea, input, button')) return textOf(lab);
    const c = lab.cloneNode(true);
    c.querySelectorAll('select, textarea, input, button, option, [role=listbox]').forEach((x) => x.remove());
    return textOf(c);
  }

  // Readable question text to store in the profile (matching uses answerKey() normalisation).
  const cleanQ = (label) => String(label || '').replace(/\(required\)|\(optional\)/gi, '').replace(/^\s*(error|warning|required)\s*:\s*/i, '')
    .replace(/^\s*select\s+(?=(are|have|has|if|do|does|did|is|was|will|would|can|could|gender|race|ethnicity|veteran|disability|sexual)\b)/i, '')
    .replace(/[←-⯿\u{1F000}-\u{1FAFF}️]/gu, ' ') // icons and emoji the site put in the label (⚑, ★, 🚩...)
    .replace(/\s*\*+\s*$/, '').replace(/^\s*\*+\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 200);

  // A real application question ("Do you now, or will you..., require visa sponsorship?"), not a search
  // filter: later steps of a multi-page application can hold just two of these.
  const isQuestion = (f) => f.kind !== 'file' && (/\?\s*\*?\s*$/.test(f.label || '')
    || /^(do|are|have|will|would|can|could|did|is|were|has)\s+you\b|^(please )?(indicate|confirm|select|describe|explain|list)\b/i.test(cleanQ(f.label)));
  const isForm = (fields) => fields.length >= 3 || fields.filter(isQuestion).length >= 2;

  function labelFor(el) {
    const parts = [];
    const lb = el.getAttribute('aria-labelledby');
    if (lb) parts.push(lb.split(/\s+/).map((id) => textOf(byId(el, id))).join(' '));
    if (el.labels && el.labels.length) parts.push(labelText(el.labels[0]));
    const al = el.getAttribute('aria-label');
    if (al) parts.push(al);
    if (!usefulLabel(parts.join(' '))) {
      const wrap = el.closest('label');
      if (wrap) parts.push(labelText(wrap));
    }
    // Web components (SmartRecruiters spl-input, spl-select...) keep the box in a shadow root and the
    // question on the host element.
    for (let h = el.getRootNode?.().host, i = 0; h && i < 3 && !usefulLabel(parts.join(' ')); h = h.getRootNode?.().host, i++) {
      const t = h.getAttribute('label') || h.getAttribute('aria-label') || labelText(h.labels?.[0]) || (h.id && labelText(h.getRootNode().querySelector?.(`label[for="${CSS.escape(h.id)}"]`)));
      if (t) parts.push(t);
    }
    if (!usefulLabel(parts.join(' '))) {
      const t = precedingText(el);
      if (t) parts.push(t);
    }
    // aria-labelledby and <label> often name the same text: keep it once.
    const uniq = [];
    for (const t of parts.map((x) => stripErrors(x)).filter(usefulLabel)) {
      const k = norm(t);
      if (!uniq.some((u) => norm(u).includes(k))) uniq.push(t);
    }
    const out = uniq.join(' ').slice(0, 300);
    // "Select One Required" is the box's placeholder, not its question: the question is the text above.
    if (placeholderLabel(out)) return precedingText(el) || out;
    return out;
  }

  const placeholderLabel = (t) => {
    const s = norm(t).replace(/\b(required|optional)\b/g, '').replace(/\s+/g, ' ').trim();
    return !s || /^(select|select one|select an option|choose|choose one|choose an option|please select|please choose|pick one|none selected|no selection)$/.test(s);
  };

  // The form's error line ("This field is required.") and a lone "*" are not the question.
  const stripErrors = (t) => String(t || '').replace(/\b(this|the)? ?field is required\.?|\bplease (fill|complete) (in |out )?this field\.?|\brequired field\.?/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s*:\-–]+|[\s:\-–]+$/g, '').trim();
  // A name/id hint says something ("salary expectation") or is just an id ("question b03a4f58 22a7 4081").
  const readableHint = (h) => String(h || '').split(/\s+/).some((w) => /^\p{L}{3,}$/u.test(w) && !/^[0-9a-f]{4,}$/i.test(w)
    && !/^(question|questions|field|fields|input|answer|custom|text|textarea|select|form|value|item|control|spl|screening)$/i.test(w));
  const usefulLabel = (t) => /\p{L}{2}/u.test(stripErrors(t).replace(/\b(required|optional)\b/gi, ''));

  // Nearest text before the field, walking up a few levels (skipping other placeholders), also out of
  // a web component's shadow root to the host's own neighbours.
  function precedingText(el) {
    let n = el;
    for (let i = 0; i < 7 && n; i++) {
      let s = n.previousElementSibling;
      while (s) {
        const t = stripErrors(textOf(s));
        if (t && t.length < 300 && usefulLabel(t) && !s.querySelector('input,select,textarea') && !placeholderLabel(t)) return t;
        s = s.previousElementSibling;
      }
      n = n.parentElement || n.getRootNode?.().host || null;
    }
    return '';
  }

  // The explanation printed under a short heading ("CONFLICT OF INTEREST" + "Do you currently, or have
  // you in the last 5 years, worked for..."). Without it the question can't be answered.
  function describedFor(el) {
    if (!el) return '';
    const ids = (el.getAttribute?.('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const aria = ids.map((id) => textOf(byId(el, id))).join(' ').trim();
    if (aria.length > 8) return aria.slice(0, 400);
    const own = norm(labelFor(el));
    let n = el;
    for (let i = 0; i < 5 && n && n.parentElement; i++, n = n.parentElement) {
      // Stop before a box that also holds the next question.
      if (n.parentElement.querySelectorAll('input:not([type=hidden]), select, textarea').length > 3) break;
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
        if (s.querySelector('input:not([type=hidden]), select, textarea, button')) break;
        const t = textOf(s);
        if (t.length >= 12 && t.length <= 400 && norm(t) !== own && !/^(required|optional|\*)$/i.test(t)) return t;
      }
    }
    return '';
  }

  function hintFor(el) {
    return [el.name, el.id, el.placeholder, el.getAttribute('data-automation-id'), el.getAttribute('autocomplete'), el.getAttribute('data-testid')]
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-[\].]+/g, ' ');
  }

  // Up the page, also out of a web component to its host (SmartRecruiters puts each radio in its own one).
  const composedParent = (n) => n.parentElement || n.getRootNode?.().host || null;
  const composedContains = (a, b) => { for (let n = b; n; n = composedParent(n)) if (n === a) return true; return false; };
  const composedClosest = (el, sel) => { for (let n = el; n; n = composedParent(n)) if (n.matches?.(sel)) return n; return null; };

  function groupQuestion(inputs, optionTexts) {
    const fs = composedClosest(inputs[0], 'fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg && textOf(lg)) return textOf(lg);
    }
    const rg = composedClosest(inputs[0], '[role=radiogroup],[role=group]');
    if (rg) {
      const l = rg.getAttribute('aria-label') || rg.getAttribute('label') || (rg.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => textOf(byId(rg, id))).join(' ');
      if (l && l.trim()) return l.trim();
    }
    let anc = composedParent(inputs[0]);
    while (anc && !inputs.every((r) => composedContains(anc, r))) anc = composedParent(anc);
    for (let i = 0; anc && i < 4; i++, anc = composedParent(anc)) {
      // A component that carries its question as an attribute (<spl-radio-group label="Are you a protected veteran?">).
      const la = anc.getAttribute?.('label') || anc.getAttribute?.('aria-label');
      if (la && usefulLabel(la) && !optionTexts.includes(la.trim())) return la.trim().slice(0, 300);
      let t = textOf(anc);
      for (const o of optionTexts) t = t.replace(o, '');
      t = t.replace(/\s+/g, ' ').trim();
      if (t.length > 2) return t.slice(0, 300);
    }
    return '';
  }

  // Which group a radio belongs to: its name, its radio group / fieldset (also outside a web component), or
  // its parent - for a radio alone in its own component, the component's parent.
  function radioKey(el) {
    if (el.name) return el.name;
    const g = composedClosest(el, '[role=radiogroup],fieldset');
    if (g) return g;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot && root.querySelectorAll('input[type=radio]').length === 1) return composedParent(root.host) || el.parentElement;
    return el.parentElement;
  }

  const SKIP_TYPES = /^(hidden|submit|button|reset|image|password|search|checkbox|range|color)$/;

  // The radio's own row: the biggest box around it that holds no other radio of its group.
  function radioRow(radio, group) {
    let row = radio.parentElement || composedParent(radio);
    for (let up = row && composedParent(row); up && up !== document.body && !group.some((r) => r !== radio && composedContains(up, r)); up = composedParent(up)) row = up;
    return row;
  }
  // The option's words ("Yes"). Some sites (ServiceNow) put them in a span beside the radio with no
  // <label> link, and an empty value: read the radio's row then, never save a blank option.
  // Its own label first, then the radio's row: labelFor alone may fall back to the text above the group,
  // which is the question ("Are you 18 years of age or older?"), not the option ("Yes").
  function radioText(radio, group) {
    const lb = radio.getAttribute('aria-labelledby');
    const own = [radio.labels?.[0] && labelText(radio.labels[0]), radio.closest('label') && labelText(radio.closest('label')), radio.getAttribute('aria-label'),
      lb && lb.split(/\s+/).map((id) => textOf(byId(radio, id))).join(' ')].map((x) => stripErrors(x || '')).find((x) => x && usefulLabel(x) && x.length < 150);
    if (own) return own;
    const row = radioRow(radio, group);
    const rt = row && stripErrors(textOf(row));
    if (rt && rt.length < 120 && usefulLabel(rt)) return rt;
    const v = String(radio.value || '').trim();
    if (v && !/^(on|true|false|\d+)$/i.test(v)) return v;
    const t = labelFor(radio);
    return t && t.length < 120 ? t : v;
  }

  // Native checkboxes that belong together (the nearest box around one that holds others) become one
  // "multi" question. A lone checkbox, and consent / newsletter boxes, are left to their own handling.
  function collectCheckboxLists(fields, boxes, nextId) {
    const groups = new Map();
    for (const b of boxes) {
      let a = b.parentElement;
      while (a && a !== document.body && !boxes.some((o) => o !== b && a.contains(o))) a = a.parentElement;
      if (!a || a === document.body) continue;
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(b);
    }
    for (const els of groups.values()) {
      if (els.length < 2) continue;
      if (fields.some((f) => f.els && f.els.some((e) => els.some((b) => e === b || e.contains(b))))) continue;
      const options = els.map((b) => radioText(b, els));
      if (options.some((o) => !o || o.length > 150)) continue;
      if (options.some((o) => /\b(i agree|agree to|consent|acknowledge|terms|privacy|subscribe|newsletter|text messages?|sms|marketing)\b/i.test(o))) continue;
      const label = groupQuestion(els, options);
      // A "question" that is half the form ("First Name* Middle Name Last Name* ... Email*") is not one list.
      if (label.length > 250 || (label.match(/\*/g) || []).length > 1) continue;
      fields.push({ id: nextId(), kind: 'multi', el: els[0], els, options, label, hint: '', required: els.some((b) => b.required) || /\*/.test(label) });
    }
  }

  // "Are you a citizen of any of these countries?" with a "None of these" item, as a checkbox list:
  // the none item, whatever the question's wording (your own saved answer wins).
  const NONE_ITEM = /\b(do not|don ?t) (hold|have) (a )?citizenship|not a citizen of any|none of (the|these|those) (above|countries|listed)|^none( of the above)?$|\bnot applicable\b/;
  const LISTED_COUNTRIES = /\b(cuba|iran|syria|north korea|democratic people s republic|russia|china|people s republic|belarus|venezuela|burma|myanmar|sudan|eritrea|nicaragua|libya|iraq|afghanistan)\b/;
  function noneOfCountries(f) {
    if (f.kind !== 'multi' && f.kind !== 'choice' && f.kind !== 'radio') return null;
    if (f.options.filter((o) => LISTED_COUNTRIES.test(norm(o))).length < 2) return null;
    return f.options.find((o) => NONE_ITEM.test(norm(o))) || null;
  }

  // ---------- Follow-up questions ----------
  // "If you answered 'yes' above, please provide the name of your manager" / "If yes, please explain" /
  // "If no, why not?": when the question right above got the other answer, this one doesn't apply.
  const FOLLOW_UP = /^(\d+\s*[.)]?\s*)?(\*\s*)?if (you )?(answered|selected|chose|choose|said|checked|responded|marked|clicked)?\s*['"“‘]?(yes|no|so)\b['"”’]?/i;
  // What a field holds now (the text of the chosen option).
  function currentAnswer(f) {
    try {
      if (f.kind === 'select') return f.el.selectedIndex >= 0 && f.el.value !== '' ? f.el.options[f.el.selectedIndex].text.trim() : '';
      if (f.kind === 'radio') { const i = f.els.findIndex((r) => r.checked); return i >= 0 ? f.options[i] : ''; }
      if (f.kind === 'choice') { const i = f.els.findIndex(isPressed); const j = i >= 0 ? i : pressedByStyle(f.els); return j >= 0 ? f.options[j] : ''; }
      if (f.kind === 'multi') return f.options.filter((_, k) => isSelected(f.els[k])).join(', ');
      if (f.kind === 'combobox') { const c = comboShown(f.el); return (typeof c === 'string' ? c : c ? textOf(c) : '') || String(f.el.value || '').trim(); }
      if (f.kind === 'listbox') return textOf(f.el);
      return String(f.el?.value || '').trim();
    } catch { return ''; }
  }
  function followUpNA(f, fields, p, answers) {
    const m = cleanQ(f.label || '').match(FOLLOW_UP) || String(f.label || '').trim().match(FOLLOW_UP);
    if (!m) return null;
    const want = m[5].toLowerCase() === 'no' ? 'no' : 'yes'; // "if so" = yes
    // The closest question before this one on the page.
    const at = (x) => (x.els ? x.els[0] : x.el);
    const before = fields.filter((x) => x !== f && x.kind !== 'file' && at(x) && at(f) && (at(x).compareDocumentPosition(at(f)) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!before.length) return null;
    const prev = before.reduce((a, b) => (at(a).compareDocumentPosition(at(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
    // Its answer now, else the answer it is about to get (it may come later in this fill).
    let got = currentAnswer(prev);
    if (!got || /^(select|choose|please select)/i.test(got)) got = ruleValue(prev, p) || (usefulLabel(prev.label) ? answers[answerKey(prev.label)] : '') || '';
    const n = norm(got);
    const said = /^(no|not|none|never|i am not|i m not|i do not|i don t|i have not|i haven t|i was not|i have never)\b/.test(n) ? 'no' : /^(yes|i am|i have|i do|i was)\b/.test(n) ? 'yes' : '';
    if (!said || said === want) return null;
    if (f.kind === 'select' || f.kind === 'radio' || f.kind === 'choice' || f.kind === 'listbox' || f.kind === 'combobox' || f.kind === 'multi') {
      const opts = f.options || [];
      return opts.find((o) => /^(n\/?a|not applicable|none)\b/i.test(o.trim())) || null;
    }
    return 'N/A';
  }

  // A click the way a mouse makes it (some sites react to pointer/mouse down, not to click alone).
  function mouseClick(el) {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.click();
  }

  // Ticks a radio so the site itself registers it. Setting .checked alone only paints the circle: a React
  // form keeps its own value, clears the circle on its next render and says "Please select an option".
  // Tries the label, the radio, then the option's row, and checks the answer is still there a moment later.
  async function checkRadio(radio, group) {
    const lab = radio.labels?.[0] || radio.closest('label');
    const row = radioRow(radio, group);
    const tries = [...new Set([isVisible(radio) || !lab ? radio : lab, lab, radio, row].filter(Boolean))];
    const held = async () => { await sleep(250); return radio.checked; };
    for (const t of tries) {
      if (radio.type === 'checkbox' && radio.checked) return true; // a second click would untick it
      t === radio ? radio.click() : mouseClick(t);
      if (await held()) return true;
    }
    // Last resort: set it the way React notices (native setter, then a click event it listens to).
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(radio, true);
    radio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    radio.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    radio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return await held();
  }

  function collectFields() {
    const fields = [];
    let n = 0;
    const radioGroups = new Map();
    const boxes = [];
    const els = deepQueryAll('input, textarea, select, button[aria-haspopup="listbox"]');
    for (const el of els) {
      if (el.closest('#jobbid-root') || el.disabled || el.readOnly) continue;
      // The site's own job search in its header ("Search for job title or keyword") is not the form.
      // Only a whole search form or the page header/menu: a search-style question box (Workday) is still filled.
      if (el.closest('form[role=search], header, nav')) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (tag === 'input' && type === 'file') {
        fields.push({ id: 'f' + n++, kind: 'file', el, label: labelFor(el), hint: hintFor(el) + ' ' + (el.accept || '') });
        continue;
      }
      if (tag === 'input' && type === 'radio') {
        // Many sites hide the real radio and style its label as a button.
        const lab = el.labels?.[0] || el.closest('label');
        if (!isVisible(el) && !(lab && isVisible(lab))) continue;
        const key = radioKey(el);
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
        continue;
      }
      // Checkbox lists ("Select all that apply", a list of countries): grouped after the loop.
      if (tag === 'input' && type === 'checkbox') {
        const lab = el.labels?.[0] || el.closest('label');
        if (isVisible(el) || (lab && isVisible(lab))) boxes.push(el);
        continue;
      }
      // A search-style dropdown that has a choice shrinks its text box to a sliver: look at its box instead.
      const ctl = el.getAttribute('role') === 'combobox' && el.closest('[class*="control" i]');
      if (!isVisible(el) && !(ctl && isVisible(ctl))) continue;
      if (tag === 'button') {
        fields.push({ id: 'f' + n++, kind: 'listbox', el, label: labelFor(el), hint: hintFor(el), required: el.getAttribute('aria-required') === 'true' });
        continue;
      }
      if (tag === 'input' && SKIP_TYPES.test(type) && !(type === 'search' && isPromptBox(el))) continue;
      if (tag === 'input' && type === 'radio') {
        const key = radioKey(el);
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
        continue;
      }
      const required = el.required || el.getAttribute('aria-required') === 'true';
      const base = { id: 'f' + n++, el, label: labelFor(el) || (el.placeholder || el.getAttribute('aria-placeholder') || '').trim(), hint: hintFor(el), required };
      if (tag === 'select') {
        const opts = [...el.options].filter((o) => o.value !== '' && !/^(select|choose|please|--)/i.test(o.text.trim()));
        fields.push({ ...base, kind: 'select', options: opts.map((o) => o.text.trim()) });
      } else if (tag === 'textarea') {
        fields.push({ ...base, kind: 'textarea' });
      } else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') {
        fields.push({ ...base, kind: 'combobox' });
      } else {
        fields.push({ ...base, kind: type === 'number' ? 'number' : type === 'date' ? 'date' : 'text' });
      }
    }
    collectChoiceGroups(fields, () => 'f' + n++);
    collectIconGroups(fields, () => 'f' + n++);
    collectCustomDropdowns(fields, () => 'f' + n++);
    for (const radios of radioGroups.values()) {
      const optionTexts = radios.map((r) => radioText(r, radios));
      fields.push({
        id: 'f' + n++,
        kind: 'radio',
        els: radios,
        el: radios[0],
        options: optionTexts,
        label: groupQuestion(radios, optionTexts),
        hint: radios[0].name || '',
        // Required: the radio says so, its group does, or the question shows a "*" ("1 * . Are you 18...").
        required: radios.some((r) => r.required || r.getAttribute('aria-required') === 'true') || radios[0].closest('[role=radiogroup][aria-required=true]') != null
          || /\*/.test(groupQuestion(radios, optionTexts)),
      });
    }
    collectCheckboxLists(fields, boxes, () => 'f' + n++);
    for (const f of fields) if (f.kind !== 'file') f.desc = describedFor(f.els ? f.els[0].closest('[role=radiogroup], fieldset') || f.els[0].parentElement : f.el);
    return fields;
  }

  // ARIA radios (role=radio) and plain button groups such as [Yes] [No].
  const CHOICE_WORDS = /^(yes|no|y|n|true|false|maybe|n\/a|not applicable|decline|prefer not to (say|answer)|i don.t know|none)$/;

  // A Yes/No button's words: its text, else (web components like ADP's sdf-radio-button) its label attribute.
  const choiceText = (e) => textOf(e) || e.getAttribute('aria-label') || e.getAttribute('label') ||
    // ZipRecruiter: an empty round button named by a separate label (aria-labelledby).
    (e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => textOf(byId(e, id))).join(' ') || (/^[a-z ]{1,20}$/i.test(e.getAttribute('value') || '') ? e.getAttribute('value') : '') || '';

  function isPressed(b) {
    if (b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true') return true;
    return /(^|[\s_-])(active|selected|checked|is-selected|is-active|pressed|on)([\s_-]|$)/i.test(typeof b.className === 'string' ? b.className : '');
  }

  // Some sites show the chosen answer only by color: the one box whose background differs
  // from both its siblings and the container is the selected one.
  function pressedByStyle(els) {
    const bg = (e) => getComputedStyle(e).backgroundColor;
    const clear = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    let anc = els[0].parentElement;
    while (anc && clear(bg(anc))) anc = anc.parentElement;
    const base = anc ? bg(anc) : 'rgb(255, 255, 255)';
    const colors = els.map(bg);
    const odd = colors.map((c, i) => !clear(c) && c !== base && colors.filter((x, j) => j !== i).every((x) => x !== c));
    return odd.filter(Boolean).length === 1 && els.length > 1 ? odd.indexOf(true) : -1;
  }

  function collectChoiceGroups(fields, nextId) {
    const groups = new Map();
    const add = (container, el) => {
      // Elements at the top of a shadow root have no parentElement: group them by the shadow root itself.
      container ||= el.parentNode;
      if (!container) return;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(el);
    };
    for (const el of deepQueryAll('[role=radio]')) {
      if (el.tagName === 'INPUT' || el.closest('#jobbid-root') || !isVisible(el)) continue;
      add(el.closest('[role=radiogroup]') || el.parentElement, el);
    }
    for (const el of deepQueryAll('button, [role=button]')) {
      // A <button> with no type counts as "submit" (Ashby's Yes/No): only real submit buttons are skipped.
      const submit = el.type === 'submit' && (el.getAttribute('type') === 'submit' || !CHOICE_WORDS.test(norm(textOf(el))));
      if (el.closest('#jobbid-root, nav, header, footer, [role=dialog] [aria-label*=close i]') || submit || el.getAttribute('role') === 'radio') continue;
      if (el.hasAttribute('aria-haspopup') || !isVisible(el)) continue;
      const t = norm(textOf(el));
      if (t && t.length <= 30) add(el.parentElement, el);
    }
    // Yes/No boxes built from plain divs/spans/labels (no <button>, no radio input).
    const boxes = new Set();
    for (const el of deepQueryAll('div, span, label, li, a, p')) {
      if (el.textContent.length > 30 || el.childElementCount > 3) continue;
      const t = norm(textOf(el));
      if (!t || !CHOICE_WORDS.test(t)) continue;
      if (el.closest('button, [role=button], [role=radio], select, option, #jobbid-root')) continue;
      if (el.querySelector('input, select, textarea') || el.closest('label')?.querySelector('input')) continue;
      // The clickable box is the outermost element that still contains only this answer.
      let box = el;
      while (box.parentElement && norm(textOf(box.parentElement)) === t && !box.parentElement.matches('form, fieldset, body')) box = box.parentElement;
      if (boxes.has(box) || !isVisible(box)) continue;
      // The label of a real radio / checkbox (Workday: <input id=x> + <label for=x>Yes</label>, side by side):
      // that question is already the radio group. A second copy here is checked as "nothing pressed".
      if (box.querySelector('input, select, textarea')) continue;
      const forId = el.closest('label')?.htmlFor;
      if (forId && byId(el, forId)?.matches?.('input')) continue;
      boxes.add(box);
      add(box.parentElement, box);
    }
    for (const [container, els] of groups) {
      if (els.length < 2 || els.length > 12) continue;
      const options = els.map((e) => choiceText(e));
      const isAria = els[0].getAttribute('role') === 'radio';
      // Plain buttons only count when they look like answers, not toolbars or navigation.
      if (!isAria && !options.every((o) => CHOICE_WORDS.test(norm(o)))) continue;
      // Several [Yes][No] pairs in one box are separate questions. One group would click only the first Yes.
      const chunks = splitChoicePairs(els);
      for (const chunk of chunks) {
        const opts = chunk.map((e) => choiceText(e));
        const label = (chunk.length === els.length && container?.getAttribute?.('aria-label')) || questionNear(chunk, opts) || groupQuestion(chunk, opts);
        fields.push({
          id: nextId(),
          kind: 'choice',
          el: chunk[0],
          els: chunk,
          options: opts,
          label: String(label || '').slice(0, 300),
          hint: '',
          required: container?.getAttribute?.('aria-required') === 'true' || /\*\s*$/.test(label || ''),
        });
      }
    }
  }

  // [Yes][No] [Yes][No] in the same parent: one pair per question.
  function splitChoicePairs(els) {
    const words = els.map((e) => norm(choiceText(e)));
    if (els.length < 4 || els.length % 2) return [els];
    const pairs = [];
    for (let i = 0; i < els.length; i += 2) {
      const a = words[i], b = words[i + 1];
      if (!((a === 'yes' && b === 'no') || (a === 'no' && b === 'yes'))) return [els];
      pairs.push(els.slice(i, i + 2));
    }
    return pairs;
  }

  // The sentence just above this pair, not the other questions in the same form.
  function questionNear(els, optionTexts) {
    let prev = els[0].previousElementSibling;
    while (prev) {
      const t = textOf(prev).replace(/\s+/g, ' ').trim();
      if (t.length > 8 && !optionTexts.some((o) => norm(o) === norm(t))) return t.slice(0, 300);
      prev = prev.previousElementSibling;
    }
    const parent = els[0].parentElement;
    if (parent) {
      const before = [];
      for (const n of parent.childNodes) {
        if (n === els[0] || (n.nodeType === 1 && els.some((e) => e === n || e.contains(n)))) break;
        const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) before.push(t);
      }
      const t = before.join(' ').trim();
      if (t.length > 8) return t.slice(0, 300);
    }
    return groupQuestion(els, optionTexts);
  }


  // ---------- Custom dropdowns ("Select ▾" built from divs) ----------

  const PLACEHOLDER = /^(select|choose|choose one|select one|select an option|please select|please choose|pick one|--|-- select --|- select -|— select —)(\.\.\.|…)?$/i;
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const dropdownRegistry = new Map(); // trigger -> field, for learning what the user picks

  function dropdownQuestion(trigger, placeholder) {
    let anc = trigger.parentElement;
    for (let i = 0; anc && i < 5; i++, anc = anc.parentElement) {
      const t = textOf(anc).replace(textOf(trigger), '').replace(placeholder, '').replace(/\s+/g, ' ').trim();
      if (t.length > 2) return t.slice(0, 300);
    }
    return '';
  }

  function collectCustomDropdowns(fields, nextId) {
    const seen = new Set();
    for (const el of deepQueryAll('div, span, p, button, [role=button], [role=combobox]')) {
      if (el.closest('#jobbid-root, select, option, [role=option], [role=listbox]')) continue;
      const t = (ownText(el) || (el.children.length === 0 ? textOf(el) : '')).replace(/[▾▼⌄˅]/g, '').trim();
      if (!t || !PLACEHOLDER.test(t) || !isVisible(el)) continue;
      const trigger = el.closest('[role=combobox], [aria-haspopup], button, [role=button], [tabindex]') || el.parentElement;
      if (!trigger || seen.has(trigger)) continue;
      seen.add(trigger);
      // Inputs (react-select etc.) and native selects next to it are handled as normal fields.
      if (trigger.querySelector('input:not([type=hidden]), select') || trigger.parentElement?.querySelector('select')) continue;
      if (fields.some((f) => f.el && (f.el === trigger || trigger.contains(f.el) || f.el.contains?.(trigger)))) continue;
      const label = dropdownQuestion(trigger, t);
      const f = { id: nextId(), kind: 'dropdown', el: trigger, label, hint: hintFor(trigger), options: null,
        required: trigger.getAttribute('aria-required') === 'true' || /\*/.test(label) || /^\s*\*/.test(textOf(trigger.parentElement || trigger)) };
      dropdownRegistry.set(trigger, f);
      fields.push(f);
    }
  }

  function popupCandidates() {
    return deepQueryAll('[role=option], [role=menuitem], [role=menuitemradio], li, [class*="option" i], [class*="item" i]')
      .filter((e) => !e.closest('#jobbid-root') && isVisible(e) && !e.querySelector('[role=option], li'))
      .filter((e) => { const t = textOf(e); return t.length > 0 && t.length < 80; });
  }

  function pressOn(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  async function openDropdown(trigger) {
    const before = new Set(popupCandidates());
    pressOn(trigger);
    await sleep(450);
    let opts = popupCandidates().filter((e) => !before.has(e) && !PLACEHOLDER.test(textOf(e)));
    if (!opts.length) opts = visibleOptions();
    return opts;
  }

  // Inside a pop-up window (ZipRecruiter / LinkedIn apply windows): there Escape means "close the window"
  // ("Are you sure you want to exit?"). A dialog role, or any fixed-position box around the field.
  function inPopupWindow(el) {
    if (composedClosest(el, '[role=dialog], [role=alertdialog], [aria-modal=true], dialog')) return true;
    for (let n = el, k = 0; n && n !== document.body && k < 40; n = composedParent(n), k++) {
      if (n.nodeType === 1 && getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }

  // Close the list a box opened. Escape only when a list is open and the box is not in a pop-up window;
  // otherwise leaving the box (blur) closes it, which never closes the page's own windows.
  function closeList(el) {
    if (!el) return;
    const open = el.getAttribute?.('aria-expanded') === 'true' || visibleOptions().length > 0;
    if (!open) return;
    if (!inPopupWindow(el)) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    else { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); el.blur?.(); }
  }

  async function closeDropdown(trigger) {
    // Never Escape on the whole page: that closes pop-up windows, not just the list.
    closeList(trigger);
    if (document.activeElement && document.activeElement !== trigger && document.activeElement !== document.body) closeList(document.activeElement);
    await sleep(150);
    if (popupCandidates().some((e) => !trigger.contains(e) && e.getBoundingClientRect().top > 0) && PLACEHOLDER.test(textOf(trigger))) pressOn(trigger);
  }

  // Reads the choices of a custom dropdown (so the AI / Saved answers can see them), then closes it.
  async function probeCombo(f) {
    const el = f.el;
    const control = el.closest('[class*="control" i]') || el;
    el.focus();
    for (const type of ['mousedown', 'mouseup']) control.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    if (f.kind === 'listbox') el.click();
    else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    await sleep(500);
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const lb = id && (el.getRootNode().getElementById?.(id) || document.getElementById(id));
    const opts = (lb ? [...lb.querySelectorAll('[role="option"], .select__option, [role="row"]')] : visibleOptions()).filter(isVisible);
    // A chosen item shown as a chip ("Cursor ✕") is not one of the options.
    const chip = (o) => /[✕×✖⨯]\s*$/.test(textOf(o)) || o.closest?.('[class*="chip" i],[class*="tag" i],[class*="pill" i],[class*="token" i]');
    f.options = [...new Set(opts.filter((o) => !chip(o)).map(textOf).filter((t) => t && !PLACEHOLDER.test(t)))].slice(0, 60);
    closeList(el);
    el.blur();
    await sleep(150);
    return f.options;
  }

  async function probeDropdown(f) {
    const opts = await openDropdown(f.el);
    f.options = [...new Set(opts.map(textOf))].slice(0, 60);
    await closeDropdown(f.el);
    return f.options;
  }

  // ---------- Multi-select icon groups (e.g. country flags) ----------

  const ISO = { us: 'United States', ca: 'Canada', gb: 'United Kingdom', uk: 'United Kingdom', au: 'Australia', ie: 'Ireland', nz: 'New Zealand',
    de: 'Germany', fr: 'France', nl: 'Netherlands', es: 'Spain', it: 'Italy', pl: 'Poland', pt: 'Portugal', se: 'Sweden', no: 'Norway',
    dk: 'Denmark', fi: 'Finland', ch: 'Switzerland', at: 'Austria', be: 'Belgium', in: 'India', sg: 'Singapore', ae: 'United Arab Emirates',
    mx: 'Mexico', br: 'Brazil', jp: 'Japan', il: 'Israel', za: 'South Africa', ph: 'Philippines', cz: 'Czech Republic', ro: 'Romania',
    ua: 'Ukraine', ar: 'Argentina', co: 'Colombia', cn: 'China', hk: 'Hong Kong', kr: 'South Korea', tw: 'Taiwan', lu: 'Luxembourg' };
  const COUNTRIES = [...new Set(Object.values(ISO))];

  function flagEmoji(s) {
    const m = String(s || '').match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
    if (!m) return '';
    const code = [...m[0]].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 97)).join('');
    return ISO[code] || '';
  }

  function countryFrom(text, allowCode) {
    const n = norm(text);
    if (!n) return '';
    if (allowCode && ISO[n]) return ISO[n];
    return COUNTRIES.find((c) => ` ${n} `.includes(` ${norm(c)} `)) || flagEmoji(text);
  }

  function countryOf(clickable, icon) {
    const attrs = (e) => e ? [e.getAttribute?.('aria-label'), e.getAttribute?.('title'), e.getAttribute?.('alt'), e.getAttribute?.('data-value'),
      e.getAttribute?.('data-country'), e.getAttribute?.('data-code'), e.querySelector?.('title')?.textContent] : [];
    for (const c of [...attrs(clickable), ...attrs(icon)]) {
      const name = countryFrom(c, true);
      if (name) return name;
    }
    const visible = countryFrom(textOf(clickable), false); // full names / flag emoji only - "No" is not Norway
    if (visible) return visible;
    // File names / classes such as flags/us.svg, flag-icon-ca, fi fi-gb.
    const src = [icon?.getAttribute?.('src'), icon?.getAttribute?.('href'), icon?.getAttribute?.('xlink:href'),
      icon?.className?.baseVal ?? icon?.className, clickable.className?.baseVal ?? clickable.className].filter(Boolean).join(' ').toLowerCase();
    const tokens = src.split(/[^a-z]+/).filter(Boolean).reverse();
    return tokens.map((t) => (t.length === 2 ? ISO[t] : COUNTRIES.find((c) => norm(c).replace(/ /g, '') === t))).find(Boolean) || '';
  }

  function clickableFor(el) {
    const c = el.closest('button, [role=button], [role=checkbox], [role=option], label, a, [tabindex]');
    if (c) return c;
    let n = el;
    for (let i = 0; n && i < 3; i++, n = n.parentElement) if (getComputedStyle(n).cursor === 'pointer') return n;
    return null;
  }

  function isSelected(e) {
    return e.checked === true || isPressed(e) || !!e.querySelector?.('input:checked') || e.getAttribute?.('data-selected') === 'true' || e.getAttribute?.('data-state') === 'on';
  }

  function collectIconGroups(fields, nextId) {
    const groups = new Map();
    const used = new Set();
    for (const icon of deepQueryAll('img, svg, [class*="flag" i], span, button, [role=button], [role=checkbox]')) {
      const isIcon = /^(img|svg)$/i.test(icon.tagName) || /flag/i.test(icon.className?.baseVal ?? icon.className ?? '');
      if (!isIcon && !(icon.children.length === 0 && flagEmoji(icon.textContent))) continue;
      if (icon.closest('#jobbid-root') || !isVisible(icon)) continue;
      const c = clickableFor(icon);
      if (!c || used.has(c)) continue;
      const name = countryOf(c, isIcon ? icon : null);
      if (!name) continue;
      used.add(c);
      const key = c.parentElement;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ el: c, name });
    }
    for (const items of groups.values()) {
      if (items.length < 2) continue;
      const els = items.map((x) => x.el);
      const options = items.map((x) => x.name);
      fields.push({ id: nextId(), kind: 'multi', el: els[0], els, options, label: groupQuestion(els, options), hint: '',
        required: /\*/.test(groupQuestion(els, options)) });
    }
  }

  // Search-style dropdowns (react-select: Greenhouse, Lever, Ashby...) keep their text box empty and show
  // the chosen option in a separate element next to it. This reads that shown choice.
  function comboShown(el) {
    // Walk up from the text box until the shown choice turns up (stop at the dropdown's own box).
    // ExtJS "boxselect" (Teradata): the choice is a tag <li class="x-boxselect-display-item"><span class="text">Male</span>.
    const SHOWN = '[class*="single-value" i], [class*="singleValue" i], [class*="selected-value" i], [class*="select-value" i], [class*="multi-value__label" i], [class*="multiValue" i] [class*="label" i], [class*="boxselect-display-item" i] .text';
    let v = null;
    for (let n = el.parentElement, k = 0; n && k < 5 && !v; n = n.parentElement, k++) {
      v = n.querySelector(SHOWN);
      if (/control/i.test(n.className || '')) break;
    }
    const t = v ? textOf(v) : '';
    return t && !PLACEHOLDER.test(t) ? t : '';
  }

  // A Location / City box the site filled itself with another city than the profile's (from the visitor's
  // internet address, "Burlingame, California", or from the resume it read): replaced with the profile's.
  function otherCity(f, p) {
    const city = norm(cityOnly(p));
    if (city.length < 3 || !f.el) return false;
    const rule = fittingRule(f, p);
    if (!rule || !(rule.key === 'city' || /^current location/.test(rule.re?.source || ''))) return false;
    const shown = f.kind === 'combobox' ? comboShown(f.el) || String(f.el.value || '') : String(f.el.value || '');
    return !!norm(shown) && !` ${norm(shown)} `.includes(` ${city} `);
  }

  function hasValue(f) {
    if (f.kind === 'combobox' && f.el && comboShown(f.el)) return true;
    // A search-style dropdown with nothing chosen: typed search text is not an answer.
    // Only react-select boxes ("select__control", "css-1abc-control"): their input holds search text, never the
    // answer. Not SuccessFactors' "fd-input-group--control" or Bootstrap's "form-control": their box shows the answer.
    if (f.kind === 'combobox' && f.el && f.el.closest('[class*="__control" i], [class*="css-" i][class*="-control" i]') && countChips(f.el) === 0) return false;
    if ((f.kind === 'text' || f.kind === 'combobox') && f.el && countChips(f.el) > 0) return true; // tag input with chips
    // Workday search list: answered only by a chosen item (chip), never by typed text.
    if ((f.kind === 'text' || f.kind === 'combobox') && isPromptBox(f.el)) {
      const box = f.el.closest('[data-automation-id="multiSelectContainer"], [data-uxi-widget-type]') || f.el.parentElement?.parentElement || f.el.parentElement;
      return !!box?.querySelector('[data-automation-id="selectedItem"], [data-automation-id*="selectedItem" i], [data-automation-id="DELETE_charm"]');
    }
    if (f.kind === 'choice') return f.els.some(isPressed) || pressedByStyle(f.els) >= 0;
    if (f.kind === 'multi') return f.els.some(isSelected);
    if (f.kind === 'dropdown') return !PLACEHOLDER.test(textOf(f.el).replace(/[▾▼⌄˅]/g, '').trim());
    if (f.kind === 'radio') return f.els.some((r) => r.checked);
    // Some sites (Greenhouse) read the file and then clear the input: remember what JobBid attached.
    if (f.kind === 'file') return (f.el.files && f.el.files.length > 0) || attachedFiles.has(f.el);
    if (f.kind === 'select') return f.el.selectedIndex > 0 && f.el.value !== '';
    if (f.kind === 'listbox') return !/^(select|choose|--)/i.test(textOf(f.el)) && textOf(f.el) !== '';
    return String(f.el.value || '').trim() !== '';
  }

  // ---------- Value matching & setting ----------

  const ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u s', 'america'],
    ['united kingdom', 'uk', 'great britain', 'england'],
    ['mobile', 'mobile phone', 'cell', 'cell phone', 'cellular'],
    ['decline', 'prefer not', 'not wish', 'don t wish', 'do not wish', 'choose not', 'not to say', 'not to disclose', 'not to answer', 'decline to self identify'],
    ['man', 'male'],
    ['woman', 'female'],
    ['bachelor', 'bachelors', 'bachelor s', 'bs', 'b s', 'bsc', 'ba', 'b a', 'undergraduate'],
    ['master', 'masters', 'master s', 'msc', 'm s', 'mba', 'graduate degree'],
    ['phd', 'ph d', 'doctorate', 'doctoral'],
    ['associate', 'associates', 'associate s'],
    ['high school', 'ged', 'secondary school'],
  ];
  // A searchable list often filters as you type: "Man" hides "Male", so the other word is tried next.
  const hasWord = (text, a) => ` ${text} `.includes(` ${a} `);
  function searchTerms(value) {
    const raw = String(value || '').trim();
    const terms = [raw.split(/[,(]/)[0].trim().slice(0, 30), raw.split(/\s+/)[0]];
    const v = norm(raw);
    for (const group of ALIASES) {
      if (group.length > 2 || !group.includes(v)) continue;
      for (const a of group) if (a !== v) terms.push(a);
    }
    return [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  }

  // US state codes, so "NJ" in a profile picks "New Jersey" in a Region/State list (and back).
  const US_STATES = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
    de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana',
    ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
    mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey',
    nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
    ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia',
    wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', pr: 'puerto rico' };

  // "Little Falls Township, NJ" -> city "little falls", state "nj" / "new jersey". Location lists word
  // places their own way ("Little Falls, New Jersey, United States"), so plain text matching misses them.
  const PLACE_FILLER = /\b(township|twp|city of|town of|village of|borough of|boro|charter township)\b/g;
  function placeParts(value) {
    const [city = '', region = ''] = String(value || '').split(',').map((s) => s.trim());
    const st = norm(region);
    const code = US_STATES[st] ? st : Object.keys(US_STATES).find((k) => US_STATES[k] === st) || '';
    return { city: norm(city).replace(PLACE_FILLER, ' ').replace(/\s+/g, ' ').trim(), code, full: code ? US_STATES[code] : st };
  }
  // The option for that place: same city (whole words, at the start), same state when the value has
  // one; one in the United States first. -1 when none fits.
  function placeIndex(options, value) {
    const { city, code, full } = placeParts(value);
    if (city.length < 3) return -1;
    const has = (o, w) => w && ` ${o} `.includes(` ${w} `);
    let best = -1, bestScore = 0;
    options.forEach((raw, i) => {
      const o = norm(raw).replace(PLACE_FILLER, ' ').replace(/\s+/g, ' ').trim();
      if (!(o === city || o.startsWith(city + ' '))) return;
      const stateOk = !code && !full ? true : has(o, code) || has(o, full);
      if (!stateOk) return;
      const score = 1 + (/\b(united states|usa|us)\b/.test(o) ? 1 : 0) + (o.split(' ').length < city.split(' ').length + 6 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }
  // No exact place in the results: the most similar one in the same state (shared city words first,
  // then one in the US). Used only on a list we searched with this city.
  function placeClosest(options, value) {
    const { city, code, full } = placeParts(value);
    const cw = city.split(' ').filter((w) => w.length > 2);
    let best = -1, bestScore = 0;
    options.forEach((raw, i) => {
      const o = ` ${norm(raw)} `;
      const words = cw.filter((w) => o.includes(` ${w} `)).length;
      const state = (code && o.includes(` ${code} `)) || (full && o.includes(` ${full} `)) ? 1 : 0;
      // Another state is another place ("Little Rock, Arkansas" for Little Falls, NJ).
      if (!state) return;
      const score = words * 2 + state * 3 + (/ (united states|usa|us) /.test(o) ? 1 : 0) - (o.trim().startsWith(cw[0] || '\u0000') ? 0 : 0.5);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }
  const placeSearch = (v) => String(v).split(',')[0].replace(/\b(township|twp|charter township)\b/gi, '').replace(/^(city|town|village|borough) of\s+/i, '').replace(/\s+/g, ' ').trim();
  const looksLikePlace = (v) => /^[^,\d]{2,40},\s*[A-Za-z .]{2,30}$/.test(String(v || '').trim()) && !!placeParts(v).code;

  // "7" against "0 - 1 Years" … "7 - 15 Years" / "Over 15 Years". A number on the shared edge
  // (7 is both the end of 4-7 and the start of 7-15) belongs to the range that starts there.
  // "$120k" / "120,000" / "7" -> a number.
  const NUM = String.raw`\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?`;
  const toNum = (d, k) => parseFloat(String(d).replace(/,/g, '')) * (k ? 1000 : 1);
  // The one number in an answer ("7", "7 years", "about 7", "$150,000"), or null.
  function answerNumber(value) {
    const s = String(value ?? '').trim();
    if (s.length > 40) return null;
    const all = [...s.matchAll(new RegExp(NUM, 'gi'))];
    return all.length === 1 ? toNum(all[0][1], all[0][2]) : null;
  }
  // An option as a range: "4 - 7 Years", "7-15", "15+", "Over 15", "Less than 1 year", "3 years".
  function parseRange(raw) {
    const s = String(raw).replace(/[–—−~]/g, '-').replace(/\bto\b/gi, '-').replace(/\s+/g, ' ').trim();
    let mm;
    if ((mm = s.match(new RegExp(`${NUM}\\s*-\\s*${NUM}`, 'i')))) return { lo: toNum(mm[1], mm[2] || mm[4]), hi: toNum(mm[3], mm[4]) };
    if ((mm = s.match(new RegExp(`${NUM}\\s*(?:\\+|or more|and (?:above|over|up)|plus)`, 'i')))) return { min: toNum(mm[1], mm[2]) };
    if ((mm = s.match(new RegExp(`(?:over|more than|greater than|above|at least)\\s*${NUM}`, 'i')))) return /at least/i.test(s) ? { min: toNum(mm[1], mm[2]) } : { above: toNum(mm[1], mm[2]) };
    if ((mm = s.match(new RegExp(`(?:under|less than|below|fewer than|up to)\\s*${NUM}`, 'i')))) return { below: toNum(mm[1], mm[2]) };
    if ((mm = s.match(new RegExp(`^${NUM}\\s*(?:years?|yrs?\\.?)?$`, 'i')))) return { exact: true, lo: toNum(mm[1], mm[2]), hi: toNum(mm[1], mm[2]) };
    return null;
  }

  function rangeChoice(options, value) {
    const n = answerNumber(value);
    if (n == null) return -1;
    const parsed = options.map(parseRange);
    const exact = parsed.findIndex((r) => r?.exact && r.lo === n);
    if (exact >= 0) return exact;
    const holds = (r) => r && (r.above != null ? n > r.above : r.min != null ? n >= r.min : r.below != null ? n < r.below : r.lo != null && n >= r.lo && n <= r.hi);
    const hits = parsed.map((r, idx) => ({ r, idx })).filter((x) => holds(x.r));
    if (!hits.length) return -1;
    const started = hits.find((x) => (x.r.lo === n || x.r.min === n) && x.r.above == null);
    if (started && hits.length > 1) return started.idx;
    hits.sort((a, b) => ((a.r.hi ?? Infinity) - (a.r.lo ?? 0)) - ((b.r.hi ?? Infinity) - (b.r.lo ?? 0)));
    return hits[0].idx;
  }

  // No option is the answer: the most similar one. A number goes to the nearest range
  // ("7" with only "1-3", "4-6", "10+" -> "4-6"); text goes to the option with the most in common.
  // "Decline / prefer not" is only chosen when the answer says so.
  function closestOption(options, value) {
    if (!options.length || value == null || String(value).trim() === '') return -1;
    const usable = options.map((o) => { const t = norm(o); return !!t && !PLACEHOLDER.test(String(o).trim()); });
    const n = answerNumber(value);
    if (n != null) {
      const parsed = options.map(parseRange);
      if (parsed.filter(Boolean).length >= 2) {
        const dist = (r) => {
          if (!r) return Infinity;
          if (r.above != null) return n > r.above ? 0 : r.above - n + 0.5;
          if (r.min != null) return n >= r.min ? 0 : r.min - n;
          if (r.below != null) return n < r.below ? 0 : n - r.below + 0.5;
          return n < r.lo ? r.lo - n : n > r.hi ? n - r.hi : 0;
        };
        let best = -1;
        parsed.forEach((r, i) => { if (usable[i] && dist(r) < Infinity && (best < 0 || dist(r) < dist(parsed[best]))) best = i; });
        if (best >= 0) return best;
      }
    }
    const v = norm(value);
    const declineOk = /decline|prefer not|not wish|not to (say|answer|disclose)/.test(v);
    const grams = (t) => { const s = ` ${t} `; const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
    const vg = grams(v);
    const vw = new Set(v.split(' ').filter((w) => w.length > 2));
    let best = -1, bestScore = 0;
    options.forEach((o, i) => {
      if (!usable[i]) return;
      const t = norm(o);
      if (!declineOk && /decline|prefer not|not wish|not to (say|answer|disclose)/.test(t)) return;
      const og = grams(t);
      let common = 0;
      for (const g of vg) if (og.has(g)) common++;
      const dice = (2 * common) / (vg.size + og.size || 1);
      const ow = t.split(' ').filter((w) => w.length > 2);
      const words = ow.length ? ow.filter((w) => vw.has(w)).length / Math.max(ow.length, vw.size || 1) : 0;
      const score = Math.max(dice, words);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return bestScore >= 0.35 ? best : -1;
  }

  // The option to choose: the matching one, else the most similar one.
  const pickIndex = (options, value) => {
    const i = bestOption(options, value);
    return i >= 0 ? i : closestOption(options, value);
  };

  function bestOption(options, value) {
    let v = norm(value);
    if (!v) return -1;
    const ns = options.map(norm);
    let i = ns.indexOf(v);
    if (i >= 0) return i;
    i = rangeChoice(options, value);
    if (i >= 0) return i;
    if (US_STATES[v]) { i = ns.indexOf(US_STATES[v]); if (i >= 0) return i; }
    const code = Object.keys(US_STATES).find((k) => US_STATES[k] === v);
    if (code) { i = ns.indexOf(code); if (i >= 0) return i; }
    // Of the options that match, the closest one: "United States" is "United States of America",
    // not "United States Minor Outlying Islands" that comes first in the list.
    const closest = (ok) => {
      let best = -1;
      ns.forEach((o, k) => { if (ok(o) && (best < 0 || o.length < ns[best].length)) best = k; });
      return best;
    };
    for (const group of ALIASES) {
      if (group.some((a) => hasWord(v, a))) {
        i = ns.findIndex((o) => group.includes(o));
        if (i >= 0) return i;
        i = closest((o) => group.some((a) => a.length > 2 && hasWord(o, a)) && !/outlying|minor|virgin/.test(o));
        if (i >= 0) return i;
      }
    }
    // "No, I do not have a disability" / "I am not a protected veteran" -> a plain "No" option, and vice versa.
    // "I identify as a Veteran, just not a Protected Veteran" is a veteran (not a "no"): a non-veteran
    // takes "I am not a Veteran." The options that start with the "no" come first.
    const startsNo = (t) => /^(no|not|none|i am not|i m not|i do not|i don t|i have not|i haven t|i was not|negative|false)\b/.test(t);
    const polarity = (t) => startsNo(t) || (/\bnot a protected\b/.test(t) && !/identify as (a|one)|^i am a\b/.test(t)) ? 'no'
      : /^(yes|i am|i m|i have|i do|i identify|i was|true|positive|i agree|i consent|i accept)\b/.test(t) ? 'yes' : '';
    const pv = polarity(v);
    if (pv) {
      i = ns.findIndex((o) => o === pv || o.split(' ')[0] === pv);
      if (i >= 0) return i;
      if (pv === 'no') { i = ns.findIndex((o) => startsNo(o) && !/decline|prefer|wish/.test(o)); if (i >= 0) return i; }
      i = ns.findIndex((o) => polarity(o) === pv && !/decline|prefer|wish/.test(o));
      if (i >= 0) return i;
    }
    i = closest((o) => o.startsWith(v));
    if (i >= 0) return i;
    i = closest((o) => o.length > 1 && (o.includes(v) || (v.includes(o) && o.length > 3)));
    if (i >= 0) return i;
    // Small spelling differences: "American Indian or Alaska Native" vs "...Alaskan Native".
    const words = (t) => t.split(' ').filter((w) => w.length > 2 && !/^(the|and|or|of|for|not)$/.test(w));
    const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
    const vw = words(v);
    if (vw.length < 2) return -1;
    let best = -1, bestScore = 0;
    ns.forEach((o, k) => {
      const ow = words(o);
      if (!ow.length) return;
      const hit = vw.filter((a) => ow.some((b) => same(a, b))).length;
      const score = hit / Math.max(vw.length, ow.length);
      if (score > bestScore) { bestScore = score; best = k; }
    });
    return bestScore >= 0.75 ? best : -1;
  }

  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    // composed: also seen by a web component around a box in its shadow root (SmartRecruiters).
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function visibleOptions() {
    // Oracle Recruiting's cx-select lists its suggestions as rows of a grid (role=grid, row, gridcell).
    return deepQueryAll('[role="option"], li[data-automation-id="promptOption"], .select__option, [role="grid"][id*="listbox" i] [role="row"], .cx-select__list [role="row"]')
      .filter(isVisible);
  }

  // Search-style dropdowns (react-select and similar): open the list, click the best option. Typing is
  // only a fallback, and nothing "leaves" the field before the click - these dropdowns close and clear
  // themselves when they lose focus.
  // composed: the event also leaves a shadow root, so web components (SmartRecruiters' city search)
  // that listen on their host element see the typing and start searching.
  function typeNoBlur(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: text.slice(-1) || 'Backspace', bubbles: true, composed: true }));
  }

  // Type like a person: keydown, beforeinput, the character, input, keyup for every letter. For boxes
  // that ignore a value set all at once (confirm-email boxes that block pasting).
  async function typeKeys(el, text, keepFocus = false) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    for (const ch of String(text)) {
      const k = { key: ch, bubbles: true, composed: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', k));
      el.dispatchEvent(new KeyboardEvent('keypress', k));
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: ch }));
      setter.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', k));
      await sleep(8);
    }
    if (keepFocus) return; // a search box: its suggestion list must stay open
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Help lines in a suggestion list are not places ("Cannot find your city? Click here to fill in manually").
  const HELP_LINE = /cannot find|can't find|not (in|on) the list|click here|fill (it )?in manually|enter (it )?manually|no results|searching|loading/i;

  // Short lines of text shown just under the box (the deepest element holding each line), also inside
  // shadow roots: suggestion lists that don't use role="option".
  function optionsNear(el) {
    const box = el.getBoundingClientRect();
    const seen = new Set();
    return deepQueryAll('[role="option"], li, [class*="option" i], [class*="result" i] div, [class*="suggest" i] div, [class*="dropdown" i] div, [class*="autocomplete" i] div, [class*="menu" i] div, [class*="pac-item" i]')
      .filter((o) => {
        if (o.closest('#jobbid-root') || !isVisible(o) || o.contains(el)) return false;
        const t = textOf(o);
        if (!t || t.length > 120 || seen.has(o) || HELP_LINE.test(t)) return false;
        if ([...o.children].some((c) => textOf(c) === t)) return false; // a deeper element has the same text
        const r = o.getBoundingClientRect();
        const below = r.top >= box.top && r.top < box.bottom + 450;
        const across = r.right > box.left - 200 && r.left < box.right + 50;
        if (!below || !across) return false;
        seen.add(o);
        return true;
      });
  }

  // Waits until the page stops changing (no new elements or text for `quiet` ms), at most `max` ms.
  // Used instead of fixed pauses while a list opens or loads: almost all fill time was waiting (measured:
  // JavaScript work is 10-80 ms of a 1-8 s fill), and a list that is ready after 40 ms is now read then.
  function settle(max, quiet = 60, min = 0) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      let qt = 0;
      const done = () => { clearTimeout(qt); clearTimeout(mt); mo.disconnect(); setTimeout(resolve, Math.max(0, min - (Date.now() - t0))); };
      const mo = new MutationObserver((recs) => {
        if (recs.every((r) => r.target.closest?.('#jobbid-root, #jobbid-root-panel'))) return; // our own UI
        clearTimeout(qt);
        qt = setTimeout(done, quiet);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      qt = setTimeout(done, quiet);
      const mt = setTimeout(done, Math.max(quiet, max));
    });
  }

  // "Chicago" -> "Chicago, IL, US" rather than "Chicago Lawn, IL, US": the city part equals the answer.
  const sameCityIndex = (texts, value) => {
    const city = norm(String(value).split(',')[0]);
    return city.length < 3 ? -1 : texts.findIndex((x) => norm(String(x).split(',')[0]) === city);
  };
  // Why a search dropdown was not filled ("the list never opened" / "not among 12 choices"), shown with
  // the problem on the hub's Problems page.
  const comboWhy = new WeakMap();
  // The dropdown's own arrow button: the one that names the same list (Oracle's cx-select:
  // <button aria-controls="country-17-listbox" class="icon-dropdown-arrow">).
  function listToggle(el, strict = false) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const root = el.getRootNode();
    const own = id && [...(root.querySelectorAll ? root.querySelectorAll('button, [role=button]') : [])]
      .find((b) => b !== el && b.getAttribute('aria-controls') === id);
    if (own || strict) return own || null;
    const box = el.closest('[class*="container" i], [class*="control" i]');
    return box?.querySelector('button[class*="arrow" i], button[class*="toggle" i], button[aria-label^="open" i]') || null;
  }
  async function comboPick(el, value) {
    if (el.disabled) return false; // locked by the site (see siteGaveUp)
    let seenMost = 0; // the most choices the list showed
    const control = el.closest('[class*="control" i]') || el.parentElement;
    el.focus();
    for (const type of ['mousedown', 'mouseup']) control.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    // Only this dropdown's own list (another dropdown's list may still be open on the page).
    const ownOptions = () => {
      const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const lb = id && (el.getRootNode().getElementById?.(id) || document.getElementById(id));
      const inBox = (root) => {
        const role = [...root.querySelectorAll('[role="option"], .select__option, [class*="option" i]:not([class*="options" i]), [role="row"]')]
          .filter((o) => isVisible(o) && textOf(o).length < 120 && !o.querySelector('[role="option"], [role="row"]'));
        return role;
      };
      if (lb) { const own = inBox(lb); if (own.length) return own; }
      // The nearest box around this field that holds the open list ("input-container" does not).
      let box = control.parentElement;
      for (let i = 0; box && i < 5; i++, box = box.parentElement) {
        if (box.querySelectorAll('input:not([type=hidden]), select, textarea').length > 1) break;
        const own = inBox(box);
        if (own.length) return own;
      }
      const std = visibleOptions();
      return std.length ? std : optionsNear(el);
    };
    // Lists that search online (cities) need a moment after typing: look a few times.
    // closest: the full list is open, so the most similar option may be chosen ("7" -> "7 - 15 Years").
    // A list filtered by typing is not used for that: it may hold only unrelated leftovers.
    const tryPick = async (tries = 1, closest = false) => {
      let opts = [], i = -1, prev = null, loading = false;
      // The time it may take: what `tries` fixed looks took before (350 ms, then 450 ms each). A list that is
      // still loading (Greenhouse's Degree / School / Discipline come from its server) gets up to 3 s.
      const start = Date.now();
      let budget = 350 + (tries - 1) * 450;
      let changedAt = start;
      for (let t = 0; i < 0; t++) {
        const left = start + budget - Date.now();
        if (t && left <= 0) break;
        await settle(t ? Math.min(450, left) : 350);
        opts = ownOptions();
        seenMost = Math.max(seenMost, opts.length);
        const now = opts.map(textOf).join('|');
        if (now !== prev) changedAt = Date.now();
        // An empty list is "loading" unless the list says it found nothing ("No options", "No results").
        const notice = [...document.querySelectorAll('[class*="menu-notice" i], [class*="no-options" i], [class*="no-results" i], [class*="loading" i]')].filter(isVisible).map(textOf).join(' ');
        loading = /loading|searching|please wait/i.test(notice) || (!opts.length && !/no (options|results|matches)|nothing found|not found/i.test(notice))
          || /loading|searching|please wait|type to search|\.\.\.$|…$/i.test(now);
        // Up to 3 s for a list that says it is loading. Before anything is typed (the first look), an empty list
        // without such a notice is usually a search box waiting for text: about 1 s, then the typing starts.
        const saysLoading = /loading|searching|please wait/i.test(notice) || /loading|searching|please wait|\.\.\.$|…$/i.test(now);
        if (loading) budget = Math.max(budget, closest && !saysLoading ? 700 : 350 + 6 * 450);
        // The same real list for 0.9 s without the answer: it's done, more waiting won't help.
        if (!place && !loading && t >= 1 && now === prev && Date.now() - changedAt >= 900) break;
        prev = now;
        // Short fixed lists only: in a long search list (cities) "most similar" would be a wrong place.
        i = closest && opts.length <= 15 ? pickIndex(opts.map(textOf), value) : sameCityIndex(opts.map(textOf), value);
        if (i < 0 && !(closest && opts.length <= 15)) i = bestOption(opts.map(textOf), value);
        if (i < 0 && place) i = placeIndex(opts.map(textOf), value);
        // After typing the city, once the results had a moment to load: the most matching one.
        if (i < 0 && place && !closest && Date.now() - start >= 1250) i = placeClosest(opts.map(textOf), value);
      }
      if (i < 0) return false;
      await chooseRow(opts[i], i);
      return true;
    };
    // Clicked on the row's innermost box (Oracle's cx-select listens on the cell inside the row, and an event
    // sent to the row never reaches it). If the list is still open with the row in it, the click did not
    // count: Arrow Down to the row (the box names the highlighted row), then Enter - Oracle takes that too.
    const chooseRow = async (opt, i) => {
      opt.scrollIntoView({ block: 'nearest' });
      let target = opt;
      while (target.children.length === 1 && textOf(target.children[0]) === textOf(target)) target = target.children[0];
      const at = target.getBoundingClientRect();
      const xy = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: at.left + Math.min(10, at.width / 2), clientY: at.top + at.height / 2 };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...xy, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(type, xy));
      }
      await sleep(150);
      const stillOpen = opt.isConnected && isVisible(opt) && el.getAttribute('aria-expanded') !== 'false';
      // A box the site locked takes no keys (a person couldn't type there either).
      const locked = el.disabled || el.closest('[aria-disabled="true"], [class*="is-disabled" i]');
      if (!stillOpen || locked) return;
      el.focus();
      const highlighted = () => opt.id && el.getAttribute('aria-activedescendant') === opt.id;
      for (let k = 0; k <= i && k < 80 && !highlighted(); k++) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
        await sleep(25);
      }
      // The box names its highlighted row, and it is another one: don't press Enter on the wrong answer.
      if (opt.id && el.getAttribute('aria-activedescendant') && !highlighted()) return;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(150);
    };
    const place = looksLikePlace(value);
    let ok = await tryPick(1, true);
    // Still closed, and it has an arrow button that names its list: open the list with it first (quicker
    // than typing into a closed box and waiting for choices that never come).
    const pressToggle = (t) => { for (const type of ['mousedown', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })); el.focus(); };
    let toggled = false;
    if (!ok && !seenMost && !el.disabled) {
      const own = listToggle(el, true);
      if (own) { pressToggle(own); toggled = true; ok = await tryPick(1, true); }
    }
    // Long lists (countries, cities): type the start of the answer to narrow it down, then pick.
    // A place is searched by its city without "Township" ("Little Falls"), which location lists know.
    for (const q of ok ? [] : [...(place ? [placeSearch(value)] : []), ...searchTerms(value)]) {
      if (!q) continue;
      if (el.disabled) break;
      typeNoBlur(el, q);
      // Online search lists (cities) need a few seconds; lists that filter what they hold are instant.
      if ((ok = await tryPick(place ? 7 : 3))) break;
    }
    // Nothing showed up at all: some lists open only from their arrow button (Oracle's Country, Title,
    // Degree). Press it, look, then type the answer into the open list.
    if (!ok && !seenMost && !toggled && !el.disabled) {
      const toggle = listToggle(el);
      if (toggle) {
        typeNoBlur(el, '');
        pressToggle(toggle);
        ok = await tryPick(3);
        for (const q of ok ? [] : searchTerms(value).slice(0, 2)) {
          if (!q) continue;
          typeNoBlur(el, q);
          if ((ok = await tryPick(3))) break;
        }
      }
    }
    // Last try with the keyboard: type the answer, the list highlights its match, Enter picks it.
    // Kept only if what is shown afterwards is the answer.
    if (!ok) {
      typeNoBlur(el, String(value).trim().slice(0, 40));
      await sleep(500);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      await sleep(250);
      const shown = comboShown(el);
      if (shown && bestOption([shown], value) === 0) ok = true;
      else if (shown) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));
    }
    await sleep(200);
    if (!ok) typeNoBlur(el, '');
    if (!ok) comboWhy.set(el, seenMost ? `"${String(value).slice(0, 60)}" is not among the ${seenMost} choices the list showed` : 'The list never opened (no choices appeared)');
    else comboWhy.delete(el);
    // Close this list so it can't get in the way of the next dropdown.
    closeList(el);
    el.blur();
    await sleep(100);
    return !!comboShown(el) || (ok && !!String(el.value || '').trim());
  }

  // Text boxes that search as you type (Location: "Chicago" -> "Chicago, IL, USA"). The site only
  // accepts the place once a suggestion is clicked.
  function suggestsPlaces(f) {
    const el = f.el;
    if (el.getAttribute('aria-autocomplete') || el.getAttribute('list') || el.getAttribute('role') === 'combobox') return true;
    if (/location|\bcity\b|town|address|where (are|do) you (live|reside|based)/.test(norm(f.label + ' ' + f.hint)) && !/e-?mail|ip address/.test(norm(f.label))) return true;
    // "State: Enter State ▾" / "Country: Type location ▾": a search box with a list arrow (a plain state
    // text box has no list, so picking a suggestion there just finds none and keeps the typed text).
    return /\bstate\b|province|country|region|nationality/.test(norm(f.label)) && !/united states|statement/.test(norm(f.label)) && hasListArrow(el);
  }

  // A text box drawn as a dropdown: an arrow / caret next to it, or a list it says it opens.
  function hasListArrow(el) {
    if (el.getAttribute('aria-haspopup') || el.getAttribute('aria-expanded') != null || el.getAttribute('aria-controls')) return true;
    let box = el.parentElement;
    for (let i = 0; box && i < 3; i++, box = box.parentElement) {
      if (box.querySelectorAll('input:not([type=hidden]), select, textarea').length > 1) break;
      if (box.querySelector('[class*="arrow" i], [class*="caret" i], [class*="chevron" i], [class*="dropdown" i], [class*="indicator" i], [class*="toggle" i]')) return true;
      if (/dropdown|autocomplete|typeahead|combo|select|picker/i.test(String(box.className?.baseVal ?? box.className ?? ''))) return true;
    }
    return false;
  }

  async function pickSuggestion(el, value) {
    // Some sites search on key presses, not on the input event.
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'o', bubbles: true, composed: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
    const nearby = () => optionsNear(el);
    const first = norm(String(value).split(/[,(]/)[0]);
    const place = looksLikePlace(value);
    let seen = false, retyped = false, shortened = false;
    const start = Date.now();
    // The same steps as before, by time instead of by fixed 350 ms pauses (looks again as soon as the list changes).
    for (let t = 0; Date.now() - start < 5000; t++) {
      const ms = Date.now() - start;
      // "Little Falls Township, NJ" finds nothing on many sites: search the city alone ("Little Falls").
      if (place && !shortened && ms >= 2200 && el.value !== placeSearch(value)) { shortened = true; setNative(el, placeSearch(value)); el.focus(); }
      // No list at all yet: the site may search only on real key presses. Type it again, key by key.
      if (!seen && !retyped && ms >= 1500) { retyped = true; await typeKeys(el, place ? placeSearch(value) : String(el.value || value), true); }
      // No list at all after ~2.6 s (and typing it key by key): this box has no suggestions.
      if (!seen && ms >= 2600) return false;
      await settle(t ? 350 : 500);
      const opts = nearby();
      if (!opts.length) continue;
      seen = true;
      const texts = opts.map(textOf);
      let i = sameCityIndex(texts, value);
      if (i < 0) i = bestOption(texts, value);
      if (i < 0 && place) i = placeIndex(texts, value);
      if (i < 0) i = texts.findIndex((x) => norm(x).startsWith(first));
      if (i < 0 && place && Date.now() - start >= 1900) i = placeClosest(texts, value);
      if (i < 0) continue;
      opts[i].scrollIntoView({ block: 'nearest' });
      for (const type of ['mousedown', 'mouseup', 'click']) opts[i].dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
      await sleep(250);
      return true;
    }
    return false;
  }

  // The answer, else the first fallback the list has; the loosest match only without fallbacks.
  const pickWith = (texts, value, alts = []) => {
    let i = bestOption(texts, value);
    for (const a of alts) if (i < 0) i = bestOption(texts, a);
    return i >= 0 || alts.length ? i : closestOption(texts, value);
  };

  // Workday lists can be nested: "Job Board" opens a second list ("LinkedIn", "Indeed"...). Each level
  // is picked the same way until the list closes.
  async function pickFromPopup(value, alts = []) {
    let picked = false, prev = '';
    for (let level = 0; level < 3; level++) {
      await settle(level ? 450 : 500);
      const opts = visibleOptions();
      const texts = opts.map(textOf);
      if (!opts.length || texts.join('|') === prev) return picked;
      const i = pickWith(texts, value, alts);
      if (i < 0) return picked;
      opts[i].scrollIntoView({ block: 'nearest' });
      opts[i].click();
      picked = true;
      prev = texts.join('|');
    }
    return picked;
  }

  function toDateInput(v) {
    const s = String(v).trim();
    // "Immediately" / "ASAP" for "Date available to start": today.
    if (/^(immediately|immediate|asap|as soon as possible|right away|now|today|any ?time)\b/i.test(s)) {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    // Full dates first (birthday), then the month/year values used by experience dates.
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = s.match(/(\d{1,2})\/(\d{4})/) || s.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    return m[1].length === 4 ? `${m[1]}-${m[2]}-01` : `${m[2]}-${m[1].padStart(2, '0')}-01`;
  }

  // ---------- Tag inputs ("Skills": type a skill, press Enter -> it becomes a chip) ----------

  const CHIP_SEL = '[class*="tag" i], [class*="chip" i], [class*="token" i], [class*="pill" i], [class*="multi-value" i], [class*="multiValue" i], [class*="badge" i], [class*="selected-item" i]';

  // The field's own box: climb at most 3 levels, but never into a container holding other fields
  // (otherwise chips of a neighbouring field would count).
  function tagBox(el) {
    let box = el.parentElement;
    for (let i = 0; i < 3 && box && !box.querySelector(CHIP_SEL); i++) {
      const up = box.parentElement;
      if (!up || up.querySelectorAll('input:not([type=hidden]), textarea, select').length > 1) break;
      box = up;
    }
    return box || el.parentElement;
  }

  // A field the site just removed or re-rendered (ADP does this) has no box any more: no chips.
  const countChips = (el) => {
    const box = el && tagBox(el);
    return box ? [...box.querySelectorAll(CHIP_SEL)].filter((c) => c !== el && !c.contains(el) && textOf(c)).length : 0;
  };

  // Skills / tags / keywords fields, or any input that already sits among chips.
  function isTagField(f) {
    if (f.kind !== 'text' && f.kind !== 'combobox') return false;
    const t = norm(f.label + ' ' + f.hint);
    if (/describe|explain|tell us|years|level|summary/.test(t)) return false;
    return /\b(skills?|tags?|keywords?|technolog(y|ies)|tech stack|tools|competenc(y|ies)|expertise|languages you)\b/.test(t) || countChips(f.el) > 0;
  }

  function pressEnter(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  async function fillTags(f, value) {
    const el = f.el;
    const items = [...new Set(String(value).split(/\s*[,;\n]\s*/).map((s) => s.trim()).filter(Boolean))].slice(0, 15);
    if (!items.length) return false;
    let added = 0;
    for (const item of items) {
      const before = countChips(el);
      el.focus();
      setNative(el, item);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: item.slice(-1), bubbles: true }));
      await sleep(250);
      // A suggestion list? Pick the matching option; otherwise press Enter to commit the tag.
      const opts = visibleOptions();
      const i = opts.length ? bestOption(opts.map(textOf), item) : -1;
      if (i >= 0) pressOn(opts[i]);
      else pressEnter(el);
      await sleep(200);
      const committed = countChips(el) > before || el.value.trim() === '';
      if (committed) { added++; continue; }
      if (!added) {
        // Not a tag input after all (Enter did nothing): put the whole list in as text.
        setNative(el, items.join(', '));
        return true;
      }
      setNative(el, ''); // the site refused this one (unknown skill or a limit): skip it
    }
    if (el.value && !added) setNative(el, '');
    return added > 0;
  }

  // Workday search lists ("How Did You Hear About Us?" with the ☰ icon): typed text is not an answer, only
  // a result clicked from the list (it then shows as a chip).
  const isPromptBox = (el) => el?.tagName === 'INPUT' && (el.getAttribute('data-automation-id') === 'searchBox'
    || !!el.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="multiselect"], [data-uxi-widget-type="selectinput"]'));

  // fn() every 0.15 s until it gives something, at most ms; then its last result.
  async function waitFor(fn, ms) {
    const end = performance.now() + ms;
    for (;;) {
      const v = fn();
      if (v || performance.now() >= end) return v;
      await sleep(150);
    }
  }

  async function promptPick(f, value) {
    const el = f.el;
    const alts = altsFor(f);
    const box = el.closest('[data-automation-id="multiSelectContainer"], [data-uxi-widget-type]') || el.parentElement?.parentElement || el.parentElement;
    const chips = () => box.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id*="selectedItem" i], [data-automation-id="DELETE_charm"]').length;
    const before = chips();
    const done = (text) => chips() > before || (!String(el.value || '').trim() && norm(textOf(box)).includes(norm(text)));
    const results = () => deepQueryAll('[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]')
      .filter((o) => isVisible(o) && !o.closest('#jobbid-root') && textOf(o).length < 120);
    // Search: the answer first, then its alternatives ("LinkedIn", "Job Board"...). Each step checks every
    // 0.15 s instead of a fixed wait: quick when Workday is quick, patient when it is slow.
    for (const term of [value, ...alts.filter((a) => norm(a) !== norm(value))].slice(0, 4)) {
      el.focus();
      setNative(el, term);
      pressEnter(el);
      const opts = (await waitFor(() => { const r = results(); return r.length ? r : null; }, 1800)) || [];
      const i = pickWith(opts.map(textOf), value, alts);
      if (i >= 0) {
        const text = textOf(opts[i]);
        mouseClick(opts[i]);
        // The chip can take over a second to appear: until then it is not a failure.
        if (await waitFor(() => done(text) || chips() > before, 2000)) { el.blur(); return true; }
      }
      if (chips() > before) { el.blur(); return true; }
      setNative(el, '');
    }
    // Nothing found by searching: open the whole list and walk it (nested: "Job Board" > "LinkedIn").
    el.focus();
    mouseClick(el);
    await sleep(500);
    if (await pickFromPopup(value, alts)) { if (await waitFor(() => chips() > before, 2000)) { el.blur(); return true; } }
    closeList(el);
    return chips() > before;
  }

  async function apply(f, value) {
    if (value == null || String(value).trim() === '') return false;
    value = String(value);
    try {
      if ((f.kind === 'text' || f.kind === 'combobox') && isPromptBox(f.el)) return await promptPick(f, value);
      if (isTagField(f)) return await fillTags(f, value);
      switch (f.kind) {
        case 'text':
          // Saved answers and AI answers too: no "+1" when the form asks for the code separately.
          if (isPhoneField(f) && hasPhoneCodeField()) value = nationalNumber(value);
          // A state search box: "Illinois" finds the state, "IL" usually doesn't.
          if (/^[A-Za-z]{2}$/.test(value.trim()) && US_STATES[value.trim().toLowerCase()] && /\bstate\b|province|region/.test(norm(f.label)) && suggestsPlaces(f) && !(f.el.maxLength > 0 && f.el.maxLength <= 3))
            value = US_STATES[value.trim().toLowerCase()].replace(/\b\w/g, (c) => c.toUpperCase());
          setNative(f.el, fixUrl(f, value));
          // Some boxes ("Confirm your email") refuse a pasted value and empty themselves: type it key by key.
          await sleep(/confirm|re-?enter|repeat|verify|again/i.test(f.label) ? 350 : 60);
          if (String(f.el.value) !== String(fixUrl(f, value))) await typeKeys(f.el, fixUrl(f, value));
          if (!String(f.el.value).trim()) return false; // still empty: left red for you, not marked filled
          if (suggestsPlaces(f)) {
            const picked = await pickSuggestion(f.el, value);
            // A State / Country list box with nothing picked: the site throws the typed text away ("Field is
            // required"), so it stays red for you instead of counting as filled.
            if (!picked && /\bstate\b|province|country|region|nationality/.test(norm(f.label)) && hasListArrow(f.el)) {
              // A list that opens on a click (ADP), not on typing: open it and pick from the whole list.
              setNative(f.el, '');
              mouseClick(f.el);
              const abbr = Object.keys(US_STATES).find((k) => US_STATES[k] === norm(value));
              if (await pickFromPopup(value, abbr ? [abbr.toUpperCase()] : [])) return true;
              closeList(f.el);
              return false;
            }
          }
          return true;
        case 'textarea':
          setNative(f.el, value);
          return true;
        case 'number': {
          const num = value.match(/-?\d+(\.\d+)?/);
          if (!num) return false;
          setNative(f.el, num[0]);
          return true;
        }
        case 'date': {
          let d = toDateInput(value);
          if (!d) return false;
          // A start date saved on an earlier form is in the past by now: today instead.
          const today = toDateInput('today');
          if (d < today && /start|availab|join|begin/.test(norm(f.label + ' ' + f.hint))) d = today;
          setNative(f.el, d);
          return true;
        }
        case 'select': {
          const opts = [...f.el.options];
          const i = pickWith(opts.map((o) => o.text), value, altsFor(f));
          if (i < 0) return false;
          setNative(f.el, opts[i].value);
          return true;
        }
        case 'dropdown': {
          const opts = await openDropdown(f.el);
          const i = pickWith(opts.map(textOf), value, altsFor(f));
          if (i < 0) { await closeDropdown(f.el); return false; }
          opts[i].scrollIntoView({ block: 'nearest' });
          pressOn(opts[i]);
          await sleep(150);
          return true;
        }
        case 'multi': {
          const wanted = String(value).split(/\s*(?:,|;|\/|\band\b|\n)\s*/).filter(Boolean);
          let ok = false;
          for (const w of wanted) {
            const i = bestOption(f.options, w);
            if (i < 0) continue;
            ok = true;
            if (isSelected(f.els[i])) continue;
            if (f.els[i].type === 'checkbox') ok = (await checkRadio(f.els[i], f.els)) && ok;
            else { pressOn(f.els[i]); await sleep(120); }
          }
          return ok;
        }
        case 'choice': {
          const i = pickIndex(f.options, value);
          if (i < 0) return false;
          const el = f.els[i];
          // Segmented Yes/No pills listen for a real click, including the label inside the button.
          pressOn(el);
          if (!isPressed(el) && pressedByStyle(f.els) !== i) el.click();
          await sleep(80);
          return true;
        }
        case 'radio': {
          const i = pickIndex(f.options, value);
          if (i < 0) return false;
          return await checkRadio(f.els[i], f.els);
        }
        case 'combobox':
          return comboPick(f.el, value);
        case 'listbox': {
          f.el.click();
          // Only a box that no longer says "Select One" was really filled (not marked done otherwise).
          if (await pickFromPopup(value, altsFor(f))) {
            await sleep(250);
            if (!/^(select|choose|--)/i.test(textOf(f.el)) && textOf(f.el) !== '') return true;
          }
          closeList(f.el);
          return false;
        }
      }
    } catch (e) {
      console.warn('[JobBid] fill failed', f.label, e);
      if (f.el) applyErrors.set(f.el, String(e?.message || e));
    }
    return false;
  }

  const fillSource = new WeakMap();
  const sourceOf = (f) => fillSource.get(f.el);

  function mark(f, how) {
    if (f.el) fillSource.set(f.el, how);
    const el = f.kind === 'radio' || f.kind === 'choice' || f.kind === 'multi' ? f.els[0].closest('fieldset,[role=radiogroup]') || f.els[0].parentElement : f.el;
    if (!el || !el.style) return;
    const color = { rule: '#16a34a', ai: '#7c3aed', missing: '#dc2626', file: '#0284c7' }[how];
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = '2px';
    el.title = { rule: 'Filled by JobBid from profile', ai: 'Filled by JobBid AI - please review', missing: 'Required - JobBid could not fill this', file: 'Resume attached by JobBid' }[how];
  }

  // ---------- Answer templates (the user's own texts, with the company filled in) ----------
  // Built-in kinds recognise common open questions; custom templates match the user's own keywords.
  const TEMPLATE_KINDS = {
    whyCompany: /\b(why|what)\b.{0,80}\b(interest|excit|draw|attract|motivat|appeal|passion|want to (work|join|be part)|join(ing)?|apply(ing)?)\b|\binterested in (working|joining)\b|\bwhy (do you want to|would you like to) (work|join)\b/,
    aboutMe: /\btell (us|me) (a bit |a little )?about (yourself|you)\b|\bintroduce yourself\b|\b(brief|short) (summary|overview) of (yourself|your (background|experience|career))\b|\bdescribe yourself\b/,
    coverNote: /\b(anything else|additional information|additional comments|other information) .{0,40}(know|share|add)|\bcover (letter|note)\b|\bmessage to (the )?(hiring|recruit)/,
  };
  // The question asks for the candidate's own words: never sent to AI.
  const NO_AI = /\b(no|without|not use|don'?t use|do not use)\b.{0,25}\b(generative |gen |)ai\b|\bin your own words\b|\buse your own words\b|\bnot (be )?(written|generated) by ai\b|\bai[- ]generated (answers|responses) (will|are)\b/i;

  // Page company names often come from the address ("voltus"): make them look right.
  const niceCompany = (c) => (c && c === c.toLowerCase() ? c.replace(/\b[a-z]/g, (x) => x.toUpperCase()) : c || '');

  function fillTemplate(text, p, job) {
    const years = String(p.yearsExperience || '').replace(/\D+$/, '');
    return String(text || '')
      .replace(/\{company\}/gi, niceCompany(job.company) || 'your company')
      .replace(/\{role\}/gi, (job.title || 'this role').replace(/\s*[-|–—]\s*.*$/, '').trim())
      .replace(/\{myName\}/gi, p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' '))
      .replace(/\{myTitle\}/gi, p.headline || p.currentTitle || '')
      .replace(/\{years\}/gi, years || '')
      .replace(/\{skills\}/gi, (p.skills || []).slice(0, 3).join(', '));
  }

  // The user's template for this question, already filled in (or '').
  function templateFor(f, p, job) {
    if (f.kind !== 'textarea' && f.kind !== 'text') return '';
    const q = norm(f.label || '');
    if (!q) return '';
    for (const t of p.answerTemplates || []) {
      if (!String(t.text || '').trim()) continue;
      const hit = t.kind && TEMPLATE_KINDS[t.kind] ? TEMPLATE_KINDS[t.kind].test(q)
        : String(t.keywords || '').split(',').map((k) => norm(k)).filter(Boolean).some((k) => q.includes(k));
      if (hit) return fillTemplate(t.text, p, job);
    }
    return '';
  }
  const noAiQuestion = (f) => NO_AI.test(`${f.label || ''} ${f.hint || ''}`);

  // ---------- Answer chosen questions with AI (from the side panel) ----------
  // The user clicked an unanswered question (or "Answer with AI"): ask the AI for just those fields,
  // fill them, mark them purple to review, and remember reusable answers.
  // Small groups of questions, each question with its own id. A long list used to go out as one
  // request, so one failure (or a closed message) dropped every answer that was still queued; now a
  // failed group is asked again question by question.
  let aiChain = Promise.resolve();
  const afterAI = (job) => {
    const run = aiChain.then(job, job);
    aiChain = run.then(() => {}, () => {});
    return run;
  };
  // ChatGPT's page labels, status lines, and the footer ("ChatGPT is AI and can make mistakes.
  // Check important info.") are not answers. Older versions saved them into the form.
  const NOT_AN_ANSWER = /^\s*((chatgpt|you)\s+said:?|(chatgpt\s+is\s+)?(responding|thinking|typing|writing|generating|searching|reasoning|analy[sz]ing|working|loading)(\s+the\s+web)?|thought\s+for\s+[\w\s.]+|stopped\s+thinking|check important info\.?)[\s:.…]*$/i;
  const CHATGPT_DISCLAIMER = /chatgpt(?:'s)?(?:\s+is(?:\s+an?)?\s+ai(?:\s+and)?)?\s+can make mistakes/i;
  function usableAnswer(v) {
    let s = String(v ?? '').trim();
    const at = s.search(CHATGPT_DISCLAIMER);
    if (at >= 0) s = s.slice(0, at).trim();
    s = s.replace(/\n?\s*check important info\.?\s*$/i, '').trim();
    // The folded-question buttons ("…", "Show more") that slipped in with an answer.
    s = s.split(/\r?\n/).filter((l) => !/^\s*(show (more|less)|\.{2,}|…+)\s*$/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return s && !NOT_AN_ANSWER.test(s) ? s : '';
  }

  // The box the user is typing in right now (also inside shadow roots), with the caret position.
  function focusNow() {
    let a = document.activeElement;
    while (a && shadowOf(a)?.activeElement) a = shadowOf(a).activeElement;
    if (!a || a === document.body || a.closest?.('#jobbid-root') || a.id === 'jobbid-root') return null;
    let start = null, end = null;
    try { start = a.selectionStart; end = a.selectionEnd; } catch {}
    return { el: a, start, end, x: window.scrollX, y: window.scrollY };
  }
  function focusBack(saved) {
    if (!saved?.el?.isConnected) return;
    saved.el.focus({ preventScroll: true });
    try { if (saved.start != null) saved.el.setSelectionRange(saved.start, saved.end); } catch {}
    window.scrollTo(saved.x, saved.y);
  }
  // The same question on the page now (the site may have redrawn its box while the AI was working).
  // The box's own name/id comes first: several boxes can share one label text.
  // One page scan serves every redrawn box for a moment (the AI's answers land together).
  let liveCache = null;
  const liveField = (f) => {
    if (f.el?.isConnected) return f;
    if (!liveCache || performance.now() - liveCache.at > 1500 || liveCache.fields.some((x) => !x.el?.isConnected)) liveCache = { at: performance.now(), fields: collectFields() };
    const all = liveCache.fields.filter((x) => x.kind === f.kind);
    const sameHint = f.hint && all.filter((x) => x.hint === f.hint);
    if (sameHint?.length === 1) return sameHint[0];
    const sameLabel = all.filter((x) => x.label === f.label && (!f.hint || x.hint === f.hint || !sameHint?.length));
    return sameLabel.length === 1 ? sameLabel[0] : null;
  };

  async function aiAnswerNow(list) {
    // Another click waits its turn. Questions already in this list are answered one by one below.
    return afterAI(() => answerQuestionList(list));
  }

  async function answerQuestionList(list) {
    // Only boxes with a readable question: "* - This field is required." or an id like
    // "question_b03a4f58-22a7-..." would only get a guess.
    const asked = (list || []).filter((f) => f && !hasValue(f) && (usefulLabel(f.label) || readableHint(f.hint)) && f.kind !== 'file');
    // Questions that ask for the candidate's own words ("No generative AI, please") are not sent.
    const own = asked.filter(noAiQuestion);
    const todo = asked.filter((f) => !noAiQuestion(f));
    if (own.length) toast({ kind: 'warn', title: 'Your own words needed', msg: `${own.length === 1 ? 'This question asks' : `${own.length} questions ask`} not to use AI. Add a "Why this company" template to your profile in the hub, or write it yourself.`, ms: 9000 });
    if (!todo.length) return { ok: true, n: 0 };
    const ctx = await send({ type: 'getContext' });
    if (!ctx.ok || !ctx.profile) return { ok: false, error: ctx.error || 'No active profile' };
    if (!ctx.settings.apiKey) {
      toast({ kind: 'warn', title: 'AI is not set up', msg: 'Add an API key, or turn on the ChatGPT website mode, in the JobBid settings.', ms: 8000 });
      return { ok: false, error: 'no AI' };
    }
    const p = ctx.profile;
    // Facts the profile already has (name, email, phone...) are filled from it, never asked.
    let fromProfile = 0;
    for (const f of [...todo]) {
      const v = ruleValue(f, p) || templateFor(f, p, getJob());
      if (v && String(v).trim() && (await apply(f, v))) { mark(f, 'rule'); fromProfile++; todo.splice(todo.indexOf(f), 1); }
    }
    if (!todo.length) {
      toast({ kind: 'ok', title: `Filled ${fromProfile} from the profile`, msg: 'No AI needed.', ms: 5000 });
      return { ok: true, n: fromProfile };
    }
    for (const f of todo.filter((x) => x.kind === 'dropdown' && !x.options)) await probeDropdown(f);
    // Dropdowns whose list loads only when opened: read the choices, so the AI picks one of them.
    for (const f of todo.filter((x) => (x.kind === 'combobox' || x.kind === 'listbox') && !x.options?.length)) await probeCombo(f);
    // The list is open now, so a saved race/gender/years value can match an option without asking ChatGPT.
    for (const f of [...todo]) {
      const v = ruleValue(f, p) || templateFor(f, p, getJob());
      if (v && String(v).trim() && (await apply(f, v))) { mark(f, 'rule'); fromProfile++; todo.splice(todo.indexOf(f), 1); }
    }
    if (!todo.length) {
      toast({ kind: 'ok', title: `Filled ${fromProfile} from the profile`, msg: 'No AI needed.', ms: 5000 });
      return { ok: true, n: fromProfile };
    }
    const web = ctx.settings.apiKey === 'chatgpt-web' || ctx.settings.chatgptWeb === 'only';
    // You asked for it, so allow more time than during a normal fill. The limit is per question.
    const limit = web ? 150 : Math.max(Number(ctx.settings.aiTimeout) || 0, 45);
    let n = 0;
    let skipped = 0;
    let failed = '';
    let blank = 0; // the AI left it empty: the profile and resume don't say (it never invents experience)
    const toCache = {};
    // Each answer goes into its own question, in the background: the box you are typing in
    // meanwhile keeps the cursor, and the page doesn't jump.
    const typing = focusNow();
    // Questions go in small groups: one AI request (with the ChatGPT website, one chat message) per
    // group instead of one per question. Every question has its own id, so each reply lands in its own
    // box; a group that fails as a whole is asked again one question at a time, so one failure never
    // drops the other answers.
    const GROUP = 8;
    const ask = (group, from) => {
      const ids = group.map((_, k) => `q${Date.now().toString(36)}${from + k}`);
      const name = cleanQ(group[0].label || group[0].hint) || 'this question';
      toast({ kind: 'info', title: group.length === 1 ? `AI is answering ${from + 1} of ${todo.length}` : `AI is answering ${from + 1}-${from + group.length} of ${todo.length}`, msg: group.length === 1 ? name : `${group.length} questions in one go`, ms: 0, progress: true });
      return send({
        type: 'answerFields',
        profile: p,
        job: getJob(),
        fields: group.map((f0, k) => ({ id: ids[k], question: [f0.label || f0.hint, f0.desc && !norm(f0.label).includes(norm(f0.desc)) ? f0.desc : ''].filter(Boolean).join(' - '), type: f0.kind, required: !!f0.required, ...(f0.options ? { options: f0.options.slice(0, 80) } : {}) })),
        // The limit is per question; a group gets a little more for every extra question.
        timeoutMs: (limit + (group.length - 1) * 20) * 1000,
      }).then((res) => ({ res, ids }));
    };
    const put = async (f0, raw) => {
      const v = usableAnswer(raw);
      const f = liveField(f0);
      if (!f || hasValue(f)) { skipped++; return; } // you answered it yourself meanwhile
      if (!v) { blank++; return; }
      // The AI guessing "Chicago, IL" for Address Line 1: a street box takes only a street line.
      if (v && f.kind === 'text' && STREET_FIELD.test(norm(f0.label || f0.hint || '')) && !STREET_NOT.test(norm(f0.label || '')) && !isStreet(v)) { skipped++; return; }
      if (v && (await apply(f, v))) {
        n++;
        mark(f, 'ai');
        aiTouched.set(f.el, { q: cleanQ(f.label || f.hint || ''), kind: f.kind });
        if (f.label && (f.kind !== 'textarea' || (!JOB_SPECIFIC.test(norm(f.label)) && !letterLike(v)))) toCache[cleanQ(f.label)] = v;
      }
    };
    for (let i = 0; i < todo.length; i += GROUP) {
      const group = todo.slice(i, i + GROUP);
      const { res, ids } = await ask(group, i);
      if (res.ok) {
        for (let k = 0; k < group.length; k++) await put(group[k], res.answers?.[ids[k]]);
        continue;
      }
      failed = res.error || 'Unknown error';
      // The extension already tried a failed group question by question; again here only if the
      // message itself was lost (the extension's background restarted meanwhile).
      if (group.length === 1 || !/message port|receiving end|closed/i.test(failed)) continue;
      for (let k = 0; k < group.length; k++) {
        const one = await ask([group[k]], i + k);
        if (!one.res.ok) { failed = one.res.error || 'Unknown error'; continue; }
        await put(group[k], one.res.answers?.[one.ids[0]]);
      }
    }
    if (typing) focusBack(typing);
    if (Object.keys(toCache).length) send({ type: 'saveAnswers', profileId: p.id, answers: toCache, fromAI: true });
    const missed = todo.length - n - skipped;
    const who = p.label || p.fullName || 'the candidate';
    const notInResume = blank ? `${blank === 1 ? 'One question is' : `${blank} questions are`} not covered by ${who}'s resume, so the AI left ${blank === 1 ? 'it' : 'them'} empty (it never makes up experience). Answer ${blank === 1 ? 'it' : 'them'} yourself, or add the experience to the profile.` : '';
    toast(n
      ? { kind: missed ? 'warn' : 'ok', title: `AI answered ${n} of ${todo.length}`, msg: missed ? `${missed} still need you. ${notInResume || failed}`.trim() : 'Purple fields were written by AI - read them before you submit.', ms: missed ? 12000 : 8000 }
      : blank && !failed
        ? { kind: 'warn', title: 'Not in the resume', msg: notInResume, ms: 12000 }
        : { kind: 'warn', title: 'AI gave no usable answer', msg: failed || 'Answer this one yourself, or try again.', ms: 8000 });
    // That was the last missing answer and auto-submit is on: submit like after a normal Fill.
    if (n && ctx.settings.autoSubmit && stillComplete()) maybeAutoSubmit(collectFields(), p);
    return failed && !n ? { ok: false, error: failed } : { ok: true, n: n + fromProfile };
  }

  // ---------- Job-site password ----------
  // The profile's job-sites password (set in the hub, Profiles) goes into every empty password box:
  // sign-in, create account and "confirm password". Never learned from forms, never sent to the AI.
  function fillPasswords(p, overwrite) {
    const pw = String(p?.sitePassword || '');
    if (!pw) return 0;
    let n = 0;
    for (const el of deepQueryAll('input[type=password]')) {
      if (el.closest('#jobbid-root, #jobbid-root-panel') || el.disabled || el.readOnly || !isVisible(el)) continue;
      if (el.value && !overwrite) continue;
      // Boxes for the CURRENT password when changing it, or one-time codes: not ours to fill.
      const hint = `${el.name} ${el.id} ${el.autocomplete} ${el.placeholder} ${labelFor(el)}`.toLowerCase();
      if (/\b(otp|one[- ]time|verification|pin|security code|cvv|cvc)\b/.test(hint)) continue;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, pw);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      mark({ el, kind: 'text' }, 'rule');
      n++;
    }
    return n;
  }

  // ---------- Consent checkboxes ----------
  // "I confirm that the information provided is accurate", "I agree to the privacy policy", "I certify...",
  // "I acknowledge...": ticked automatically. Marketing boxes (newsletter, job alerts, SMS) are left alone
  // unless the form marks them required.

  const CONSENT_RE = /\bi\s+(hereby\s+|have\s+)?(confirm|certify|agree|acknowledge|accept|understand|consent|attest|declare|affirm|authori[sz]e|read)\b|\bagree\s+(to|with)\b|\baccept\s+the\b|terms\s*(and|&)\s*conditions|terms\s+of\s+(use|service)|privacy\s+(policy|notice|statement)|data\s+(protection|processing)|\b(information|answers|details|statements?)\b.{0,40}\b(true|accurate|correct|complete)\b|\btrue,?\s+(and|&)\s+(accurate|correct|complete)\b|\bconsent\s+to\b/i;
  const MARKETING_RE = /newsletter|marketing|promotional|job\s+alerts?|similar\s+(jobs|roles|positions|opportunities)|future\s+(jobs|roles|positions|opportunities|openings|vacancies)|talent\s+(pool|community|network)|keep\s+me\s+(informed|updated|posted)|send\s+me|\bsms\b|text\s+messages?|whatsapp|subscribe|news\s+and\s+updates/i;

  // The text that belongs to a checkbox: its label, or the text right next to it.
  function checkboxText(el) {
    let t = labelFor(el);
    if (t.length < 8) {
      const box = el.closest('label, [role=group], li, p, div') || el.parentElement;
      const near = box ? textOf(box) : '';
      if (near.length <= 600) t = `${t} ${near}`.trim();
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function checkConsents() {
    let n = 0;
    for (const el of deepQueryAll('input[type=checkbox], [role=checkbox]')) {
      if (el.closest('#jobbid-root, #jobbid-root-panel') || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const native = el.tagName === 'INPUT';
      const isOn = () => (native ? el.checked : el.getAttribute('aria-checked') === 'true');
      if (isOn()) continue;
      // Styled checkboxes often hide the real input; the label or wrapper is what's on screen.
      const shown = [el, native && el.labels?.[0], el.parentElement].find((x) => x && isVisible(x));
      if (!shown) continue;
      const text = checkboxText(el);
      if (!text || text.length > 600 || !CONSENT_RE.test(text)) continue;
      const required = (native && el.required) || el.getAttribute('aria-required') === 'true' || /\*/.test(text);
      if (MARKETING_RE.test(text) && !required) continue;
      el.click();
      if (!isOn() && native && el.labels?.[0]) el.labels[0].click();
      if (!isOn() && shown !== el) shown.click();
      if (isOn()) {
        mark({ el: shown === el ? el : shown, kind: 'checkbox' }, 'rule');
        n++;
      }
    }
    return n;
  }

  // ---------- Resume upload ----------

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function chooseResume(p, resumeId) {
    const list = p.resumes || [];
    if (resumeId) return list.find((r) => r.id === resumeId);
    const host = location.hostname;
    const bySite = list.find((r) => (r.sites || '').split(/[\s,]+/).filter(Boolean).some((s) => host.includes(s.trim().toLowerCase())));
    return bySite || list.find((r) => r.id === p.defaultResumeId) || list[0];
  }

  const attachedFiles = new WeakMap(); // file input -> resume name JobBid attached
  const fixedResume = new WeakSet(); // file inputs holding a "Fix resume" PDF: Fill keeps it

  async function attachResume(f, resume) {
    const r = resume.data ? { ok: true, data: resume.data } : await send({ type: 'getFile', fileId: resume.id });
    if (!r.ok || !r.data) return false;
    if (resume.data) fixedResume.add(f.el); else fixedResume.delete(f.el);
    const file = new File([b64ToBytes(r.data)], resume.name, { type: resume.type || 'application/octet-stream', lastModified: Date.now() });
    const dt = new DataTransfer();
    dt.items.add(file);
    f.el.files = dt.files;
    // Only "change": also sending "input" makes some sites (Greenhouse) start two uploads that block each other.
    f.el.dispatchEvent(new Event('change', { bubbles: true }));
    attachedFiles.set(f.el, resume.name);
    return true;
  }

  const isResumeField = (f, fileFields) => {
    const t = norm(f.label + ' ' + f.hint);
    return /resume|cv\b|curriculum/.test(t) || (fileFields.length === 1 && !/cover|photo|image|transcript|portfolio/.test(t));
  };

  // Panel "Attach" button: put the chosen resume into every resume upload on this page (replacing what is there).
  // fixed = { name, type, data } from "Fix resume": used once, only kept in the page's file box.
  async function attachResumeNow(resumeId, fixed) {
    let resume = fixed;
    if (!resume) {
      const ctx = await send({ type: 'getContext' });
      const p = ctx.ok && ctx.profile;
      resume = p && chooseResume(p, resumeId);
    }
    if (!resume) return 0;
    const fileFields = collectFields().filter((f) => f.kind === 'file');
    let n = 0;
    for (const f of fileFields.filter((x) => isResumeField(x, fileFields))) {
      if (await attachResume(f, resume)) { n++; mark(f.el.closest('div') ? { ...f, el: f.el.closest('div') } : f, 'file'); }
    }
    return n;
  }
  const attachedName = (el) => attachedFiles.get(el) || el.files?.[0]?.name || '';
  const isFixedResume = (el) => fixedResume.has(el);

  // ---------- Job posting extraction ----------

  const JD_SELECTORS = [
    '#jobDescriptionText', '.jobs-description__content', '.jobs-description', '.jobs-box__html-content',
    '[data-automation-id="jobPostingDescription"]', '.job__description', '#content .body', '#job-description',
    '[data-testid="jobDescriptionHtml"]', '[data-testid="job-description"]', '[data-cy="jobDescription"]',
    '.posting-page .section-wrapper', '.job-description', '[class*="jobDescription"]', '[class*="job-description"]',
    '[class*="JobDescription"]', '[id*="job-details"]',
  ];

  // Portal headings like "Candidate Portal" or "Job Details" are not job titles.
  const GENERIC_TITLE = /^(candidate|career|careers|job|jobs|talent|applicant|recruiting)( portal| site| center| centre| board| search| details| description| opening| openings| posting| listing)?s?$|^(job description|job details|search jobs|apply( now)?|my applications|my profile|home|welcome|sign in|log ?in|create (an )?account|job summary|about (us|the role))$/i;
  function pageTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    const parts = [og, ...document.title.split(/\s+[|\-–—:]\s+/)].map((x) => x.trim()).filter((x) => x && !GENERIC_TITLE.test(x));
    return parts[0] || document.title;
  }
  // Company from the header logo's alt text, else the site's address (careers.akraya.com -> Akraya).
  function logoCompany() {
    const img = document.querySelector('header img[alt], [class*="logo" i] img[alt], img[class*="logo" i][alt], img[id*="logo" i][alt]');
    const alt = (img?.alt || '').replace(/\b(logo|careers?|jobs?|home|company)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (alt.length >= 2 && alt.length <= 60) return alt;
    const parts = location.hostname.replace(/^www\./, '').split('.');
    const SHARED = /^(greenhouse|lever|ashbyhq|workable|smartrecruiters|myworkdayjobs|workday|icims|jobvite|bamboohr|applytojob|recruitee|breezy|jazzhr|taleo|oraclecloud|successfactors|linkedin|indeed|glassdoor|ziprecruiter|dice|monster|google|bullhorn|bullhornstaffing|avature|paylocity|paycom|ultipro|ukg|adp|dayforcehcm|teamtailor|personio|rippling|join|wellfound|builtin)$/i;
    const name = parts.length > 2 && SHARED.test(parts[parts.length - 2]) ? parts[0] : parts[parts.length - 2] || '';
    if (!name || /^(careers?|jobs?|apply|recruiting|portal|candidate|hire|talent)$/i.test(name)) return '';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function getJob() {
    let description = '';
    let found = 'none'; // 'selector' = a known job-description block, 'keywords' = looks like a job posting
    for (const s of JD_SELECTORS) {
      const el = document.querySelector(s);
      if (el && textOf(el).length > 200) { description = textOf(el); found = 'selector'; break; }
    }
    if (!description) {
      const kw = /responsibilit|requirement|qualification|what you('|’)ll do|about the role|about you|experience with/gi;
      let best = null;
      for (const el of document.querySelectorAll('article, section, main, div')) {
        const t = textOf(el);
        if (t.length < 400 || t.length > 25000) continue;
        const score = (t.match(kw) || []).length;
        if (score >= 2 && (!best || score > best.score || (score === best.score && t.length < best.t.length))) best = { score, t };
      }
      if (best && best.score >= 3) found = 'keywords';
      description = best ? best.t : textOf(document.body).slice(0, 8000);
    }
    // Known job-title spots first, then the first real heading (skipping portal names like "Candidate Portal").
    const okTitle = (el) => { const t = textOf(el); return isVisible(el) && t.length >= 4 && t.length <= 150 && !GENERIC_TITLE.test(t); };
    let titleEl = null;
    for (const s of ['.jobs-unified-top-card__job-title', '.job-details-jobs-unified-top-card__job-title', '[data-automation-id="jobPostingHeader"]', '[data-testid="jobsearch-JobInfoHeader-title"]', '.posting-headline h2', 'h1', 'h2']) {
      if ((titleEl = [...document.querySelectorAll(s)].find(okTitle))) break;
    }
    const companyEl = document.querySelector('.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name, [data-testid="inlineHeader-companyName"], [data-company-name], [data-cy="companyNameLink"], .company-name, [class*="companyName"]');
    let company = textOf(companyEl) || document.querySelector('meta[property="og:site_name"]')?.content || '';
    if (!company) {
      const m = location.href.match(/(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com)\/([^/?#]+)/);
      if (m) company = m[1];
      else if (/myworkdayjobs/.test(location.hostname)) company = location.hostname.split('.')[0];
    }
    if (!company) company = logoCompany();
    return {
      title: (textOf(titleEl) || pageTitle()).slice(0, 150),
      company: company.slice(0, 100),
      description: description.slice(0, 12000),
      url: location.href,
      found,
    };
  }

  // ---------- Fill check & report ----------
  // After a fill every answer is read back. One the site cleared gets one more try; whatever is still
  // wrong (cleared, refused, a red error under it, no answer) goes to the hub's Problems page.

  const applyErrors = new WeakMap(); // field element -> the script error apply() hit on it
  const ERROR_TEXT = /\b(required|please (select|choose|enter|provide|answer|fill|complete|make)|(is|was) (invalid|not valid|incorrect)|enter a valid|not a valid|must (be|select|enter|choose)|can ?not be (blank|empty)|cannot be left|this field)\b/i;

  // The block around one question (label, options, error line), small enough to show on its own.
  function fieldBox(f) {
    const own = new Set(f.els || [f.el]);
    let box = f.els?.[0] || f.el;
    for (let k = 0; k < 7 && box; k++) {
      const up = composedParent(box);
      if (!up || up === document.body || up === document.documentElement) break;
      const others = [...up.querySelectorAll('input:not([type=hidden]), select, textarea, [role=combobox], [role=listbox]')].filter((e) => !own.has(e)).length;
      if (others > 1 || textOf(up).length > 900) break;
      box = up;
    }
    return box;
  }

  // The error message the site shows for this field ('' when none).
  function fieldError(f) {
    const els = f.els || [f.el];
    for (const el of els) {
      for (const attr of ['aria-errormessage', 'aria-describedby']) {
        for (const id of String(el.getAttribute?.(attr) || '').split(/\s+/).filter(Boolean)) {
          const t = textOf(byId(el, id));
          if (t && t.length < 200 && ERROR_TEXT.test(t)) return t;
        }
      }
    }
    const box = fieldBox(f);
    for (const e of box?.querySelectorAll?.('[role=alert], [aria-live=assertive], [class*="error" i], [id*="error" i], [class*="invalid" i], [data-automation-id*="error" i]') || []) {
      if (els.includes(e) || !isVisible(e)) continue;
      const t = textOf(e);
      if (t && t.length < 200 && ERROR_TEXT.test(t)) return t;
    }
    // aria-invalid alone is not counted: many sites (ADP) leave it on a filled box until the next Submit.
    return '';
  }

  // The site gave up on this box itself and locked it ("Our location service is temporarily unavailable.
  // You can submit your application without a location."): it may stay empty. Its list, stuck open
  // because the box is locked, is hidden. Returns the site's message ('' when not).
  // Only when the site says it may be left out: "unavailable" alone keeps it a required box that needs you
  // (otherwise Full auto could submit an incomplete application).
  const SITE_SKIP = /(submit|apply|continue)( (your|the) application)? without/i;
  function siteGaveUp(f) {
    const el = f.el;
    if (!el || !(el.disabled || el.closest?.('[aria-disabled="true"], [class*="is-disabled" i]'))) return '';
    const box = fieldBox(f) || el.parentElement;
    const ids = ['aria-errormessage', 'aria-describedby'].flatMap((a) => String(el.getAttribute(a) || '').split(/\s+/)).filter(Boolean);
    const notes = [...ids.map((id) => byId(el, id)), ...(box?.querySelectorAll?.('[id*="error" i], [class*="error" i], [class*="helper" i], [role=alert]') || [])];
    const msg = notes.map((n) => textOf(n)).find((t) => t && t.length < 300 && SITE_SKIP.test(t)) || '';
    if (msg) for (const m of box?.querySelectorAll?.('.select__menu, [role=listbox]') || []) if (!m.contains(el)) m.style.display = 'none';
    return msg;
  }

  // The question's page code, trimmed (no scripts, icons or long attribute values), for fixing it later.
  function snippet(f) {
    try {
      const box = fieldBox(f).cloneNode(true);
      box.querySelectorAll('script, style, svg, img, noscript').forEach((n) => n.replaceWith(document.createComment(n.tagName.toLowerCase())));
      for (const n of [box, ...box.querySelectorAll('*')]) {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name)) n.removeAttribute(a.name);
          else if (a.value.length > 160) n.setAttribute(a.name, a.value.slice(0, 160) + '…');
        }
      }
      const html = box.outerHTML.replace(/\s+/g, ' ');
      return html.length > 5000 ? html.slice(0, 5000) + '…' : html;
    } catch { return ''; }
  }

  function problemOf(f, status, value, error = '') {
    const text = norm(`${f.label} ${f.hint}`);
    const v = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);
    return {
      q: cleanQ(f.label || f.hint || '').slice(0, 300),
      kind: f.kind,
      required: !!f.required,
      options: (f.options || []).map((o) => String(o ?? '').slice(0, 120)).slice(0, 40),
      value: SENSITIVE.test(text) ? '' : v.slice(0, 300),
      status,
      error: String(error || applyErrors.get(f.el) || (status === 'failed' && comboWhy.get(f.el)) || '').slice(0, 300),
      html: SENSITIVE.test(text) ? '' : snippet(f),
    };
  }

  // Read the answers back (see above). Returns the problems; the caller counts them off "filled".
  async function verifyFilled(done) {
    const problems = [];
    if (!done.length) return problems;
    await settle(600, 60, 300); // the site reacts to the answers (some clear a box after checking it with their server)
    const live = done.filter((d) => (d.f.els || [d.f.el]).some((e) => e.isConnected));
    const bad = live.filter((d) => (!hasValue(d.f) || fieldError(d.f)) && !siteGaveUp(d.f));
    if (!bad.length) return problems;
    let retries = 0;
    for (const d of bad) {
      // The site cleared it: once more, but not for a box that was slow the first time (it would only
      // be slow again), and at most 4 boxes.
      if (!hasValue(d.f)) { if (retries < 4 && (d.ms || 0) < 2500) { retries++; await apply(d.f, d.v); } }
      else {
        // An old red line from an earlier Submit often goes away once the site re-checks the field.
        for (const t of ['change', 'blur', 'focusout']) d.f.el.dispatchEvent(new Event(t, { bubbles: true }));
      }
    }
    await settle(700, 60, 300);
    for (const d of bad) {
      const empty = !hasValue(d.f), err = fieldError(d.f);
      if (!empty && !err) continue;
      mark(d.f, 'missing');
      problems.push(problemOf(d.f, empty ? 'cleared' : 'site-error', d.v, err));
    }
    return problems;
  }

  // One report per fill (each frame sends its own): how many boxes, how many filled, what went wrong.
  function sendFillReport(p, job, fieldCount, filled, problems, timing = {}) {
    send({
      type: 'fillReport',
      report: {
        url: location.href,
        pageUrl: IS_TOP ? '' : document.referrer || '',
        title: job.title || '',
        company: job.company || '',
        profileId: p.id,
        profileName: p.label || p.fullName || '',
        fields: fieldCount,
        filled: Math.max(0, filled),
        problems: problems.slice(0, 40),
        ms: timing.ms || 0,
        slow: timing.slow || [],
      },
    }).catch?.(() => {});
  }

  // ---------- Main fill ----------

  let filling = false;
  // Boxes on this page answered by the AI (now, or from an AI answer saved earlier that no person checked yet).
  // Full auto does not send a form with one of these unless it is an essay box (see runBid).
  const aiTouched = new Map(); // element -> { q, kind }

  // A ZIP / postal code search box that comes after City, State or County boxes goes first: choosing the
  // ZIP's row ("60623, Chicago, Cook, IL") fills them, and their lists only hold the right places after it
  // (Oracle lists 500 cities before it, without Chicago).
  function zipFirst(list) {
    const geo = (f) => f.kind === 'combobox' && /\b(city|state|county|province|region)\b/.test(norm(f.label));
    const zip = list.findIndex((f) => f.kind === 'combobox' && /\b(zip|postal|post code|postcode)\b/.test(norm(f.label)));
    if (zip < 0) return list;
    const first = list.findIndex(geo);
    if (first < 0 || first > zip) return list;
    const [z] = list.splice(zip, 1);
    list.splice(first, 0, z);
    return list;
  }

  async function fill({ resumeId, noApply, noAutoSubmit } = {}) {
    if (filling) return;
    // No form yet, only the job's Apply button: press it first.
    if (!noApply && needsApplyClick()) {
      toast({ kind: 'info', title: 'Opening the application...', msg: 'JobBid pressed the Apply button.', ms: 4000 });
      const r = await openApplication();
      if (r === 'signin') return toast({ kind: 'warn', title: 'Sign in first', msg: 'This site needs an account to apply. Sign in or create one, then press Fill.', ms: 12000 });
      if (r === 'away') return; // the next page (or new tab) fills by itself
      if (r !== 'form') return toast({ kind: 'warn', title: 'No form opened', msg: 'JobBid pressed Apply, but no application form appeared. Open it yourself, then press Fill.', ms: 9000 });
    }
    filling = true;
    window.__jobbidFillState?.(true); // the side panel's button says "Filling..." until it's done
    try {
      const ctx = await send({ type: 'getContext' });
      if (!ctx.ok) return IS_TOP && toast({ kind: 'err', msg: ctx.error || 'Extension error' });
      const p = ctx.profile;
      if (!p) return IS_TOP && toast({ kind: 'err', title: 'No profile yet', msg: 'Open the JobBid dashboard and import a resume.' });
      const fields = collectFields();
      if (!fields.length) {
        // A sign-in step with only a password box.
        const pw = fillPasswords(p, ctx.settings.overwrite);
        if (pw) return toast({ kind: 'ok', title: 'Password filled', msg: `${p.label || p.fullName}'s job-sites password. Check it, then sign in.`, ms: 6000 });
        return IS_TOP && toast({ kind: 'warn', title: 'No form on this page', msg: 'Click the Apply button on the job first, then fill.' });
      }
      // Fill button, Shift+Alt+F, the panel or Auto bid: the team sees "<you> is filling" on Job links.
      touchJob('fill', p);

      let filled = 0, ai = 0, files = 0;
      let aiProblem = '';
      const unresolved = [];
      const siteSkipped = []; // boxes the site locked and lets you leave empty
      const done = []; // { f, v }: answered, read back after the loop
      const report = []; // problems for the hub
      const slow = []; // boxes that took over 1.5 s (for the hub: where fill time goes)
      const started = performance.now();
      const answers = Object.fromEntries(Object.entries(p.customAnswers || {}).map(([k, v]) => [answerKey(k), v]));
      const aiGuess = new Set((p.aiGuessKeys || []).map(answerKey));
      const fileFields = fields.filter((f) => f.kind === 'file');
      // A resume fixed for this job on its posting page goes in instead of the usual one (unless one was picked).
      const fixed = !resumeId && fileFields.length ? (await send({ type: 'takeFixedResume', profileId: p.id })).file : null;
      const resume = fixed || chooseResume(p, resumeId);
      const job = getJob();

      // Questions that appear only after an earlier answer (e.g. "race" after "Hispanic: No") are
      // picked up in a second pass.
      const seenEls = new Set();
      const queue = zipFirst([...fields]);
      for (let pass = 0; pass < 2; pass++) {
       if (pass) { await settle(400); for (const f of collectFields()) if (!seenEls.has(f.el)) queue.push(f); }
       while (queue.length) {
        const f = queue.shift();
        seenEls.add(f.el);
        if (f.kind === 'file') {
          // Never re-attach the same file: that restarts the site's upload (stuck progress bar).
          const same = fixed ? fixedResume.has(f.el) && hasValue(f) : attachedFiles.get(f.el) === resume?.name || (fixedResume.has(f.el) && hasValue(f));
          if (isResumeField(f, fileFields) && resume && !same && (fixed || ctx.settings.overwrite || !hasValue(f)) && (await attachResume(f, resume))) {
            files++;
            if (fixed) send({ type: 'dropFixedResume' });
            mark(f.el.closest('div') ? { ...f, el: f.el.closest('div') } : f, 'file');
          }
          continue;
        }
        // A number already in the box with "+1" while the form has its own country-code box: the site
        // rejects it ("Enter a valid format"), so it is corrected even when filled boxes are kept.
        if (hasValue(f) && isPhoneField(f) && hasPhoneCodeField()) {
          const cur = String(f.el.value || '');
          const fixed = nationalNumber(cur);
          if (fixed && fixed !== cur) { setNative(f.el, fixed); mark(f, 'rule'); filled++; }
          continue;
        }
        if (!ctx.settings.overwrite && hasValue(f) && !otherCity(f, p)) continue;
        // A box without a readable question never takes a saved answer (one saved under "" went everywhere).
        const saved = savedAnswer(f, answers);
        // Yes/No screening questions: the answer you (or the AI) gave this exact question beats the
        // profile's general answer.
        const rule = fittingRule(f, p);
        let v = saved != null && saved !== '' && (rule ? YESNO_KEYS.includes(rule.key) || !rule.key : !!noneOfCountries(f)) ? saved : ruleValue(f, p);
        if (v == null || v === '') v = saved;
        // "If you answered 'yes' above, please provide..." after a "No": N/A (no AI needed).
        if ((v == null || v === '') && f.kind !== 'file') v = followUpNA(f, fields, p, answers) || v;
        if (typeof v === 'string') v = usableAnswer(v);
        // An old saved letter would go to every company unchanged: leave the box for a fresh answer.
        if (f.kind === 'textarea' && typeof v === 'string' && letterLike(v)) v = '';
        // The user's own template ("Why {company}?") with this job's company filled in.
        if (v == null || v === '') v = templateFor(f, p, job);
        const t0 = performance.now();
        const ok = v != null && v !== '' && (await apply(f, v));
        const ms = Math.round(performance.now() - t0);
        if (ms > 1500) slow.push({ q: cleanQ(f.label || f.hint || '').slice(0, 160), kind: f.kind, ms, ok: !!ok });
        if (ok) {
          filled++;
          // The saved answer was an AI guess nobody checked: purple, and Full auto treats it as an AI answer.
          const guessed = saved != null && v === saved && aiGuess.has(savedKey(f, answers));
          mark(f, guessed ? 'ai' : 'rule');
          if (guessed) aiTouched.set(f.el, { q: cleanQ(f.label || ''), kind: f.kind });
          done.push({ f, v, ms });
          continue;
        }
        // The site locked the box and says it may stay empty (its location service is down).
        const gaveUp = siteGaveUp(f);
        if (gaveUp) { siteSkipped.push(`${cleanQ(f.label || 'A box')}: ${gaveUp}`); continue; }
        // Had an answer, but the box would not take it (no matching option, nothing chosen, an error).
        if (v != null && v !== '') report.push(problemOf(f, 'failed', v));
        if (f.label || f.hint) unresolved.push(f);
       }
      }

      for (const f of unresolved.filter((x) => x.kind === 'dropdown' && !x.options).slice(0, 12)) await probeDropdown(f);
      filled += checkConsents();
      filled += fillPasswords(p, ctx.settings.overwrite);

      // Read every answer back: the site may have cleared it or put a red error under it.
      const broken = await verifyFilled(done);
      filled -= broken.length;
      report.push(...broken);
      const failedNow = new Set(report.map((x) => x.q));
      for (const f of unresolved) {
        // Essay boxes are left for "Answer with AI" on purpose: not a problem.
        // A one-time code ("Security code" emailed to you) is yours to type: not a problem either.
        if (f.required && f.kind !== 'textarea' && !isOneTime(f) && !hasValue(f) && !failedNow.has(cleanQ(f.label || f.hint || '').slice(0, 300))) report.push(problemOf(f, 'unanswered', ''));
      }
      sendFillReport(p, job, fields.length, filled, report, { ms: Math.round(performance.now() - started), slow: slow.sort((a, b) => b.ms - a.ms).slice(0, 15) });

      // Fill never asks the AI by itself: unanswered questions are marked, and the user clicks
      // "Answer with AI" (or a red question in the side panel) to ask.
      unresolved.filter((f) => f.required).forEach((f) => mark(f, 'missing'));

      const missing = unresolved.filter((f) => f.required && !hasValue(f)).length;
      const pending = unresolved
        .filter((f) => !hasValue(f) && f.label && (f.required || f.options?.length || f.kind === 'textarea') && !fittingRule(f, p))
        .filter((f) => !SENSITIVE.test(norm(f.label + ' ' + f.hint)) && !(f.kind === 'textarea' && JOB_SPECIFIC.test(norm(f.label))))
        .map((f) => ({ q: cleanQ(f.label), options: (f.options || []).slice(0, 40) }))
        .filter((x) => x.q.length > 3 && answers[answerKey(x.q)] === undefined);
      let newPending = 0;
      if (pending.length) {
        const r = await send({ type: 'savePendingQuestions', profileId: p.id, questions: pending });
        newPending = r.ok ? r.added : 0;
      }
      const total = filled + ai;
      const parts = [];
      if (ai) parts.push(`${ai} written by AI (purple)`);
      if (broken.length) parts.push(`${broken.length} the site would not keep (red) - sent to the hub's Problems page`);
      if (files) parts.push(`resume attached: ${resume.name}`);
      if (missing) parts.push(`${missing} required need you (red) - click "Answer with AI" in the panel to ask the AI`);
      if (aiProblem) parts.push(aiProblem + ', skipped');
      if (siteSkipped.length) parts.push(`left empty, the site allows it - ${siteSkipped.join(' · ')}`);
      if (newPending) parts.push(`${newPending} new question${newPending === 1 ? '' : 's'} added to Saved answers - answer once in the dashboard and it fills next time`);
      lastFill = { profile: p, at: Date.now() };
      toast({
        kind: missing ? 'warn' : total || files ? 'ok' : 'warn',
        title: total || files ? `Filled ${total} field${total === 1 ? '' : 's'} as ${p.label || p.fullName}` : 'Nothing to fill here',
        msg: (parts.length ? parts.join(' · ') + '. ' : '') + 'Review everything, then submit.',
        ms: 15000,
        actions: [{ label: 'Log application', primary: true, onClick: () => logApplication(p) }, { label: 'Dismiss' }],
      });
      if (ctx.settings.autoSubmit && !missing && !noAutoSubmit) maybeAutoSubmit(fields, p); // auto bid submits by itself
    } finally {
      filling = false;
      window.__jobbidFillState?.(false);
    }
  }

  // ---------- Auto-submit (opt-in) ----------
  // Every required field filled -> count down, then press the form's final Submit button.
  // Never on multi-step "Next / Continue" buttons, never when this profile already applied.

  const SUBMIT_RE = /^(submit|submit application|submit my application|submit your application|send application|send my application|apply|apply now|complete application|finish application)$/i;
  const NOT_SUBMIT_RE = /next|continue|review|save|back|cancel|draft/i;
  let autoTimer = null;

  function findSubmitButton(fields) {
    const form = fields.map((f) => (f.el || f.els?.[0])?.closest?.('form')).find(Boolean);
    const scope = form || document;
    const cands = [...scope.querySelectorAll('button, input[type=submit], [role=button]')].filter((b) => isVisible(b) && !b.disabled && !b.closest('#jobbid-root, #jobbid-root-panel'));
    const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return cands.find((b) => SUBMIT_RE.test(label(b)) && !NOT_SUBMIT_RE.test(label(b)))
      || (form && cands.find((b) => b.type === 'submit' && label(b).length <= 30 && !NOT_SUBMIT_RE.test(label(b))));
  }

  // Still complete right now? (The site may clear a field, or an upload may have failed.)
  const stillComplete = () => collectFields().every((f) => !f.required || hasValue(f));

  function maybeAutoSubmit(fields, p) {
    clearTimeout(autoTimer);
    const btn = findSubmitButton(fields);
    if (!btn || !stillComplete()) return;
    if (appliedState.matches.some((m) => m.profileId === p.id)) {
      return toast({ kind: 'warn', title: 'Auto-submit skipped', msg: `${p.label || p.fullName} already applied to this job.`, ms: 8000 });
    }
    // Same rule as Full auto: nothing the AI guessed for a fact goes out unchecked.
    const guessed = [...aiTouched].filter(([el, x]) => el.isConnected && x.kind !== 'textarea');
    if (guessed.length) {
      return toast({ kind: 'warn', title: 'Auto-submit skipped', msg: `The AI answered ${guessed.length} question${guessed.length === 1 ? '' : 's'} (purple). Check ${guessed.length === 1 ? 'it' : 'them'}, then submit yourself.`, ms: 10000 });
    }
    let left = 1; // short pause so Cancel is still possible
    let cancelled = false;
    const submit = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(autoTimer);
      if (!stillComplete() || !btn.isConnected || btn.disabled) {
        return toast({ kind: 'warn', title: 'Auto-submit stopped', msg: 'A required field became empty. Check the form, then submit yourself.', ms: 9000 });
      }
      promptedFor = location.href; // logged here, so don't also ask "Did you submit?"
      btn.click();
      logApplication(p);
    };
    const tick = () => {
      if (cancelled) return;
      if (left <= 0) return submit();
      toast({
        kind: 'info',
        title: `Submitting in ${left}s`,
        msg: `All required fields are filled. JobBid will press "${(btn.innerText || btn.value || 'Submit').trim().slice(0, 30)}".`,
        ms: 0,
        actions: [{ label: 'Cancel', onClick: () => { cancelled = true; clearTimeout(autoTimer); } }, { label: 'Submit now', primary: true, onClick: submit }],
      });
      left--;
      autoTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  async function logApplication(profile) {
    const job = getJob();
    const pageUrl = location.href;
    const dup = await send({ type: 'checkApplied', url: pageUrl, title: job.title, company: job.company });
    if (dup.ok && dup.matches.some((m) => m.profileId === profile.id)) {
      return toast({ kind: 'info', title: 'Already in your tracker', msg: `${profile.label || profile.fullName} already logged this job.` });
    }
    const r = await send({
      type: 'logApplication',
      profileId: profile.id,
      profileName: profile.label || profile.fullName,
      title: job.title,
      company: job.company,
      url: pageUrl,
    });
    if (r.ok) appliedState.key = ''; // re-check so the Apply guard knows about it
    toast(r.ok
      ? { kind: 'ok', title: 'Application logged', msg: `${job.title || 'Job'}${job.company ? ' at ' + job.company : ''}`, ms: 5000 }
      : { kind: 'err', title: 'Could not log', msg: r.error });
  }

  // ---------- UI (shadow DOM so page CSS can't interfere) ----------

  const UI_ICONS = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    err: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${UI_ICONS[n]}</svg>`;

  let ui;
  function getUI() {
    if (ui) return ui;
    const host = document.createElement('div');
    host.id = 'jobbid-root';
    // Mounted on <html> and pinned with !important: sites that transform/zoom <body> turn
    // position:fixed into "relative to that element", which pushes the widget to the left.
    host.style.cssText = `all:initial;position:fixed!important;${uiSide === 'left' ? 'right' : 'left'}:auto!important;top:auto!important;${uiSide}:${uiOffset}px!important;bottom:20px!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;`;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .wrap { --card:#fff; --text:#1b1b2f; --text2:#5b5d72; --stroke:rgba(30,27,75,.08); --accent:#4f46e5; --on:#fff; --hover:rgba(79,70,229,.06);
          --ok:#16a34a; --warn:#b45309; --err:#dc2626; --info:#4f46e5; --grad:linear-gradient(135deg,#4f46e5,#7c3aed 55%,#c026d3);
          font: 14px/20px "Segoe UI Variable Text","Segoe UI","Malgun Gothic","Microsoft YaHei",system-ui,sans-serif; color: var(--text);
          display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
        @media (prefers-color-scheme: dark) {
          .wrap:not([data-theme=light]) { --card:#1c1d2a; --text:#f1f1f8; --text2:#b4b6cc; --stroke:rgba(255,255,255,.08); --accent:#6d68f5; --on:#fff; --hover:rgba(165,180,252,.08);
            --ok:#4ade80; --warn:#fbbf24; --err:#f87171; --info:#a5b4fc; }
        }
        .wrap[data-theme=dark] { --card:#1c1d2a; --text:#f1f1f8; --text2:#b4b6cc; --stroke:rgba(255,255,255,.08); --accent:#6d68f5; --on:#fff; --hover:rgba(165,180,252,.08);
            --ok:#4ade80; --warn:#fbbf24; --err:#f87171; --info:#a5b4fc; }
        svg { width:16px; height:16px; flex:none; }
        .toast { width:360px; max-width:calc(100vw - 40px); background:var(--card); border:1px solid var(--stroke); border-radius:12px;
          box-shadow:0 8px 32px rgba(0,0,0,.22); padding:14px 14px 14px 16px; display:none; animation:in .25s cubic-bezier(.1,.9,.2,1); position:relative; overflow:hidden; }
        @keyframes in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        .head { display:flex; gap:10px; align-items:flex-start; }
        .head .ic svg { width:18px; height:18px; margin-top:1px; }
        .ic.ok { color:var(--ok); } .ic.warn { color:var(--warn); } .ic.err { color:var(--err); } .ic.info { color:var(--info); }
        .title { font-weight:600; }
        .msg { color:var(--text2); font-size:13px; margin-top:2px; }
        .body { flex:1; min-width:0; }
        .x { all:unset; cursor:pointer; width:28px; height:28px; border-radius:4px; display:grid; place-items:center; color:var(--text2); margin:-6px -6px 0 0; }
        .x:hover { background:var(--hover); }
        .actions { display:flex; gap:8px; margin-top:12px; padding-left:28px; }
        .actions button { all:unset; cursor:pointer; flex:1; text-align:center; padding:6px 12px; border-radius:8px; border:1px solid var(--stroke); background:var(--hover); font-size:13px; }
        .actions button.primary { background:var(--grad); color:#fff; border-color:transparent; font-weight:600; }
        .actions button:hover { filter:brightness(1.06); }
        .bar { position:absolute; left:0; right:0; bottom:0; height:3px; overflow:hidden; display:none; }
        .bar i { position:absolute; height:100%; width:40%; background:var(--grad); border-radius:2px; animation:slide 1.2s ease-in-out infinite; }
        @keyframes slide { from { left:-40%; } to { left:100%; } }
        .fab { display:none; align-items:center; background:var(--card); border:1px solid var(--stroke); border-radius:12px;
          box-shadow:0 8px 24px rgba(0,0,0,.18); overflow:hidden; animation:in .25s cubic-bezier(.1,.9,.2,1); }
        .fab button { all:unset; cursor:pointer; display:flex; align-items:center; gap:8px; height:40px; padding:0 14px; }
        .fab .fill { background:var(--grad); color:#fff; font-weight:600; }
        .fab .fill:hover { filter:brightness(1.08); }
        .fab .who { padding:0 10px 0 6px; font-size:13px; color:var(--text2); max-width:180px; }
        .fab .who:hover { background:var(--hover); }
        .fab .av { width:26px; height:26px; border-radius:50%; background:#7c3aed; color:#fff; display:grid; place-items:center; font-size:11px; font-weight:600; flex:none; }
        .fab .who span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fab .hide { padding:0 8px; color:var(--text2); }
        .fab .hide:hover { background:var(--hover); }
        .banner { width:360px; max-width:calc(100vw - 40px); display:none; gap:10px; align-items:flex-start; padding:12px 14px; border-radius:8px; font-size:13px;
          background:var(--card); border:1px solid var(--stroke); border-left:3px solid var(--warn); box-shadow:0 8px 24px rgba(0,0,0,.14); }
        .banner .ic { color:var(--warn); }
        .learn { display:none; align-items:center; gap:8px; padding:6px 6px 6px 12px; border-radius:16px; font-size:12px;
          background:var(--card); border:1px solid var(--stroke); box-shadow:0 4px 12px rgba(0,0,0,.14); animation:in .2s ease-out; }
        .learn .ic { color:var(--ok); display:flex; }
        .learn button { all:unset; cursor:pointer; padding:2px 8px; border-radius:10px; color:var(--accent); font-weight:600; }
        .learn button:hover { background:var(--hover); }
      </style>
      <div class="wrap">
        <div class="banner"><span class="ic">${svg('warn')}</span><div class="body"></div></div>
        <div class="toast" role="status"><div class="head"><span class="ic"></span><div class="body"><div class="title"></div><div class="msg"></div></div>
          <button class="x" title="Close">${svg('close')}</button></div><div class="actions"></div><div class="bar"><i></i></div></div>
        <div class="learn" role="status"><span class="ic">${svg('ok')}</span><span class="txt"></span><button type="button">Undo</button></div>
        <div class="fab">
          <button class="who" title="Active profile - change it in the JobBid popup"><span class="av"></span><span class="name"></span></button>
          <button class="fill" title="Fill this application (Alt+Shift+F)">${svg('bolt')}Fill</button>
          <button class="hide" title="Hide on this page">${svg('close')}</button>
        </div>
      </div>`;
    (document.documentElement || document.body).appendChild(host);
    // Thrown out of the page (an old copy of JobBid after an update, or a React site rebuilding the whole
    // page, see panel.js): put it back.
    const keepUi = () => { if (!host.isConnected && !dead && alive()) (document.documentElement || document.body).appendChild(host); };
    new MutationObserver(keepUi).observe(document.documentElement, { childList: true });
    setInterval(keepUi, 1500);
    self.jbI18n?.observe(root);
    const $r = (s) => root.querySelector(s);
    $r('.fill').addEventListener('click', () => fill());
    $r('.who').addEventListener('click', () => toast({ kind: 'info', title: 'Switch profile', msg: 'Click the JobBid icon in the Chrome toolbar to change who you are applying as.', ms: 6000 }));
    $r('.hide').addEventListener('click', () => { hiddenHere = true; $r('.fab').style.display = 'none'; });
    $r('.x').addEventListener('click', () => ($r('.toast').style.display = 'none'));
    send({ type: 'getContext' }).then((c) => c.ok && setTheme(c.settings.theme));
    ui = { host, $r, fab: $r('.fab'), toast: $r('.toast'), banner: $r('.banner'), learn: $r('.learn') };
    setUiOffset(uiOffset, uiSide);
    return ui;
  }

  function setTheme(theme) {
    const wrap = ui?.$r('.wrap');
    if (!wrap) return;
    if (theme === 'light' || theme === 'dark') wrap.dataset.theme = theme;
    else delete wrap.dataset.theme;
  }
  chrome.storage.onChanged.addListener((c) => c.settings && setTheme(c.settings.newValue?.theme));

  let toastTimer;
  let hiddenHere = false;
  // toast({ kind: ok|warn|err|info, title, msg, ms, progress, actions: [{ label, primary, onClick }] })
  function toast(opts) {
    const { kind = 'info', title = '', msg = '', ms = 9000, progress = false, actions = [] } = opts;
    const { $r, toast: t } = getUI();
    const ic = $r('.toast .ic');
    ic.className = 'ic ' + kind;
    ic.innerHTML = svg(kind);
    $r('.toast .title').textContent = title || { ok: 'Done', warn: 'Heads up', err: 'Something went wrong', info: 'JobBid' }[kind];
    $r('.toast .msg').textContent = msg;
    $r('.toast .bar').style.display = progress ? 'block' : 'none';
    const box = $r('.toast .actions');
    box.innerHTML = '';
    box.style.display = actions.length ? 'flex' : 'none';
    // A question waiting for an answer (no time limit): Enter = the main button, Esc = the other one.
    const keys = !ms && actions.some((a) => a.primary);
    const btns = [];
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label + (keys ? (a.primary ? '  ⏎' : '  Esc') : '');
      if (keys) b.title = a.primary ? 'Enter' : 'Esc';
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', () => { t.style.display = 'none'; a.onClick?.(); });
      box.appendChild(b);
      btns.push([a, b]);
    }
    setToastKeys(t, keys ? btns : []);
    t.style.display = 'block';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => (t.style.display = 'none'), ms);
  }

  let toastKeyHandler = null;
  function setToastKeys(t, btns) {
    if (toastKeyHandler) removeEventListener('keydown', toastKeyHandler, true);
    toastKeyHandler = null;
    const primary = btns.find(([a]) => a.primary)?.[1], other = btns.find(([a]) => !a.primary)?.[1];
    if (!primary) return;
    toastKeyHandler = (e) => {
      if (t.style.display === 'none' || !primary.isConnected) {
        removeEventListener('keydown', toastKeyHandler, true);
        toastKeyHandler = null;
        return;
      }
      // Typing in a form field keeps its normal Enter.
      const el = e.target;
      if (e.isComposing || el?.isContentEditable || (el?.matches?.('textarea, select, input') && !el.matches('input[type=button], input[type=submit], input[type=checkbox], input[type=radio]'))) return;
      const target = e.key === 'Enter' ? primary : e.key === 'Escape' ? other : null;
      if (!target) return;
      // Don't let the page see this key (it would press the site's focused button again).
      e.preventDefault();
      e.stopImmediatePropagation();
      target.click();
    };
    addEventListener('keydown', toastKeyHandler, true);
  }

  // Notifications sit on the same side as the side panel (left by default), beside it when it is open.
  let uiOffset = 20, uiSide = 'left';
  function setUiOffset(px, side = uiSide) {
    uiOffset = px;
    uiSide = side === 'right' ? 'right' : 'left';
    if (!ui) return;
    // setProperty keeps the !important priority that plain .style.right = would drop.
    ui.host.style.setProperty(uiSide, px + 'px', 'important');
    ui.host.style.setProperty(uiSide === 'left' ? 'right' : 'left', 'auto', 'important');
    ui.host.shadowRoot.querySelector('.wrap').style.alignItems = uiSide === 'left' ? 'flex-start' : 'flex-end';
  }

  // Compact avatar for the floating button: initials that survive "Dr.", "Jr." and CJK names.
  const FAB_GRADIENTS = [['#4f46e5', '#7c3aed'], ['#0f6cbd', '#1d4ed8'], ['#0e7490', '#0f766e'], ['#047857', '#15803d'],
    ['#9a3412', '#c2410c'], ['#9f1239', '#be123c'], ['#7e22ce', '#a21caf'], ['#334155', '#475569']];
  function fabInitials(name) {
    const raw = String(name || '');
    const cjk = raw.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g);
    if (cjk) return cjk.slice(0, 2).join('');
    const skip = /^(mr|mrs|ms|miss|dr|prof|sir|jr|sr|ii|iii|iv|v|phd|mba|md|cpa|esq)\.?$/i;
    const tokens = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '')
      .replace(/[^\p{L}\p{N}\s.-]+/gu, ' ').split(/[\s.-]+/).filter((t) => t && !skip.test(t));
    if (!tokens.length) return '?';
    if (tokens.length > 1) return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
    return [...tokens[0]].slice(0, 2).join('').toUpperCase();
  }
  function fabGradient(name) {
    let h = 0;
    for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b] = FAB_GRADIENTS[h % FAB_GRADIENTS.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  }

  async function refreshButton() {
    const ctx = await send({ type: 'getContext' });
    if (hiddenHere || !ctx.ok || !ctx.settings.showButton || !ctx.profile || ctx.settings.showPanel !== false) {
      if (ui) ui.fab.style.display = 'none';
      return;
    }
    const count = deepQueryAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=search]), textarea, select').filter(isVisible).length;
    const hasFile = !!document.querySelector('input[type=file]');
    if (count >= 3 || hasFile) {
      const { $r, fab } = getUI();
      const name = (ctx.profile.label || ctx.profile.fullName || 'Profile').trim();
      const av = $r('.av');
      av.textContent = fabInitials(name);
      av.style.background = fabGradient(name);
      $r('.name').textContent = name.split(/\s+/)[0];
      fab.style.display = 'flex';
    } else if (ui) ui.fab.style.display = 'none';
  }

  // Jobs already in the tracker for this page (by address, or company + title). Kept ready so the
  // Apply-button guard below can decide synchronously when the user clicks.
  let appliedState = { key: '', matches: [], profileId: '' };
  async function checkApplied() {
    if (!IS_TOP) return;
    const job = getJob();
    const key = location.href + '|' + job.title + '|' + job.company;
    if (key === appliedState.key) return;
    appliedState.key = key;
    const [r, ctx] = await Promise.all([send({ type: 'checkApplied', url: location.href, title: job.title, company: job.company }), send({ type: 'getContext' })]);
    appliedState = { key, matches: r.ok ? r.matches : [], profileId: ctx.ok ? ctx.profile?.id || '' : '' };
    if (appliedState.matches.length) {
      const body = getUI().banner.querySelector('.body');
      body.innerHTML = '<b>Already applied here</b><br>';
      body.append(appliedState.matches.map((m) => `${m.profileName} on ${new Date(m.date).toLocaleDateString(self.jbI18n?.locale)}`).join(', '));
      ui.banner.style.display = 'flex';
    } else if (ui) ui.banner.style.display = 'none';
  }

  // Clicking the site's Apply button on a job this profile already applied to: stop and ask first.
  const APPLY_RE = /^(easy apply|quick apply|1-click apply|apply|apply now|apply here|apply today|apply online|apply for (this )?(job|position|role)|apply on (the )?company (site|website)|apply with [a-z ]+|submit( your)? application|send application|i'?m interested)$/i;
  let applyBypass = false;
  const agoText = (d) => {
    const days = Math.floor((Date.now() - new Date(d)) / 864e5);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  document.addEventListener('click', (e) => {
    if (applyBypass || !e.isTrusted || !IS_TOP || !appliedState.matches.length) return;
    const el = e.target.closest?.('button, a, input[type=submit], input[type=button], [role=button]');
    if (!el || el.closest('#jobbid-root, #jobbid-root-panel')) return;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40 || !APPLY_RE.test(label)) return;
    const mine = appliedState.matches.filter((m) => m.profileId === appliedState.profileId);
    const others = appliedState.matches.filter((m) => m.profileId !== appliedState.profileId);
    const when = (m) => `${new Date(m.date).toLocaleDateString(self.jbI18n?.locale)} (${agoText(m.date)})`;
    if (!mine.length) {
      // Another profile applied: just let the user know.
      toast({ kind: 'info', title: 'Another profile already applied', msg: others.map((m) => `${m.profileName} on ${when(m)}`).join(', '), ms: 8000 });
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    const m = mine[0];
    toast({
      kind: 'warn',
      title: 'Already applied to this job',
      msg: `${m.title || 'This job'}${m.company ? ' at ' + m.company : ''} - ${m.profileName} applied on ${when(m)}.${others.length ? ` Also: ${others.map((o) => o.profileName).join(', ')}.` : ''}`,
      ms: 0,
      actions: [
        { label: 'Cancel' },
        { label: 'Apply anyway', primary: true, onClick: () => { applyBypass = true; el.click(); setTimeout(() => (applyBypass = false), 800); } },
      ],
    });
  }, true);

  // Tell the hub's Job links page that this job is being worked on ('fill') or was sent ('submit').
  // The background keeps it to once per job and step every 10 minutes; nothing when offline.
  function touchJob(kind, p) {
    if (!p) return;
    const job = getJob();
    send({ type: 'jobTouch', kind, url: location.href, title: job.title, company: job.company, profileId: p.id, profileName: p.label || p.fullName || '' }).catch?.(() => {});
  }

  // After a fill, offer to log the application when the user clicks a final submit button.
  let lastFill = null;
  let promptedFor = '';
  async function maybePromptLog(target) {
    if (!lastFill || Date.now() - lastFill.at > 30 * 60 * 1000 || promptedFor === location.href) return;
    const el = target?.closest?.('button, input[type=submit], [role=button], a');
    if (!el || el.closest('#jobbid-root')) return;
    const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!/submit|send application|apply|finish|complete application/.test(label) || /next|continue|back|save|review|cancel/.test(label)) return;
    // "Apply now" on a job page starts an application; it doesn't send one.
    if (/^(easy |quick |1-click )?apply( now| here| today| online| for .*| on .*| with .*)$/.test(label)) return;
    // Submit clicked after a fill: "Submitted" on Job links, even if nobody answers "Log it".
    touchJob('submit', lastFill.profile);
    const ctx = await send({ type: 'getContext' });
    if (!ctx.ok || ctx.settings.promptLog === false) return;
    promptedFor = location.href;
    const profile = lastFill.profile;
    // Re-check the tracker right now: never ask to log a job this profile already logged.
    const job = getJob();
    const dup = await send({ type: 'checkApplied', url: location.href, title: job.title, company: job.company });
    if (dup.ok && dup.matches.some((m) => m.profileId === profile.id)) return;
    setTimeout(() => toast({
      kind: 'info',
      title: 'Did you submit this application?',
      msg: 'Log it so you never apply to the same job twice.',
      ms: 20000,
      actions: [{ label: 'Log it', primary: true, onClick: () => logApplication(profile) }, { label: 'Not yet' }],
    }), 1200);
  }
  document.addEventListener('click', (e) => maybePromptLog(e.target), true);

  // ---------- Learning answers ----------
  // When the user answers (or corrects) a question themselves, save it to the
  // profile so the same question is filled automatically next time.

  const SENSITIVE = /ssn|social security|password|passcode|card number|credit card|cvv|cvc|bank|routing|account number|iban|passport number|licen[cs]e number|date of birth|birth ?date|\bdob\b|birthday|birth\s*(day|month|year|yr)|year of birth|captcha|verification code|one time/;
  const JOB_SPECIFIC = /\bwhy\b.{0,40}\b(you|this|our|us|join|work|apply|applying|interested|want)\b|cover letter|tell us why|what excites|what interests you|about us|motivat|(message|note) to (the )?(hiring|recruit)|introduce yourself|personal statement|\bletter\b/;
  // Text written for one company (a letter: "Dear...", "Sincerely") must never be reused for another job.
  const letterLike = (t) => /^\s*(dear|hello|hi|to whom)\b/i.test(t) || /\b(sincerely|best regards|kind regards|warm regards|yours (truly|faithfully))\b/i.test(t) || /\bcover letter\b/i.test(t);
  let learned = {};
  let learnTimer;
  let lastLearn = null;
  let ctxCache = null;

  async function learnContext() {
    if (!ctxCache || Date.now() - ctxCache.at > 30000) ctxCache = { at: Date.now(), ctx: await send({ type: 'getContext' }) };
    const ctx = ctxCache.ctx;
    if (!ctx.ok || ctx.settings.learnAnswers === false) return null;
    return lastFill ? lastFill.profile : ctx.profile;
  }

  // Answers are learned only on application pages. Gmail, ChatGPT and job-board search filters once saved
  // "To", "Subject", "Search", "Date posted"... as answers, which then went into every box with that label.
  const NOT_APPLY_HOST = /(^|\.)(mail\.google\.com|docs\.google\.com|calendar\.google\.com|www\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|chatgpt\.com|openai\.com|gemini\.google\.com|claude\.ai|perplexity\.ai|copilot\.microsoft\.com|github\.com|stackoverflow\.com|youtube\.com|facebook\.com|x\.com|twitter\.com|reddit\.com)$/;
  const ATS_HOST = /myworkdayjobs|workday|greenhouse|lever\.co|ashbyhq|icims|smartrecruiters|successfactors|oraclecloud|taleo|jobvite|workable|bamboohr|applytojob|breezy|recruitee|teamtailor|paylocity|ultipro|dayforcehcm|adp\.com|smartapply\.indeed/;
  const SEARCH_BOX = /^(search|filter|filters|keywords?|sort by|date posted|job type|experience level)\b|search radius|radius within|type to (search|filter)|search for\b/;
  let applySeen = false, learnPageAt = 0, learnPageOk = false;
  function learnablePage() {
    // Google Forms applications are fine.
    if (NOT_APPLY_HOST.test(location.hostname) && !/^\/forms\//.test(location.pathname)) return false;
    if (applySeen || lastFill) return true;
    if (Date.now() - learnPageAt < 2000) return learnPageOk;
    const fields = collectFields();
    const keys = new Set(fields.map((f) => ruleFor(f)?.key).filter(Boolean));
    // A resume upload, or name + email boxes, or an applicant-tracking site's form. Once seen, the later
    // steps of the same application (screening questions only) count too.
    learnPageOk = fields.some((f) => f.kind === 'file') || (keys.has('email') && (keys.has('firstName') || keys.has('lastName') || keys.has('phone')))
      || (ATS_HOST.test(location.hostname) && fields.length >= 2);
    learnPageAt = Date.now();
    if (learnPageOk) applySeen = true;
    return learnPageOk;
  }

  const comboLearned = new WeakMap(); // combobox -> last choice saved
  async function learnFromClick(target) {
    // Custom dropdown: the user picked something if its placeholder went away.
    setTimeout(() => {
      for (const [trigger, f] of dropdownRegistry) {
        if (!trigger.isConnected) { dropdownRegistry.delete(trigger); continue; }
        const shown = textOf(trigger).replace(/[▾▼⌄˅]/g, '').trim();
        if (shown && !PLACEHOLDER.test(shown) && f.lastLearned !== shown) {
          f.lastLearned = shown;
          learnFrom(trigger, [f], shown);
        }
      }
      // Search-style dropdowns: remember the choice shown after the user picked it.
      for (const f of collectFields()) {
        if (f.kind !== 'combobox' || !f.label) continue;
        const shown = comboShown(f.el);
        if (shown && comboLearned.get(f.el) !== shown) { comboLearned.set(f.el, shown); learnFrom(f.el, [f], shown); }
      }
    }, 350);
    const fields = collectFields();
    const multi = fields.find((x) => x.kind === 'multi' && x.els.some((b) => b === target || b.contains(target)));
    if (multi) {
      await sleep(200);
      const picked = multi.options.filter((_, i) => isSelected(multi.els[i]));
      if (picked.length) learnFrom(multi.el, [multi], picked.join(', '));
      return;
    }
    const f = fields.find((x) => x.kind === 'choice' && x.els.some((b) => b === target || b.contains(target)));
    if (!f) return;
    const i = f.els.findIndex((b) => b === target || b.contains(target));
    learnFrom(f.els[i], fields, f.options[i]);
  }

  async function learnFrom(el, fields = null, clicked = null) {
    if (!clicked && !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (el.closest('#jobbid-root') || el.type === 'password' || el.type === 'file' || el.type === 'checkbox') return;
    fields ||= collectFields();
    if (!clicked && !isForm(fields)) return; // not an application form
    if (!learnablePage()) return;
    const f = fields.find((x) => x.el === el || (x.els && x.els.includes(el)));
    if (!f || !f.label) return;
    if (SENSITIVE.test(norm(f.label + ' ' + f.hint)) || isOneTime(f)) return;
    if (SEARCH_BOX.test(norm(f.label)) || el.type === 'search' || el.getAttribute?.('role') === 'searchbox') return;
    const p = await learnContext();
    if (!p) return;
    let rule = ruleFor(f);

    let v = clicked || '';
    if (clicked) {}
    else if (f.kind === 'select') v = el.selectedIndex >= 0 && el.value !== '' ? el.options[el.selectedIndex].text.trim() : '';
    else if (f.kind === 'radio') { const i = f.els.findIndex((r) => r.checked); v = i >= 0 ? f.options[i] : ''; }
    else v = String(el.value || '').trim();
    if (!v || /^(select|choose|please select)/i.test(v)) return;
    // A plain Yes/No is the answer to a question, never a name, city, state...
    if (rule && TEXT_KEYS.test(rule.key || '') && /^(yes|no)$/.test(norm(v))) rule = null;

    if (rule) {
      // A derived value (e.g. "City, State", a link chosen from the profile): kept for this exact question.
      if (!rule.key) return rememberAnswer(p, f, v);
      if (YESNO_KEYS.includes(rule.key)) {
        // The answer to this exact question is kept too ("convicted ... or found not guilty by reason
        // of insanity" is not the profile's plain "Ever convicted?"), and it wins over the profile next time.
        rememberAnswer(p, f, v);
        const w = norm(v).split(' ')[0];
        if (w !== 'yes' && w !== 'no') return;
        v = w === 'yes' ? 'Yes' : 'No';
      }
      if (['linkedin', 'github'].includes(rule.key)) v = withHttps(v);
      if (!YESNO_KEYS.includes(rule.key) && !plausible(rule.key, v)) return; // not that kind of value: not saved anywhere
      const current = String(p[rule.key] ?? '').trim();
      if (norm(current) === norm(v) || withHttps(current) === v) return;
      return offerProfileUpdate(p, rule.key, v, current);
    }
    if (f.kind === 'textarea' && (v.length > 3000 || JOB_SPECIFIC.test(norm(f.label)) || letterLike(v))) return;
    rememberAnswer(p, f, v);
  }

  // The answer to this question, saved to the profile's Saved answers (shown with Undo).
  function rememberAnswer(p, f, v) {
    const key = cleanQ(f.label);
    if (!usefulLabel(key) || answerKey(key).length <= 3 || isOneTime(f)) return;
    const existing = Object.fromEntries(Object.entries(p.customAnswers || {}).map(([k, a]) => [answerKey(k), a]));
    if (existing[answerKey(key)] === v) return;
    learned[key] = v;
    p.customAnswers = { ...(p.customAnswers || {}), [key]: v };
    clearTimeout(learnTimer);
    learnTimer = setTimeout(() => flushLearned(p), 1200);
  }

  // Empty profile field: save right away (with Undo). Different value: ask first,
  // because a site-specific variation shouldn't silently overwrite the profile.
  async function offerProfileUpdate(p, key, value, current) {
    const first = (p.label || p.fullName || 'profile').split(' ')[0];
    const name = FIELD_NAMES[key] || key;
    const save = async () => {
      const r = await send({ type: 'updateProfileField', profileId: p.id, key, value });
      if (!r.ok) return;
      p[key] = value;
      showChip(`Saved ${name} to ${first}'s profile`, 'Undo', async () => {
        await send({ type: 'updateProfileField', profileId: p.id, key, value: current });
        p[key] = current;
      });
    };
    if (!current) return save();
    showChip(`Update ${name} in ${first}'s profile?`, 'Update', save, 12000);
  }

  function showChip(text, buttonLabel, onClick, ms = 6000) {
    const { learn } = getUI();
    learn.querySelector('.txt').textContent = text;
    const btn = learn.querySelector('button');
    btn.textContent = buttonLabel;
    btn.onclick = async () => {
      learn.style.display = 'none';
      await onClick();
    };
    learn.style.display = 'flex';
    clearTimeout(learn._t);
    learn._t = setTimeout(() => (learn.style.display = 'none'), ms);
  }

  async function flushLearned(p) {
    const answers = learned;
    learned = {};
    const keys = Object.keys(answers);
    if (!keys.length) return;
    const r = await send({ type: 'saveAnswers', profileId: p.id, answers });
    if (!r.ok) return;
    lastLearn = { profileId: p.id, keys, profile: p };
    const first = (p.label || p.fullName || 'profile').split(' ')[0];
    showChip(`Remembered ${keys.length} answer${keys.length === 1 ? '' : 's'} for ${first}`, 'Undo', undoLearn);
  }

  async function undoLearn() {
    if (!lastLearn) return;
    await send({ type: 'removeAnswers', profileId: lastLearn.profileId, keys: lastLearn.keys });
    for (const k of lastLearn.keys) delete lastLearn.profile.customAnswers[k];
    lastLearn = null;
  }

  async function saveQuestionsNow() {
    const ctx = await send({ type: 'getContext' });
    const p = ctx.ok && ctx.profile;
    if (!p) return { added: 0 };
    const known = Object.fromEntries(Object.entries(p.customAnswers || {}).map(([k, a]) => [answerKey(k), a]));
    const questions = collectFields()
      .filter((f) => f.kind !== 'file' && f.label && !hasValue(f) && !ruleFor(f))
      .filter((f) => !SENSITIVE.test(norm(f.label + ' ' + f.hint)) && !(f.kind === 'textarea' && JOB_SPECIFIC.test(norm(f.label))))
      .map((f) => ({ q: cleanQ(f.label), options: (f.options || []).slice(0, 40) }))
      .filter((x) => x.q.length > 3 && known[answerKey(x.q)] === undefined);
    if (!questions.length) return { added: 0, profile: p };
    const r = await send({ type: 'savePendingQuestions', profileId: p.id, questions });
    return { added: r.ok ? r.added : 0, profile: p };
  }

  // Only real user edits count (JobBid's own fills dispatch untrusted events).
  document.addEventListener('change', (e) => e.isTrusted && learnFrom(e.target), true);
  document.addEventListener('click', (e) => e.isTrusted && !e.target.closest?.('#jobbid-root') && setTimeout(() => learnFromClick(e.target), 50), true);
  // Choosing in a search-style dropdown with the keyboard (type, then Enter or Tab) is learned too.
  document.addEventListener('keydown', (e) => e.isTrusted && (e.key === 'Enter' || e.key === 'Tab') && e.target.getAttribute?.('role') === 'combobox'
    && !e.target.closest?.('#jobbid-root') && setTimeout(() => learnFromClick(e.target), 50), true);

  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { refreshButton(); checkApplied(); }, 1200);
  }).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((c) => (c.settings || c.profiles) && refreshButton());
  refreshButton();
  checkApplied();
  continueAfterApply();

  // ---------- Opening the application (the job's Apply button) ----------
  // A job page often shows only the description and an Apply button. JobBid presses it, and the
  // "Apply Manually" choice some sites show next (Workday). If that opens the form on a new page or in a
  // new tab, the background remembers it and the new page fills (or auto-bids) by itself.

  const APPLY_OPEN = /^(apply|apply now|apply here|apply today|apply online|apply for (this )?(job|position|role)|i'?m interested|start (your |my )?application|begin (your )?application)$/i;
  const APPLY_MANUAL = /^(apply manually|apply without (a )?(resume|linkedin|account)|fill (out )?(the )?(application|form) manually)$/i;
  // Arrows and icons around the words don't count ("APPLY NOW ↗" on Jobright, "→ Apply").
  const BUTTON_ICONS = /^[\s\u2190-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F]+|[\s\u2190-\u2BFF\u{1F000}-\u{1FAFF}\uFE0F]+$/gu;
  const pageButton = (re) => [...document.querySelectorAll('a, button, [role=button], input[type=button], input[type=submit]')]
    .find((b) => isVisible(b) && !b.closest('#jobbid-root, #jobbid-root-panel') && re.test((textOf(b) || b.value || b.getAttribute('aria-label') || '').replace(BUTTON_ICONS, '').trim()));
  // A big embedded frame may hold the form (company site with a Greenhouse frame): don't press Apply then.
  const bigFrame = () => [...document.querySelectorAll('iframe')].some((f) => { const r = f.getBoundingClientRect(); return isVisible(f) && r.width > 300 && r.height > 300; });
  // An application window is already open over the page (ZipRecruiter, LinkedIn Easy Apply): even a step
  // with only dropdowns (Veteran / Race / Gender) is the form. Pressing the page's Apply behind it would
  // open another tab (an ad) instead of filling it.
  const popupBox = (el) => {
    const d = composedClosest(el, '[role=dialog], [role=alertdialog], [aria-modal=true], dialog');
    if (d) return d;
    for (let n = el, k = 0; n && n !== document.body && k < 40; n = composedParent(n), k++) {
      if (n.nodeType === 1 && getComputedStyle(n).position === 'fixed') return n;
    }
    return null;
  };
  // A sticky search bar is fixed too, so only a window-sized box counts.
  const popupForm = () => collectFields().some((f) => {
    const box = f.el && f.kind !== 'file' && popupBox(f.el);
    if (!box || box.closest?.('#jobbid-root, #jobbid-root-panel')) return false;
    const r = box.getBoundingClientRect();
    return r.width > 320 && r.height > 250;
  });
  const needsApplyClick = () => IS_TOP && !isForm(formFields()) && !bigFrame() && !popupForm() && !!(pageButton(APPLY_OPEN) || pageButton(APPLY_MANUAL));

  // 'form' = the form is here now, 'signin' = the site wants an account, 'away' = going to another page, '' = nothing happened.
  async function openApplication() {
    const btn = pageButton(APPLY_OPEN) || pageButton(APPLY_MANUAL);
    if (!btn) return '';
    const ok = await send({ type: 'fillAfterApply', localMode: localBidMode });
    if (ok && ok.ok === false && ok.loop) return '';
    let left = false;
    const onLeave = () => { left = true; };
    window.addEventListener('pagehide', onLeave, { once: true });
    btn.click();
    for (let i = 0; i < 24 && !left; i++) {
      await sleep(600);
      const manual = pageButton(APPLY_MANUAL);
      if (manual && manual !== btn) { manual.click(); await sleep(1200); }
      if (visiblePassword()) { send({ type: 'takePendingFill' }); return 'signin'; }
      if (isForm(formFields())) { send({ type: 'takePendingFill' }); return 'form'; }
    }
    if (left) return 'away';
    // The form opened in a new tab (that tab took over).
    const r = await send({ type: 'takePendingFill' });
    return r.taken ? 'away' : '';
  }

  // After JobBid pressed Apply on the previous page (or the tab that opened this one).
  async function continueAfterApply() {
    if (!IS_TOP) return;
    const r = await send({ type: 'takePendingFill' });
    if (!r.ok || !r.pending) return;
    if (r.bidMode) return autoBid({ mode: r.bidMode });
    if (r.localMode) return autoBid({ mode: r.localMode, local: true });
    for (let i = 0; i < 30 && !isForm(formFields()); i++) {
      if (visiblePassword()) break;
      const manual = pageButton(APPLY_MANUAL);
      if (manual) { manual.click(); await sleep(1500); continue; }
      await sleep(700);
    }
    if (visiblePassword()) return toast({ kind: 'warn', title: 'Sign in first', msg: 'This site needs an account to apply. Sign in or create one, then press Fill.', ms: 12000 });
    if (isForm(formFields())) fill({});
  }

  // ---------- Auto bid ----------
  // The background worker opened this tab for one job of the hub's auto-bid queue. Fill the form, let the
  // AI answer what is left, then either leave it for you to check (review mode) or submit it (auto mode).
  // Anything uncertain stops with a reason instead of guessing: captcha, sign-in, unanswered questions,
  // no Submit button, no confirmation.

  const BID_SUCCESS = /thank(s| you) for (applying|your application|your interest|submitting)|application (was |has been |is )?(successfully )?(submitted|received|sent|complete)|we('ve| have) received your application|successfully (submitted|applied)|your application (is in|has been)|application submitted/i;
  const BID_CLOSED = /no longer (available|accepting|open)|(position|job|role) (has been |is )?(filled|closed)|this job (is )?(closed|expired)|job not found|page (you're looking for )?(was )?not found/i;
  let bidRunning = false;

  const formFields = () => collectFields().filter((f) => f.kind !== 'listbox');
  async function waitForForm(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = formFields();
      if (isForm(f)) return f;
      await sleep(700);
    }
    return null;
  }
  const visiblePassword = () => deepQueryAll('input[type=password]').some(isVisible);
  // A captcha that wants a person: the reCAPTCHA / hCaptcha picture challenge, or a visible checkbox widget.
  const captchaShown = () => [...document.querySelectorAll('iframe')].some((f) => {
    const src = f.src || '';
    if (!/recaptcha|hcaptcha|turnstile|captcha/i.test(src) || !isVisible(f)) return false;
    const r = f.getBoundingClientRect();
    return r.width > 60 && r.height > 60 && !/recaptcha\/(api2|enterprise)\/anchor.*size=invisible/.test(src);
  });
  const requiredMissing = () => collectFields().filter((f) => f.required && !hasValue(f));
  const pageErrors = () => deepQueryAll('[role=alert], [class*="error" i], [aria-invalid="true"]')
    .filter((e) => isVisible(e) && !e.closest('#jobbid-root'))
    .map((e) => (e.getAttribute('aria-invalid') === 'true' ? labelFor(e) + ' is invalid' : textOf(e)))
    .filter((t) => t && t.length < 160);

  // Multi-page applications (Workday, Oracle, SuccessFactors, iCIMS...): each step is filled, then its
  // Continue / Next button is pressed, until the page with the final Submit.
  const NEXT_RE = /^(continue|next|next step|save (and|&) continue|save (and|&) next|continue to next step|proceed|review|review application)$/i;
  const btnLabel = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  function findNextButton() {
    // Workday's footer button (it says "Continue", "Save and Continue", and "Submit" on the last step).
    const wd = document.querySelector('[data-automation-id="bottom-navigation-next-button"], [data-automation-id="pageFooterNextButton"]');
    if (wd && isVisible(wd) && !wd.disabled && NEXT_RE.test(btnLabel(wd))) return wd;
    return deepQueryAll('button, input[type=submit], input[type=button], [role=button]')
      .filter((b) => isVisible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('#jobbid-root, #jobbid-root-panel'))
      .reverse() // the page's own footer buttons come last
      .find((b) => NEXT_RE.test(btnLabel(b))) || null;
  }
  // What is on screen: the step's headings and its questions. Changes when the next step opens.
  const stepSig = () => [...document.querySelectorAll('h1, h2, h3, [data-automation-id="pageHeaderTitle"]')].filter(isVisible).map(textOf).join('|').slice(0, 300)
    + '#' + formFields().map((f) => f.label).join('|').slice(0, 600);
  const stepName = () => {
    const active = document.querySelector('[data-automation-id="progressBarActiveStep"], [aria-current="step"]');
    if (active && isVisible(active)) return textOf(active).replace(/^(current step|step \d+ of \d+)\s*/i, '').slice(0, 60);
    const hs = [...document.querySelectorAll('[data-automation-id="pageHeaderTitle"], h2, h1')].filter((h) => isVisible(h) && !h.closest('#jobbid-root, #jobbid-root-panel') && textOf(h).length < 70);
    return textOf(hs.find((h) => h.matches('[data-automation-id="pageHeaderTitle"]')) || hs[hs.length - 1]).slice(0, 60);
  };
  // A step page also counts as the form: Workday's first step is only a resume drop box and Continue.
  const isStepPage = (f) => isForm(f) || (f.length >= 1 && !!findNextButton());
  async function waitForStep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = formFields();
      if (isStepPage(f)) return f;
      await sleep(700);
    }
    return null;
  }
  // An upload still running (the site reads the resume): Continue would not move on yet.
  const uploading = () => deepQueryAll('[role=progressbar], [data-automation-id*="upload" i][data-automation-id*="progress" i], [class*="uploading" i]')
    .some((e) => isVisible(e) && !e.closest('[data-automation-id^="progressBar"], [role=list], ol, nav') && textOf(e).length < 60 && e.getAttribute('aria-valuenow') !== '100')
    || deepQueryAll('[data-automation-id*="file-upload" i] *, [class*="upload" i] *').some((e) => isVisible(e) && /^(uploading|processing|parsing)\b/i.test(textOf(e)) && textOf(e).length < 40);

  // Each step, for the status line under "Auto-apply this job" in the side panel.
  const bidStatus = (text, note = '', kind = 'run') => { try { window.__jobbidBidStatus?.({ text, note, kind }); } catch { /* no panel */ } };

  async function runBid(mode) {
    bidStatus('Looking for the application form');
    let fields = await waitForStep(needsApplyClick() ? 3000 : 15000);
    if (!fields && needsApplyClick()) {
      bidStatus('Pressing Apply', 'Opening the application form');
      const r = await openApplication();
      if (r === 'away') return new Promise(() => {}); // the next page carries on and reports
      fields = r === 'form' ? formFields() : await waitForStep(5000);
    }
    if (visiblePassword()) return { status: 'needs', reason: 'This site asks you to sign in or create an account.' };
    if (!fields) {
      if (BID_CLOSED.test(document.body.innerText || '')) return { status: 'skipped', reason: 'The job is closed.' };
      return { status: 'needs', reason: 'No application form found on the page.' };
    }
    const ctx = await send({ type: 'getContext' });
    const p = ctx.profile;
    if (!ctx.ok || !p) return { status: 'failed', reason: ctx.error || 'No profile' };

    aiTouched.clear();
    // AI guesses on every step: earlier steps leave the page, but their answers are still in the application.
    const guessedAll = new Set();
    let steps = 0;
    for (;;) {
      steps++;
      const where = stepName();
      const at = steps > 1 || findNextButton() ? `Step ${steps}${where ? `: ${where}` : ''}` : `As ${p.label || p.fullName}`;
      bidStatus('Filling the form', at);
      // A second pass only when the first one brought new questions (they appear after earlier answers).
      const labels = () => formFields().map((f) => f.label).join('|');
      const before = labels();
      await fill({ noApply: true, noAutoSubmit: true });
      await settle(500);
      if (labels() !== before) {
        bidStatus('Filling the form', `${at} - new questions appeared`);
        await fill({ noApply: true, noAutoSubmit: true });
        await settle(400);
      }

      let missing = requiredMissing();
      const askable = missing.filter((f) => f.kind !== 'file');
      if (askable.length) {
        bidStatus(`Asking the AI (${askable.length} question${askable.length === 1 ? '' : 's'})`, askable.slice(0, 3).map((f) => cleanQ(f.label || f.hint)).filter(Boolean).join(' · '));
        const r = await aiAnswerNow(askable);
        if (r && r.ok === false && r.error) toast({ kind: 'warn', title: 'Auto bid: AI problem', msg: r.error, ms: 8000 });
        await sleep(1000);
      }
      missing = requiredMissing();
      if (missing.length) {
        const names = missing.map((f) => cleanQ(f.label || f.hint) || f.kind).slice(0, 5);
        return { status: 'needs', reason: `${steps > 1 ? `${at} - ` : ''}${missing.length} required question${missing.length === 1 ? '' : 's'} not answered: ${names.join(' · ')}`.slice(0, 480), detail: { questions: names } };
      }
      for (const [, x] of aiTouched) if (x.kind !== 'textarea') guessedAll.add(x.q || 'A question');

      // The last step (its button says Submit), or a one-page form: done here.
      const next = findNextButton();
      if (!next || steps >= 12) break;
      // The resume is still being read by the site: Continue would not move on yet.
      for (let t = 0; t < 20 && uploading(); t++) { if (!t) bidStatus('Waiting for the upload', 'The site is reading the resume'); await sleep(500); }
      bidStatus('Next step', `Pressing "${btnLabel(next)}"`);
      const sig = stepSig();
      next.click();
      let moved = false;
      for (let t = 0; t < 60 && !moved; t++) { await sleep(250); moved = stepSig() !== sig; }
      if (!moved) {
        const errs = pageErrors();
        return { status: 'needs', reason: `${at} was not accepted: ${errs.slice(0, 3).join(' · ') || 'the page did not move on after Continue'}`.slice(0, 480) };
      }
      // The new step finishes drawing: the same questions twice in a row (at most 3 s).
      for (let t = 0, last = ''; t < 12; t++) { await sleep(250); const now = stepSig(); if (now === last) break; last = now; }
      if (visiblePassword()) return { status: 'needs', reason: 'This site asks you to sign in or create an account.' };
    }

    // Full auto sends nothing the AI guessed for a fact (yes/no, a choice, years, salary...): a wrong
    // "Yes, I have a clearance" goes to the employer. AI-written essay answers may still go.
    const guessed = [...guessedAll];
    if (mode === 'auto' && guessed.length) {
      toast({ kind: 'warn', title: 'Auto bid: check the AI answers', msg: `The AI answered ${guessed.length} question${guessed.length === 1 ? '' : 's'} (purple). Check ${guessed.length === 1 ? 'it' : 'them'}, then press Submit.`, ms: 0 });
      return { status: 'review', reason: `Not sent: the AI answered ${guessed.length} question${guessed.length === 1 ? '' : 's'} - check before submitting: ${guessed.slice(0, 4).join(' · ')}`.slice(0, 480), detail: { aiQuestions: guessed.slice(0, 10) } };
    }

    if (mode !== 'auto') {
      toast({ kind: 'ok', title: 'Auto bid: ready for you', msg: `Filled as ${p.label || p.fullName}. Check the answers, then press Submit.`, ms: 0 });
      return { status: 'review', reason: steps > 1 ? `Filled ${steps} steps. Check the answers, then press Submit.` : 'Filled. Check it and press Submit.' };
    }

    const btn = findSubmitButton(collectFields());
    if (!btn) return { status: 'needs', reason: 'No final Submit button found (a form with several pages?).' };
    if (captchaShown()) return { status: 'needs', reason: 'A captcha must be solved by you.' };
    bidStatus('Submitting', 'Waiting for the site to confirm (up to 30 seconds)');
    const before = location.href;
    const thanksBefore = BID_SUCCESS.test(document.body.innerText || '');
    promptedFor = location.href; // logged below, so don't also ask "Did you submit?"
    btn.click();
    // From here on the application may have been sent: the hub never sends it again by itself.
    const pressed = (r) => ({ ...r, detail: { ...(r.detail || {}), submitPressed: true } });
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      await sleep(1000);
      const text = document.body.innerText || '';
      const moved = location.href !== before && /confirm|thank|success|submitted|complete/i.test(location.href);
      const formGone = formFields().length < 2;
      if ((!thanksBefore && BID_SUCCESS.test(text)) || moved || (formGone && BID_SUCCESS.test(text))) {
        await logApplication(p);
        return { status: 'submitted', reason: '' };
      }
      if (captchaShown()) return pressed({ status: 'needs', reason: 'A captcha appeared after Submit. Solve it in the tab and submit.' });
      if (Date.now() > end - 22000 && requiredMissing().length) {
        return pressed({ status: 'needs', reason: `The site did not accept the form: ${pageErrors().slice(0, 3).join(' · ') || 'a required field is empty'}`.slice(0, 480) });
      }
    }
    const errs = pageErrors();
    if (errs.length) return pressed({ status: 'needs', reason: `The site did not accept the form: ${errs.slice(0, 3).join(' · ')}`.slice(0, 480) });
    // No error and no "thank you" page: it most likely went through. Logged, so it is never applied to twice.
    await logApplication(p);
    return pressed({ status: 'needs', reason: 'Submit was pressed, but no confirmation was seen. Logged as applied - check the tab or your email.' });
  }

  // local: "Auto-apply this job" in the panel (this page only, not the hub's queue): the result is shown here.
  let localBidMode = '';
  async function autoBid({ mode, local = false }) {
    if (bidRunning) return;
    bidRunning = true;
    localBidMode = local ? mode : '';
    if (local) toast({ kind: 'info', title: 'Auto-applying this job...', msg: mode === 'auto' ? 'Fill, AI, then Submit.' : 'Fill and AI - you press Submit.', ms: 5000, progress: true });
    let result;
    try {
      result = await runBid(mode);
    } catch (e) {
      result = { status: 'failed', reason: e.message || String(e) };
    } finally {
      bidRunning = false;
      localBidMode = '';
    }
    // The result stays under the panel's button.
    const KIND = { submitted: 'ok', review: 'ok', needs: 'warn', skipped: 'warn', failed: 'err' };
    const TITLE = { submitted: 'Application submitted', review: 'Ready for you to check and submit', needs: 'Needs you', skipped: 'Skipped', failed: 'Auto-apply failed' };
    bidStatus(TITLE[result.status] || result.status, result.reason || '', KIND[result.status] || 'warn');
    if (!local) return send({ type: 'autoBidResult', result: { ...result, url: location.href } });
    const T = { submitted: ['ok', 'Application submitted'], review: ['ok', 'Ready for you'], needs: ['warn', 'Needs you'], skipped: ['warn', 'Skipped'], failed: ['err', 'Auto-apply failed'] }[result.status] || ['warn', result.status];
    if (result.status !== 'review') toast({ kind: T[0], title: T[1], msg: result.reason || 'Done.', ms: 12000 });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'fill') {
      fill(msg).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'togglePanel' && IS_TOP) {
      window.__jobbidPanelToggle?.();
      sendResponse({ ok: !!window.__jobbidPanelToggle });
      return false;
    }
    if (msg.type === 'getJob' && IS_TOP) {
      sendResponse({ ok: true, job: getJob() });
    }
    if (msg.type === 'autoBid' && IS_TOP) {
      autoBid(msg);
      sendResponse({ ok: true });
    }
    return false;
  });

  // Shared with panel.js (same isolated world, not visible to the page).
  window.__jobbid = { isFilling: () => filling, autoBid, isQuestion, noAiQuestion, aiAnswerNow, checkConsents, collectFields, hasValue, fill, getJob, send, sourceOf, cleanQ, norm, textOf, isVisible, logApplication, toast, setUiOffset, IS_TOP, alive, shutDown, saveQuestionsNow, attachResumeNow, attachedName, isFixedResume, chooseResume };
})();
