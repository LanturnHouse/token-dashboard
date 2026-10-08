'use strict';
// Claude Usage Dashboard - HTTP server (read-only over the Claude data dir).

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { createScanner } = require('./lib/scanner');
const mask = require('./lib/mask');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, '.cache');
const CONFIG_PATH = path.join(ROOT, 'config.json');
// DEMO mode: privacy-masked API output; uses its own cache file so it never fights the normal server.
const DEMO = process.env.DEMO === '1' || process.argv.includes('--demo');
// DASHBOARD_CACHE overrides the cache file (used by test servers so they never share a cache).
const SCAN_CACHE_PATH = process.env.DASHBOARD_CACHE ||
  path.join(CACHE_DIR, DEMO ? 'scan-cache-demo.json' : 'scan-cache.json');
const PROVIDER_FILTERS = ['all', 'claude', 'codex'];

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- config ----------
function loadConfig() {
  const defaults = { port: 7777, host: '127.0.0.1', claudeDir: '', codexDir: '', codexPricing: {} };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    cfg = null;
  }
  if (!cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + '\n'); } catch { /* ignore */ }
    cfg = defaults;
  }
  const merged = { ...defaults, ...cfg };
  if (process.env.PORT) merged.port = Number(process.env.PORT);
  merged.port = Number(merged.port) || 7777;
  merged.claudeDir = merged.claudeDir && String(merged.claudeDir).trim()
    ? path.resolve(String(merged.claudeDir))
    : path.join(os.homedir(), '.claude');
  // CODEX_DIR env overrides config codexDir (handy for testing a missing Codex install).
  const codexRaw = process.env.CODEX_DIR !== undefined ? process.env.CODEX_DIR : merged.codexDir;
  merged.codexDir = codexRaw && String(codexRaw).trim()
    ? path.resolve(String(codexRaw))
    : path.join(os.homedir(), '.codex');
  if (!merged.codexPricing || typeof merged.codexPricing !== 'object') merged.codexPricing = {};
  return merged;
}

const config = loadConfig();

// ---------- logging ----------
function log(msg) {
  console.log(new Date().toISOString() + ' ' + msg);
}

// ---------- response helpers ----------
function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

// ---------- handlers ----------
async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return sendText(res, 400, 'bad request'); }
  if (rel === '' ) rel = 'index.html';
  const full = path.resolve(PUBLIC_DIR, rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'forbidden');
  let st;
  try { st = await fsp.stat(full); } catch { return sendText(res, 404, 'not found'); }
  if (!st.isFile()) return sendText(res, 404, 'not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

// ---------- scanner ----------
const scanner = createScanner(config.claudeDir, {
  codexDir: config.codexDir,
  codexPricing: config.codexPricing,
  cachePath: SCAN_CACHE_PATH,
  log,
});

// ---------- router ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    const m = /^\/api\/session\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (pathname !== '/api/summary' && pathname !== '/api/meta' && !m) return sendJson(res, 404, { error: 'not found' });
    if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
    if (pathname === '/api/meta') return sendJson(res, 200, { demo: DEMO });
    if (pathname === '/api/summary') {
      const provider = url.searchParams.get('provider') || 'all';
      if (!PROVIDER_FILTERS.includes(provider)) return sendJson(res, 400, { error: 'bad provider' });
      const snap = scanner.getSnapshot(provider);
      return sendJson(res, 200, DEMO ? mask.maskSummary(snap) : snap);
    }
    // DEMO: the id in the URL is a masked id; resolve it back to the real session server-side.
    const realId = DEMO ? mask.realIdOf(m[1]) : m[1];
    const detail = realId ? scanner.getSession(realId) : null;
    if (!detail) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, DEMO ? mask.maskSession(detail) : detail);
  }

  if (method !== 'GET' && method !== 'HEAD') return sendText(res, 405, 'method not allowed');
  return serveStatic(req, res, pathname);
}

// ---------- startup ----------
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    log('request error: ' + e.message);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: 'internal error' });
    else res.end();
  });
});

server.listen(config.port, config.host, () => {
  // DEMO: keep the real Claude dir path out of the console too.
  if (DEMO) log(`DEMO dashboard listening on http://${config.host}:${config.port}  (privacy mask on, cache: scan-cache-demo.json)`);
  else log(`dashboard listening on http://${config.host}:${config.port}  (claudeDir: ${config.claudeDir}, codexDir: ${config.codexDir})`);
  scanner.start();
});

server.on('error', (e) => {
  log('server error: ' + e.message);
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down');
  try { scanner.stop(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
