// Regression tests for the form filler.
// Every fixtures/*.html is an application form (copied from a real site, with a little script where the
// site's own widgets need one). Each is opened in headless Chrome, the extension's real content.js is
// added with a stand-in for the Chrome extension APIs, Fill is pressed, and the <script id="expect">
// list in the page says what every box must hold afterwards.
//   npm test                 all forms
//   npm test -- greenhouse   only forms whose file name contains "greenhouse"
//   npm test -- --show       with a visible browser window
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = process.env.JOBBID_EXT_DIR || path.resolve(here, '..', 'JobBidExtension');
const FIX = path.join(here, 'fixtures');
const args = process.argv.slice(2);
const show = args.includes('--show');
const only = args.filter((a) => !a.startsWith('--'));
const profile = JSON.parse(fs.readFileSync(path.join(here, 'profile.json'), 'utf8'));

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Google Chrome not found. Set CHROME_PATH.'); process.exit(2); }

// Forms are served over http (some code reads location.origin), each under its own path.
const server = http.createServer((req, res) => {
  const f = path.join(FIX, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''));
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// The extension's background, as far as a fill needs it.
function fakeChrome(profile) {
  const reports = [];
  window.__jbReports = reports;
  const answer = (msg) => {
    switch (msg.type) {
      case 'getContext': return { ok: true, profile, settings: { overwrite: false, useAI: false, learnAnswers: false, autoSubmit: false } };
      case 'takeFixedResume': return { ok: true, file: null };
      case 'savePendingQuestions': return { ok: true, added: 0 };
      case 'fillReport': reports.push(msg.report); return { ok: true };
      case 'autoBidResult': window.__jbBidResult = msg.result; return { ok: true };
      case 'logApplication': window.__jbLogged = (window.__jbLogged || 0) + 1; return { ok: true };
      case 'checkApplied': return { ok: true, matches: [] };
      case 'takePendingFill': return { ok: true, pending: null };
      // Any resume file: a tiny PDF.
      case 'getFile': return { ok: true, data: 'JVBERi0xLjQKJSVFT0YK' };
      default: return { ok: true };
    }
  };
  const listeners = [];
  window.chrome = {
    runtime: {
      id: 'jobbid-test', lastError: undefined,
      getManifest: () => ({ version: 'test' }),
      getURL: (p) => p,
      sendMessage(msg, cb) { const r = answer(msg); if (typeof cb === 'function') { setTimeout(() => cb(r), 0); return undefined; } return Promise.resolve(r); },
      onMessage: { addListener: (f) => listeners.push(f) },
    },
    storage: { onChanged: { addListener() {} }, local: { get: async () => ({}), set: async () => {} } },
  };
  // Full auto / Review like the hub's queue: resolves with the result the tab would report.
  window.__jbBid = (mode) => new Promise((resolve) => {
    for (const f of listeners) f({ type: 'autoBid', mode }, {}, () => {});
    const t0 = Date.now();
    const wait = () => (window.__jbBidResult ? resolve({ ok: true, result: window.__jbBidResult }) : Date.now() - t0 > 120000 ? resolve({ ok: false, error: 'timeout' }) : setTimeout(wait, 300));
    wait();
  });
  window.__jbFill = () => new Promise((resolve) => {
    let done = false;
    for (const f of listeners) f({ type: 'fill', noApply: true }, {}, (r) => { done = true; resolve(r); });
    setTimeout(() => !done && resolve({ ok: false, error: 'timeout' }), 90000);
  });
}

// What a box holds, as a person would read it.
function readBack(checks) {
  const textOf = (n) => (n ? (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim() : '');
  return checks.map((c) => {
    const els = [...document.querySelectorAll(c.sel)];
    const el = els[0];
    let got;
    if (!el) got = '(missing)';
    else if (c.checked !== undefined) got = el.checked;
    else if (c.picked) got = els.filter((e) => e.checked).map((e) => e.value).join(',');
    else if (c.text) got = textOf(el);
    else got = el.value;
    const want = c.checked ?? c.picked ?? c.text ?? c.value ?? c.contains;
    const ok = c.contains !== undefined ? String(got).toLowerCase().includes(String(c.contains).toLowerCase()) : String(got) === String(want);
    return { name: c.name || c.sel, want, got, ok };
  });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: !show, args: ['--no-first-run', '--no-default-browser-check'] });
const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.html') && (!only.length || only.some((o) => f.includes(o)))).sort();
const content = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
let failed = 0;
const started = Date.now();
for (const file of files) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(process.env.STACK ? e.stack : e.message));
  // A form may change the test candidate (e.g. saved answers): <script id="profile" type="application/json">.
  const html = fs.readFileSync(path.join(FIX, file), 'utf8');
  const extra = html.match(/<script type="application\/json" id="profile">([\s\S]*?)<\/script>/);
  await page.evaluateOnNewDocument(fakeChrome, extra ? { ...profile, ...JSON.parse(extra[1]) } : profile);
  const t0 = Date.now();
  const results0 = [];
  try {
    await page.goto(base + file, { waitUntil: 'load' });
    const expect = await page.$eval('#expect', (s) => JSON.parse(s.textContent));
    await page.addScriptTag({ content });
    // "autoBid": "auto" | "review" runs Auto bid on the page instead of a plain Fill, and checks its result.
    const r = expect.autoBid ? await page.evaluate((m) => window.__jbBid(m), expect.autoBid) : await page.evaluate(() => window.__jbFill());
    if (expect.autoBid) {
      const want = expect.bidStatus;
      results0.push({ name: 'Auto bid result', want, got: r.result?.status + (r.result?.reason ? ` (${r.result.reason.slice(0, 90)})` : ''), ok: r.result?.status === want });
    }
    const results = [...results0, ...(await page.evaluate(readBack, expect.checks || []))];
    const reports = await page.evaluate(() => window.__jbReports);
    // Problems the filler reported that the form says it must not (e.g. a field the site allows empty).
    const probs = (reports[0]?.problems || []).filter((p) => (expect.noProblems || []).some((q) => p.q.toLowerCase().includes(q.toLowerCase())));
    // Questions the filler must report (it could not answer them and must say so).
    const unreported = (expect.mustReport || []).filter((q) => !(reports[0]?.problems || []).some((p) => p.q.toLowerCase().includes(q.toLowerCase())));
    const bad = results.filter((x) => !x.ok);
    const ok = r.ok && !bad.length && !probs.length && !unreported.length && !errors.length;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${results.length} checks)`);
    if (!r.ok) console.log(`      fill did not finish: ${r.error}`);
    for (const b of bad) console.log(`      ${b.name}: want ${JSON.stringify(b.want)}, got ${JSON.stringify(b.got)}`);
    for (const p of probs) console.log(`      reported as a problem: "${p.q}" (${p.status})`);
    for (const q of unreported) console.log(`      not reported, but it should be: "${q}"`);
    for (const e of errors) console.log(`      page error: ${e}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${file}  ${e.message}`);
  }
  await page.close();
}
await browser.close();
server.close();
console.log(`\n${files.length - failed}/${files.length} forms passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
