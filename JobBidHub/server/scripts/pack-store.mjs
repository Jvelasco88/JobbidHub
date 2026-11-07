// Builds the zip to upload to the Chrome Web Store developer dashboard:
//   cd JobBidHub/server && npm run pack-store
// Only the extension's own files go in (no hub settings, no updater marker). The store keeps it up to date,
// so the hub's "update available" check is skipped for store installs (see background.js extUpdateCheck).
import fs from 'node:fs';
import path from 'node:path';
import { EXT_DIR, listFiles, zip } from '../src/extension.js';

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const files = listFiles(EXT_DIR).filter((f) => !/^(README\.md|store\/)/i.test(f));
const out = path.resolve(EXT_DIR, '..', 'JobBidHub', 'release', `jobbid-extension-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip(files.map((name) => ({ name, data: fs.readFileSync(path.join(EXT_DIR, name)) }))));
console.log(`${files.length} files -> ${out}`);
