'use strict';
// Claude Usage Dashboard - HTTP server (read-only over the Claude data dir).

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { createScanner } = require('./lib/scanner');
const mask = require('./lib/mask');

// Single Executable Application (SEA) detection. Outside a SEA build, require('node:sea') may not
// expose isSea (older Node) or may throw, so every failure means "not SEA".
const SEA_API = (() => { try { return require('node:sea'); } catch { return null; } })();
const IS_SEA = (() => { try { return !!SEA_API && SEA_API.isSea() === true; } catch { return false; } })();
// In a SEA build, config.json and .cache/ live next to the exe; static files come from embedded assets.
const ROOT = IS_SEA ? path.dirname(process.execPath) : __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, '.cache');
const CONFIG_PATH = path.join(ROOT, 'config.json');
// DEMO mode: privacy-masked API output; uses its own cache file so it never fights the normal server.
const DEMO = process.env.DEMO === '1' || process.argv.includes('--demo');
// --no-open: do not open the browser automatically (SEA build only).
const NO_OPEN = process.argv.includes('--no-open');
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
  // Demo mode defaults to its own port (config "demoPort", 7778) so it can run beside the normal dashboard.
  if (DEMO) merged.port = Number(merged.demoPort) || 7778;
  if (process.env.PORT) merged.port = Number(process.env.PORT);
  merged.port = Number(merged.port) || (DEMO ? 7778 : 7777);
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
  if (IS_SEA) return serveSeaAsset(req, res, full);
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

// Static files for a SEA build: embedded assets keyed like "public/index.html".
function serveSeaAsset(req, res, full) {
  const key = 'public/' + path.relative(PUBLIC_DIR, full).split(path.sep).join('/');
  let data;
  try { data = SEA_API.getAsset(key); } catch { data = undefined; }
  if (data === undefined) return sendText(res, 404, 'not found');
  const body = Buffer.from(data);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': CSP,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(body);
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

// Open the default browser on Windows. Fire-and-forget: a failure only means no auto-open.
function openBrowser(url) {
  try {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* ignore: user can open the URL manually */ });
    child.unref();
  } catch { /* ignore */ }
}

function printSeaBanner(url) {
  const lines = [
    '',
    '  ============================================================',
    '   AI 토큰 사용량 대시보드 (token-dashboard) 실행 중',
    '',
    `   주소: ${url}`,
    DEMO ? '   모드: 데모 (제목, 프로젝트명, 경로를 가린 화면)' : '   모드: 일반',
    `   설정 파일: ${CONFIG_PATH}`,
    '',
    '   이 창을 닫으면 대시보드가 종료됩니다.',
    '  ============================================================',
    '',
  ];
  console.log(lines.join('\n'));
}

server.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  // DEMO: keep the real Claude dir path out of the console too.
  if (DEMO) log(`DEMO dashboard listening on http://${config.host}:${config.port}  (privacy mask on, cache: scan-cache-demo.json)`);
  else log(`dashboard listening on http://${config.host}:${config.port}  (claudeDir: ${config.claudeDir}, codexDir: ${config.codexDir})`);
  if (IS_SEA) {
    printSeaBanner(url);
    if (!NO_OPEN) openBrowser(url);
  }
  scanner.start();
});

server.on('error', (e) => {
  if (IS_SEA && e.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  포트 ${config.port} 이(가) 이미 사용 중입니다.`);
    console.log('  이미 대시보드가 실행 중이거나 다른 프로그램이 이 포트를 쓰고 있을 수 있습니다.');
    console.log('  해결 방법: 실행 중인 대시보드를 종료하거나, config.json의 "port" 값 또는');
    console.log('  PORT 환경변수를 다른 번호로 바꾼 뒤 다시 실행하세요.');
    console.log('');
    console.log('  이 창은 10초 후 자동으로 닫힙니다.');
    setTimeout(() => process.exit(1), 10000);
    return;
  }
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
