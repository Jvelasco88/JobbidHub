// Automatic backups. Once a day (and from the dashboard on demand) a copy of the database, the
// encryption key (data/secret.key - without it saved passwords can't be read) and the hub settings goes
// to JobBidHub/backups, and also to a second folder when one is set: OneDrive, a USB disk, a NAS.
// Each copy is opened and checked before it counts. The newest `keep` copies are kept in each folder.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, getMeta, setMeta } from './db.js';
import { nowIso } from './util.js';

const DEF = { copyTo: '', keep: 14, everyHours: 24 };
const NAME = /^jobbid-\d{4}-\d{2}-\d{2}_\d{4,6}$/;
let dataDir = '';
let localDir = '';
let running = null;

const J = (s, d) => { try { return { ...d, ...JSON.parse(s) }; } catch { return d; } };
export const backupConfig = () => J(getMeta('backupConfig', '{}'), DEF);
const backupState = () => J(getMeta('backupState', '{}'), {});
const setState = (patch) => setMeta('backupState', JSON.stringify({ ...backupState(), ...patch }));

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const README = `JobBid Hub backup

To restore:
1. Close the JobBid Hub window (stop the hub).
2. In JobBidHub\\data, move the old jobbid.db, jobbid.db-wal and jobbid.db-shm somewhere safe.
3. Copy jobbid.db, secret.key and hub-config.json from this folder into JobBidHub\\data.
4. Start the hub again (start.bat).

secret.key unlocks the saved job-site and proxy passwords. Keep this folder private.
`;

// Folders that hold backups, newest first.
function listIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && NAME.test(e.name) && fs.existsSync(path.join(dir, e.name, 'jobbid.db')))
      .map((e) => {
        const f = path.join(dir, e.name, 'jobbid.db');
        const st = fs.statSync(f);
        return { name: e.name, dir, at: st.mtime.toISOString(), size: st.size };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch { return []; }
}

function prune(dir, keep) {
  for (const old of listIn(dir).slice(Math.max(1, keep))) fs.rmSync(path.join(dir, old.name), { recursive: true, force: true });
}

// Opens the copy on its own and checks it (a half-written or damaged file fails here).
function verify(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = db.prepare('PRAGMA quick_check').get();
    if (Object.values(ok)[0] !== 'ok') throw new Error('The copy failed its check: ' + Object.values(ok)[0]);
    const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return { profiles: n('profiles'), applications: n('applications'), files: n('files') };
  } finally { db.close(); }
}

// A folder we may write to: absolute, and a test file can be written and removed.
export function checkFolder(dir) {
  if (!dir) return '';
  if (!path.isAbsolute(dir)) return 'Use a full folder path, e.g. C:\\Users\\you\\OneDrive\\JobBid backups';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.jobbid-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return '';
  } catch (e) { return `Can't write to that folder (${e.code || e.message}).`; }
}

async function doBackup(reason) {
  const cfg = backupConfig();
  const started = Date.now();
  const name = `jobbid-${stamp()}`;
  const target = path.join(localDir, name);
  try {
    fs.mkdirSync(target, { recursive: true });
    const dbCopy = path.join(target, 'jobbid.db');
    // VACUUM INTO writes a complete, consistent copy while the hub keeps running.
    getDb().exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
    for (const f of ['secret.key', 'hub-config.json']) {
      const src = path.join(dataDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, f));
    }
    fs.writeFileSync(path.join(target, 'README.txt'), README);
    const counts = verify(dbCopy);
    prune(localDir, cfg.keep);
    // The second copy, off this PC. A failure here is reported, but the local copy still counts.
    let copyError = '';
    if (cfg.copyTo) {
      copyError = checkFolder(cfg.copyTo);
      if (!copyError) {
        try {
          fs.cpSync(target, path.join(cfg.copyTo, name), { recursive: true });
          prune(cfg.copyTo, cfg.keep);
        } catch (e) { copyError = `Copy to ${cfg.copyTo} failed (${e.code || e.message}).`; }
      }
    }
    const size = fs.statSync(dbCopy).size;
    setState({ lastOk: nowIso(), lastName: name, lastSize: size, lastMs: Date.now() - started, lastCounts: counts, lastReason: reason, lastError: '', copyError, copiedAt: cfg.copyTo && !copyError ? nowIso() : backupState().copiedAt || '' });
    return { ok: true, name, size, counts, copyError };
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    setState({ lastError: e.message || String(e), lastErrorAt: nowIso() });
    return { ok: false, error: e.message || String(e) };
  }
}

export function runBackup(reason = 'manual') {
  if (!running) running = doBackup(reason).finally(() => { running = null; });
  return running;
}

export function startBackups(dbFile, log) {
  dataDir = path.dirname(dbFile);
  localDir = process.env.JOBBID_BACKUPS || path.join(dataDir, '..', 'backups');
  const due = () => {
    const last = Date.parse(backupState().lastOk || 0) || 0;
    return Date.now() - last > backupConfig().everyHours * 3600e3;
  };
  const tick = async () => {
    if (!due()) return;
    const r = await runBackup('daily');
    if (r.ok) log.info(`Backup saved: ${r.name}${r.copyError ? ' (second copy failed: ' + r.copyError + ')' : ''}`);
    else log.error(`Backup failed: ${r.error}`);
  };
  setTimeout(tick, 60 * 1000); // a minute after start, when one is due
  return setInterval(tick, 30 * 60 * 1000);
}

export function backupView() {
  const cfg = backupConfig();
  const st = backupState();
  const local = listIn(localDir);
  const copies = cfg.copyTo ? listIn(cfg.copyTo) : [];
  const last = Date.parse(st.lastOk || 0) || 0;
  return {
    config: cfg,
    state: st,
    localDir: path.resolve(localDir),
    local,
    copies,
    overdue: !last || Date.now() - last > (cfg.everyHours + 6) * 3600e3,
    running: !!running,
  };
}

export default async function backupRoutes(app) {
  app.get('/api/admin/backups', async () => backupView());
  app.post('/api/admin/backups/run', async () => { const r = await runBackup('manual'); return { ...r, view: backupView() }; });
  app.put('/api/admin/backups', async (req, reply) => {
    const b = req.body || {};
    const cfg = backupConfig();
    if (b.copyTo !== undefined) {
      const dir = String(b.copyTo || '').trim().replace(/^"(.*)"$/, '$1');
      const err = checkFolder(dir);
      if (err) return reply.code(400).send({ error: err });
      if (dir && path.resolve(dir).toLowerCase().startsWith(path.resolve(localDir).toLowerCase())) return reply.code(400).send({ error: 'Pick a folder outside JobBidHub\\backups - ideally on another disk or in OneDrive.' });
      cfg.copyTo = dir;
    }
    if (b.keep !== undefined) cfg.keep = Math.min(90, Math.max(3, Math.round(Number(b.keep) || DEF.keep)));
    setMeta('backupConfig', JSON.stringify(cfg));
    return backupView();
  });
}
