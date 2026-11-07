// JobBid Hub server: local database + API on http://127.0.0.1:4417, and the dashboard (web/dist).
// Only this computer can reach it; only the JobBid extension and the dashboard may call the API.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import routes from './routes.js';
import autobidRoutes from './autobid.js';
import jobLinkRoutes from './joblinks.js';
import fillReportRoutes from './fillreports.js';
import proxyRoutes from './proxy.js';
import extensionRoutes from './extension.js';
import authRoutes from './auth-routes.js';
import { initAuth } from './auth.js';
import { initNotices } from './notices.js';
import { startScheduler } from './jobs.js';
import { loadNetworkConfig, networkOn, allowedHosts, lanAddresses, publicHost } from './network.js';
import { startTunnel } from './tunnel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PORT = Number(process.env.PORT) || 4417;
const DB_FILE = process.env.JOBBID_DB || path.join(root, 'data', 'jobbid.db');
// Office-network mode listens on every network card; otherwise only this computer can connect.
loadNetworkConfig(path.dirname(DB_FILE));
const HOST = process.env.HOST || (networkOn() ? '0.0.0.0' : '127.0.0.1');
const WEB_DIST = path.join(root, 'web', 'dist');
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

openDb(DB_FILE);
initAuth();
initNotices();

// trustProxy: cloudflared runs on this PC and forwards visitors; their real address and https come in its headers.
const app = Fastify({ trustProxy: ['127.0.0.1', '::1'], logger: { level: process.env.LOG_LEVEL || 'info', transport: undefined }, bodyLimit: 300 * 1024 * 1024 });

// Callers allowed to use the API: Chrome extensions, the dev server, and pages served by this hub itself
// (same address as the request, e.g. http://192.168.1.20:4417 in office-network mode).
const hostOf = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '');
const okOrigin = (o, host) => !o || /^chrome-extension:\/\//.test(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)
  || (!!host && (o.toLowerCase() === `http://${String(host).toLowerCase()}` || o.toLowerCase() === `https://${String(host).toLowerCase()}`));
app.addHook('onRequest', async (req, reply) => {
  // Block DNS-rebinding (a website pretending to be this server) and cross-site requests.
  if (!allowedHosts().includes(hostOf(req.headers.host))) return reply.code(403).send({ error: 'Forbidden host' });
  if (!okOrigin(req.headers.origin, req.headers.host)) return reply.code(403).send({ error: 'Forbidden origin' });
});
await app.register(cors, { delegator: (req, cb) => cb(null, { origin: okOrigin(req.headers.origin, req.headers.host), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }) });

app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode || 500;
  if (code >= 500) req.log.error(err);
  reply.code(code).send({ error: err.message || 'Server error' });
});

// Sign-in guard first, so every API route below is protected.
await app.register(authRoutes);
await app.register(routes, { version });
await app.register(autobidRoutes);
await app.register(jobLinkRoutes);
await app.register(fillReportRoutes);
await app.register(proxyRoutes);
await app.register(extensionRoutes);

// The dashboard (built with "npm run build" in web/). Unknown non-API paths return index.html (client-side routing).
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
} else {
  app.get('/', async () => 'JobBid Hub API is running. Build the dashboard: cd web && npm install && npm run build');
}

startScheduler(app.log);
startTunnel(app.log);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`JobBid Hub ready: http://localhost:${PORT}  (database: ${DB_FILE})`);
  if (publicHost()) console.log(`Internet: https://${publicHost()}`);
  if (networkOn()) console.log(`Office network: ${lanAddresses().map((a) => `http://${a}:${PORT}`).join('  ') || '(no network address found)'}`);
} catch (e) {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy - JobBid Hub is probably already running.`);
  else console.error(e);
  process.exit(1);
}
