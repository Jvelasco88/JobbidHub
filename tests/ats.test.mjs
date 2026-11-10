// ATS matcher and resume optimizer: the extension's real ats.js / resumedoc.js / resumefix.js / pdf-lib, run in
// Node on Word and PDF resumes built here (made-up candidates, never real data). The two AI steps (reading the
// job, proposing edits) get fixed replies, so what is tested is everything JobBid does with them: checking the
// job's requirements against its text, scoring the file, refusing invented changes, writing the file, reading
// it back and scoring it again.
//   node ats.test.mjs
import { G, ATS, PDFLib, rdOpen, makeDocx, makePdf, fileOf, DOCX, JOB_ML, AI_ML, RESUME_ML } from './ats-fixtures.mjs';
let failed = 0, passed = 0;
const check = (name, ok, extra = '') => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}${extra ? ' - ' + extra : ''}`); } };
const section = (t) => console.log(t);

const JOB_DATA = { title: 'Data Analyst', company: 'Shop Co', url: 'https://jobs.example.com/2', description: `
We need a Data Analyst with 3 years of experience in SQL and Tableau.
Required: SQL, Tableau, Excel, A/B testing, stakeholder communication.
Preferred: Python, Looker. Bachelor's degree required.` };
const AI_DATA = { yearsRequired: 3, degree: { level: 'bachelor', fields: [], required: true }, requirements: [
  { term: 'SQL', category: 'skill', importance: 'required' }, { term: 'Tableau', category: 'tool', importance: 'required' },
  { term: 'Excel', category: 'tool', importance: 'required' }, { term: 'A/B testing', aliases: ['AB testing', 'experimentation'], category: 'skill', importance: 'required' },
  { term: 'stakeholder communication', category: 'soft', importance: 'required' }, { term: 'Python', category: 'skill', importance: 'preferred' },
  { term: 'Looker', category: 'tool', importance: 'preferred', related: ['Tableau'] },
] };

const JOB_DEVOPS = { title: 'DevOps Engineer', company: 'Cloudy', url: 'https://jobs.example.com/3', description: `
DevOps Engineer. 4+ years with Terraform, AWS and CI/CD pipelines. AWS Certified Solutions Architect preferred.
You will automate infrastructure and keep services reliable.` };
const AI_DEVOPS = { yearsRequired: 4, requirements: [
  { term: 'Terraform', category: 'tool', importance: 'required' }, { term: 'AWS', aliases: ['Amazon Web Services'], category: 'tool', importance: 'required' },
  { term: 'CI/CD', aliases: ['continuous integration'], category: 'skill', importance: 'required' },
  { term: 'AWS Certified Solutions Architect', category: 'certification', importance: 'preferred' },
  { term: 'automate infrastructure', category: 'responsibility', importance: 'required' },
] };


console.log('ATS matcher and optimizer');

section('Job reading (the AI\'s list, checked against the posting)');
const aML = ATS.validateAnalysis(AI_ML, JOB_ML);
check('a requirement the posting never names is dropped', !aML.requirements.some((r) => r.term === 'Rust') && aML.dropped >= 1);
check('duplicates are merged ("ML" into "Machine Learning")', aML.requirements.filter((r) => /^(ML|Machine Learning)$/.test(r.term)).length === 1);
check('years come from the posting (5)', aML.yearsRequired === 5);
check('a number of years the posting does not state is not used', ATS.validateAnalysis({ ...AI_ML, yearsRequired: 12 }, JOB_ML).yearsRequired === 5);
check('degree read: master, required', aML.degree?.level === 'master' && aML.degree.required);
check('multi-word skills kept whole', aML.requirements.some((r) => r.term === 'Predictive Modeling') && aML.requirements.some((r) => r.term === 'Statistical Modeling'));
check('required come before preferred', aML.requirements.findIndex((r) => r.importance === 'preferred') > aML.requirements.findLastIndex((r) => r.importance === 'required'));

section('Word resume: reading and scoring');
const mlFile = fileOf(makeDocx(RESUME_ML), 'Alex_Rivera.docx', DOCX);
const mlDoc = await rdOpen(mlFile);
const mlModel = ATS.buildModel(mlDoc.lines, mlDoc.meta);
const zoneOf = (t) => mlModel.lines.find((l) => l.text.startsWith(t))?.zone;
check('sections found', zoneOf('Software engineer with 9') === 'summary' && zoneOf('Languages') === 'skills' && zoneOf('Built ML ranking') === 'experience' && zoneOf('B.S. Computer') === 'education',
  JSON.stringify(mlModel.lines.map((l) => [l.text.slice(0, 20), l.zone, l.kind])));
check('a "title <tab> dates" line is read with a space and locked', mlModel.lines.some((l) => l.text === 'Senior Software Engineer, Acme Retail Jan 2019 - Present' && l.lock));
check('name and contact lines are locked', mlModel.lines.filter((l) => l.zone === 'header').every((l) => l.lock));
const rML = ATS.score(mlModel, aML);
const req = (r, t) => r.requirements.find((x) => x.term === t);
check('score is 0-100 and labelled an estimate', rML.score > 0 && rML.score < 100 && rML.label === 'Estimated ATS match');
check('alias: "K8s" matches Kubernetes', req(rML, 'Kubernetes').status === 'matched' && req(rML, 'Kubernetes').via === 'K8s');
check('alias: "ML" matches Machine Learning', req(rML, 'Machine Learning').status === 'matched');
check('word forms: "statistical models" matches Statistical Modeling', req(rML, 'Statistical Modeling').status === 'matched');
check('a related skill is only partial (TensorFlow for PyTorch)', req(rML, 'PyTorch').status === 'partial' && req(rML, 'PyTorch').via === 'TensorFlow');
check('half a multi-word term is partial (Predictive Modeling)', req(rML, 'Predictive Modeling').status !== 'matched');
check('listed only under Skills = matched but not shown in work (Docker)', req(rML, 'Docker').status === 'matched' && !req(rML, 'Docker').demonstrated);
check('shown in a job bullet = demonstrated (Python)', req(rML, 'Python').demonstrated && req(rML, 'Python').evidence.some((e) => e.section === 'experience'));
check('evidence quotes the resume line', req(rML, 'Kubernetes').evidence[0].text.includes('K8s'));
check('missing: Snowflake', req(rML, 'Snowflake').status === 'missing');
check('responsibility matched from a bullet ("Deployed models to production")', req(rML, 'deploy models to production').status === 'matched');
check('years from the dates (Jun 2015 - now, about 11)', rML.years.have >= 10 && rML.years.have <= 12, String(rML.years.have));
const qual = rML.components.find((c) => c.key === 'qualifications');
check('missing qualification: master\'s asked, bachelor\'s shown', qual && qual.points < qual.max && qual.deductions.some((d) => /master/.test(d.text)));
check('every lost point is explained', rML.components.every((c) => c.points >= c.max - 0.2 || c.deductions.length));
check('components add up to the score', Math.abs(rML.components.reduce((s, c) => s + c.points, 0) - rML.score) < 0.15);
check('same file, same score', ATS.score(ATS.buildModel(mlDoc.lines, mlDoc.meta), aML).score === rML.score);
check('weights can be changed', ATS.score(mlModel, aML, { keywords: 80 }).components.find((c) => c.key === 'keywords').max > rML.components.find((c) => c.key === 'keywords').max);

section('Repeating a keyword does not add points');
const repeated = RESUME_ML.map((p) => (p.text?.startsWith('Maintained a Java') ? { ...p, text: 'Maintained a Java billing service with Python, Python and Python tooling in Python.' } : p));
const repModel = ATS.buildModel((await rdOpen(fileOf(makeDocx(repeated), 'r.docx', DOCX))).lines, {});
const rRep = ATS.score(repModel, aML);
check('keyword coverage is the same with Python written 5 more times', rRep.components.find((c) => c.key === 'keywords').points === rML.components.find((c) => c.key === 'keywords').points);
const stuffed = RESUME_ML.concat(Array.from({ length: 8 }, () => ({ li: true, text: 'Used Docker daily.' })));
const rStuff = ATS.score(ATS.buildModel((await rdOpen(fileOf(makeDocx(stuffed), 's.docx', DOCX))).lines, {}), aML);
check('the same keyword 7+ times is flagged as stuffing', rStuff.warnings.some((w) => /stuffing/.test(w)));

section('Other jobs');
const aData = ATS.validateAnalysis(AI_DATA, JOB_DATA);
const dataResume = [{ name: true, text: 'Sam Lee' }, { text: 'sam@example.com | 555-010-3000' }, { h: true, text: 'Experience' }, { tab: ['Analyst, Shop Co', 'Mar 2022 - Present'] },
  { li: true, text: 'Ran experimentation programs and built Tableau dashboards for marketing.' }, { li: true, text: 'Wrote SQL queries for weekly reports.' },
  { h: true, text: 'Skills' }, { text: 'SQL, Tableau, Excel' }, { h: true, text: 'Education' }, { text: 'Bachelor of Arts in Economics, 2021' }];
const rData = ATS.score(ATS.buildModel((await rdOpen(fileOf(makeDocx(dataResume), 'd.docx', DOCX))).lines, {}), aData);
check('alias "experimentation" matches A/B testing', req(rData, 'A/B testing').status === 'matched');
check('Looker missing but Tableau related: partial', req(rData, 'Looker').status === 'partial');
check('bachelor\'s asked and shown: no degree deduction', !rData.components.find((c) => c.key === 'qualifications')?.deductions.length);
check('years: about 4.7 vs 3 asked: full points', rData.components.find((c) => c.key === 'years').points === rData.components.find((c) => c.key === 'years').max);
const aDev = ATS.validateAnalysis(AI_DEVOPS, JOB_DEVOPS);
const devResume = [{ name: true, text: 'Jo Park' }, { text: 'jo@example.com' }, { h: true, text: 'Work Experience' }, { tab: ['DevOps Engineer, Cloudy Co', '2021 - 2023'] },
  { li: true, text: 'Automated infrastructure with Terraform on Amazon Web Services.' }, { h: true, text: 'Education' }, { text: 'BS Computer Science' }];
const rDev = ATS.score(ATS.buildModel((await rdOpen(fileOf(makeDocx(devResume, { table: true }), 'v.docx', DOCX))).lines, (await rdOpen(fileOf(makeDocx(devResume, { table: true }), 'v.docx', DOCX))).meta), aDev);
check('"Amazon Web Services" matches AWS', req(rDev, 'AWS').status === 'matched');
check('missing certification lowers qualifications', rDev.components.find((c) => c.key === 'qualifications').deductions.some((d) => /Certified/.test(d.text)));
check('years short: 2021-2023 vs 4 asked', rDev.components.find((c) => c.key === 'years').points < rDev.components.find((c) => c.key === 'years').max);
check('a table is a formatting warning', rDev.warnings.some((w) => /Tables/.test(w)));
check('no Skills heading is a formatting warning', rDev.warnings.some((w) => /Skills/.test(w)));

section('Optimizer: proposed changes are checked');
const id = (t) => mlModel.lines.find((l) => l.text.startsWith(t)).id;
const targets = [{ term: 'Docker', how: 'demonstrate' }, { term: 'PyTorch', how: 'confirmed' }, { term: 'Healthcare', how: 'confirmed' }];
const ctxV = { model: mlModel, analysis: aML, report: rML, sections: ['summary', 'skills', 'experience'], targets, kind: 'docx', fits: mlDoc.fits };
const proposed = { changes: [
  { op: 'replace', id: id('Software engineer with 9'), text: 'Machine learning engineer with 9 years of experience building ML services in Python and PyTorch, now focused on healthcare data.', reason: 'lead with the title' },
  { op: 'replace', id: id('ML & Data'), text: 'ML & Data: PyTorch, TensorFlow, scikit-learn, Kubernetes (K8s), Docker, statistical modeling', reason: 'job terms' },
  { op: 'insert', after: id('Deployed models'), text: 'Packaged ranking models in Docker images for repeatable deployments.', reason: 'show Docker' },
  { op: 'insert', after: id('Built statistical'), text: 'Built predictive modeling pipelines with Snowflake that raised revenue by 25%.', reason: 'invented' },
  { op: 'replace', id: id('Senior Software Engineer, Acme'), text: 'Staff ML Engineer, Acme Retail Jan 2019 - Present', reason: 'title' },
  { op: 'delete', id: id('Maintained a Java'), reason: 'not relevant' },
  { op: 'replace', id: id('B.S. Computer'), text: 'M.S. Computer Science', reason: 'degree' },
  { op: 'replace', id: id('Wrote Python ETL'), text: 'Wrote Python ETL jobs on Databricks for risk teams.', reason: 'new tool' },
], cannot: [{ term: 'Snowflake', why: 'no Snowflake work in the resume' }], summary: 'Tailored' };
const v = ATS.validateChanges(proposed, ctxV);
const ch = (t) => v.changes.find((c) => c.text.startsWith(t) || c.before.startsWith(t));
check('a supported rewrite passes', ch('Machine learning engineer')?.safe);
check('a confirmed keyword (PyTorch) is allowed', ch('ML & Data')?.safe);
check('a new bullet showing a listed skill passes', ch('Packaged ranking')?.safe);
check('an invented number is flagged', ch('Built predictive')?.flags.some((f) => /25%/.test(f)));
check('an unconfirmed missing keyword (Snowflake) is flagged', ch('Built predictive')?.flags.some((f) => /Snowflake/.test(f)));
check('a new tool name (Databricks) is flagged', ch('Wrote Python ETL')?.flags.some((f) => /databricks/i.test(f)));
check('a job title/date line cannot change', v.dropped.some((d) => /locked/.test(d.why) && /Staff ML/.test(d.text)));
check('education was not selected: dropped', v.dropped.some((d) => /Education|education/.test(d.why)));
check('a delete in a selected section is kept', !!v.changes.find((c) => c.op === 'delete'));
check('the new bullet copies a body bullet', ch('Packaged ranking').styleFrom === id('Deployed models'));
check('"cannot" list passed on', v.cannot[0]?.term === 'Snowflake');
check('keywords each change adds are listed', ch('Packaged ranking').keywords.some((k) => k.term === 'Docker'));

section('Word: build, read again, score again');
const accepted = v.changes.filter((c) => c.safe);
const built = await mlDoc.build(accepted, 'keep', mlModel);
const outDoc = await rdOpen(fileOf(built.bytes, 'Alex_Rivera.docx', DOCX));
const outModel = ATS.buildModel(outDoc.lines, outDoc.meta);
const after = ATS.score(outModel, aML);
check('nothing left out', !built.left.length);
check('the rewritten summary is in the new file', outModel.fullText.includes('Machine learning engineer with 9 years'));
check('the new bullet is in the new file, right after its line', (() => { const i = outModel.lines.findIndex((l) => l.text.startsWith('Deployed models')); return outModel.lines[i + 1]?.text.startsWith('Packaged ranking'); })());
check('the new bullet is a list item like its neighbour', outModel.lines.find((l) => l.text.startsWith('Packaged ranking')).bullet);
check('the deleted bullet is gone', !outModel.fullText.includes('Maintained a Java'));
check('a bold "Languages:" label keeps its own run', /<w:b\/><w:sz w:val="21"\/><\/w:rPr><w:t xml:space="preserve">ML &amp; Data: <\/w:t>/.test(new TextDecoder().decode(await (async () => { const e = G('rfZipRead')(built.bytes).find((x) => x.name === 'word/document.xml'); return G('rfStreamBytes')(e.data, new DecompressionStream('deflate-raw')); })())));
const xmlOut = new TextDecoder().decode(await G('rfStreamBytes')(G('rfZipRead')(built.bytes).find((x) => x.name === 'word/document.xml').data, new DecompressionStream('deflate-raw')));
check('page settings appear once (not copied into new lines)', (xmlOut.match(/<w:sectPr/g) || []).length === 1);
check('the file is still well-formed XML (tags balanced)', (xmlOut.match(/<w:p>|<w:p /g) || []).length === (xmlOut.match(/<\/w:p>/g) || []).length);
check('the score went up', after.score > rML.score, `${rML.score} -> ${after.score}`);
check('Docker is now shown in work experience', req(after, 'Docker').demonstrated);
check('Snowflake (refused) is still missing', req(after, 'Snowflake').status === 'missing');
const ver = ATS.verify({ before: rML, after, beforeModel: mlModel, afterModel: outModel, targets, changes: accepted });
check('verification: Docker done, PyTorch done', ver.keywords.find((k) => k.term === 'Docker').done && ver.keywords.find((k) => k.term === 'PyTorch').done);
check('verification: every accepted change is in the file', ver.present.every((p) => p.ok), JSON.stringify(ver.present));
check('the change is explained', ver.explain.length >= 2 && ver.explain.some((e) => /Keyword coverage/.test(e)));
const nx = ATS.nextStep(after, [rML.score, after.score], targets.map((t) => t.term));
check('what is left is listed as needing experience', nx.needExperience.includes('Snowflake'));
check('a pass that gained under 1 point stops the loop', ATS.nextStep(after, [70, 70.4], []).canContinue === false);

section('PDF: original look, or a rebuilt ATS-friendly PDF');
const pdfLines = RESUME_ML.map((p) => (p.tab ? { text: `${p.tab[0]}  ${p.tab[1]}`, b: true } : p.label ? { text: p.label + p.text } : p));
const pdfFile = fileOf(await makePdf(pdfLines), 'Alex_Rivera.pdf', 'application/pdf');
const pDoc = await rdOpen(pdfFile);
const pModel = ATS.buildModel(pDoc.lines, pDoc.meta);
const pRep = ATS.score(pModel, aML);
check('PDF: sections found', pModel.lines.some((l) => l.zone === 'experience' && l.bullet) && pModel.lines.some((l) => l.zone === 'skills'), JSON.stringify(pModel.lines.map((l) => [l.text.slice(0, 16), l.zone, l.kind])));
check('PDF and Word of the same resume score about the same', Math.abs(pRep.score - rML.score) < 6, `${pRep.score} vs ${rML.score}`);
const pid = (t) => pModel.lines.find((l) => l.text.startsWith(t)).id;
const pChanges = ATS.validateChanges({ changes: [
  { op: 'replace', id: pid('Wrote Python ETL'), text: 'Wrote Python ETL jobs in Docker for risk teams.' },
  { op: 'insert', after: pid('Deployed models'), text: 'Packaged ranking models in Docker images for repeatable deployments.' },
] }, { model: pModel, analysis: aML, report: pRep, sections: ['experience'], targets, kind: 'pdf', fits: pDoc.fits });
check('PDF: a short rewrite fits the original line', pChanges.changes[0].fitsLayout);
const keep = await pDoc.build(pChanges.changes, 'keep', pModel);
const keepModel = ATS.buildModel((await rdOpen(fileOf(keep.bytes, 'a.pdf', 'application/pdf'))).lines, {});
check('PDF keep: the rewrite is in the file', keepModel.fullText.includes('Wrote Python ETL jobs in Docker for risk teams.'));
check('PDF keep: the new bullet is left out (it needs the rebuilt layout)', keep.left.length === 1 && keep.left[0].op === 'insert');
const reb = await pDoc.build(pChanges.changes, 'rebuild', pModel);
const rebDoc = await rdOpen(fileOf(reb.bytes, 'a.pdf', 'application/pdf'));
const rebModel = ATS.buildModel(rebDoc.lines, rebDoc.meta);
check('PDF rebuild: every change is in the file', rebModel.fullText.includes('Wrote Python ETL jobs in Docker for risk teams.') && rebModel.fullText.includes('Packaged ranking models in Docker images'));
check('PDF rebuild: headings, bullets and sections read back', rebModel.lines.some((l) => l.kind === 'heading' && l.section === 'experience') && rebModel.lines.find((l) => l.text.startsWith('Packaged ranking'))?.bullet,
  JSON.stringify(rebModel.lines.map((l) => [l.text.slice(0, 16), l.zone, l.kind])));
check('PDF rebuild: wrapped bullets read back as one line each', rebModel.lines.filter((l) => l.zone === 'experience' && l.bullet).length === pModel.lines.filter((l) => l.zone === 'experience' && l.bullet).length + 1);
const rebRep = ATS.score(rebModel, aML);
check('PDF rebuild: no formatting warnings added', rebRep.warnings.length <= pRep.warnings.length, rebRep.warnings.join(' | '));
check('PDF rebuild: score not lower than the original', rebRep.score >= pRep.score, `${pRep.score} -> ${rebRep.score}`);
const longLines = pdfLines.concat(Array.from({ length: 70 }, (_, i) => ({ li: true, text: `Delivered project ${i + 1} with Python services for internal teams across several regions and products.` })));
const longDoc = await rdOpen(fileOf(await makePdf(longLines.slice(0, 40)), 'l.pdf', 'application/pdf'));
const longModel = ATS.buildModel(longDoc.lines.concat(longLines.slice(40).map((l, i) => ({ id: 1000 + i, text: l.text, bullet: true }))), {});
const longOut = await rdOpen(fileOf(await G('rdRebuildPdf')(longModel.lines, longModel), 'l.pdf', 'application/pdf'));
check('PDF rebuild: a long resume flows onto more pages', longOut.meta.pages >= 2 && longOut.lines.length >= longModel.lines.length - 2, `${longOut.meta.pages} pages`);
const twoCol = await rdOpen(fileOf(await makePdf(Array.from({ length: 12 }, (_, i) => ({ text: `Left column sentence number ${i} about work`, right: `Right column sentence number ${i} about skills` })), { columns: true }), 'c.pdf', 'application/pdf'));
check('PDF: two columns are a formatting warning', ATS.score(ATS.buildModel(twoCol.lines, twoCol.meta), aML).warnings.some((w) => /column/i.test(w)));

section('More checks');
check('PDF: the title line is found even when it runs into the contact line', pRep.components.find((c) => c.key === 'title').points >= rML.components.find((c) => c.key === 'title').points - 0.5,
  `${pRep.components.find((c) => c.key === 'title').points}`);
const q = rDev.components.find((c) => c.key === 'qualifications');
check('a missing preferred certificate costs about half the education points, not all', q.points > q.max * 0.3 && q.points < q.max * 0.7, `${q.points}/${q.max}`);
const rows = ATS.compareRows(mlModel, accepted);
check('comparison: changed, added and removed rows', rows.some((r) => r.kind === 'changed') && rows.some((r) => r.kind === 'added' && /Packaged ranking/.test(r.b)) && rows.some((r) => r.kind === 'removed' && /Java billing/.test(r.a)));
check('comparison: every original line is there once', rows.filter((r) => r.kind !== 'added').length === mlModel.lines.length);

console.log(`\n${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
