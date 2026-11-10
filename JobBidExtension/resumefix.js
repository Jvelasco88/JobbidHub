// Resume file helpers: zip (Word .docx) reading and writing, and PDF text reading and in-place rewriting
// (the old words are taken out of the page and each new line is drawn at the same spot, with the same font and
// settings). Used by resumedoc.js for the ATS matcher and optimizer.

const rfLatin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };
const rfBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const rfNum = (v) => String(Math.round(v * 1000) / 1000);
const BULLET_RE = /^\s*[•●▪■◦‣○►✓*–-]\s+/;

// ---------- Word (.docx) ----------

async function rfStreamBytes(data, stream) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
}
const RF_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function rfCrc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = RF_CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function rfZipRead(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .docx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true), csize = dv.getUint32(p + 20, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    out.push({ name: new TextDecoder().decode(nameBytes), nameBytes, flags: dv.getUint16(p + 8, true) & ~8, method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true), crc: dv.getUint32(p + 16, true), usize: dv.getUint32(p + 24, true), data: bytes.subarray(start, start + csize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function rfZipWrite(entries) {
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const common = [...u16(e.flags), ...u16(e.method), ...u16(e.time), ...u16(e.date), ...u32(e.crc), ...u32(e.data.length), ...u32(e.usize), ...u16(e.nameBytes.length)];
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...common, ...u16(0)]);
    parts.push(head, e.nameBytes, e.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), e.nameBytes);
    off += head.length + e.nameBytes.length + e.data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(csize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let at = 0;
  for (const a of all) { out.set(a, at); at += a.length; }
  return out;
}

const rfXmlDec = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const rfXmlEsc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- PDF ----------

const RF_WINANSI = (() => {
  const m = new Map();
  for (let c = 32; c < 127; c++) m.set(c, String.fromCharCode(c));
  for (let c = 160; c < 256; c++) m.set(c, String.fromCharCode(c));
  const hi = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' };
  for (const [c, u] of Object.entries(hi)) m.set(Number(c), u);
  return m;
})();
const RF_GLYPHS = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
  question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”', ellipsis: '…', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', periodcentered: '·', copyright: '©',
  registered: '®', trademark: '™', degree: '°', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
function rfGlyph(name) {
  name = name.split('.')[0];
  if (/^[A-Za-z]$/.test(name)) return name;
  if (RF_GLYPHS[name]) return RF_GLYPHS[name];
  const u = name.match(/^uni([0-9A-Fa-f]{4})/) || name.match(/^u([0-9A-Fa-f]{4,6})$/);
  return u ? String.fromCodePoint(parseInt(u[1], 16)) : '';
}

function rfCMap(t, map, codes) {
  const hex = (h) => parseInt(h, 16);
  const u16 = (h) => { let s = ''; for (let k = 0; k + 4 <= h.length; k += 4) s += String.fromCharCode(hex(h.substr(k, 4))); return s; };
  for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) { map.set(hex(m[1]), u16(m[2])); codes.add(hex(m[1])); }
  }
  for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = hex(m[1]), hi = hex(m[2]);
      if (hi < lo || hi - lo > 65535) continue;
      if (m[3]) {
        const base = u16(m[3]), last = base.charCodeAt(base.length - 1);
        for (let c = lo; c <= hi; c++) { map.set(c, base.slice(0, -1) + String.fromCharCode(last + c - lo)); codes.add(c); }
      } else [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((x, j) => { if (lo + j <= hi) { map.set(lo + j, u16(x[1])); codes.add(lo + j); } });
    }
  }
}

function rfFontInfo(ctx, dict) {
  const L = PDFLib;
  const get = (d, k) => (d instanceof L.PDFDict ? ctx.lookup(d.get(L.PDFName.of(k))) : undefined);
  const nm = (o) => (o instanceof L.PDFName ? o.asString().slice(1) : '');
  const num = (o) => (o instanceof L.PDFNumber ? o.asNumber() : 0);
  const arr = (o) => (o instanceof L.PDFArray ? o.asArray().map((x) => ctx.lookup(x)) : []);
  const subtype = nm(get(dict, 'Subtype'));
  const rawBase = nm(get(dict, 'BaseFont'));
  const info = { base: rawBase.replace(/^[A-Z]{6}\+/, ''), subset: /^[A-Z]{6}\+/.test(rawBase), twoByte: false, widths: new Map(), dw: 0, uni: new Map(), tu: new Set(), used: new Set(), ok: true };
  let desc;
  if (subtype === 'Type0') {
    if (nm(get(dict, 'Encoding')) !== 'Identity-H') info.ok = false;
    info.twoByte = true;
    const d = arr(get(dict, 'DescendantFonts'))[0];
    desc = get(d, 'FontDescriptor');
    info.dw = get(d, 'DW') ? num(get(d, 'DW')) : 1000;
    const W = arr(get(d, 'W'));
    for (let k = 0; k < W.length;) {
      const first = num(W[k]);
      if (W[k + 1] instanceof L.PDFArray) { arr(W[k + 1]).forEach((w, j) => info.widths.set(first + j, num(w))); k += 2; }
      else { const last = num(W[k + 1]), w = num(W[k + 2]); for (let c = first; c <= last && c - first < 65536; c++) info.widths.set(c, w); k += 3; }
    }
  } else if (subtype === 'Type1' || subtype === 'TrueType' || subtype === 'MMType1') {
    desc = get(dict, 'FontDescriptor');
    const fc = num(get(dict, 'FirstChar'));
    arr(get(dict, 'Widths')).forEach((w, j) => info.widths.set(fc + j, num(w)));
    info.uni = new Map(RF_WINANSI);
    const enc = get(dict, 'Encoding');
    if (enc instanceof L.PDFDict) {
      let c = 0;
      for (const x of arr(get(enc, 'Differences'))) {
        if (x instanceof L.PDFNumber) c = x.asNumber();
        else { const u = rfGlyph(nm(x)); if (u) info.uni.set(c, u); c++; }
      }
    }
  } else info.ok = false; // Type3 and others: left untouched
  const tu = get(dict, 'ToUnicode');
  if (tu instanceof L.PDFRawStream) rfCMap(rfLatin1(L.decodePDFRawStream(tu).decode()), info.uni, info.tu);
  else if (info.twoByte) info.ok = false;
  return info;
}

const rfWidth = (f, c) => (f.widths.has(c) ? f.widths.get(c) : f.twoByte ? f.dw : f.widths.size ? 0 : 500);
const rfCodes = (str, f) => {
  const out = [];
  if (f?.twoByte) for (let k = 0; k + 1 < str.length; k += 2) out.push((str.charCodeAt(k) << 8) | str.charCodeAt(k + 1));
  else for (let k = 0; k < str.length; k++) out.push(str.charCodeAt(k));
  return out;
};
// Letters the font can draw: for a subset font only the ones the document already uses (the others are not in the file).
function rfFrom(f) {
  if (f.from) return f.from;
  f.from = new Map();
  for (const [c, u] of f.uni) {
    if ([...u].length !== 1 || f.from.has(u)) continue;
    const ok = f.subset ? f.used.has(c) : (f.twoByte ? f.tu.has(c) : (!f.widths.size || rfWidth(f, c) > 0));
    if (ok) f.from.set(u, c);
  }
  return f.from;
}

// Content stream -> operators with their operands and where they are in the text.
function rfParseOps(s) {
  const ops = [], n = s.length;
  const WS = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const DELIM = '()<>[]{}/%';
  let i = 0;
  const skipWs = () => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (WS(c)) i++;
      else if (c === 37) while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      else break;
    }
  };
  const word = () => { const st = i; while (i < n && !WS(s.charCodeAt(i)) && !DELIM.includes(s[i])) i++; return s.slice(st, i); };
  const value = () => {
    const ch = s[i];
    if (ch === '(') {
      i++;
      let depth = 1, out = '';
      while (i < n) {
        const c = s[i++];
        if (c === '\\') {
          const e = s[i++];
          if (e === 'n') out += '\n'; else if (e === 'r') out += '\r'; else if (e === 't') out += '\t'; else if (e === 'b') out += '\b'; else if (e === 'f') out += '\f';
          else if (e === '\r') { if (s[i] === '\n') i++; } else if (e === '\n') { /* line continuation */ }
          else if (e >= '0' && e <= '7') { let o = e; while (o.length < 3 && s[i] >= '0' && s[i] <= '7') o += s[i++]; out += String.fromCharCode(parseInt(o, 8) & 255); }
          else out += e;
        } else if (c === '(') { depth++; out += c; } else if (c === ')') { if (--depth === 0) break; out += c; } else out += c;
      }
      return { str: out };
    }
    if (ch === '<' && s[i + 1] === '<') {
      i += 2;
      const d = [];
      for (;;) { skipWs(); if (i >= n) break; if (s[i] === '>' && s[i + 1] === '>') { i += 2; break; } d.push(value()); }
      return { dict: d };
    }
    if (ch === '<') {
      i++;
      let h = '';
      while (i < n && s[i] !== '>') { if (/[0-9a-fA-F]/.test(s[i])) h += s[i]; i++; }
      i++;
      if (h.length % 2) h += '0';
      let str = '';
      for (let k = 0; k < h.length; k += 2) str += String.fromCharCode(parseInt(h.substr(k, 2), 16));
      return { str };
    }
    if (ch === '[') {
      i++;
      const a = [];
      for (;;) { skipWs(); if (i >= n) break; if (s[i] === ']') { i++; break; } a.push(value()); }
      return { arr: a };
    }
    if (ch === '/') { i++; return { name: word() }; }
    if (DELIM.includes(ch)) { i++; return { junk: ch }; }
    const w = word();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { num: parseFloat(w) };
    if (w === 'true' || w === 'false' || w === 'null') return { kw: w };
    return { op: w };
  };
  let args = [], argStart = -1;
  for (;;) {
    skipWs();
    if (i >= n) break;
    const st = i;
    const v = value();
    if (v.op === undefined) { if (argStart < 0) argStart = st; args.push(v); continue; }
    if (v.op === 'BI') { // inline image: its binary data runs to "EI"
      const id = s.slice(i).search(/\sID[\s]/);
      if (id >= 0) {
        const re = /\sEI(?=\s|$)/g;
        re.lastIndex = i + id + 4;
        const m = re.exec(s);
        i = m ? m.index + 3 : n;
      }
    }
    ops.push({ op: v.op, args, start: argStart >= 0 ? argStart : st, end: i });
    args = [];
    argStart = -1;
  }
  return ops;
}

const rfMul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];

// Every text-showing operator with where it lands on the page and what it says.
function rfTextPieces(ops, fontOf) {
  const I = [1, 0, 0, 1, 0, 0];
  const pieces = [];
  let g = { ctm: I, font: null, fontName: '', tfs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack = [];
  let tm = I, tlm = I;
  const td = (x, y) => { tlm = rfMul([1, 0, 0, 1, x, y], tlm); tm = tlm; };
  const show = (idx, items) => {
    const M = rfMul(tm, g.ctm);
    const st = rfMul([g.tfs * g.th, 0, 0, g.tfs, 0, g.rise], M);
    const f = g.font;
    let adv = 0, text = '';
    for (const it of items) {
      if (it.num != null) { adv += (-it.num / 1000) * g.tfs * g.th; if (it.num < -250 && text && !text.endsWith(' ')) text += ' '; continue; }
      if (it.str == null) continue;
      for (const c of rfCodes(it.str, f)) {
        adv += ((f ? rfWidth(f, c) : 500) / 1000 * g.tfs + g.tc + (!f?.twoByte && c === 32 ? g.tw : 0)) * g.th;
        if (f) { text += f.uni.get(c) ?? ''; f.used.add(c); }
      }
    }
    tm = rfMul([1, 0, 0, 1, adv, 0], tm);
    const sx = Math.hypot(M[0], M[1]);
    pieces.push({ op: ops[idx], font: f, fontName: g.fontName, tfs: g.tfs, tc: g.tc, tw: g.tw, th: g.th, adv, sx, text,
      x0: st[4], x1: st[4] + adv * sx, y: st[5], size: Math.hypot(st[2], st[3]), ok: !!f?.ok, rotated: Math.abs(M[1]) > 1e-3 * Math.abs(M[0]) || M[0] <= 0 });
  };
  // Small filled shapes: list bullets drawn as dots or squares instead of a "•" letter.
  const marks = [];
  let path = null;
  const pt = (x, y) => {
    const m = g.ctm, X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    path ||= { x0: X, x1: X, y0: Y, y1: Y };
    path.x0 = Math.min(path.x0, X); path.x1 = Math.max(path.x1, X); path.y0 = Math.min(path.y0, Y); path.y1 = Math.max(path.y1, Y);
  };
  ops.forEach((o, idx) => {
    const a = o.args, v = (k) => a[k]?.num ?? 0;
    switch (o.op) {
      case 'm': case 'l': pt(v(0), v(1)); break;
      case 'c': pt(v(0), v(1)); pt(v(2), v(3)); pt(v(4), v(5)); break;
      case 'v': case 'y': pt(v(0), v(1)); pt(v(2), v(3)); break;
      case 're': pt(v(0), v(1)); pt(v(0) + v(2), v(1) + v(3)); break;
      case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
        if (path && path.x1 - path.x0 < 7 && path.y1 - path.y0 < 7 && path.x1 - path.x0 > 0.5) marks.push(path);
        path = null;
        break;
      case 'n': case 'S': case 's': path = null; break;
      case 'q': stack.push({ ...g }); break;
      case 'Q': g = stack.pop() || g; break;
      case 'cm': g.ctm = rfMul([v(0), v(1), v(2), v(3), v(4), v(5)], g.ctm); break;
      case 'BT': tm = tlm = I; break;
      case 'Tf': g.fontName = a[0]?.name || ''; g.tfs = v(1); g.font = fontOf(g.fontName); break;
      case 'Tc': g.tc = v(0); break;
      case 'Tw': g.tw = v(0); break;
      case 'Tz': g.th = v(0) / 100; break;
      case 'TL': g.tl = v(0); break;
      case 'Ts': g.rise = v(0); break;
      case 'Td': td(v(0), v(1)); break;
      case 'TD': g.tl = -v(1); td(v(0), v(1)); break;
      case 'Tm': tm = tlm = [v(0), v(1), v(2), v(3), v(4), v(5)]; break;
      case 'T*': td(0, -g.tl); break;
      case "'": td(0, -g.tl); show(idx, [a[0] || {}]); break;
      case '"': g.tw = v(0); g.tc = v(1); td(0, -g.tl); show(idx, [a[2] || {}]); break;
      case 'Tj': show(idx, [a[0] || {}]); break;
      case 'TJ': show(idx, a[0]?.arr || []); break;
    }
  });
  return { pieces, marks };
}

// Pieces -> lines -> runs of one font -> blocks (a paragraph or bullet that wraps over several lines).
function rfBlocks({ pieces, marks }) {
  const bulletAt = (seg) => marks.some((m) => m.x1 <= seg.x0 + 0.5 && seg.x0 - m.x1 < 2.5 * seg.size && (m.y0 + m.y1) / 2 > seg.y - 0.2 * seg.size && (m.y0 + m.y1) / 2 < seg.y + 0.8 * seg.size);
  const lines = [];
  let line = null;
  for (const p of pieces) {
    if (p.rotated || !p.size) { line = null; continue; }
    if (!p.text && !p.adv) continue;
    const same = line && Math.abs(p.y - line.y) < 0.35 * p.size && p.x0 > line.x1 - 0.6 * p.size && p.x0 < line.x1 + 2.5 * p.size;
    if (!same) { line = { y: p.y, x1: p.x1, pieces: [] }; lines.push(line); }
    line.pieces.push(p);
    line.x1 = Math.max(line.x1, p.x1);
  }
  const blocks = [];
  let open = null;
  for (const ln of lines) {
    const segs = [];
    for (const p of ln.pieces) {
      const key = (p.font?.uid ?? p.fontName) + '|' + rfNum(p.tfs) + '|' + rfNum(p.size);
      const last = segs[segs.length - 1];
      if (last && last.key === key) {
        if (p.x0 - last.x1 > 0.15 * p.size && !/\s$/.test(last.text) && !/^\s/.test(p.text)) last.text += ' ';
        last.text += p.text;
        last.pieces.push(p);
        last.x1 = Math.max(last.x1, p.x1);
      } else segs.push({ key, pieces: [p], text: p.text, x0: p.x0, x1: p.x1, y: p.y, size: p.size });
    }
    segs.forEach((seg, si) => {
      const join = open && si === 0 && seg.key === open.key && !BULLET_RE.test(seg.text) && !bulletAt(seg)
        && open.lastY - seg.y > 0.8 * seg.size && open.lastY - seg.y < 2.2 * seg.size
        && (open.segs.length === 1 ? seg.x0 > open.segs[0].x0 - 0.6 * seg.size && seg.x0 < open.segs[0].x0 + 3 * seg.size : Math.abs(seg.x0 - open.contX) < 0.6 * seg.size)
        && open.segs[open.segs.length - 1].x1 >= open.right - 3 * seg.size;
      if (join) {
        if (open.segs.length === 1) open.contX = seg.x0;
        open.segs.push(seg);
        open.lastY = seg.y;
        open.right = Math.max(open.right, seg.x1);
      } else {
        open = { key: seg.key, segs: [seg], lastY: seg.y, right: seg.x1, contX: seg.x0 };
        blocks.push(open);
      }
    });
  }
  // How far each line may run: to the right edge of its column, but not into the next thing on the same line.
  const all = blocks.flatMap((b) => b.segs);
  for (const seg of all) {
    let right = seg.x1, next = Infinity;
    for (const s of all) {
      if (s.x0 < seg.x1 && s.x1 > seg.x0) right = Math.max(right, s.x1);
      if (s !== seg && Math.abs(s.y - seg.y) < 0.35 * seg.size && s.x0 >= seg.x1 - 0.1) next = Math.min(next, s.x0);
    }
    seg.maxX = Math.max(seg.x1, Math.min(right, next - 0.6 * seg.size));
  }
  for (const b of blocks) {
    const text = b.segs.map((s) => s.text.trim()).join(' ');
    // A leading space (the one after a "Skills:" label) belongs to this text and stays.
    b.prefix = b.segs[0].text.match(/^\s*/)[0] + (text.match(BULLET_RE) || [''])[0];
    b.text = text.replace(BULLET_RE, '').replace(/\s+/g, ' ').trim();
    // For the ATS reader (resumedoc.js): a list item, bold, its size and where it starts.
    b.bullet = BULLET_RE.test(b.prefix) || bulletAt(b.segs[0]);
    b.strong = /bold|black|heavy|semibold|demi/i.test(b.segs[0].pieces[0].font?.base || '');
    b.size = b.segs[0].size;
    b.x0 = b.segs[0].x0;
  }
  return blocks;
}

async function rfPdfOpen(bytes) {
  const L = PDFLib;
  const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) throw new Error('This PDF is password-protected, so it cannot be edited');
  const ctx = doc.context;
  const fontCache = new Map();
  const pages = doc.getPages().map((page) => {
    try { page.node.normalize(); } catch { /* already normal */ }
    const res = page.node.Resources();
    const fonts = res && ctx.lookup(res.get(L.PDFName.of('Font')));
    const fontOf = (name) => {
      if (!(fonts instanceof L.PDFDict)) return null;
      const entry = fonts.entries().find(([k]) => k.asString() === '/' + name);
      if (!entry) return null;
      const key = entry[1] instanceof L.PDFRef ? entry[1].toString() : entry[1];
      if (!fontCache.has(key)) {
        let f = null;
        try { f = rfFontInfo(ctx, ctx.lookup(entry[1])); f.uid = 'f' + fontCache.size; } catch { f = null; }
        fontCache.set(key, f);
      }
      return fontCache.get(key);
    };
    const c = page.node.Contents();
    const streams = !c ? [] : c instanceof L.PDFArray ? c.asArray().map((r) => ctx.lookup(r)) : [c];
    const content = streams.map((s) => rfLatin1(s instanceof L.PDFRawStream ? L.decodePDFRawStream(s).decode() : s.getUnencodedContents ? s.getUnencodedContents() : s.getContents())).join('\n');
    const ops = rfParseOps(content);
    const tp = rfTextPieces(ops, fontOf);
    // blank: drawn letters with no text map (an ATS reads nothing there).
    return { page, content, blocks: rfBlocks(tp), pieces: tp.pieces.length, blank: tp.pieces.filter((x) => x.text === '' && x.adv > 0.5).length, width: page.getWidth() };
  });
  pages.forEach((pg, i) => pg.blocks.forEach((b) => (b.page = i)));
  const blocks = pages.flatMap((p) => p.blocks);
  blocks.forEach((b, id) => (b.id = id));
  const parts = blocks.filter((b) => b.text.length >= 2 && b.segs.every((s) => s.pieces.every((p) => p.ok))).map((b) => ({ id: b.id, text: b.text, max: b.text.length }));
  // A PDF font only holds the letters the file already uses. The AI is told which ones the main font lacks.
  const weight = new Map();
  for (const p of parts) { const f = blocks[p.id].segs[0].pieces[0].font; weight.set(f, (weight.get(f) || 0) + p.text.length); }
  const main = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mainFrom = main ? rfFrom(main) : null;
  const lacks = mainFrom ? [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,.;:-()/&%+\'!?'].filter((ch) => !mainFrom.has(ch)) : [];
  return {
    parts,
    blocks,
    pageCount: pages.length,
    pageWidth: pages[0]?.width || 612,
    stats: { pieces: pages.reduce((s, p) => s + p.pieces, 0), blank: pages.reduce((s, p) => s + p.blank, 0) },
    canWrite: (str) => !mainFrom || [...str].every((ch) => mainFrom.has(ch) || mainFrom.has(ch.normalize('NFKD').replace(/[̀-ͯ]/g, ''))),
    // Why a new text can't go in ('' = it fits): a letter the font lacks, or more room than the lines give.
    check(id, text) {
      const b = blocks[id];
      if (!b || rfPlace(b, text)) return '';
      const from = rfFrom(b.segs[0].pieces[0].font);
      const plain = [...text].map((ch) => (from.has(ch) ? ch : ch.normalize('NFKD').replace(/[̀-ͯ]/g, ''))).join('');
      const no = [...new Set([...b.prefix + plain].filter((ch) => !from.has(ch)))];
      if (no.length) return `this part's font has no ${no.map((c) => (c === ' ' ? 'space' : c)).join(' ')} - use other words`;
      const words = text.split(' ');
      while (words.length > 1 && !rfPlace(b, words.join(' '))) words.pop();
      return `too wide for its lines - at most about ${words.length > 1 ? words.join(' ').length : Math.round(b.text.length * 0.9)} characters`;
    },
    note: lacks.length ? `The file's font has no ${lacks.join(' ')} - never use these characters, pick other words instead.` : '',
    async apply(changes) {
      let changed = 0, skipped = 0;
      const used = new Set();
      for (const pg of pages) {
        const edits = [];
        for (const b of pg.blocks) {
          const t = changes.get(b.id);
          if (!t || t === b.text) continue;
          const e = rfPlace(b, t);
          if (e) { edits.push(...e); used.add(b.id); changed++; } else skipped++;
        }
        if (!edits.length) continue;
        let s = pg.content;
        for (const e of edits.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
        pg.page.node.set(L.PDFName.of('Contents'), ctx.register(ctx.flateStream(rfBytes(s))));
      }
      return { bytes: await doc.save(), changed, skipped, used };
    },
  };
}

// The new text of one block, wrapped into the block's own lines, in the block's own font, size, spacing
// and colour. null = it needs a letter the font does not have or more room than the lines give, so the block
// stays exactly as it was.
function rfPlace(b, text) {
  const f = b.segs[0].pieces[0].font, from = rfFrom(f);
  // A letter with an accent the font lacks becomes its plain letter (é -> e) when the font has that one.
  text = [...text].map((ch) => (from.has(ch) ? ch : ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))).join('');
  if ([...b.prefix + text].some((ch) => !from.has(ch))) return null;
  const unit = (ch, p) => { const code = from.get(ch); return (rfWidth(f, code) / 1000 * p.tfs + p.tc + (!f.twoByte && code === 32 ? p.tw : 0)) * p.th; };
  const measure = (str, seg) => { const p = seg.pieces[0]; let w = 0; for (const ch of str) w += unit(ch, p); return w * p.sx; };
  const room = (seg) => (seg.maxX - seg.x0) * 1.005;
  const words = text.split(' ').filter(Boolean);
  if (!words.length) return null;
  words[0] = b.prefix + words[0];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const seg = b.segs[lines.length];
    const next = cur ? cur + ' ' + w : w;
    if (measure(next, seg) <= room(seg)) { cur = next; continue; }
    lines.push(cur);
    cur = w;
    const nseg = b.segs[lines.length];
    if (!lines[lines.length - 1] || !nseg || measure(cur, nseg) > room(nseg)) return null;
  }
  lines.push(cur);
  return rfEmit(b, lines, { f, from, unit });
}

function rfEmit(b, lines, { f, from, unit }) {
  const lead = (op) => (op.op === "'" ? 'T* ' : op.op === '"' ? `${rfNum(op.args[0]?.num || 0)} Tw ${rfNum(op.args[1]?.num || 0)} Tc T* ` : '');
  // Move on by the old text's width, so whatever the page draws next stays exactly where it was.
  const skip = (adv, p) => (Math.abs(adv) > 1e-6 && p.tfs && p.th ? `[${rfNum((-adv * 1000) / (p.tfs * p.th))}] TJ` : '');
  const draw = (str, p) => {
    const codes = [...str].map((ch) => from.get(ch));
    const adv = [...str].reduce((w, ch) => w + unit(ch, p), 0);
    return `<${codes.map((c) => c.toString(16).padStart(f.twoByte ? 4 : 2, '0')).join('')}> Tj ` + skip(p.adv - adv, p);
  };
  const edits = [];
  b.segs.forEach((seg, i) => seg.pieces.forEach((p, j) => {
    const text = j === 0 && lines[i] ? draw(lines[i], p) : skip(p.adv, p);
    edits.push({ start: p.op.start, end: p.op.end, text: ' ' + lead(p.op) + text + ' ' });
  }));
  return edits;
}
