// Shared by ats.test.mjs and optimizer.ui.mjs: the extension's ATS files loaded in a Node sandbox, and
// made-up Word / PDF resumes and jobs (never real candidate data).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT = process.env.JOBBID_EXT_DIR || path.resolve(here, '..', 'JobBidExtension');
const ctx = vm.createContext({ console, atob, btoa, TextEncoder, TextDecoder, CompressionStream, DecompressionStream, Response, Blob, URL, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, DataView });
ctx.self = ctx;
ctx.window = ctx;
for (const f of ['lib/pdf-lib.min.js', 'resumefix.js', 'resumedoc.js', 'ats.js']) vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
// Top-level const/function declarations of classic scripts live in the context's global lexical scope.
export const G = (name) => vm.runInContext(name, ctx);
export const ATS = G('JobBidATS'), PDFLib = G('PDFLib');
export const rdOpen = G('rdOpen'), rfZipWrite = G('rfZipWrite'), rfCrc32 = G('rfCrc32');


// ---------- Test files ----------

const enc = new TextEncoder();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A real .docx (opens in Word): styles, a bullet list (numbering), page settings in the last paragraph's section.
export function makeDocx(paras, { table = false } = {}) {
  const P = (p) => {
    const pPr = p.h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : p.li ? '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' : '';
    const run = (t, b) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}<w:sz w:val="${p.h ? 26 : p.name ? 36 : 21}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    if (p.tab) return `<w:p>${pPr}${run(p.tab[0], true)}<w:r><w:tab/></w:r>${run(p.tab[1], false)}</w:p>`;
    if (p.label) return `<w:p>${pPr}${run(p.label, true)}${run(p.text, false)}</w:p>`;
    return `<w:p>${pPr}${run(p.text, p.h || p.name || p.b)}</w:p>`;
  };
  let body = paras.map(P).join('');
  if (table) body += '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p></w:body></w:document>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': doc,
  };
  const entries = Object.entries(files).map(([name, text]) => { const data = enc.encode(text); return { name, nameBytes: enc.encode(name), flags: 0, method: 0, time: 0, date: 0, crc: rfCrc32(data), usize: data.length, data }; });
  return rfZipWrite(entries);
}
export const b64 = (bytes) => Buffer.from(bytes).toString('base64');
export const fileOf = (bytes, name, type) => ({ name, type, data: b64(bytes) });
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function makePdf(lines, { columns = false, pages = 1 } = {}) {
  const pdf = await PDFLib.PDFDocument.create();
  const reg = await pdf.embedFont(PDFLib.StandardFonts.Helvetica), bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  for (let pg = 0; pg < pages; pg++) {
    const page = pdf.addPage(G('Array').of(612, 792));
    let y = 740;
    for (const l of lines) {
      const size = l.h ? 13 : l.name ? 18 : 10;
      const font = l.h || l.name || l.b ? bold : reg;
      if (l.li) page.drawText('•', { x: 60, y, size, font: reg });
      page.drawText(l.text, { x: l.li ? 72 : 60, y, size, font });
      if (columns && l.right) page.drawText(l.right, { x: 330, y, size, font: reg });
      y -= size * 1.6;
    }
  }
  return pdf.save();
}


// ---------- Jobs and the AI's (fixed) readings of them ----------

export const JOB_ML = { title: 'Senior Machine Learning Engineer', company: 'Example Health', url: 'https://jobs.example.com/1', description: `
About the role: Example Health builds care tools for hospitals.
Requirements:
- 5+ years of experience building machine learning systems in production.
- Strong Python and PyTorch; experience with Kubernetes and Docker.
- Statistical modeling and predictive modeling for healthcare data.
- Deploy models to production and monitor them.
- Master's degree in Computer Science or a related field.
Nice to have:
- AWS SageMaker, MLOps, Snowflake.
We offer great benefits.` };
export const AI_ML = { titleAliases: ['ML Engineer', 'AI Engineer'], yearsRequired: 5, degree: { level: 'master', fields: ['Computer Science'], required: true }, requirements: [
  { term: 'Machine Learning', aliases: ['ML'], related: [], category: 'skill', importance: 'required' },
  { term: 'Python', aliases: [], related: [], category: 'skill', importance: 'required' },
  { term: 'PyTorch', aliases: [], related: ['TensorFlow'], category: 'tool', importance: 'required' },
  { term: 'Kubernetes', aliases: ['K8s'], related: [], category: 'tool', importance: 'required' },
  { term: 'Docker', aliases: [], related: [], category: 'tool', importance: 'required' },
  { term: 'Statistical Modeling', aliases: [], related: [], category: 'skill', importance: 'required' },
  { term: 'Predictive Modeling', aliases: [], related: [], category: 'skill', importance: 'required' },
  { term: 'Healthcare', aliases: ['health care'], related: [], category: 'domain', importance: 'preferred' },
  { term: 'deploy models to production', aliases: [], related: [], category: 'responsibility', importance: 'required' },
  { term: 'AWS SageMaker', aliases: ['SageMaker'], related: [], category: 'tool', importance: 'preferred' },
  { term: 'MLOps', aliases: [], related: [], category: 'skill', importance: 'preferred' },
  { term: 'Snowflake', aliases: [], related: [], category: 'tool', importance: 'preferred' },
  // Not in the posting: must be dropped.
  { term: 'Rust', aliases: [], related: [], category: 'skill', importance: 'required' },
  // Duplicate of Machine Learning: merged.
  { term: 'ML', aliases: [], related: [], category: 'skill', importance: 'preferred' },
] };


// ---------- Resumes ----------

export const RESUME_ML = [
  { name: true, text: 'Alex Rivera' },
  { text: 'Senior Software Engineer | AI Engineer' },
  { text: 'alex.rivera@example.com · (555) 010-2000 · Chicago, IL' },
  { h: true, text: 'Summary' },
  { text: 'Software engineer with 9 years of experience building data products and ML services in Python for retail and finance teams.' },
  { h: true, text: 'Skills' },
  { label: 'Languages: ', text: 'Python, SQL, Go' },
  { label: 'ML & Data: ', text: 'TensorFlow, scikit-learn, K8s, Docker, statistical models' },
  { h: true, text: 'Experience' },
  { tab: ['Senior Software Engineer, Acme Retail', 'Jan 2019 - Present'] },
  { li: true, text: 'Built ML ranking services in Python serving 3M requests a day.' },
  { li: true, text: 'Deployed models to production on K8s and cut latency by 40%.' },
  { li: true, text: 'Built statistical models for demand forecasting with TensorFlow.' },
  { tab: ['Software Engineer, Fin Bank', 'Jun 2015 - Dec 2018'] },
  { li: true, text: 'Wrote Python ETL jobs and dashboards for risk teams.' },
  { li: true, text: 'Maintained a Java billing service.' },
  { h: true, text: 'Education' },
  { text: 'B.S. Computer Science, State University, 2015' },
];
