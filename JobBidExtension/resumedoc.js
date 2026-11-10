// Resume files for the ATS matcher and optimizer: read a Word (.docx) or PDF resume into lines (what an ATS
// reads), and write the accepted changes back.
// Word: changed lines keep their runs' formatting, new bullets copy a nearby bullet's paragraph and letter
// style (numbering, indent, font), so Word reflows the page itself. PDF: either the original pages with only
// the changes that fit their lines (same look), or a clean one-column ATS-friendly PDF with every change.
// Uses resumefix.js (zip, PDF text) and pdf-lib.

const RD_BULLET = /^\s*[•●▪■◦‣○►✓*–-]\s+/;

async function rdOpen(file) {
  const bytes = rfBytes(atob(file.data));
  const kind = /\.docx$/i.test(file.name || '') || /wordprocessingml/.test(file.type || '') ? 'docx' : /\.pdf$/i.test(file.name || '') || /pdf/.test(file.type || '') ? 'pdf' : '';
  if (!kind) throw new Error(`${file.name || 'This file'}: only PDF and Word .docx resumes can be read`);
  const doc = kind === 'docx' ? await rdDocx(bytes) : await rdPdf(bytes);
  if (doc.lines.filter((l) => l.text.length > 1).length < 3) throw new Error(`Could not read the text of ${file.name}${kind === 'pdf' ? ' (a scanned image?)' : ''}`);
  return { ...doc, kind, name: file.name, type: file.type || (kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), bytes };
}

const rdB64 = (bytes) => btoa(rfLatin1(bytes));

// ---------- Word ----------

const rdXmlOf = async (e) => new TextDecoder().decode(e.method === 0 ? e.data : await rfStreamBytes(e.data, new DecompressionStream('deflate-raw')));

// Paragraphs in document order: where each starts and ends, its text pieces (<w:t>), tabs / line breaks,
// whether it is inside a table or text box, and its paragraph properties (style, numbering).
function rdDocxParas(xml) {
  const re = /<w:p(?=[\s>/])[^>]*?(\/?)>|<\/w:p>|<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>|<w:(tab|br|cr)(?=[\s/>])[^>]*\/>|<(\/?)w:tbl>|<(\/?)w:txbxContent>|<(\/?)mc:Fallback>/g;
  const stack = [], out = [];
  let tbl = 0, tx = 0, fb = 0, m;
  while ((m = re.exec(xml))) {
    const s = m[0];
    if (m[6] !== undefined) { fb += m[6] ? -1 : 1; continue; }
    if (fb > 0) continue; // the old-Word copy of a text box: the same text again
    if (m[4] !== undefined) { tbl += m[4] ? -1 : 1; continue; }
    if (m[5] !== undefined) { tx += m[5] ? -1 : 1; continue; }
    if (s.startsWith('</w:p')) {
      const p = stack.pop();
      if (!p) continue;
      p.end = m.index + s.length;
      out.push(p);
    } else if (s.startsWith('<w:p')) {
      if (m[1]) continue;
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ start: m.index, ts: [], seq: [], tab: false, br: false, inTable: tbl > 0, inTextbox: tx > 0, nested: false });
    } else if (stack.length) {
      const top = stack[stack.length - 1];
      if (m[3]) { top[m[3] === 'tab' ? 'tab' : 'br'] = true; top.seq.push(' '); } else { const t = { start: m.index, end: m.index + s.length, text: rfXmlDec(m[2]) }; top.ts.push(t); top.seq.push(t.text); }
    }
  }
  out.sort((a, b) => a.start - b.start);
  for (const p of out) {
    p.raw = p.ts.map((x) => x.text).join('');
    p.text = p.seq.join('').replace(/\s+/g, ' ').trim();
    const head = xml.slice(p.start, p.end).match(/^<w:p\b[^>]*>\s*(<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>)?/);
    p.pPr = head?.[1] || '';
    p.style = (p.pPr.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    p.numbered = /<w:numPr>/.test(p.pPr);
    p.sect = /<w:sectPr/.test(p.pPr);
    const rprs = p.ts.map((t) => rdRunProps(xml, p, t));
    p.rprs = rprs;
    const bold = (r) => /<w:b\/>|<w:b w:val="(1|true|on)"\/>/.test(r);
    const real = p.ts.map((t, i) => ({ t, r: rprs[i] })).filter((x) => x.t.text.trim());
    p.strong = /heading|title/i.test(p.style) || (real.length > 0 && real.every((x) => bold(x.r)));
    const sz = (rprs.find((r) => /<w:sz /.test(r)) || '').match(/<w:sz w:val="(\d+)"/);
    p.size = sz ? Number(sz[1]) / 2 : 0;
  }
  return out;
}
// The letter style (<w:rPr>) of the run that holds this text piece.
function rdRunProps(xml, p, t) {
  const rs = Math.max(xml.lastIndexOf('<w:r>', t.start), xml.lastIndexOf('<w:r ', t.start));
  if (rs < p.start) return '';
  const m = xml.slice(rs, t.start).match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  return m ? m[0].replace(/<w:rPrChange[\s\S]*?<\/w:rPrChange>/g, '') : '';
}

async function rdDocx(bytes) {
  const entries = rfZipRead(bytes);
  const entry = entries.find((x) => x.name === 'word/document.xml');
  if (!entry) throw new Error('No document text found in the .docx');
  const xml = await rdXmlOf(entry);
  const paras = rdDocxParas(xml).filter((p) => p.text.length >= 1);
  // Page headers / footers: an ATS may skip them (contact details there are a warning).
  let headerText = '';
  for (const e of entries.filter((x) => /^word\/(header|footer)\d*\.xml$/.test(x.name))) {
    headerText += ' ' + rdDocxParas(await rdXmlOf(e)).map((p) => p.text).join(' ');
  }
  const lines = paras.map((p, id) => ({ id, text: p.text.replace(RD_BULLET, ''), bullet: p.numbered || /list|bullet/i.test(p.style) || RD_BULLET.test(p.text), strong: p.strong, size: p.size,
    editable: p.ts.length > 0 && !p.tab && !p.br && !p.nested }));
  paras.forEach((p, id) => (p.id = id));
  const meta = {
    tables: /<w:tbl>/.test(xml), textboxes: /<w:txbxContent/.test(xml), columns: /<w:cols\b[^>]*w:num="[2-9]"/.test(xml),
    headerContact: /[\w.+-]+@[\w-]+\.[\w.]{2,}|\+?\d[\d\s().-]{8,}\d/.test(headerText) && !/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(paras.map((p) => p.text).join(' ')),
    unreadable: 0, pages: 0,
  };
  return {
    lines, meta,
    fits: (id) => !!lines[id]?.editable,
    async build(changes) {
      const edits = [], left = [];
      const runEdit = (p, next) => {
        const runs = p.ts.map((x) => x.text);
        let acc = '', i = 0;
        while (i < runs.length - 1 && runs[i] && next.startsWith(acc + runs[i])) acc += runs[i++];
        runs[i] = next.slice(acc.length);
        for (let k = i + 1; k < runs.length; k++) runs[k] = '';
        p.ts.forEach((x, k) => { if (runs[k] !== x.text) edits.push({ start: x.start, end: x.end, text: `<w:t xml:space="preserve">${rfXmlEsc(runs[k])}</w:t>` }); });
      };
      const prefixOf = (p) => (p.raw.match(/^\s*/)[0]) + ((p.raw.replace(/^\s*/, '').match(RD_BULLET) || [''])[0]);
      for (const c of changes) {
        const p = paras[c.op === 'insert' ? c.after : c.id];
        if (!p) { left.push({ ...c, why: 'line not found' }); continue; }
        if (c.op === 'replace') {
          if (!lines[c.id].editable) { left.push({ ...c, why: 'this line mixes tabs or breaks with text' }); continue; }
          runEdit(p, prefixOf(p) + c.text);
        } else if (c.op === 'delete') {
          // A table cell needs a paragraph, and the last paragraph of a section holds the page settings: emptied instead.
          if (p.inTable || p.sect || p.nested) { if (lines[c.id].editable) runEdit(p, ''); else left.push({ ...c, why: 'layout line' }); continue; }
          edits.push({ start: p.start, end: p.end, text: '' });
        }
      }
      // New lines: after their line, in the order given, each a copy of a body paragraph's look.
      const ins = new Map();
      for (const c of changes.filter((x) => x.op === 'insert')) {
        const p = paras[c.after];
        if (!p) continue;
        const src = paras[c.styleFrom] || p;
        const pPr = src.pPr.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '').replace(/<w:pPrChange[\s\S]*?<\/w:pPrChange>/g, '');
        const main = src.ts.map((t, i) => ({ len: t.text.length, r: src.rprs[i] })).sort((a, b) => b.len - a.len)[0];
        const rPr = main?.r || '';
        const typed = !src.numbered && RD_BULLET.test(src.raw.replace(/^\s*/, '')) ? src.raw.replace(/^\s*/, '').match(RD_BULLET)[0] : '';
        const xmlP = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${rfXmlEsc(typed + c.text)}</w:t></w:r></w:p>`;
        ins.set(p.end, (ins.get(p.end) || '') + xmlP);
      }
      for (const [at, text] of ins) edits.push({ start: at, end: at, text });
      // Last first, so earlier positions stay valid; at the same spot a removal goes before an insertion.
      edits.sort((a, b) => b.start - a.start || b.end - a.end);
      let out = xml;
      for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
      const raw = new TextEncoder().encode(out);
      const copy = entries.map((e) => (e === entry ? { ...e } : e));
      const ne = copy[entries.indexOf(entry)];
      Object.assign(ne, { method: 8, data: await rfStreamBytes(raw, new CompressionStream('deflate-raw')), crc: rfCrc32(raw), usize: raw.length });
      return { bytes: rfZipWrite(copy), left, mode: 'keep' };
    },
  };
}

// ---------- PDF ----------

async function rdPdf(bytes) {
  const pd = await rfPdfOpen(bytes);
  const editable = new Set(pd.parts.map((p) => p.id));
  const lines = pd.blocks.filter((b) => b.text.length >= 1).map((b) => ({ id: b.id, text: b.text, bullet: !!b.bullet, strong: !!b.strong, size: b.size || 0, editable: editable.has(b.id) }));
  // Two columns: long lines starting at two places far apart, several of each.
  const starts = pd.blocks.filter((b) => b.text.length > 25).map((b) => b.x0).sort((a, b) => a - b);
  let columns = false;
  if (starts.length >= 8) {
    for (let i = 1; i < starts.length; i++) {
      if (starts[i] - starts[i - 1] > 150 && i >= 4 && starts.length - i >= 4 && starts[i] > pd.pageWidth * 0.3) { columns = true; break; }
    }
  }
  const meta = { tables: false, textboxes: false, columns, headerContact: false, unreadable: pd.stats.pieces ? pd.stats.blank / pd.stats.pieces : 0, pages: pd.pageCount };
  return {
    lines, meta,
    fits: (id, text) => editable.has(id) && !pd.check(id, text),
    // mode "keep": the original pages, only the changes that fit their lines. "rebuild": a new clean PDF.
    async build(changes, mode, model) {
      if (mode === 'rebuild') {
        const final = JobBidATS.applyToLines(model, changes);
        return { bytes: await rdRebuildPdf(final, model), left: [], mode: 'rebuild' };
      }
      const fresh = await rfPdfOpen(bytes);
      const ok = new Map(), left = [];
      for (const c of changes) {
        if (c.op !== 'replace') { left.push({ ...c, why: 'adding or removing lines needs the rebuilt layout' }); continue; }
        const why = editable.has(c.id) ? fresh.check(c.id, c.text) : 'this line\'s font cannot be edited';
        if (why) left.push({ ...c, why }); else ok.set(c.id, c.text);
      }
      if (!ok.size) return { bytes, left, mode: 'keep' };
      const res = await fresh.apply(ok);
      return { bytes: res.bytes, left, mode: 'keep' };
    },
  };
}

// A clean one-column PDF in Helvetica: name, contact lines, headings with a rule, bullets with a hanging indent.
// Text an ATS reads in order; pages are added as needed. Widths are written into the fonts so any reader
// (and JobBid's own) measures the text exactly.
async function rdRebuildPdf(lines, model) {
  const L = PDFLib;
  const pdf = await L.PDFDocument.create();
  const reg = await pdf.embedFont(L.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(L.StandardFonts.HelveticaBold);
  const ok = new Set(RF_WINANSI.values());
  for (const f of [reg, bold]) {
    await f.embed();
    const dict = pdf.context.lookup(f.ref);
    const widths = [];
    for (let c = 32; c <= 255; c++) { const ch = RF_WINANSI.get(c); let w = 0; try { w = ch ? f.widthOfTextAtSize(ch, 1000) : 0; } catch { w = 0; } widths.push(Math.round(w)); }
    dict.set(L.PDFName.of('FirstChar'), L.PDFNumber.of(32));
    dict.set(L.PDFName.of('LastChar'), L.PDFNumber.of(255));
    dict.set(L.PDFName.of('Widths'), pdf.context.obj(widths));
  }
  const safe = (s) => [...String(s || '')].map((ch) => (ok.has(ch) ? ch : /\s/.test(ch) ? ' ' : [...ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')].filter((c) => ok.has(c)).join(''))).join('').replace(/\s+/g, ' ').trim();
  const W = 612, H = 792, M = 50, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ink = L.rgb(0.1, 0.1, 0.12), soft = L.rgb(0.3, 0.3, 0.35);
  const wrap = (text, font, size, width) => {
    const out = [];
    let cur = '';
    for (const w of text.split(' ')) {
      const next = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(next, size) <= width || !cur) cur = next;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const room = (h) => { if (y - h < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const put = (text, { font = reg, size = 10, indent = 0, bullet = false, color = ink, before = 0 }) => {
    const lh = size * 1.32;
    const parts = wrap(text, font, size, maxW - indent);
    y -= before;
    parts.forEach((ln, i) => {
      room(lh);
      y -= lh;
      if (bullet && i === 0) page.drawText('•', { x: M + indent - 11, y, size, font: reg, color });
      page.drawText(ln, { x: M + indent, y, size, font, color });
    });
  };
  let first = true;
  for (const l of lines) {
    const text = safe(l.text);
    if (!text) continue;
    if (first && l.zone === 'header') { put(text, { font: bold, size: 18 }); first = false; continue; }
    first = false;
    if (l.kind === 'heading') {
      room(40);
      put(text.toUpperCase(), { font: bold, size: 11.5, before: 10 });
      page.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.7, color: soft });
      y -= 6;
    } else if (l.zone === 'header') put(text, { size: 9.5, color: soft });
    else if (l.bullet || l.kind === 'bullet') put(text, { indent: 14, bullet: true, before: 1.5 });
    else put(text, { font: l.strong || l.dated ? bold : reg, size: l.strong || l.dated ? 10.5 : 10, before: l.dated || l.strong ? 5 : 1.5 });
  }
  const name = model.lines.find((l) => l.zone === 'header')?.text || 'Resume';
  pdf.setTitle(safe(name) + ' - Resume');
  pdf.setProducer('JobBid');
  return pdf.save();
}
