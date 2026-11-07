// The JobBid Chrome extension, downloadable from the hub (sign-in page and Settings), so teammates install
// the same version the hub works with. The zip is built from the extension folder on request and carries
// hub.json with this hub's address, so a fresh install already knows where to sign in.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { networkOn, lanAddresses, publicHost, tunnelConfig } from './network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = process.env.JOBBID_EXT_DIR || path.resolve(here, '../../../JobBidExtension');
const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store|Thumbs\.db|hub\.json|updater\.json)$/i;

export function listFiles(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (SKIP.test(rel)) continue;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// A plain zip file (deflate), enough for Chrome's "Load unpacked" after extracting.
export function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20);
    cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const manifest = () => JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));

export default async function extensionRoutes(app) {
  app.get('/api/extension/info', async () => {
    // The addresses teammates use (only when office-network access is on).
    const port = Number(process.env.PORT) || 4417;
    const lan = networkOn() ? lanAddresses().map((a) => `http://${a}:${port}`) : [];
    const publicUrl = publicHost() ? tunnelConfig().url : '';
    try { return { ok: true, version: manifest().version, lan, publicUrl }; } catch { return { ok: false, lan, publicUrl }; }
  });

  // Windows installer with auto-update (see scripts/install.ps1 and scripts/update.ps1).
  // The internet address when there is one (works from anywhere), else the address this page was opened with.
  const hubOf = (req) => (publicHost() ? tunnelConfig().url : `${req.protocol}://${req.headers.host}`);
  const script = (name, req) => fs.readFileSync(path.join(here, 'scripts', name), 'utf8').replaceAll('__HUB__', hubOf(req)).replace(/\r?\n/g, '\r\n');
  app.get('/api/extension/install.ps1', async (req, reply) => reply.type('text/plain; charset=utf-8').send(script('install.ps1', req)));
  app.get('/api/extension/update.ps1', async (req, reply) => reply.type('text/plain; charset=utf-8').send(script('update.ps1', req)));
  app.get('/api/extension/installer', async (req, reply) => {
    const bat = [
      '@echo off',
      'title JobBid installer',
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072;$w=New-Object Net.WebClient;${publicHost() ? '' : '$w.Proxy=$null;'}iex $w.DownloadString('${hubOf(req)}/api/extension/install.ps1')"`,
      'pause',
      '',
    ].join('\r\n');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="Install JobBid.bat"');
    return reply.send(bat);
  });

  app.get('/api/extension/download', async (req, reply) => {
    let version;
    try { version = manifest().version; } catch { return reply.code(404).send({ error: 'The extension folder was not found next to the hub.' }); }
    const entries = listFiles(EXT_DIR).map((rel) => ({ name: `JobBid/${rel}`, data: fs.readFileSync(path.join(EXT_DIR, rel)) }));
    // The address this page was opened with (already checked against the hub's allowed names).
    const hubUrl = hubOf(req);
    entries.push({ name: 'JobBid/hub.json', data: Buffer.from(JSON.stringify({ url: hubUrl }, null, 2)) });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="JobBid-extension-${version}.zip"`);
    return reply.send(zip(entries));
  });
}
