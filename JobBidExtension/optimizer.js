// Resume optimizer: a full-screen window over the page, opened from the Match tab.
// Steps: ATS score (with every requirement and its evidence) -> choose sections and keywords -> the AI's proposed
// changes, each accepted or rejected -> the new file, read back and scored the same way, side by side with the
// original -> download / use for this application / another pass. All work is done in background.js
// (atsScore, atsOptimize, atsBuild); this file only shows it.

(() => {
  if (window !== window.top || window.__jobbidOptimizer) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const STEPS = [['score', 'ATS score'], ['choose', 'Choose'], ['review', 'Review changes'], ['result', 'Result']];
  const IMP = { required: 'Required', preferred: 'Preferred', optional: 'Optional' };
  const SECTIONS = { summary: 'Summary', skills: 'Skills', experience: 'Experience', projects: 'Projects' };
  const OPS = { replace: 'Rewrite', insert: 'New line', delete: 'Remove' };
  const color = (v) => (v >= 75 ? 'var(--ok)' : v >= 55 ? 'var(--warn)' : 'var(--err)');
  const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
  let host = null, root = null, st = null, ctx = null, poll = 0;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .w { --bg:#f6f6fb; --card:#fff; --text:#1b1b2f; --t2:#5b5d72; --t3:#8b8da3; --stroke:rgba(30,27,75,.1); --accent:#6d28d9; --soft:rgba(109,40,217,.08);
      --ok:#15803d; --okbg:#dcfce7; --warn:#b45309; --warnbg:#fef3c7; --err:#dc2626; --errbg:#fee2e2; --add:#e7f8ec; --del:#fdecec;
      font: 13px/19px "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; color: var(--text); }
    @media (prefers-color-scheme: dark) { .w:not([data-theme=light]) { --bg:#13131c; --card:#1d1d29; --text:#f1f1f8; --t2:#b4b6cc; --t3:#868aa3; --stroke:rgba(255,255,255,.1);
      --accent:#c4b5fd; --soft:rgba(167,139,250,.14); --ok:#4ade80; --okbg:rgba(74,222,128,.14); --warn:#fbbf24; --warnbg:rgba(251,191,36,.14); --err:#f87171; --errbg:rgba(248,113,113,.15); --add:rgba(74,222,128,.1); --del:rgba(248,113,113,.1); } }
    .w[data-theme=dark] { --bg:#13131c; --card:#1d1d29; --text:#f1f1f8; --t2:#b4b6cc; --t3:#868aa3; --stroke:rgba(255,255,255,.1);
      --accent:#c4b5fd; --soft:rgba(167,139,250,.14); --ok:#4ade80; --okbg:rgba(74,222,128,.14); --warn:#fbbf24; --warnbg:rgba(251,191,36,.14); --err:#f87171; --errbg:rgba(248,113,113,.15); --add:rgba(74,222,128,.1); --del:rgba(248,113,113,.1); }
    .back { position:fixed; inset:0; background:rgba(10,10,20,.55); }
    .dlg { position:fixed; inset:3vh 3vw; max-width:1240px; margin:0 auto; background:var(--bg); border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 80px rgba(0,0,0,.4); }
    header { display:flex; align-items:center; gap:12px; padding:14px 18px; background:var(--card); border-bottom:1px solid var(--stroke); }
    header h2 { margin:0; font-size:17px; } header .t2 { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .x { all:unset; cursor:pointer; width:32px; height:32px; border-radius:50%; display:grid; place-items:center; font-size:20px; color:var(--t2); }
    .x:hover { background:var(--soft); }
    nav { display:flex; gap:6px; padding:10px 18px; background:var(--card); border-bottom:1px solid var(--stroke); flex-wrap:wrap; }
    nav button { all:unset; cursor:pointer; padding:5px 12px; border-radius:999px; color:var(--t3); font-weight:600; font-size:12.5px; display:flex; gap:6px; align-items:center; }
    nav button .n { width:20px; height:20px; border-radius:50%; display:grid; place-items:center; background:var(--stroke); font-size:11px; }
    nav button.on { color:var(--accent); background:var(--soft); } nav button.on .n { background:var(--accent); color:var(--card); }
    nav button.done { color:var(--text); } nav button[disabled] { cursor:default; opacity:.5; }
    main { flex:1; overflow:auto; padding:16px 18px; }
    footer { display:flex; gap:8px; align-items:center; padding:12px 18px; background:var(--card); border-top:1px solid var(--stroke); flex-wrap:wrap; }
    footer .sp { flex:1; }
    .btn { all:unset; cursor:pointer; padding:9px 16px; border-radius:10px; font-weight:700; font-size:13px; border:1px solid var(--stroke); background:var(--card); color:var(--text); }
    .btn.pri { background:linear-gradient(135deg,#6d28d9,#9333ea); color:#fff; border-color:transparent; }
    .btn[disabled] { opacity:.45; cursor:default; }
    .link { all:unset; cursor:pointer; color:var(--accent); font-weight:600; font-size:12.5px; }
    .card { background:var(--card); border:1px solid var(--stroke); border-radius:12px; padding:14px 16px; margin-bottom:12px; }
    h3 { margin:0 0 10px; font-size:14px; }
    .t2 { color:var(--t2); } .t3 { color:var(--t3); font-size:12px; }
    .top { display:flex; gap:18px; align-items:center; flex-wrap:wrap; }
    .big { font-size:44px; font-weight:800; line-height:1; } .big small { font-size:15px; color:var(--t3); font-weight:600; }
    .grow { flex:1; min-width:0; }
    .counts { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .pill { padding:2px 9px; border-radius:999px; font-size:12px; font-weight:600; background:var(--stroke); }
    .pill.ok { background:var(--okbg); color:var(--ok); } .pill.warn { background:var(--warnbg); color:var(--warn); } .pill.err { background:var(--errbg); color:var(--err); } .pill.acc { background:var(--soft); color:var(--accent); }
    .comp { display:grid; grid-template-columns: minmax(150px,230px) 1fr 80px; gap:4px 12px; align-items:center; padding:6px 0; border-top:1px solid var(--stroke); }
    .comp:first-of-type { border-top:0; }
    .tr { height:7px; border-radius:4px; background:var(--stroke); overflow:hidden; } .tr i { display:block; height:100%; border-radius:4px; }
    .comp b.pts { text-align:right; } .comp .det { grid-column: 1 / -1; color:var(--t3); font-size:12px; }
    .ded { grid-column: 1 / -1; margin:2px 0 4px; padding-left:14px; font-size:12px; color:var(--t2); }
    .ded li { margin:2px 0; } .ded li b { color:var(--err); font-weight:700; margin-right:4px; }
    .tabs { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
    .tabs button { all:unset; cursor:pointer; padding:4px 10px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--t2); border:1px solid var(--stroke); }
    .tabs button.on { background:var(--soft); color:var(--accent); border-color:transparent; }
    .rq { display:flex; gap:10px; padding:8px 0; border-top:1px solid var(--stroke); }
    .rq:first-child { border-top:0; }
    .ic { width:22px; height:22px; flex:none; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:12px; }
    .ic.matched { background:var(--okbg); color:var(--ok); } .ic.partial { background:var(--warnbg); color:var(--warn); } .ic.missing { background:var(--errbg); color:var(--err); }
    .ev { margin-top:3px; font-size:12px; color:var(--t2); } .ev i { color:var(--t3); font-style:normal; }
    .tag { font-size:11px; padding:1px 7px; border-radius:6px; margin-left:6px; font-weight:600; background:var(--stroke); color:var(--t2); }
    .tag.ok { background:var(--okbg); color:var(--ok); } .tag.warn { background:var(--warnbg); color:var(--warn); } .tag.err { background:var(--errbg); color:var(--err); }
    label.chk { display:flex; gap:9px; align-items:flex-start; padding:7px 0; cursor:pointer; }
    label.chk input { margin-top:3px; accent-color:#7c3aed; }
    .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    @media (max-width: 860px) { .grid2 { grid-template-columns: 1fr; } .comp { grid-template-columns: 1fr 70px; } .comp .tr { grid-column: 1 / -1; } }
    .chg { border:1px solid var(--stroke); border-radius:12px; margin-bottom:10px; background:var(--card); overflow:hidden; }
    .chg.off { opacity:.6; } .chg.flag { border-color:var(--err); }
    .chg .hd { display:flex; gap:8px; align-items:center; padding:9px 12px; border-bottom:1px solid var(--stroke); flex-wrap:wrap; }
    .chg .hd input { accent-color:#7c3aed; width:16px; height:16px; }
    .chg .cols { display:grid; grid-template-columns: 1fr 1fr; }
    .chg .cols > div { padding:9px 12px; } .chg .cols .a { background:var(--del); } .chg .cols .b { background:var(--add); }
    .chg .cols .lbl { font-size:11px; font-weight:700; color:var(--t3); text-transform:uppercase; letter-spacing:.04em; margin-bottom:2px; }
    .flags { padding:6px 12px 9px; color:var(--err); font-size:12px; } .why { padding:0 12px 9px; color:var(--t3); font-size:12px; }
    .cmp { display:grid; grid-template-columns: 1fr 1fr; font-size:12.5px; border:1px solid var(--stroke); border-radius:10px; overflow:hidden; }
    .cmp > div { padding:5px 10px; border-top:1px solid var(--stroke); white-space:pre-wrap; }
    .cmp .h { background:var(--card); font-weight:700; border-top:0; }
    .cmp .changed.a, .cmp .removed.a { background:var(--del); } .cmp .changed.b, .cmp .added.b { background:var(--add); } .cmp .heading { font-weight:700; }
    .busy { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:60px 20px; text-align:center; }
    .spin { width:30px; height:30px; border:3px solid var(--stroke); border-top-color:var(--accent); border-radius:50%; animation:sp 0.9s linear infinite; }
    @keyframes sp { to { transform: rotate(360deg); } }
    .errbox { background:var(--errbg); color:var(--err); padding:9px 12px; border-radius:10px; margin-bottom:12px; }
    .note { background:var(--soft); padding:9px 12px; border-radius:10px; margin-bottom:12px; }
    .warnbox { background:var(--warnbg); color:var(--warn); padding:9px 12px; border-radius:10px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; } td, th { text-align:left; padding:6px 8px; border-top:1px solid var(--stroke); vertical-align:top; } th { color:var(--t3); font-weight:600; border-top:0; }
    select, input[type=number] { font:inherit; padding:5px 8px; border-radius:8px; border:1px solid var(--stroke); background:var(--card); color:var(--text); }
    input[type=number] { width:70px; }
    details summary { cursor:pointer; color:var(--accent); font-weight:600; }
    .live { display:grid; grid-template-columns: minmax(280px, 400px) 1fr; gap:14px; align-items:start; }
    @media (max-width: 860px) { .live { grid-template-columns: 1fr; } }
    ol.steps { list-style:none; margin:0; padding:0; }
    ol.steps li { display:flex; gap:10px; padding:9px 0; border-top:1px solid var(--stroke); }
    ol.steps li:first-child { border-top:0; }
    ol.steps .dot { width:22px; height:22px; flex:none; border-radius:50%; display:grid; place-items:center; font-size:12px; font-weight:800; background:var(--stroke); color:var(--t3); }
    ol.steps li.done .dot, ol.steps li.skip .dot { background:var(--okbg); color:var(--ok); }
    ol.steps li.fail .dot { background:var(--errbg); color:var(--err); }
    ol.steps li.now .dot { background:transparent; border:3px solid var(--stroke); border-top-color:var(--accent); animation:sp .9s linear infinite; }
    ol.steps li.todo b { color:var(--t3); font-weight:600; }
    ol.steps li.fail .t3 { color:var(--err); }
    .pv { padding:6px 10px; border-top:1px solid var(--stroke); font-size:12.5px; display:flex; gap:8px; align-items:flex-start; transition:background .4s; }
    .pv:first-child { border-top:0; }
    .pv.heading { font-weight:700; color:var(--t2); }
    .pv.changed, .pv.added { background:var(--warnbg); } .pv.removed { background:var(--del); text-decoration:line-through; color:var(--t3); }
    .pv.wrt.changed, .pv.wrt.added { background:var(--add); }
    .pv .st { flex:none; font-size:11px; font-weight:700; padding:1px 7px; border-radius:6px; background:var(--stroke); color:var(--t2); min-width:62px; text-align:center; }
    .pv .st.wr { background:var(--warnbg); color:var(--warn); animation:pulse 1.1s ease-in-out infinite; }
    .pv .st.ok { background:var(--okbg); color:var(--ok); }
    @keyframes pulse { 50% { opacity:.45; } }
    .cmp .mk { font-weight:800; margin-right:6px; } .cmp .mk.ok { color:var(--ok); } .cmp .mk.no { color:var(--err); }
    ul { margin:6px 0; padding-left:18px; }
  `;

  function open(c) {
    ctx = c;
    const res = c.result;
    st = { step: c.step || 'score', res, file: c.file || null, resumeId: c.resumeId, sections: new Set(res.sections.filter((z) => z !== 'projects' || res.sections.length <= 1)),
      targets: new Map(), mode: 'keep', proposal: null, accept: new Set(), busy: '', error: '', build: null, history: [], tried: [], filter: 'all', onlyChanges: true, weights: null, stage: '', t0: 0 };
    if (res.sections.includes('projects')) st.sections.add('projects');
    defaultTargets();
    mount();
    render();
  }
  // Skills the resume lists but never shows in a job: offered to be worked into the experience (ticked).
  function defaultTargets() {
    st.targets = new Map();
    for (const r of st.res.report.requirements) {
      if (r.category === 'responsibility' || r.category === 'soft' || r.importance === 'optional') continue;
      if (r.status === 'matched' && !r.demonstrated && !st.tried.includes(r.term)) st.targets.set(r.term, 'demonstrate');
    }
  }

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'jobbid-optimizer';
    host.style.cssText = 'all:initial;position:fixed!important;inset:0!important;z-index:2147483647!important;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="w"><div class="back"></div><div class="dlg" role="dialog" aria-modal="true" aria-label="Resume optimizer">
      <header><h2>Resume optimizer</h2><span class="t2" id="sub"></span><button class="x" data-act="close" title="Close" aria-label="Close">×</button></header>
      <nav id="nav"></nav><main id="main"></main><footer id="foot"></footer></div></div>`;
    (document.documentElement || document.body).appendChild(host);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !st.busy) close(); e.stopPropagation(); });
    self.jbI18n?.observe?.(root);
  }
  function close() { clearInterval(poll); host?.remove(); host = null; }

  function render() {
    if (!root) return;
    const w = root.querySelector('.w');
    if (ctx.theme === 'light' || ctx.theme === 'dark') w.dataset.theme = ctx.theme; else delete w.dataset.theme;
    root.getElementById('sub').textContent = `${ctx.job.title || ''}${ctx.job.company ? ' · ' + ctx.job.company : ''} · ${st.res.resume.name}${st.file ? (st.file.uploaded ? ' (your file)' : ' (optimized version)') : ''}`;
    const can = { score: true, choose: true, review: !!st.proposal, result: !!st.build };
    const idx = STEPS.findIndex(([k]) => k === st.step);
    root.getElementById('nav').innerHTML = STEPS.map(([k, label], i) => `<button data-act="go" data-step="${k}" class="${k === st.step ? 'on' : i < idx ? 'done' : ''}" ${can[k] && !st.busy ? '' : 'disabled'}><span class="n">${i + 1}</span>${label}</button>`).join('');
    const main = root.getElementById('main');
    const keep = main.dataset.step === st.step ? main.scrollTop : 0;
    main.dataset.step = st.step;
    const err = st.error ? `<div class="errbox">${esc(st.error)}</div>` : '';
    main.innerHTML = st.busy ? busyHtml() : err + ({ score: scoreHtml, choose: chooseHtml, review: reviewHtml, result: resultHtml }[st.step])();
    main.scrollTop = keep;
    root.getElementById('foot').innerHTML = st.busy ? '<span class="t3">Working... you can keep this window open.</span>' : footHtml();
  }
  const busyHtml = () => `<div class="live"><div class="card"><h3 style="display:flex">${esc(st.busy)}<span class="grow"></span><span class="t3" id="secs">${Math.round((Date.now() - st.t0) / 1000)}s</span></h3><div id="steps">${stepsHtml()}</div></div>
    <div id="preview">${previewHtml()}</div></div>`;
  const fmtMs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  // This call's progress only (an older run's record may still be in storage).
  const myProg = () => (st.prog && new Date(st.prog.startedAt).getTime() >= st.t0 - 1500 ? st.prog : null);
  function stepsHtml() {
    const p = myProg();
    if (!p) return '<div class="t3">Starting...</div>';
    const secs = Math.round((Date.now() - new Date(p.at).getTime()) / 1000);
    return `<ol class="steps">${p.steps.map((x) => `<li class="${x.state}"><span class="dot">${{ done: '✓', skip: '✓', fail: '✕' }[x.state] || ''}</span><div class="grow">
      <b>${esc(x.label)}</b>${x.state === 'done' && x.ms >= 50 ? ` <span class="t3">${fmtMs(x.ms)}</span>` : ''}${x.state === 'now' && secs > 1 ? ` <span class="t3">${secs}s</span>` : ''}
      <div class="t3">${esc(x.state === 'now' && st.stage && /^(Asking|Waiting|Retry)/i.test(st.stage) ? st.stage : x.detail)}</div></div></li>`).join('')}</ol>`;
  }
  // While the new file is built: the resume with every accepted change, "writing" until the file is written.
  function previewHtml() {
    if (st.busyOp === 'optimize') {
      const t = [...st.targets].map(([term, how]) => `${term}${how === 'confirmed' ? ' (confirmed)' : ''}`);
      return `<div class="card"><h3>What the AI is asked to do</h3><div class="t2">Sections: ${[...st.sections].map((z) => SECTIONS[z]).join(', ')}</div>
        <div class="t2" style="margin-top:4px">Keywords: ${t.length ? esc(t.join(', ')) : 'none - sharpen what is there'}</div>
        <div class="t3" style="margin-top:8px">Every change it proposes is then checked: new numbers, skills you didn't confirm, new names, locked lines.</div></div>`;
    }
    if (st.busyOp !== 'build' || !st.proposal) return '';
    const changes = st.proposal.changes.filter((c) => st.accept.has(c.cid));
    const written = myProg()?.steps[1]?.state === 'done';
    const rep = new Map(changes.filter((c) => c.op === 'replace').map((c) => [c.id, c]));
    const del = new Set(changes.filter((c) => c.op === 'delete').map((c) => c.id));
    const ins = new Map();
    for (const c of changes.filter((x) => x.op === 'insert')) { if (!ins.has(c.after)) ins.set(c.after, []); ins.get(c.after).push(c); }
    const chip = `<span class="st ${written ? 'ok' : 'wr'}">${written ? 'written' : 'writing'}</span>`;
    const rows = [];
    for (const l of st.res.lines) {
      if (l.kind === 'heading') rows.push(`<div class="pv heading"><span class="st" style="visibility:hidden">-</span>${esc(l.text)}</div>`);
      else if (rep.has(l.id)) rows.push(`<div class="pv changed ${written ? 'wrt' : ''}">${chip}<span>${esc(rep.get(l.id).text)}</span></div>`);
      else if (del.has(l.id)) rows.push(`<div class="pv removed">${chip}<span>${esc(l.text)}</span></div>`);
      for (const c of ins.get(l.id) || []) rows.push(`<div class="pv added ${written ? 'wrt' : ''}">${chip}<span>${l.bullet || c.op === 'insert' ? '• ' : ''}${esc(c.text)}</span></div>`);
    }
    return `<div class="card"><h3>Your resume, ${written ? 'written' : 'being written'}: ${changes.length} change${changes.length === 1 ? '' : 's'}</h3><div style="border:1px solid var(--stroke);border-radius:10px;overflow:hidden">${rows.join('')}</div></div>`;
  }

  // ---------- Step 1: the score ----------

  function scoreHtml() {
    const { report: r, resume } = st.res;
    const resumes = ctx.profile.resumes || [];
    const ring = (v) => `<span class="big" style="color:${color(v)}">${fmt(v)}<small>/100</small></span>`;
    const filters = [['all', `All ${r.counts.total}`], ['missing', `Missing ${r.counts.missing}`], ['partial', `Partly ${r.counts.partial}`], ['matched', `Matched ${r.counts.matched}`]];
    const rows = r.requirements.filter((x) => st.filter === 'all' || x.status === st.filter);
    return `
      <div class="card"><div class="top">${ring(r.score)}
        <div class="grow"><b>Estimated ATS match</b>
          <div class="t2">How a typical applicant-tracking system would rank this resume file for this job, from the job's own requirements. An estimate, not the employer's official score.</div>
          <div class="counts"><span class="pill ok">${r.counts.matched} matched</span><span class="pill warn">${r.counts.partial} partly</span><span class="pill err">${r.counts.missing} missing</span>${r.warnings.length ? `<span class="pill">${r.warnings.length} formatting warning${r.warnings.length === 1 ? '' : 's'}</span>` : ''}</div></div>
        <div><div class="t3">Resume file</div>
          <select data-act="pickResume">${resumes.map((x) => `<option value="${esc(x.id)}" ${!st.file && x.id === resume.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${st.file ? `<option selected>${esc(resume.name)} (${st.file.uploaded ? 'your file' : 'optimized'})</option>` : ''}</select>
          <div style="margin-top:6px"><label class="link">Score another file...<input type="file" data-act="upload" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></label></div></div>
      </div></div>
      <div class="card"><h3>Score breakdown</h3>
        ${r.components.map((c) => `<div class="comp"><span>${esc(c.label)}</span><span class="tr"><i style="width:${c.max ? (c.points / c.max) * 100 : 0}%;background:${color(c.max ? (c.points / c.max) * 100 : 0)}"></i></span><b class="pts">${fmt(c.points)} / ${fmt(c.max)}</b>
          <span class="det">${esc(c.detail)}</span>
          ${c.deductions.length ? `<ul class="ded">${c.deductions.slice(0, 12).map((d) => `<li><b>-${fmt(d.points)}</b>${esc(d.text)}</li>`).join('')}${c.deductions.length > 12 ? `<li>${c.deductions.length - 12} more</li>` : ''}</ul>` : ''}</div>`).join('')}
        <details style="margin-top:10px"><summary>Scoring weights</summary>${weightsHtml()}</details>
      </div>
      <div class="card"><h3>Job requirements</h3>
        <div class="tabs">${filters.map(([k, l]) => `<button data-act="filter" data-f="${k}" class="${st.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${rows.map(reqRow).join('') || '<div class="t3">None</div>'}
      </div>
      ${r.warnings.length ? `<div class="card"><h3>Formatting warnings</h3><ul>${r.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
  }
  function reqRow(x) {
    const mark = { matched: '✓', partial: '≈', missing: '✕' }[x.status];
    const shown = x.status === 'matched' ? (x.demonstrated ? '<span class="tag ok">shown in experience</span>' : '<span class="tag warn">listed only</span>') : '';
    const ev = x.evidence[0];
    return `<div class="rq"><span class="ic ${x.status}">${mark}</span><div class="grow"><b translate="no">${esc(x.term)}</b><span class="tag">${IMP[x.importance]}</span><span class="tag">${esc(x.category)}</span>${shown}
      ${x.via ? `<span class="t3"> · via "${esc(x.via)}"${x.status === 'partial' ? ' (related, partial credit)' : ''}</span>` : ''}
      ${ev ? `<div class="ev">"${esc(ev.text)}" <i>· ${esc(SECTIONS[ev.section] || ev.section)}</i></div>` : x.status === 'missing' ? '<div class="ev t3">Not found in the resume</div>' : ''}</div></div>`;
  }
  function weightsHtml() {
    const w = st.weights || st.res.report.weights;
    const labels = { keywords: 'Keyword coverage', demonstrated: 'Skills shown in experience', responsibilities: 'Relevant experience', title: 'Job title alignment', years: 'Years of experience', qualifications: 'Education & certifications', readability: 'ATS readability' };
    return `<div class="t3" style="margin:6px 0">Relative weights (parts the job doesn't ask about are left out and the rest scaled to 100). Saved on this computer.</div>
      <table>${Object.keys(labels).map((k) => `<tr><td>${labels[k]}</td><td><input type="number" min="0" max="100" step="1" data-w="${k}" value="${esc(w[k] ?? 0)}"></td></tr>`).join('')}</table>
      <div style="margin-top:8px;display:flex;gap:10px"><button class="link" data-act="saveWeights">Save and re-score</button><button class="link" data-act="resetWeights">Reset to defaults</button></div>`;
  }

  // ---------- Step 2: what to improve ----------

  function chooseHtml() {
    const r = st.res.report;
    const kw = r.requirements.filter((x) => x.category !== 'responsibility');
    const listed = kw.filter((x) => x.status === 'matched' && !x.demonstrated && x.category !== 'soft');
    const gaps = kw.filter((x) => x.status !== 'matched');
    const order = { required: 0, preferred: 1, optional: 2 };
    gaps.sort((a, b) => order[a.importance] - order[b.importance]);
    const pdf = st.res.resume.kind === 'pdf';
    const sec = (z) => {
      const has = st.res.sections.includes(z);
      return `<label class="chk"><input type="checkbox" data-act="sec" data-z="${z}" ${st.sections.has(z) ? 'checked' : ''} ${has ? '' : 'disabled'}><span><b>${SECTIONS[z]}</b>${has ? '' : ' <span class="t3">(not found in this resume)</span>'}</span></label>`;
    };
    const tgt = (x, how, label) => `<label class="chk"><input type="checkbox" data-act="target" data-term="${esc(x.term)}" data-how="${how}" ${st.targets.get(x.term) === how ? 'checked' : ''}>
      <span class="grow"><b translate="no">${esc(x.term)}</b><span class="tag">${IMP[x.importance]}</span>${x.status === 'partial' ? '<span class="tag warn">partly</span>' : x.status === 'missing' ? '<span class="tag err">missing</span>' : ''}${st.tried.includes(x.term) ? '<span class="tag">tried before</span>' : ''}
      <div class="ev">${label}${x.evidence[0] ? ` · resume: "${esc(x.evidence[0].text.slice(0, 120))}"` : ''}</div></span></label>`;
    return `
      <div class="grid2">
        <div>
          <div class="card"><h3>1. Sections to improve</h3>${['summary', 'skills', 'experience', 'projects'].map(sec).join('')}
            <div class="t3">Names, contact details, job titles, companies, dates, education and certifications are never changed.</div></div>
          <div class="card"><h3>${pdf ? '3. PDF layout' : '3. Your Word file'}</h3>${pdf ? `
            <label class="chk"><input type="radio" name="mode" data-act="mode" value="keep" ${st.mode === 'keep' ? 'checked' : ''}><span><b>Keep my PDF's design</b><div class="ev">Same fonts and layout. Only rewrites that fit the existing lines are made: no new bullets.</div></span></label>
            <label class="chk"><input type="radio" name="mode" data-act="mode" value="rebuild" ${st.mode === 'rebuild' ? 'checked' : ''}><span><b>Build a clean ATS-friendly PDF</b><div class="ev">All changes, new bullets included, in a simple one-column layout every ATS reads in order. Your original design is not kept.</div></span></label>
            <div class="t3">For edits with your own design, use the Word (.docx) version of this resume.</div>`
    : '<div class="t2">Your fonts, styles and spacing are kept. Rewritten lines keep their formatting, new bullets copy the bullets around them, and Word reflows the pages.</div>'}</div>
        </div>
        <div class="card"><h3>2. Keywords</h3>
          ${listed.length ? `<div class="t2" style="margin-bottom:4px"><b>Show these in your work experience</b> - the resume lists them, but no job or project shows them.</div>${listed.map((x) => tgt(x, 'demonstrate', 'Listed only: will be worked into a related bullet')).join('')}` : ''}
          ${gaps.length ? `<div class="t2" style="margin:12px 0 4px"><b>Missing or partly matched</b> - tick only what you have really used. Unticked ones are never added; they stay listed as gaps.</div>${gaps.map((x) => tgt(x, 'confirmed', 'I have used this')).join('')}` : ''}
          ${!listed.length && !gaps.length ? '<div class="t2">Every keyword is matched and shown in experience. The optimizer can still sharpen the summary and bullets.</div>' : ''}
        </div>
      </div>`;
  }

  // ---------- Step 3: the proposed changes ----------

  function reviewHtml() {
    const p = st.proposal;
    const pdfKeep = st.res.resume.kind === 'pdf' && st.mode === 'keep';
    const notFit = p.changes.filter((c) => st.accept.has(c.cid) && pdfKeep && !c.fitsLayout).length;
    const unconfirmed = st.res.report.requirements.filter((r) => r.status !== 'matched' && r.category !== 'responsibility' && !p.targets.some((t) => t.term === r.term));
    const card = (c) => {
      const on = st.accept.has(c.cid);
      return `<div class="chg ${on ? '' : 'off'} ${c.safe ? '' : 'flag'}"><div class="hd">
        <input type="checkbox" data-act="accept" data-cid="${c.cid}" ${on ? 'checked' : ''} aria-label="Accept this change"><b>${OPS[c.op]}</b><span class="tag">${SECTIONS[c.section] || c.section}</span>
        ${c.keywords.map((k) => `<span class="tag ok" translate="no">+ ${esc(k.term)}</span>`).join('')}
        ${pdfKeep && !c.fitsLayout ? '<span class="tag warn">does not fit the original layout</span>' : ''}</div>
        <div class="cols"><div class="a"><div class="lbl">Before</div>${c.op === 'insert' ? '<span class="t3">(new line)</span>' : esc(c.before)}</div><div class="b"><div class="lbl">After</div>${c.op === 'delete' ? '<span class="t3">(removed)</span>' : esc(c.text)}</div></div>
        ${c.flags.length ? `<div class="flags">${c.flags.map((f) => '⚠ ' + esc(f)).join('<br>')}</div>` : ''}${c.reason ? `<div class="why">Why: ${esc(c.reason)}</div>` : ''}</div>`;
    };
    return `
      <div class="note">${esc(p.summary || 'Proposed changes')} · ${p.changes.length} proposed, ${p.changes.filter((c) => c.safe).length} passed every check, ${p.changes.filter((c) => !c.safe).length} flagged (off unless you turn them on).
        <span style="float:right"><button class="link" data-act="acceptSafe">Accept all that passed</button> · <button class="link" data-act="rejectAll">Reject all</button></span></div>
      ${notFit ? `<div class="warnbox">${notFit} accepted change${notFit === 1 ? ' does' : 's do'} not fit the original PDF lines and will be left out. <button class="link" data-act="mode" value="rebuild">Use the clean ATS-friendly PDF instead</button></div>` : ''}
      ${p.changes.map(card).join('') || '<div class="card">The AI proposed no change that passed the checks. Go back and choose other sections or keywords.</div>'}
      ${p.cannot.length || unconfirmed.length ? `<div class="card"><h3>Not added - these need experience the resume doesn't show</h3><ul>
        ${p.cannot.map((c) => `<li><b translate="no">${esc(c.term)}</b>${c.why ? ` - ${esc(c.why)}` : ''}</li>`).join('')}
        ${unconfirmed.filter((r) => !p.cannot.some((c) => c.term.toLowerCase() === r.term.toLowerCase())).map((r) => `<li><b translate="no">${esc(r.term)}</b> <span class="t3">(${IMP[r.importance]}, not confirmed by you)</span></li>`).join('')}</ul></div>` : ''}
      ${p.dropped.length ? `<details class="card"><summary>${p.dropped.length} proposal${p.dropped.length === 1 ? ' was' : 's were'} thrown away by the checks</summary><ul>${p.dropped.map((d) => `<li>${esc(OPS[d.op] || d.op)}: "${esc(String(d.text).slice(0, 140))}" - ${esc(d.why)}</li>`).join('')}</ul></details>` : ''}`;
  }

  // ---------- Step 4: the new file ----------

  function resultHtml() {
    const b = st.build;
    const v = b.verify;
    const statusTag = (s) => `<span class="tag ${s === 'matched' ? 'ok' : s === 'partial' ? 'warn' : 'err'}">${s}</span>`;
    const missingIn = v.present.filter((x) => !x.ok).length;
    const rows = b.compare.filter((r) => !st.onlyChanges || r.kind !== 'same' || r.heading);
    const present = new Map(v.present.map((x) => [x.cid, x.ok]));
    return `
      <div class="card"><div class="top">
        <span class="big" style="color:${color(b.before.score)}">${fmt(b.before.score)}</span><span style="font-size:24px">→</span><span class="big" style="color:${color(b.after.score)}">${fmt(b.after.score)}<small>/100</small></span>
        <div class="grow"><b>${v.delta > 0 ? `+${fmt(v.delta)} points` : v.delta < 0 ? `${fmt(v.delta)} points` : 'No change in score'}</b>
          <div class="t2">Both scores come from the same rules, reading the actual files. The new file below is exactly the one scored, downloaded and attached.</div>
          ${b.history.length > 2 ? `<div class="t3">Passes: ${b.history.map(fmt).join(' → ')}</div>` : ''}</div></div>
        ${b.rebuilt ? '<div class="note" style="margin-top:10px">This is a rebuilt, one-column ATS-friendly PDF: the text is yours, the original design is not kept.</div>' : ''}
        ${missingIn ? `<div class="warnbox" style="margin-top:10px">${missingIn} accepted change${missingIn === 1 ? ' was' : 's were'} not found when the new file was read back.</div>` : ''}
        ${b.left.length ? `<div class="warnbox" style="margin-top:10px">${b.left.length} change${b.left.length === 1 ? ' was' : 's were'} left out: ${b.left.slice(0, 3).map((c) => esc(c.why)).join('; ')}</div>` : ''}
      </div>
      <div class="grid2">
        <div class="card"><h3>Why the score changed</h3><ul>${v.explain.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          ${b.after.warnings.length ? `<h3 style="margin-top:12px">Formatting warnings in the new file</h3><ul>${b.after.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card"><h3>Selected keywords, checked in the new file</h3>${v.keywords.length ? `<table><tr><th>Keyword</th><th>Before</th><th>After</th><th></th></tr>
          ${v.keywords.map((k) => `<tr><td><b translate="no">${esc(k.term)}</b><div class="t3">${k.how === 'confirmed' ? 'confirmed by you' : 'to show in experience'}</div>${k.evidence ? `<div class="ev">"${esc(k.evidence.slice(0, 110))}"</div>` : ''}</td>
            <td>${statusTag(k.before)}${k.demonstratedBefore ? '<div class="t3">in experience</div>' : ''}</td><td>${statusTag(k.after)}${k.demonstrated ? '<div class="t3">in experience</div>' : ''}</td><td>${k.done ? '<span class="tag ok">done</span>' : '<span class="tag err">not done</span>'}</td></tr>`).join('')}</table>` : '<div class="t3">No keyword was selected.</div>'}
          <h3 style="margin-top:12px">Next</h3><div class="${b.next.canContinue ? 't2' : 't2'}">${esc(b.next.reason)}.</div>
          ${b.next.needExperience.length ? `<div class="t3" style="margin-top:4px">Still missing: ${b.next.needExperience.slice(0, 12).map(esc).join(', ')}</div>` : ''}</div>
      </div>
      <div class="card"><h3 style="display:flex;align-items:center">Original vs. optimized <span class="grow"></span><label class="t3" style="font-weight:400"><input type="checkbox" data-act="onlyChanges" ${st.onlyChanges ? 'checked' : ''}> only changed lines</label></h3>
        <div class="cmp"><div class="h">Original</div><div class="h">Optimized</div>
          ${rows.map((r) => { const ok = r.cid ? present.get(r.cid) : null; const mk = ok == null ? '' : `<span class="mk ${ok ? 'ok' : 'no'}" title="${ok ? 'Found in the new file when it was read back' : 'Not found in the new file'}">${ok ? '✓' : '✕'}</span>`;
    return `<div class="a ${r.kind} ${r.heading ? 'heading' : ''}">${esc(r.a)}</div><div class="b ${r.kind} ${r.heading ? 'heading' : ''}">${mk}${esc(r.b)}</div>`; }).join('')}</div>
        <div class="t3" style="margin-top:6px">✓ = the line was found when the new file was read back.</div>
        <details style="margin-top:10px"><summary>The new file's text, as an ATS reads it</summary><div class="cmp" style="grid-template-columns:1fr;margin-top:8px">${b.finalLines.map((l) => `<div class="${l.kind === 'heading' ? 'heading' : ''}">${l.kind === 'bullet' ? '• ' : ''}${esc(l.text)}</div>`).join('')}</div></details>
      </div>`;
  }

  function footHtml() {
    const s = st.step;
    if (s === 'score') return `<span class="t3">Same scoring before and after every change.</span><span class="sp"></span><button class="btn" data-act="rescore">Re-read the job</button><button class="btn pri" data-act="go" data-step="choose">Choose what to improve →</button>`;
    if (s === 'choose') {
      const n = st.targets.size;
      return `<button class="btn" data-act="go" data-step="score">← Score</button><span class="sp"></span><span class="t3">${st.sections.size} section${st.sections.size === 1 ? '' : 's'} · ${n} keyword${n === 1 ? '' : 's'}</span>
        <button class="btn pri" data-act="optimize" ${st.sections.size ? '' : 'disabled'}>Optimize with AI</button>`;
    }
    if (s === 'review') {
      const n = st.accept.size;
      return `<button class="btn" data-act="go" data-step="choose">← Choose</button><span class="sp"></span><span class="t3">${n} of ${st.proposal.changes.length} accepted</span><button class="btn pri" data-act="build" ${n ? '' : 'disabled'}>Build the resume and re-score</button>`;
    }
    const b = st.build;
    return `<button class="btn" data-act="go" data-step="review">← Changes</button><button class="btn" data-act="restart">Start over from the original</button><span class="sp"></span>
      <button class="btn" data-act="again" ${b.next.canContinue ? '' : 'disabled'} title="${esc(b.next.reason)}">Another pass</button>
      <button class="btn" data-act="download">Download</button><button class="btn pri" data-act="use">Use for this application</button>`;
  }

  // ---------- Actions ----------

  async function call(type, extra, label) {
    st.busy = label; st.error = ''; st.stage = ''; st.t0 = Date.now(); st.prog = null;
    st.busyOp = { atsScore: 'score', atsOptimize: 'optimize', atsBuild: 'build' }[type];
    render();
    clearInterval(poll);
    let lastPreview = '';
    poll = setInterval(async () => {
      try {
        const { aiStatus, atsProgress } = await chrome.storage.local.get(['aiStatus', 'atsProgress']);
        st.stage = aiStatus?.state === 'working' ? aiStatus.stage || '' : '';
        if (atsProgress) st.prog = atsProgress;
      } catch { /* extension reloaded */ }
      const a = root?.getElementById('steps'), b = root?.getElementById('secs'), c = root?.getElementById('preview');
      if (a) a.innerHTML = stepsHtml();
      if (b) b.textContent = Math.round((Date.now() - st.t0) / 1000) + 's';
      // The preview is redrawn only when it changes (keeps its scroll position).
      if (c) { const html = previewHtml(); if (html !== lastPreview) { c.innerHTML = html; lastPreview = html; } }
    }, 400);
    let r;
    try { r = await ctx.api.send({ type, profile: ctx.profile, job: ctx.job, resumeId: st.resumeId, file: st.file, ...extra }); } catch (e) { r = { ok: false, error: e.message }; }
    clearInterval(poll);
    st.busy = '';
    if (!r?.ok || !r.result) {
      st.error = r?.error || 'Something went wrong. Try again.';
      notify('err', { atsScore: 'Scoring failed', atsOptimize: 'Optimizing failed', atsBuild: 'Building the resume failed' }[type], st.error);
      render();
      return null;
    }
    const res = r.result;
    if (type === 'atsScore') notify('ok', `Resume scored: ${fmt(res.report.score)}/100`, `${res.report.counts.matched} matched, ${res.report.counts.partial} partly, ${res.report.counts.missing} missing · ${res.resume.name}`);
    if (type === 'atsOptimize') notify('ok', `${res.changes.length} change${res.changes.length === 1 ? '' : 's'} proposed`, `${res.changes.filter((c) => c.safe).length} passed every check, ${res.changes.filter((c) => !c.safe).length} flagged. Review them.`);
    if (type === 'atsBuild') notify('ok', `New resume: ${fmt(res.before.score)} → ${fmt(res.after.score)}`, `${res.verify.present.filter((x) => x.ok).length} change${res.verify.present.length === 1 ? '' : 's'} in the file · ${res.file.name}`);
    return res;
  }
  // Every finished step says so on the page; with the tab in the background, also a Chrome notification.
  function notify(kind, title, msg) {
    ctx.api.toast({ kind, title, msg, ms: kind === 'err' ? 9000 : 6000 });
    if (document.hidden) ctx.api.send({ type: 'atsNotify', title, msg });
  }
  async function rescore(force = false) {
    const res = await call('atsScore', { force }, force ? 'Reading the job again...' : 'Scoring the resume...');
    if (!res) return false;
    st.res = res;
    st.sections = new Set(res.sections);
    defaultTargets();
    if (!st.file) ctx.onScored?.(res);
    render();
    return true;
  }
  async function optimize() {
    const targets = [...st.targets].map(([term, how]) => ({ term, how }));
    const res = await call('atsOptimize', { sections: [...st.sections], targets, mode: st.mode }, 'The AI is tailoring the resume...');
    if (!res) return;
    st.proposal = { ...res, targets };
    const pdfKeep = st.res.resume.kind === 'pdf' && st.mode === 'keep';
    st.accept = new Set(res.changes.filter((c) => c.safe && (!pdfKeep || c.fitsLayout)).map((c) => c.cid));
    st.build = null;
    st.step = 'review';
    render();
  }
  async function build() {
    const changes = st.proposal.changes.filter((c) => st.accept.has(c.cid));
    const res = await call('atsBuild', { changes, mode: st.mode, targets: st.proposal.targets, history: st.history }, 'Writing the new resume and scoring it again...');
    if (!res) return;
    st.build = res;
    st.history = res.history;
    st.step = 'result';
    ctx.onBuilt?.(res);
    render();
  }
  async function again() {
    st.tried = [...new Set([...st.tried, ...st.proposal.targets.map((t) => t.term)])];
    st.file = { ...st.build.file };
    st.proposal = null;
    st.build = null;
    if (await rescore()) { st.step = 'choose'; render(); }
  }
  async function restart() {
    st.file = null; st.history = []; st.tried = []; st.proposal = null; st.build = null;
    if (await rescore()) { st.step = 'choose'; render(); }
  }
  function download() {
    const f = st.build.file;
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: f.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t || st.busy) return;
    const act = t.dataset.act;
    if (act === 'close') return close();
    if (act === 'go') { st.step = t.dataset.step; st.error = ''; return render(); }
    if (act === 'filter') { st.filter = t.dataset.f; return render(); }
    if (act === 'rescore') return rescore(true);
    if (act === 'optimize') return optimize();
    if (act === 'build') return build();
    if (act === 'again') return again();
    if (act === 'restart') return restart();
    if (act === 'download') return download();
    if (act === 'use') {
      return Promise.resolve(ctx.useFile(st.build.file)).then((msg) => { st.error = ''; ctx.api.toast({ kind: 'ok', title: 'Optimized resume', msg, ms: 7000 }); });
    }
    if (act === 'acceptSafe') { st.accept = new Set(st.proposal.changes.filter((c) => c.safe && (st.res.resume.kind !== 'pdf' || st.mode === 'rebuild' || c.fitsLayout)).map((c) => c.cid)); return render(); }
    if (act === 'rejectAll') { st.accept = new Set(); return render(); }
    if (act === 'mode' && t.tagName === 'BUTTON') { st.mode = t.getAttribute('value'); st.accept = new Set(st.proposal.changes.filter((c) => c.safe).map((c) => c.cid)); return render(); }
    if (act === 'saveWeights' || act === 'resetWeights') {
      const set = {};
      root.querySelectorAll('[data-w]').forEach((i) => (set[i.dataset.w] = Math.max(0, Math.min(100, Number(i.value) || 0))));
      return ctx.api.send({ type: 'atsWeights', set: act === 'saveWeights' ? set : null, reset: act === 'resetWeights' }).then((r) => { st.weights = r.weights; return rescore(); });
    }
  }
  function onChange(e) {
    const t = e.target;
    const act = t.dataset.act;
    if (!act || st.busy) return;
    if (act === 'sec') { if (t.checked) st.sections.add(t.dataset.z); else st.sections.delete(t.dataset.z); return render(); }
    if (act === 'target') { if (t.checked) st.targets.set(t.dataset.term, t.dataset.how); else st.targets.delete(t.dataset.term); return render(); }
    if (act === 'mode') { st.mode = t.value; return render(); }
    if (act === 'accept') { if (t.checked) st.accept.add(t.dataset.cid); else st.accept.delete(t.dataset.cid); return render(); }
    if (act === 'onlyChanges') { st.onlyChanges = t.checked; return render(); }
    if (act === 'pickResume') {
      const id = t.value;
      if (!(ctx.profile.resumes || []).some((x) => x.id === id)) return;
      st.resumeId = id; st.file = null; st.history = []; st.tried = []; st.proposal = null; st.build = null;
      return rescore();
    }
    if (act === 'upload') {
      const f = t.files?.[0];
      if (!f) return;
      if (!/\.(pdf|docx)$/i.test(f.name)) { st.error = 'Choose a PDF or Word (.docx) file'; return render(); }
      const rd = new FileReader();
      rd.onload = () => {
        st.file = { name: f.name, type: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), data: String(rd.result).split(',')[1] || '', uploaded: true };
        st.history = []; st.tried = []; st.proposal = null; st.build = null;
        rescore();
      };
      rd.readAsDataURL(f);
    }
  }

  window.__jobbidOptimizer = { open, isOpen: () => !!host?.isConnected };
})();
