// Read a resume's text in the browser (PDF with pdf.js, Word .docx with a small zip reader), and make a
// first reading of it without AI (lib/resumeparse.js, the same reader the extension used).

export async function pdfText(buf: ArrayBuffer): Promise<string> {
  // Served as a plain file from public/lib (not bundled), so the path is built at runtime.
  const url = '/lib/pdf.min.mjs';
  const pdfjs: any = await import(/* @vite-ignore */ url);
  pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.min.mjs';
  // pdf.js takes ownership of the buffer it is given, so pass a copy.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  await loadLocalReader();
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += (window as any).pdfItemsToText ? (window as any).pdfItemsToText(content.items) : content.items.map((it: any) => it.str + (it.hasEOL ? '\n' : ' ')).join('');
  }
  return out;
}

// Minimal .docx reader: finds word/document.xml in the zip and strips tags.
export async function docxText(buf: ArrayBuffer): Promise<string> {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .docx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === 'word/document.xml') {
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = new Uint8Array(buf, start, csize);
      const xml = method === 0
        ? new TextDecoder().decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      const txt = xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '');
      const el = document.createElement('textarea');
      el.innerHTML = txt;
      return el.value;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('No document text found in .docx');
}

let readerLoading: Promise<void> | null = null;
export function loadLocalReader(): Promise<void> {
  if ((window as any).localParseResume) return Promise.resolve();
  readerLoading ||= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/lib/resumeparse.js';
    s.onload = () => resolve();
    s.onerror = () => resolve(); // without it, the server still reads contact details (and AI the rest)
    document.head.append(s);
  });
  return readerLoading;
}

export async function resumeText(file: File, buf: ArrayBuffer): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return pdfText(buf);
  if (ext === 'docx') return docxText(buf);
  if (ext === 'doc') throw new Error('Old .doc files cannot be read - save it as .docx or PDF');
  return new TextDecoder().decode(buf);
}

export async function readLocally(text: string): Promise<Record<string, any>> {
  await loadLocalReader();
  try { return (window as any).localParseResume?.(text) || {}; } catch { return {}; }
}

export function bufToBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
