// The resume optimizer end to end in headless Chrome: a job posting page with the extension's real content.js,
// panel.js and optimizer.js, and the real background ATS code (cut from background.js) running in the page with
// the real ats.js / resumedoc.js / resumefix.js / pdf-lib. Only the AI is replaced by fixed replies.
// Clicks through: Score my resume -> Optimize resume -> tick a keyword -> Optimize with AI -> review (a flagged
// change is off) -> Build -> result -> Use for this application, and checks the file handed to the application
// is byte for byte the one that was scored. Once with a Word resume, once with a PDF (rebuilt layout).
//   node optimizer.ui.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EXT, makeDocx, makePdf, JOB_ML, AI_ML, RESUME_ML, DOCX } from './ats-fixtures.mjs';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`, '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Google Chrome not found. Set CHROME_PATH.'); process.exit(2); }

const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const atsBg = bg.slice(bg.indexOf('// ---------- ATS matcher and resume optimizer'), bg.indexOf('// ---------- The JobBid icon ----------'));
if (atsBg.length < 2000) { console.error('ATS section not found in background.js'); process.exit(2); }
const lib = ['lib/pdf-lib.min.js', 'resumefix.js', 'resumedoc.js', 'ats.js'].map((f) => fs.readFileSync(path.join(EXT, f), 'utf8')).join('\n;\n');
const ui = ['content.js', 'panel.js', 'optimizer.js'].map((f) => fs.readFileSync(path.join(EXT, f), 'utf8'));

const page0 = `<!doctype html><html><head><meta charset="utf-8"><title>${JOB_ML.title} - ${JOB_ML.company}</title></head><body>
<h1>${JOB_ML.title}</h1><div class="company-name">${JOB_ML.company}</div>
<div id="job-description">${JOB_ML.description.trim().split('\n').map((l) => `<p>${l}</p>`).join('')}</div></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page0); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/jobs/1`;

// In the page before anything else: chrome.* with an in-memory storage, and a background that answers
// the panel's messages with the real ATS functions (defined later, when the scripts are added).
function fakeChrome(seed) {
  const mem = { ...seed };
  window.__held = null;
  window.__mem = mem;
  window.__notes = [];
  const changed = [];
  const answer = async (msg) => {
    switch (msg.type) {
      case 'getContext': return { ok: true, profile: mem.profiles[0], settings: { overwrite: false, useAI: false } };
      case 'atsScore': return { ok: true, result: await window.atsScore(msg) };
      case 'atsOptimize': return { ok: true, result: await window.atsOptimize(msg) };
      // The result comes back 1.5 s after the work is done, so the test can see the finished steps and preview.
      case 'atsBuild': { const result = await window.atsBuild(msg); await new Promise((r) => setTimeout(r, 1500)); return { ok: true, result }; }
      case 'atsNotify': window.__notes.push(msg.title); return { ok: true };
      case 'atsWeights': return { ok: true, weights: {}, defaults: {} };
      case 'holdFixedResume': window.__held = msg.file; return { ok: true };
      case 'analyzeMatch': return { ok: true, match: null };
      case 'takeFixedResume': return { ok: true, file: null };
      case 'checkApplied': return { ok: true, matches: [] };
      default: return { ok: true };
    }
  };
  window.chrome = {
    runtime: {
      id: 'jobbid-test', lastError: undefined, getManifest: () => ({ version: 'test' }), getURL: (p) => p,
      sendMessage(msg, cb) {
        const p = answer(msg).catch((e) => ({ ok: false, error: e.message }));
        if (typeof cb === 'function') { p.then((r) => cb(r)); return undefined; }
        return p;
      },
      onMessage: { addListener() {} },
    },
    storage: {
      onChanged: { addListener: (f) => changed.push(f) },
      local: {
        get: async (k) => { const keys = k == null ? Object.keys(mem) : Array.isArray(k) ? k : [k]; return Object.fromEntries(keys.filter((x) => x in mem).map((x) => [x, structuredClone(mem[x])])); },
        set: async (o) => { Object.assign(mem, structuredClone(o)); const c = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }])); for (const f of changed) f(c, 'local'); },
        remove: async () => {},
      },
      session: { get: async () => ({}), set: async () => {} },
    },
    notifications: { onClicked: { addListener() {} }, create() {}, clear() {} },
    tabs: { update: async () => ({}) }, windows: { update: async () => ({}) },
  };
}

// The AI's two answers: the job's requirements, then edits (found by the lines' text, whatever their ids).
function fakeAi(aiJob) {
  window.aiStage = () => {};
  window.ai = async (prompt) => {
    if (window.__aiDown) throw new Error('All 1 AI keys failed. gemini: 503 overloaded');
    if (prompt.includes('configuring an applicant tracking system')) { await new Promise((r) => setTimeout(r, 1200)); return aiJob; }
    // The evidence review: one honest "equivalent" with a real quote, everything else left to the words.
    if (prompt.includes('You check a job candidate\'s evidence')) {
      await new Promise((r) => setTimeout(r, 400));
      const reqId = (term) => (prompt.match(new RegExp(`^(r\\d+) \\([^)]*\\) ${term}`, 'm')) || [])[1];
      const line = (start) => Number((prompt.match(new RegExp(`^\\[(\\d+)\\] \\([^)]*\\) ${start}`, 'm')) || [])[1]);
      return {
        results: [{ id: reqId('Predictive Modeling'), status: 'equivalent', lines: [line('Built statistical models')], quote: 'statistical models for demand forecasting', explanation: 'Forecasting models are predictive models.', recommendation: 'Call the forecasting work predictive modeling and say how you evaluated it.' }],
        summary: { status: 'weak', explanation: 'The summary does not mention machine learning in production.', recommendation: 'Lead with the ML services you built in Python.' },
        suggestions: [{ text: 'Your resume mentions ranking services; say how they were deployed and monitored.', lines: [line('Built ML ranking')] }],
      };
    }
    await new Promise((r) => setTimeout(r, 1500));
    const id = (start) => { const m = prompt.match(new RegExp('\\[(\\d+)\\] \\([^)]*\\) ' + start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); return m ? Number(m[1]) : -1; };
    return {
      changes: [
        { op: 'replace', id: id('Software engineer with 9'), text: 'Machine learning engineer with 9 years of experience building ML services in Python and PyTorch.', reason: 'lead with the job title' },
        { op: 'insert', after: id('Deployed models'), text: 'Packaged ranking models in Docker images for repeatable deployments.', reason: 'show Docker in a job' },
        { op: 'insert', after: id('Built statistical'), text: 'Cut costs by 30% with Snowflake pipelines.', reason: 'invented' },
      ],
      cannot: [{ term: 'Snowflake', why: 'no Snowflake work in the resume' }], summary: 'Led with the ML title and showed Docker in work',
    };
  };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: !process.argv.includes('--show'), args: ['--no-first-run', '--window-size=1400,900'] });
let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`); } };

async function run(kind) {
  console.log(`Optimizer UI with a ${kind === 'pdf' ? 'PDF' : 'Word'} resume`);
  const bytes = kind === 'pdf'
    ? await makePdf(RESUME_ML.map((p) => (p.tab ? { text: `${p.tab[0]}  ${p.tab[1]}`, b: true } : p.label ? { text: p.label + p.text } : p)))
    : makeDocx(RESUME_ML);
  const name = kind === 'pdf' ? 'Alex_Rivera.pdf' : 'Alex_Rivera.docx';
  const seed = {
    profiles: [{ id: 'p1', fullName: 'Alex Rivera', headline: 'Senior Software Engineer', resumes: [{ id: 'r1', name, type: kind === 'pdf' ? 'application/pdf' : DOCX }], defaultResumeId: 'r1' }],
    settings: { activeProfileId: 'p1', aiKeys: [{ id: 'k', provider: 'gemini', key: 'x', enabled: true }] },
    hubConfig: { token: 't', user: 'tester' }, panelTab: 'match', panelCollapsed: false,
    file_r1: Buffer.from(bytes).toString('base64'),
  };
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(process.env.STACK ? e.stack : e.message));
  await page.evaluateOnNewDocument(fakeChrome, seed);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(fakeAi, AI_ML);
  await page.addScriptTag({ content: lib + '\n;\n' + atsBg + '\nwindow.atsScore = atsScore; window.atsOptimize = atsOptimize; window.atsBuild = atsBuild;' });
  for (const code of ui) await page.addScriptTag({ content: code });

  const inPanel = (fn, ...a) => page.evaluate((src, ...args) => { const r = document.querySelector('#jobbid-root-panel')?.shadowRoot; return r ? new Function('r', 'args', src)(r, args) : null; }, fn, ...a);
  const inOpt = (fn, ...a) => page.evaluate((src, ...args) => { const r = document.querySelector('#jobbid-optimizer')?.shadowRoot; return r ? new Function('r', 'args', src)(r, args) : null; }, fn, ...a);
  const shot = (n) => (process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, `${kind}-${n}.png`) }) : null);
  const until = async (what, test, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await test(); if (v) return v; if (Date.now() - t0 > ms) { check(what, false, 'timed out'); return null; } await new Promise((r) => setTimeout(r, 150)); } };

  await until('the Match tab shows the ATS card', () => inPanel("return !!r.getElementById('atsRun')"));
  await inPanel("r.getElementById('atsRun').click()");
  const scoring = await until('the panel shows the steps while scoring', () => inPanel("const li = [...r.querySelectorAll('ol.atsteps li')]; return li.length === 5 && li[0].classList.contains('now') ? li.map((x) => x.textContent.replace(/\\s+/g, ' ').trim()) : null"));
  check('panel steps: job, resume, profile, AI review, score', scoring && /Read the job/.test(scoring[0]) && /AI reviews/.test(scoring[3]) && /Score it/.test(scoring[4]), JSON.stringify(scoring));
  const score = await until('the fit is scored', () => inPanel("const n = r.querySelector('.fitnum'); return n && /\\/100/.test(n.textContent) ? n.textContent : ''"));
  check('the card shows "JobBid Fit Estimate" out of 100 with a band', !!score && await inPanel("return /JobBid Fit Estimate/.test(r.getElementById('body').textContent) && /(Strong|Good|Partial|Limited) alignment/.test(r.getElementById('body').textContent)"), score);
  check('labelled AI-reviewed', await inPanel("return /AI-reviewed/.test(r.getElementById('body').textContent)"));
  await shot('1-card');
  if (process.env.SHOTS) {
    await page.setViewport({ width: 1400, height: 2600 });
    await inPanel("r.querySelectorAll('details.cmp').forEach((d, i) => { d.open = i < 4; }); r.querySelector('details.rd').open = true; r.getElementById('body').style.maxHeight = 'none'; r.querySelector('.panel').style.maxHeight = 'none';");
    await new Promise((res) => setTimeout(res, 300));
    await page.screenshot({ path: path.join(process.env.SHOTS, `${kind}-1b-tall.png`), clip: { x: 0, y: 0, width: 380, height: 2600 } });
    await page.setViewport({ width: 1400, height: 900 });
  }
  const rows = await inPanel("return [...r.querySelectorAll('details.cmp .cl')].map((x) => x.textContent)");
  check('Resume vs job rows: title, years, industry, required, preferred, responsibilities, education, summary', ['Job title', 'Years', 'Industry', 'Required skills', 'Preferred skills', 'Responsibilities', 'Education', 'Summary'].every((t) => rows?.includes(t)), JSON.stringify(rows));
  check('a missing requirement is listed with its status', await inPanel("return [...r.querySelectorAll('.rqi')].some((x) => /Snowflake/.test(x.textContent) && /Not shown/.test(x.textContent))"));
  check('an equivalent match shows the resume\'s words and why', await inPanel("return [...r.querySelectorAll('.rqi')].some((x) => /Predictive Modeling/.test(x.textContent) && /Equivalent/.test(x.textContent) && /demand forecasting/.test(x.textContent) && /Forecasting models are predictive/.test(x.textContent))"));
  check('AI suggestions built on real lines', await inPanel("return /How to improve[\\s\\S]*deployed and monitored/.test(r.getElementById('body').textContent)"));
  check('readability is a separate check, not in the score', await inPanel("return /Resume readability/.test(r.getElementById('body').textContent) && /Not part of the fit score/.test(r.getElementById('body').textContent)"));
  check('the card says it is an estimate', await inPanel("return /An estimate, not the employer/.test(r.getElementById('body').textContent)"));

  if (process.env.SHOTS) { await inPanel("r.getElementById('atsDetail').click()"); await new Promise((r) => setTimeout(r, 400)); await shot('0-score'); await inOpt("r.querySelector('[data-act=close]').click()"); }
  await inPanel("r.getElementById('atsOpt').click()");
  await until('the optimizer opens on "Choose"', () => inOpt("return /Sections to improve/.test(r.getElementById('main').textContent)"));
  await shot('2-choose');
  check('listed-only Docker is offered and ticked', await inOpt("const i = r.querySelector('input[data-term=\"Docker\"]'); return !!i && i.checked && i.dataset.how === 'demonstrate'"));
  check('missing Snowflake is offered unticked', await inOpt("const i = r.querySelector('input[data-term=\"Snowflake\"]'); return !!i && !i.checked && i.dataset.how === 'confirmed'"));
  // The candidate confirms PyTorch.
  await inOpt("const i = r.querySelector('input[data-term=\"PyTorch\"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true }))");
  if (kind === 'pdf') {
    check('PDF: layout choice offered', await inOpt("return !!r.querySelector('input[data-act=mode][value=rebuild]')"));
    await inOpt("const i = r.querySelector('input[data-act=mode][value=rebuild]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true }))");
  }
  await inOpt("r.querySelector('[data-act=optimize]').click()");
  const during = await until('steps are shown while the AI works', () => inOpt("const li = [...r.querySelectorAll('ol.steps li')]; return li.length === 5 && li[3].classList.contains('now') ? li.map((x) => x.className + ':' + x.textContent.replace(/\\s+/g, ' ').trim()) : null"));
  await shot('2b-optimizing');
  check('while the AI works: job and resume steps done, AI step running', during && /done|skip/.test(during[0]) && /^done/.test(during[1]), JSON.stringify(during));
  check('while the AI works: what it was asked is shown', await inOpt("return /What the AI is asked to do[\\s\\S]*Docker/.test(r.getElementById('preview').textContent)"));
  await until('the changes are shown', () => inOpt("return r.querySelectorAll('.chg').length >= 3"));
  const review = await inOpt("return [...r.querySelectorAll('.chg')].map((c) => ({ on: c.querySelector('input').checked, flagged: c.classList.contains('flag'), text: c.textContent }))");
  await shot('3-review');
  check('3 changes proposed', review?.length === 3, JSON.stringify(review?.map((x) => x.text.slice(0, 40))));
  check('the invented one (30%, Snowflake) is flagged and off', review?.some((c) => /30%/.test(c.text) && c.flagged && !c.on));
  check('the supported ones are on', review?.filter((c) => c.on).length === 2);
  check('"Not added" lists Snowflake', await inOpt("return /Not added[\\s\\S]*Snowflake/.test(r.getElementById('main').textContent)"));
  // The tab goes to the background: the finished build also sends a Chrome notification.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await inOpt("r.querySelector('[data-act=build]').click()");
  const built = await until('the build steps finish while the window waits', () => inOpt("const li = [...r.querySelectorAll('ol.steps li')]; return li.length === 5 && li.every((x) => /done|skip/.test(x.className)) ? li.map((x) => x.textContent.replace(/\\s+/g, ' ').trim()) : null"));
  await shot('3b-building');
  check('build steps: written, read back, scored, checked', built && /Score it again.*→/.test(built[3]) && /changes found in the file/.test(built[4]), JSON.stringify(built));
  check('live preview: the accepted changes are marked written', await inOpt("const pv = [...r.querySelectorAll('#preview .pv.changed, #preview .pv.added')]; return pv.length === 2 && pv.every((x) => /written/.test(x.textContent))"));
  await until('the result is shown', () => inOpt("return /Original vs. optimized/.test(r.getElementById('main').textContent)"), 30000);
  const res = await inOpt("const big = [...r.querySelectorAll('.big')].map((b) => parseFloat(b.textContent)); return { big, text: r.getElementById('main').textContent }");
  await shot('4-result');
  check('before and after scores shown, after higher', res?.big.length === 2 && res.big[1] > res.big[0], JSON.stringify(res?.big));
  check('each changed line is marked as found in the new file', await inOpt("return r.querySelectorAll('.cmp .mk.ok').length === 2 && !r.querySelector('.cmp .mk.no')"));
  check('a message says the new resume is ready', await page.evaluate(() => /New resume:/.test(document.querySelector('#jobbid-root')?.shadowRoot?.querySelector('.toast .title')?.textContent || '')));
  check('with the tab in the background, a Chrome notification too', await page.evaluate(() => window.__notes.some((t) => /New resume:/.test(t))));
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
  check('Docker checked as done in the new file', /Docker[\s\S]{0,200}done/.test(res?.text || ''));
  check('the comparison shows the new bullet', /Packaged ranking models in Docker images/.test(res?.text || ''));
  check('the invented line is not in the new file', !/Cut costs by 30%/.test(res?.text || ''));
  if (kind === 'pdf') check('PDF: says the layout was rebuilt', /rebuilt, one-column ATS-friendly PDF/.test(res?.text || ''));
  await inOpt("r.querySelector('[data-act=use]').click()");
  const held = await until('the file is handed to the application', () => page.evaluate(() => window.__held));
  // Score the handed-over bytes again, independently: the same number as shown.
  const rescored = held && await page.evaluate(async (f) => { const j = window.__jobbid.getJob(); return (await window.atsScore({ profile: window.__mem.profiles[0], job: { title: j.title, company: j.company, url: j.url, description: j.description }, file: f })).report.score; }, held);
  check('the attached file is exactly the scored one', held && Math.abs(rescored - res.big[1]) < 0.05 && held.score === res.big[1], `${rescored} vs ${res?.big[1]}`);
  check('the attached file keeps its name and type', held?.name === name && (kind === 'pdf' ? held.type === 'application/pdf' : held.type === DOCX));
  await inOpt("r.querySelector('[data-act=close]').click()");
  await until('the panel shows the optimized version', () => inPanel("return /Optimized resume:/.test(r.getElementById('body').textContent)"));
  // Evidence: resume + profile, analyzed again.
  await inPanel("const s = r.getElementById('atsSrc'); s.value = 'both'; s.dispatchEvent(new Event('change', { bubbles: true }))");
  await until('the evidence choice changes', () => inPanel("return !!r.getElementById('atsRun')"));
  await inPanel("r.getElementById('atsRun').click()");
  await until('scored with resume + profile', () => inPanel("return /Resume \\+ profile/.test(r.querySelector('.fithead')?.textContent || '')"));
  check('the evidence used is shown (resume + profile)', await inPanel("return /Resume \\+ profile/.test(r.querySelector('.fithead')?.textContent || '')"));
  check('no page errors', !errors.length, errors.join(' | '));
  await page.close();
}

await run('docx');
await run('pdf');

// The AI down: the result is labelled "rules only", never shown as AI-analyzed.
{
  console.log('Fit estimate with the AI down');
  const seed = { profiles: [{ id: 'p1', fullName: 'Alex Rivera', resumes: [{ id: 'r1', name: 'Alex_Rivera.docx', type: DOCX }], defaultResumeId: 'r1' }],
    settings: { activeProfileId: 'p1', aiKeys: [{ id: 'k', provider: 'gemini', key: 'x', enabled: true }] }, hubConfig: { token: 't', user: 'tester' }, panelTab: 'match', panelCollapsed: false,
    file_r1: Buffer.from(makeDocx(RESUME_ML)).toString('base64') };
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(fakeChrome, seed);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(fakeAi, AI_ML);
  await page.evaluate(() => { window.__aiDown = true; });
  await page.addScriptTag({ content: lib + '\n;\n' + atsBg + '\nwindow.atsScore = atsScore; window.atsOptimize = atsOptimize; window.atsBuild = atsBuild;' });
  for (const code of ui) await page.addScriptTag({ content: code });
  const inPanel = (fn) => page.evaluate((src) => { const r = document.querySelector('#jobbid-root-panel')?.shadowRoot; return r ? new Function('r', src)(r) : null; }, fn);
  const until = async (test, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await test(); if (v || Date.now() - t0 > ms) return v; await new Promise((r) => setTimeout(r, 150)); } };
  await until(() => inPanel("return !!r.getElementById('atsRun')"));
  await inPanel("r.getElementById('atsRun').click()");
  const ok = await until(() => inPanel("return !!r.querySelector('.fitnum')"));
  const text = ok ? await inPanel("return r.getElementById('body').textContent") : '';
  check('AI down: still a score, from the posting\'s words', !!ok);
  check('AI down: labelled "Rules only" with the reason', /Rules only/.test(text) && /503 overloaded/.test(text) && !/AI-reviewed/.test(text), text.slice(0, 300));
  check('AI down: no page errors', !errors.length, errors.join(' | '));
  await page.close();
}
await browser.close();
server.close();
console.log(`\n${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
