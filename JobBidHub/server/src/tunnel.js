// Internet access through a Cloudflare Tunnel: the hub runs cloudflared (tools/cloudflared.exe) with the
// tunnel token from the Cloudflare dashboard, so https://hub.your-domain.com reaches this hub from anywhere
// (also through proxies). The token and address live in data/hub-config.json (see network.js).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tunnelConfig, setQuickUrl } from './network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.CLOUDFLARED || path.resolve(here, '../../tools/cloudflared.exe');

let child = null;
let wanted = false;
let restartTimer = null;
const st = { running: false, connections: 0, error: '', lines: [], startedAt: '' };

export const tunnelStatus = () => ({ ...st, installed: fs.existsSync(EXE), lines: st.lines.slice(-12) });

function note(line) {
  line = String(line).trim();
  if (!line) return;
  // Never keep the token in the log shown on the page.
  const tok = tunnelConfig().token;
  if (tok) line = line.split(tok).join('***');
  st.lines.push(line.replace(/^\S+Z\s+/, '').slice(0, 300));
  if (st.lines.length > 60) st.lines.splice(0, st.lines.length - 60);
  const quick = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (quick && tunnelConfig().mode === 'quick') setQuickUrl(quick[0].toLowerCase());
  if (/Registered tunnel connection/i.test(line)) { st.connections++; st.error = ''; }
  if (/Unregistered tunnel connection|connection .* lost/i.test(line)) st.connections = Math.max(0, st.connections - 1);
  if (/ERR /.test(line) && !/Retrying|Serve tunnel error/i.test(line)) st.error = line.replace(/^.*?ERR\s+/, '').slice(0, 200);
  if (/Failed to get tunnel|Unauthorized|invalid token|token .* (invalid|malformed)/i.test(line)) st.error = 'The tunnel token is not valid. Copy it again from the Cloudflare dashboard.';
}

export function startTunnel(log) {
  const cfg = tunnelConfig();
  wanted = !!(cfg.on && (cfg.mode === 'quick' || cfg.token));
  clearTimeout(restartTimer);
  if (!wanted || child) return;
  if (!fs.existsSync(EXE)) { st.error = `cloudflared was not found at ${EXE}`; return; }
  st.connections = 0;
  st.error = '';
  st.startedAt = new Date().toISOString();
  // The token goes in an environment variable, not on the command line (other programs can read command lines).
  setQuickUrl('');
  const port = Number(process.env.PORT) || 4417;
  // http2 (TCP 443): QUIC uses UDP, which many networks, VPNs and proxies block ("failed to dial to edge with quic").
  const args = cfg.mode === 'quick' ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`] : ['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run'];
  child = spawn(EXE, args, { env: { ...process.env, ...(cfg.mode === 'token' ? { TUNNEL_TOKEN: cfg.token } : {}) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  st.running = true;
  const onData = (d) => String(d).split(/\r?\n/).forEach(note);
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    child = null;
    st.running = false;
    st.connections = 0;
    if (wanted) {
      note(`cloudflared stopped (code ${code}) - starting again in 10s`);
      restartTimer = setTimeout(() => startTunnel(log), 10000);
    }
  });
  log?.info?.('Cloudflare tunnel started');
}

export function stopTunnel() {
  wanted = false;
  clearTimeout(restartTimer);
  if (child) { child.kill(); child = null; }
  setQuickUrl('');
  st.running = false;
  st.connections = 0;
}

// cloudflared must not keep running after the hub closes (closing the window, restart, Ctrl+C).
for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => { try { child?.kill(); } catch { /* already gone */ } if (sig !== 'exit') process.exit(0); });
}
