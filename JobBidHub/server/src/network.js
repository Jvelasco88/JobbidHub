// "Only this PC" or "office network". Stored in data/hub-config.json because it decides how the server
// starts (which network address it listens on); changing it restarts the hub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let file = '';
let cfg = { network: false };

export function loadNetworkConfig(dataDir) {
  file = path.join(dataDir, 'hub-config.json');
  try { cfg = { network: false, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first start: this PC only */ }
  return cfg;
}
export const networkOn = () => !!cfg.network;
// Internet access (Cloudflare Tunnel): on/off, the tunnel token and the public address, e.g. https://hub.example.com.
// mode 'quick': Cloudflare's free Quick Tunnel (no account; a random https://...trycloudflare.com address
// that changes whenever the hub restarts). mode 'token': your own domain through a named tunnel.
let quickUrl = '';
export const setQuickUrl = (u) => { quickUrl = u || ''; };
export const tunnelConfig = () => {
  const mode = (cfg.tunnelMode || (cfg.tunnelToken ? 'token' : 'quick')) === 'token' ? 'token' : 'quick';
  return { on: !!cfg.tunnel, mode, token: cfg.tunnelToken || '', url: mode === 'quick' ? quickUrl : cfg.publicUrl || '' };
};
export const publicHost = () => { const c = tunnelConfig(); try { return c.on && c.url ? new URL(c.url).hostname.toLowerCase() : ''; } catch { return ''; } };
export function saveNetworkConfig(patch) {
  cfg = { ...cfg, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return cfg;
}

// This computer's addresses on the office network (what teammates type in their browser).
export function lanAddresses() {
  const out = [];
  // Virtual adapters (VMware, Hyper-V, VirtualBox, WSL, Docker) last: teammates can't use those addresses.
  const virtual = /vmware|virtual|vethernet|hyper-?v|vbox|wsl|docker|loopback|tailscale|zerotier/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ a: a.address, v: virtual.test(name) });
  }
  return out.sort((x, y) => x.v - y.v).map((x) => x.a);
}

// Names this server answers to. Anything else is a website pretending to be the hub (DNS rebinding).
export function allowedHosts() {
  const names = ['localhost', '127.0.0.1', '[::1]'];
  if (networkOn()) names.push(...lanAddresses(), os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`);
  if (publicHost()) names.push(publicHost());
  return names;
}
