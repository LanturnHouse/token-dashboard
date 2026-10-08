'use strict';
// Usage log scanner (read-only). Providers: Claude Code transcripts and Codex (GPT) rollouts.
// Incremental: each file keeps {size, offset, partial bytes, aggregates, message-id map}.
// Refresh only reads bytes appended since the last offset.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { costOf, pricingTable, NOTE: PRICING_NOTE, GPT_NOTE, codexPriceRows, codexCostOf } = require('./pricing');
const codex = require('./codex');

const IDLE_GAP_MS = 5 * 60 * 1000;      // gaps <= 5 min count as active time
const RUNNING_WINDOW_MS = 60 * 1000;    // subagent is "running" if written within 60 s
const CHUNK_BYTES = 4 * 1024 * 1024;
const ID_KEEP = 2000;                   // message ids persisted per transcript
const CACHE_VERSION = 5;
const MINUTE_KEEP_MS = 3 * 3600000;   // minute buckets are kept for ~3 hours only
const DAYS = 30;
const HOURS = 48;
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']; // Claude model lines (matched by substring)
// Claude families first, then the GPT lines. Stack order follows FAMILY_KEYS.
const GPT_FAMILIES = ['gpt-astra', 'gpt-sol', 'gpt-terra', 'gpt-luna', 'gpt-other'];
const FAMILY_KEYS = ['opus', 'sonnet', 'haiku', 'fable', 'other', ...GPT_FAMILIES];
const GPT_LINES = [['astra', 'gpt-astra'], ['sol', 'gpt-sol'], ['terra', 'gpt-terra'], ['luna', 'gpt-luna']];
const PROVIDERS = ['claude', 'codex'];

// ---------- small helpers ----------
const yieldNow = () => new Promise((r) => setImmediate(r));
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const dateKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};
const hourKey = (ts) => dateKey(ts) + 'T' + pad2(new Date(ts).getHours());
const minuteKey = (ts) => { const d = new Date(ts); return dateKey(ts) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
// GPT ids: gpt*, codex*, o1/o3/o4, and 'unknown' (Codex usage with no turn_context model).
const isGptId = (m) => m.startsWith('gpt') || m.startsWith('codex') || /^o[134]/.test(m) || m === 'unknown';
const familyOf = (model) => {
  const m = String(model || '').toLowerCase();
  if (m.includes('mythos')) return 'fable'; // mythos is priced with fable
  for (const f of FAMILIES) if (m.includes(f)) return f;
  if (isGptId(m)) {
    for (const [name, fam] of GPT_LINES) if (m.includes(name)) return fam;
    return 'gpt-other';
  }
  return 'other';
};
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const zeroTok = () => ({ input: 0, output: 0, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, total: 0, cost: 0, costUnknown: false });
const zeroFamilies = () => Object.fromEntries(FAMILY_KEYS.map((f) => [f, 0]));
const copyTok = (t) => ({
  input: t.input, output: t.output, cacheCreate: t.cacheCreate, cacheCreate1h: t.cacheCreate1h,
  cacheRead: t.cacheRead, total: t.total, cost: t.cost, costUnknown: !!t.costUnknown,
});
// Token-object fields: total excludes cost and cacheCreate1h (subset of cacheCreate).
function fixTotal(t) {
  t.total = t.input + t.output + t.cacheCreate + t.cacheRead;
  if (t.total === 0) t.cost = 0; // scrub float residue after full retraction
}
function addTok(t, r, sign) {
  t.input += sign * r.input;
  t.output += sign * r.output;
  t.cacheCreate += sign * r.cacheCreate;
  t.cacheCreate1h += sign * (r.cacheCreate1h || 0);
  t.cacheRead += sign * r.cacheRead;
  t.cost += sign * (r.cost || 0);
  if (sign > 0 && r.costUnknown) t.costUnknown = true; // sticky: an aggregate is unknown if any part is
  fixTotal(t);
}
function addInto(dst, src) {
  dst.input += src.input;
  dst.output += src.output;
  dst.cacheCreate += src.cacheCreate;
  dst.cacheCreate1h += src.cacheCreate1h || 0;
  dst.cacheRead += src.cacheRead;
  dst.cost += src.cost || 0;
  if (src.costUnknown) dst.costUnknown = true;
  fixTotal(dst);
}
const recTotal = (r) => r.input + r.output + r.cacheCreate + r.cacheRead;
const stripTags = (s) =>
  s.replace(/<\/?[A-Za-z][\w:-]*(\s[^>]*)?\/?>/g, ' ').replace(/\s+/g, ' ').trim();
function mergeByModel(dst, src) {
  for (const m of Object.keys(src)) {
    if (!dst[m]) dst[m] = zeroTok();
    addInto(dst[m], src[m]);
  }
}
// alias(opus, sonnet 등)만 적힌 model 값은 실제 모델 id로 대체할 수 있게 구분
const MODEL_ALIAS = /^(opus|sonnet|haiku|fable|mythos)$/i;
function primaryModelOf(byModel) {
  let best = null;
  let bestOut = -1;
  for (const m of Object.keys(byModel || {})) {
    if (byModel[m].output > bestOut) { bestOut = byModel[m].output; best = m; }
  }
  return best;
}

// ---------- per-transcript state ----------
function newAgg() {
  return {
    tokens: zeroTok(),
    byModel: {},          // model -> tokens
    daily: {},            // 'YYYY-MM-DD' -> { tok, byModel: {model: tok}, active }
    hourly: {},           // 'YYYY-MM-DDTHH' -> {opus,sonnet,haiku,fable,other,gpt-astra,gpt-sol,gpt-terra,gpt-luna,gpt-other (tokens), cost}
    minutely: {},         // 'YYYY-MM-DDTHH:MM' -> same shape as hourly; only the last ~3 h are kept
    firstTs: null,
    lastTs: null,
    lastSeq: null,        // last timestamp seen (for active-time gaps)
    activeMs: 0,
    apiCalls: 0,
    prompts: 0,
    firstPrompt: '',
    lastPrompt: '',
    customTitle: '',
    agentName: '',
    cwd: '',
    version: '',
    models: {},
  };
}

function newState(file) {
  const provider = file.provider || 'claude';
  return {
    path: file.path,
    provider,
    kind: file.kind,            // 'main' | 'agent'
    sid: file.sid,
    projDir: file.projDir,
    size: 0,
    offset: 0,
    mtimeMs: 0,
    partial: Buffer.alloc(0),
    agg: newAgg(),
    ids: new Map(),             // message.id -> last-seen record
    meta: null,
    metaMtime: 0,
    metaPath: provider === 'claude' && file.kind === 'agent' ? file.path.replace(/\.jsonl$/, '.meta.json') : null,
    cx: provider === 'codex' ? codex.createCxState() : null,
    role: file.kind,            // 'main' | 'agent' as used by the current snapshot (codex: computed per snapshot)
  };
}

function resetState(st) {
  st.size = 0;
  st.offset = 0;
  st.partial = Buffer.alloc(0);
  st.agg = newAgg();
  st.ids = new Map();
  if (st.provider === 'codex') { st.cx = codex.createCxState(); st.meta = null; }
}

function dayOf(a, ts) {
  const k = dateKey(ts);
  if (!a.daily[k]) a.daily[k] = { tok: zeroTok(), byModel: {}, active: 0 };
  return a.daily[k];
}

// Apply (sign=+1) or retract (sign=-1) one API-message record.
function applyRec(a, r, sign) {
  addTok(a.tokens, r, sign);
  if (!a.byModel[r.model]) a.byModel[r.model] = zeroTok();
  addTok(a.byModel[r.model], r, sign);
  const d = dayOf(a, r.ts);
  addTok(d.tok, r, sign);
  if (!d.byModel[r.model]) d.byModel[r.model] = zeroTok();
  addTok(d.byModel[r.model], r, sign);
  const hk = hourKey(r.ts);
  let h = a.hourly[hk];
  if (!h) h = a.hourly[hk] = { ...zeroFamilies(), cost: 0 };
  h[familyOf(r.model)] += sign * recTotal(r);
  h.cost += sign * (r.cost || 0);
  if (FAMILY_KEYS.every((f) => h[f] === 0)) delete a.hourly[hk];
  // minute bucket: skipped for records older than the keep window (apply and retract skip alike,
  // and pruning uses the same cutoff, so the pair stays symmetric)
  if (r.ts >= Date.now() - MINUTE_KEEP_MS) {
    const mk = minuteKey(r.ts);
    let m = a.minutely[mk];
    if (!m) m = a.minutely[mk] = { ...zeroFamilies(), cost: 0 };
    m[familyOf(r.model)] += sign * recTotal(r);
    m.cost += sign * (r.cost || 0);
    if (FAMILY_KEYS.every((f) => m[f] === 0)) delete a.minutely[mk];
  }
}

function pruneMinutes(a, now) {
  if (!a.minutely) { a.minutely = {}; return; }
  const cut = minuteKey(now - MINUTE_KEEP_MS);
  for (const k of Object.keys(a.minutely)) if (k < cut) delete a.minutely[k];
}

// Dedupe by message id: a message split across several lines repeats its usage.
// Counting uses the last-seen record for each id (previous contribution is retracted).
function applyMessage(st, id, rec) {
  const a = st.agg;
  const prev = st.ids.get(id);
  if (prev) applyRec(a, prev, -1);
  else a.apiCalls++;
  st.ids.set(id, rec);
  applyRec(a, rec, 1);
}

// Undo an id's contribution entirely (used when a fallback record is superseded).
function retractMessage(st, id) {
  const prev = st.ids.get(id);
  if (!prev) return;
  applyRec(st.agg, prev, -1);
  st.agg.apiCalls--;
  st.ids.delete(id);
}

function timeline(a, t) {
  if (a.firstTs === null || t < a.firstTs) a.firstTs = t;
  if (a.lastTs === null || t > a.lastTs) a.lastTs = t;
  // Only count forward progress so out-of-order lines can't inflate active time past wall time.
  if (a.lastSeq !== null && t <= a.lastSeq) return;
  if (a.lastSeq !== null) {
    const gap = t - a.lastSeq;
    if (gap <= IDLE_GAP_MS) {
      a.activeMs += gap;
      dayOf(a, t).active += gap;
    }
  }
  a.lastSeq = t;
}

function addPrompt(a, clean) {
  a.prompts++;
  a.lastPrompt = clean.slice(0, 300);
  if (!a.firstPrompt) a.firstPrompt = clean.slice(0, 300);
}

// Codex records -> aggregates. Built per file; pricing comes from config + built-in table.
function codexSink(st, priceRows) {
  const a = st.agg;
  return {
    timeline: (t) => timeline(a, t),
    usage: (id, rec) => { a.models[rec.model] = true; applyMessage(st, id, rec); },
    retract: (id) => retractMessage(st, id),
    prompt: (text) => addPrompt(a, text),
    meta: (cwd, version) => {
      if (cwd && !a.cwd) a.cwd = cwd;
      if (version && !a.version) a.version = version;
    },
    price: (model, input, output, cacheRead, cacheWrite) =>
      codexCostOf(priceRows, model, input, output, cacheRead, cacheWrite),
  };
}

function processClaudeLine(st, o) {
  const a = st.agg;

  if (typeof o.cwd === 'string' && o.cwd && !a.cwd) a.cwd = o.cwd;
  if (typeof o.version === 'string' && o.version && !a.version) a.version = o.version;

  if (typeof o.timestamp === 'string') {
    const t = Date.parse(o.timestamp);
    if (!Number.isNaN(t)) timeline(a, t);
  }
  let ts = null;
  if (typeof o.timestamp === 'string') {
    const t = Date.parse(o.timestamp);
    if (!Number.isNaN(t)) ts = t;
  }

  switch (o.type) {
    case 'assistant': {
      const m = o.message;
      if (!m || typeof m !== 'object') break;
      const model = m.model;
      const u = m.usage;
      if (!m.id || !model || model === '<synthetic>' || !u || typeof u !== 'object') break;
      const when = ts !== null ? ts : a.lastSeq;
      if (when === null) break;
      a.models[model] = true;
      const cacheCreate = num(u.cache_creation_input_tokens);
      const rec = {
        ts: when,
        model,
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheCreate,
        cacheCreate1h: Math.min(num(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens), cacheCreate),
        cacheRead: num(u.cache_read_input_tokens),
        fast: u.speed === 'fast',
      };
      rec.cost = costOf(rec);
      applyMessage(st, m.id, rec);
      break;
    }
    case 'user': {
      if (st.kind !== 'main' || o.isSidechain) break;
      const c = o.message && o.message.content;
      let body = null;
      if (typeof c === 'string') body = c;
      else if (Array.isArray(c)) {
        const hasResult = c.some((b) => b && b.type === 'tool_result');
        const texts = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
        if (!hasResult && texts.length) body = texts.map((b) => b.text).join('\n');
      }
      if (body === null) break;
      a.prompts++;
      const clean = stripTags(body);
      if (clean) {
        a.lastPrompt = clean.slice(0, 300);
        if (!a.firstPrompt) a.firstPrompt = clean.slice(0, 300);
      }
      break;
    }
    case 'custom-title':
      if (typeof o.customTitle === 'string' && o.customTitle) a.customTitle = o.customTitle;
      break;
    case 'agent-name':
      if (typeof o.agentName === 'string' && o.agentName) a.agentName = o.agentName;
      break;
    default:
      break; // unknown types ignored
  }
}

// Read only bytes [offset, size) and feed complete lines to processLine.
async function updateFile(st, stat, processLine) {
  if (stat.size < st.offset) resetState(st); // truncated or replaced
  if (stat.size === st.offset) {
    st.size = stat.size;
    st.mtimeMs = stat.mtimeMs;
    return;
  }
  const fh = await fsp.open(st.path, 'r');
  try {
    let pos = st.offset;
    const end = stat.size;
    while (pos < end) {
      const len = Math.min(CHUNK_BYTES, end - pos);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const data = buf.subarray(0, bytesRead);
      const work = st.partial.length ? Buffer.concat([st.partial, data]) : data;
      let start = 0;
      let nl;
      while ((nl = work.indexOf(0x0a, start)) !== -1) {
        processLine(st, work.subarray(start, nl));
        start = nl + 1;
      }
      st.partial = Buffer.from(work.subarray(start)); // keep incomplete tail only
      st.offset = pos;
      await yieldNow();
    }
  } finally {
    await fh.close();
  }
  st.size = stat.size;
  st.mtimeMs = stat.mtimeMs;
}

async function updateMeta(st) {
  if (!st.metaPath) return;
  let s;
  try { s = await fsp.stat(st.metaPath); } catch {
    if (!st.meta) st.meta = {};
    return;
  }
  if (st.meta && s.mtimeMs === st.metaMtime) return;
  try {
    st.meta = JSON.parse(await fsp.readFile(st.metaPath, 'utf8'));
  } catch {
    st.meta = {};
  }
  st.metaMtime = s.mtimeMs;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readPidInfos(sessionsDir) {
  const out = [];
  let names;
  try { names = fs.readdirSync(sessionsDir); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue; // ignore *.key
    try {
      const info = JSON.parse(fs.readFileSync(path.join(sessionsDir, n), 'utf8'));
      if (info && info.pid && info.sessionId) out.push(info);
    } catch { /* ignore broken pid file */ }
  }
  return out;
}

// Codex session index (id -> thread_name). Defensive: skip anything that does not parse.
function readCodexIndex(file) {
  const map = new Map();
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return map; }
  for (const ln of text.split('\n')) {
    if (!ln.trim()) continue;
    try {
      const o = JSON.parse(ln);
      if (o && typeof o.id === 'string' && typeof o.thread_name === 'string' && o.thread_name.trim()) {
        map.set(o.id, o.thread_name.trim().slice(0, 200));
      }
    } catch { /* skip malformed line */ }
  }
  return map;
}

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
function codexIdOf(fileName) {
  const m = UUID_TAIL.exec(fileName);
  return m ? m[1] : fileName.slice(0, -6);
}

// Resolve a subagent to its root main session (walks parent links, falls back to session_id).
function resolveRoot(st, byId) {
  let cur = st;
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    if (!cur.cx.isSub) return cur;
    if (seen.has(cur.sid)) break;
    seen.add(cur.sid);
    const next = cur.cx.parentId ? byId.get(cur.cx.parentId) : null;
    if (!next) break;
    cur = next;
  }
  const hint = st.cx.sessionHint ? byId.get(st.cx.sessionHint) : null;
  if (hint && !hint.cx.isSub) return hint;
  return null;
}

// Codex import placeholders with no usage: hidden everywhere (they would only add phantom activity).
function isHidden(st) {
  return st.provider === 'codex' && !!st.cx && st.cx.imported && st.agg.tokens.total === 0;
}

// ---------- scanner ----------
function createScanner(claudeDir, options = {}) {
  const projectsDir = path.join(claudeDir, 'projects');
  const sessionsDir = path.join(claudeDir, 'sessions');
  const codexDir = options.codexDir || null;   // null disables the codex provider
  const codexSessionsDir = codexDir ? path.join(codexDir, 'sessions') : null;
  const codexIndexPath = codexDir ? path.join(codexDir, 'session_index.jsonl') : null;
  const codexPricing = options.codexPricing || {};
  const priceRows = codexPriceRows(codexPricing);
  const pricingKey = JSON.stringify(priceRows);
  const cachePath = options.cachePath || null;
  const log = options.log || (() => {});

  const files = new Map(); // transcript path -> state
  let scanning = true;
  let initialDone = false;
  let progress = { done: 0, total: 0 };
  let inFlight = null;
  let timers = [];
  let providerAvail = { claude: false, codex: false };
  let codexIndex = new Map();
  let codexIndexMtime = -1;

  async function collectAgents(dir, sid, projDir, out) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await collectAgents(full, sid, projDir, out);
      else if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) {
        out.push({ path: full, kind: 'agent', sid, projDir, provider: 'claude' });
      }
    }
  }

  async function discoverClaude() {
    const out = [];
    let projEnts;
    try { projEnts = await fsp.readdir(projectsDir, { withFileTypes: true }); } catch { return out; }
    for (const pe of projEnts) {
      if (!pe.isDirectory()) continue;
      const projDir = pe.name;
      const pdir = path.join(projectsDir, projDir);
      let ents;
      try { ents = await fsp.readdir(pdir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const full = path.join(pdir, e.name);
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          out.push({ path: full, kind: 'main', sid: e.name.slice(0, -6), projDir, provider: 'claude' });
        } else if (e.isDirectory()) {
          // subagents/agent-*.jsonl and subagents/workflows/<wf>/agent-*.jsonl (any depth under subagents/)
          await collectAgents(path.join(full, 'subagents'), e.name, projDir, out);
        }
      }
    }
    return out;
  }

  // ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (kind is decided later from session_meta)
  async function discoverCodex() {
    const out = [];
    if (!codexSessionsDir) return out;
    async function walk(dir, depth) {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 6) await walk(full, depth + 1);
        else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
          out.push({ path: full, kind: 'main', sid: codexIdOf(e.name), projDir: '', provider: 'codex' });
        }
      }
    }
    await walk(codexSessionsDir, 0);
    return out;
  }

  function refreshCodexIndex() {
    if (!codexIndexPath) return;
    let mt = -1;
    try { mt = fs.statSync(codexIndexPath).mtimeMs; } catch { codexIndex = new Map(); codexIndexMtime = -1; return; }
    if (mt === codexIndexMtime) return;
    codexIndex = readCodexIndex(codexIndexPath);
    codexIndexMtime = mt;
  }

  function processLine(st, buf) {
    const text = buf.toString('utf8');
    if (!text.trim()) return;
    let o;
    try { o = JSON.parse(text); } catch { return; } // malformed line: skip
    if (!o || typeof o !== 'object') return;
    if (st.provider === 'codex') {
      codex.processRecord(st, o, codexSink(st, priceRows));
      return;
    }
    processClaudeLine(st, o);
  }

  async function refreshInner() {
    const claudeFound = await discoverClaude();
    const codexFound = await discoverCodex();
    providerAvail = { claude: claudeFound.length > 0, codex: codexFound.length > 0 };
    refreshCodexIndex();
    const found = claudeFound.concat(codexFound);
    if (!initialDone) progress = { done: 0, total: found.length };
    const seen = new Set();
    for (const f of found) {
      seen.add(f.path);
      let st = files.get(f.path);
      if (!st) { st = newState(f); files.set(f.path, st); }
      try {
        const stat = await fsp.stat(f.path);
        await updateFile(st, stat, processLine);
        if (st.provider === 'claude' && st.kind === 'agent') await updateMeta(st);
      } catch (e) {
        log('scan error: ' + f.path + ': ' + e.message);
      }
      if (!initialDone) progress.done++;
      await yieldNow();
    }
    for (const k of [...files.keys()]) if (!seen.has(k)) files.delete(k);
    const pnow = Date.now();
    for (const st of files.values()) pruneMinutes(st.agg, pnow);
    if (!initialDone) {
      initialDone = true;
      scanning = false;
      progress = { done: found.length, total: found.length };
      log('initial scan done: ' + found.length + ' transcripts');
    }
  }

  function refresh() {
    if (inFlight) return inFlight;
    inFlight = refreshInner()
      .catch((e) => log('refresh failed: ' + e.message))
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  // ----- snapshot building -----
  // Assigns st.role for every file and returns Map(sid -> session entry) for all providers.
  function buildSessions(now) {
    const sessions = new Map();
    const get = (sid, provider) => {
      if (!sessions.has(sid)) {
        sessions.set(sid, { sid, provider, main: null, agents: [], projDir: '', pid: null, status: 'ended', live: false, indexTitle: '' });
      }
      return sessions.get(sid);
    };

    // Claude: transcripts grouped by session id, liveness from pid files.
    const claudeStates = [...files.values()].filter((st) => st.provider === 'claude');
    for (const st of claudeStates) {
      st.role = st.kind;
      const e = get(st.sid, 'claude');
      if (st.kind === 'main') { e.main = st; e.projDir = st.projDir; }
      else e.agents.push(st);
    }
    const pids = readPidInfos(sessionsDir).map((info) => ({ info, alive: isAlive(info.pid) }));
    for (const p of pids) {
      if (!p.alive) continue;
      const e = sessions.get(p.info.sessionId);
      if (e) {
        if (!e.pid || (p.info.updatedAt || 0) > (e.pid.info.updatedAt || 0)) e.pid = p;
      } else {
        const stub = get(p.info.sessionId, 'claude');
        stub.pid = p;
      }
    }

    // Codex: root sessions by thread id; subagents attached to their root session.
    const cxStates = [...files.values()].filter((st) => st.provider === 'codex' && !isHidden(st));
    const byId = new Map();
    for (const st of cxStates) byId.set(st.sid, st);
    for (const st of cxStates) st.role = st.cx.isSub ? 'agent' : 'main';
    for (const st of cxStates) {
      if (!st.cx.isSub) continue;
      const root = resolveRoot(st, byId);
      if (root) {
        st.role = 'agent';
        get(root.sid, 'codex').agents.push(st);
      } else {
        st.role = 'main'; // unknown parent: show as its own session
      }
    }
    for (const st of cxStates) {
      if (st.role !== 'main') continue;
      const e = get(st.sid, 'codex');
      e.main = st;
      e.projDir = '';
      if (st.cx.isSub) e.indexTitle = (st.meta && st.meta.agentType) || 'subagent';
    }
    for (const e of sessions.values()) {
      if (e.provider !== 'codex' || !e.main) continue;
      e.status = codex.statusOf(e.main.cx, e.main.mtimeMs, now);
      e.live = e.status !== 'ended';
      e.indexTitle = codexIndex.get(e.sid) || e.indexTitle || '';
    }
    return sessions;
  }

  function summarize(e, now) {
    const m = e.main ? e.main.agg : null;
    const isCodex = e.provider === 'codex';
    const pid = isCodex ? null : e.pid;
    const live = isCodex ? !!e.live : !!pid;
    const status = isCodex ? e.status : (live ? (pid.info.status === 'busy' ? 'busy' : 'idle') : 'ended');
    const own = m ? copyTok(m.tokens) : zeroTok();
    const agentTok = zeroTok();
    let agentFirst = null;
    let agentLast = null;
    const byModelAgents = {};
    const modelSet = new Set(m ? Object.keys(m.models) : []);
    for (const ag of e.agents) {
      addInto(agentTok, ag.agg.tokens);
      mergeByModel(byModelAgents, ag.agg.byModel);
      for (const k of Object.keys(ag.agg.models || {})) modelSet.add(k);
      if (ag.agg.firstTs !== null && (agentFirst === null || ag.agg.firstTs < agentFirst)) agentFirst = ag.agg.firstTs;
      if (ag.agg.lastTs !== null && (agentLast === null || ag.agg.lastTs > agentLast)) agentLast = ag.agg.lastTs;
    }
    const sessionTok = copyTok(own);
    addInto(sessionTok, agentTok);
    const byModelTotal = {};
    mergeByModel(byModelTotal, m ? m.byModel : {});
    mergeByModel(byModelTotal, byModelAgents);
    for (const k of Object.keys(byModelTotal)) modelSet.add(k);
    const ownModels = m ? Object.keys(m.models) : [];
    const models = [...new Set([...ownModels, ...modelSet])];
    const modelsAll = [...modelSet].sort();

    const cwd = (m && m.cwd) || (pid && pid.info.cwd) || '';
    const base = cwd ? cwd.split(/[\\/]+/).filter(Boolean).pop() : '';
    const project = base || e.projDir || '';
    let title;
    if (isCodex) {
      title = e.indexTitle || (m && m.firstPrompt ? m.firstPrompt.slice(0, 60) : '') || e.sid;
    } else {
      title =
        (m && (m.customTitle || m.agentName || (m.firstPrompt || '').slice(0, 60))) ||
        (pid && pid.info.name) ||
        e.sid;
    }

    const lastCandidates = [m && m.lastTs, agentLast, !isCodex && live ? pid.info.updatedAt : null].filter((x) => typeof x === 'number');
    const lastTs = lastCandidates.length ? Math.max(...lastCandidates) : null;
    const firstCandidates = [m && m.firstTs, agentFirst].filter((x) => typeof x === 'number');
    const firstTs = firstCandidates.length ? Math.min(...firstCandidates) : null;

    const runningAgents = live
      ? e.agents
          .filter((ag) => now - ag.mtimeMs <= RUNNING_WINDOW_MS)
          .map((ag) => ({
            agentId: agentIdOf(ag),
            agentType: (ag.meta && ag.meta.agentType) || '',
            description: (ag.meta && ag.meta.description) || '',
            model: agentModelOf(ag),
          }))
      : [];

    let startedAt = null;
    if (isCodex) {
      if (live && e.main && typeof e.main.cx.startTs === 'number') startedAt = e.main.cx.startTs;
    } else if (live && typeof pid.info.startedAt === 'number') {
      startedAt = pid.info.startedAt;
    }

    return {
      id: e.sid,
      provider: e.provider,
      projDir: e.projDir,
      project,
      cwd,
      title,
      imported: !!(e.main && e.main.cx && e.main.cx.imported),
      lastPrompt: m ? m.lastPrompt : '',
      prompts: m ? m.prompts : 0,
      version: m ? m.version : '',
      models,
      modelsAll,
      primaryModel: m ? primaryModelOf(m.byModel) : null,
      status,
      live,
      pid: !isCodex && live ? pid.info.pid : null,
      kind: !isCodex && live ? pid.info.kind || null : null,
      entrypoint: !isCodex && live ? pid.info.entrypoint || null : null,
      startedAt,
      firstTs,
      lastTs,
      wallMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : 0,
      activeMs: m ? m.activeMs : 0,
      apiCalls: m ? m.apiCalls : 0,
      tokens: own,
      byModel: m ? mergeCopy(m.byModel) : {},
      byModelTotal: mergeCopy(byModelTotal),
      byModelAgents: mergeCopy(byModelAgents),
      agentCount: e.agents.length,
      agentTokens: agentTok,
      sessionTotal: sessionTok,
      runningAgents,
    };
  }

  // agent 모델: meta.model이 완전한 id면 그대로, alias면 실제 사용 모델 id를 우선
  function agentModelOf(ag) {
    const mm = ag.meta && ag.meta.model ? String(ag.meta.model) : '';
    const bm = primaryModelOf(ag.agg.byModel);
    if (mm && !MODEL_ALIAS.test(mm)) return mm;
    return bm || mm || '';
  }

  function agentIdOf(st) {
    if (st.provider === 'codex') return st.sid;
    return path.basename(st.path, '.jsonl').replace(/^agent-/, '');
  }

  function agentDetail(ag, live, now) {
    const meta = ag.meta || {};
    const a = ag.agg;
    return {
      agentId: agentIdOf(ag),
      agentType: meta.agentType || '',
      description: meta.description || '',
      model: agentModelOf(ag),
      workflowPhase: meta.workflowPhase || null,
      toolUseId: meta.toolUseId || null,
      tokens: copyTok(a.tokens),
      byModel: mergeCopy(a.byModel),
      firstTs: a.firstTs,
      lastTs: a.lastTs,
      wallMs: a.firstTs !== null && a.lastTs !== null ? a.lastTs - a.firstTs : 0,
      activeMs: a.activeMs,
      apiCalls: a.apiCalls,
      running: live && now - ag.mtimeMs <= RUNNING_WINDOW_MS,
    };
  }

  function mergeCopy(byModel) {
    const out = {};
    for (const m of Object.keys(byModel)) out[m] = copyTok(byModel[m]);
    return out;
  }

  // Latest Codex rate-limit snapshot across all codex files.
  function codexRateLimits() {
    let best = null;
    for (const st of files.values()) {
      if (st.provider !== 'codex' || !st.cx || !st.cx.rate) continue;
      if (!best || st.cx.rate.ts > best.ts) best = st.cx.rate;
    }
    if (!best) return null;
    return { observedAt: best.ts, limit_id: best.limit_id, plan_type: best.plan_type, primary: best.primary, secondary: best.secondary };
  }

  function codexPricingInfo() {
    return {
      note: GPT_NOTE,
      table: priceRows.map((r) => ({
        match: r.match, input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite,
      })),
      configNote: 'config.json 의 codexPricing 에 "모델 일부" 키와 {input, output, cacheRead, cacheWrite} (USD/1M)를 넣으면 기본 가격을 덮어씁니다. 표에 없는 모델(예: codex-auto-review)은 단가 미설정으로 표시됩니다.',
    };
  }

  function getSnapshot(filter = 'all') {
    const now = Date.now();
    const sessionMap = buildSessions(now);
    const sessionAll = [...sessionMap.values()].map((e) => summarize(e, now));
    const sessionList = sessionAll.filter((s) => filter === 'all' || s.provider === filter);
    sessionList.sort((x, y) => (y.lastTs || 0) - (x.lastTs || 0));
    const live = sessionList.filter((s) => s.live);

    const inScope = (st) => (filter === 'all' || st.provider === filter) && !isHidden(st);

    const todayKey = dateKey(now);
    const dayKeys = []; // newest first
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push(dateKey(d.getTime()));
    }
    const dayAcc = new Map();
    for (const k of dayKeys) {
      dayAcc.set(k, { tok: zeroTok(), byModel: {}, byFamily: zeroFamilies(), costByFamily: zeroFamilies(), active: 0 });
    }
    const hourKeys = [];
    for (let i = HOURS - 1; i >= 0; i--) hourKeys.push(hourKey(now - i * 3600000));
    const hourSet = new Set(hourKeys);
    const hourly = {};
    const hourlyByFamily = {};
    const hourlyCost = {};
    for (const k of hourKeys) {
      hourly[k] = 0;
      hourlyByFamily[k] = zeroFamilies();
      hourlyCost[k] = 0;
    }

    const last60 = { total: 0, byFamily: zeroFamilies(), cost: 0 };
    const m60From = minuteKey(now - 59 * 60000);
    const m60To = minuteKey(now);
    const totalTok = zeroTok();
    const totalByModel = {};
    let totalActive = 0;
    let agentFiles = 0;
    const scoped = [...files.values()].filter(inScope);
    for (const st of scoped) {
      const a = st.agg;
      addInto(totalTok, a.tokens);
      mergeByModel(totalByModel, a.byModel);
      if (st.role === 'main') totalActive += a.activeMs;
      else agentFiles++;
      for (const k of Object.keys(a.daily)) {
        const acc = dayAcc.get(k);
        if (!acc) continue;
        const d = a.daily[k];
        addInto(acc.tok, d.tok);
        for (const m of Object.keys(d.byModel)) {
          acc.byModel[m] = (acc.byModel[m] || 0) + d.byModel[m].total;
          const fam = familyOf(m);
          acc.byFamily[fam] += d.byModel[m].total;
          acc.costByFamily[fam] += d.byModel[m].cost;
        }
        if (st.role === 'main') acc.active += d.active;
      }
      for (const k of Object.keys(a.minutely || {})) {
        if (k < m60From || k > m60To) continue;
        const m = a.minutely[k];
        for (const f of FAMILY_KEYS) { last60.byFamily[f] += m[f]; last60.total += m[f]; }
        last60.cost += m.cost;
      }
      for (const k of Object.keys(a.hourly)) {
        if (!hourSet.has(k)) continue;
        const h = a.hourly[k];
        for (const f of FAMILY_KEYS) hourlyByFamily[k][f] += h[f];
        hourlyCost[k] += h.cost;
        hourly[k] += FAMILY_KEYS.reduce((s, f) => s + h[f], 0);
      }
    }

    // daily array: oldest first, zero-filled
    const daily = dayKeys.slice().reverse().map((k) => {
      const acc = dayAcc.get(k);
      return {
        date: k,
        total: acc.tok.total,
        tokens: acc.tok,
        byModel: acc.byModel,
        byFamily: acc.byFamily,
        active: acc.active,
        cost: acc.tok.cost,
        costUnknown: !!acc.tok.costUnknown,
        costByFamily: acc.costByFamily,
      };
    });
    const sumDays = (keys) => {
      const tok = zeroTok();
      const byModel = {};
      let active = 0;
      for (const k of keys) {
        const acc = dayAcc.get(k);
        if (!acc) continue;
        addInto(tok, acc.tok);
        active += acc.active;
      }
      // per-model tokens-objects for the window
      for (const st of scoped) {
        for (const k of keys) {
          const d = st.agg.daily[k];
          if (d) mergeByModel(byModel, d.byModel);
        }
      }
      return { tokens: tok, byModel, activeMs: active };
    };
    const todayAgg = sumDays([todayKey]);
    const last7Agg = sumDays(dayKeys.slice(0, 7));

    const providers = {};
    if (providerAvail.claude) {
      providers.claude = { available: true, sessions: sessionAll.filter((s) => s.provider === 'claude').length };
    }
    if (providerAvail.codex) {
      providers.codex = {
        available: true,
        sessions: sessionAll.filter((s) => s.provider === 'codex').length,
        rateLimits: codexRateLimits(),
      };
    }

    return {
      scanning,
      progress: { done: progress.done, total: progress.total },
      generatedAt: now,
      provider: filter,
      providers,
      totals: {
        tokens: totalTok,
        byModel: totalByModel,
        sessions: sessionList.length,
        agents: agentFiles,
        activeMs: totalActive,
      },
      today: todayAgg,
      last7d: last7Agg,
      daily,
      hourly,
      hourlyByFamily,
      hourlyCost,
      last60,
      pricing: {
        note: PRICING_NOTE,
        table: pricingTable(),
        codex: codexPricingInfo(),
      },
      live,
      sessions: sessionList,
    };
  }

  function getSession(id) {
    const now = Date.now();
    const sessionMap = buildSessions(now);
    const e = sessionMap.get(id);
    if (!e) return null;
    const s = summarize(e, now);
    const daily = {};
    const dailyByFamily = {};
    const dailyCost = {};
    const add = (agg) => {
      for (const k of Object.keys(agg.daily)) {
        const d = agg.daily[k];
        daily[k] = (daily[k] || 0) + d.tok.total;
        dailyCost[k] = (dailyCost[k] || 0) + d.tok.cost;
        const fam = dailyByFamily[k] || (dailyByFamily[k] = zeroFamilies());
        for (const m of Object.keys(d.byModel)) fam[familyOf(m)] += d.byModel[m].total;
      }
    };
    if (e.main) add(e.main.agg);
    for (const ag of e.agents) add(ag.agg);
    s.agents = e.agents
      .map((ag) => agentDetail(ag, s.live, now))
      .sort((x, y) => (y.lastTs || 0) - (x.lastTs || 0));
    s.daily = daily;
    s.dailyByFamily = dailyByFamily;
    s.dailyCost = dailyCost;
    return s;
  }

  // ----- cache -----
  function serialize(st) {
    return {
      path: st.path,
      provider: st.provider,
      kind: st.kind,
      sid: st.sid,
      projDir: st.projDir,
      size: st.size,
      offset: st.offset,
      mtimeMs: st.mtimeMs,
      partial: st.partial.toString('base64'),
      agg: st.agg,
      ids: [...st.ids].slice(-ID_KEEP),
      meta: st.meta,
      metaMtime: st.metaMtime,
      metaPath: st.metaPath,
      cx: st.cx,
    };
  }

  function deserialize(o) {
    const st = newState({ path: o.path, provider: o.provider, kind: o.kind, sid: o.sid, projDir: o.projDir });
    st.size = o.size;
    st.offset = o.offset;
    st.mtimeMs = o.mtimeMs;
    st.partial = Buffer.from(o.partial || '', 'base64');
    st.agg = o.agg;
    if (!st.agg.minutely) st.agg.minutely = {};
    st.ids = new Map(o.ids || []);
    st.meta = o.meta;
    st.metaMtime = o.metaMtime || 0;
    if (st.provider === 'codex') st.cx = o.cx || codex.createCxState();
    return st;
  }

  function loadCache() {
    if (!cachePath) return;
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (!data || data.version !== CACHE_VERSION || data.claudeDir !== claudeDir ||
          data.codexDir !== (codexDir || '') || data.pricingKey !== pricingKey) return;
      for (const o of data.files) files.set(o.path, deserialize(o));
      log('cache loaded: ' + files.size + ' transcripts');
    } catch { /* no or invalid cache: full scan */ }
  }

  function saveCache() {
    if (!cachePath) return;
    try {
      const data = {
        version: CACHE_VERSION, claudeDir, codexDir: codexDir || '', pricingKey, savedAt: Date.now(),
        files: [...files.values()].map(serialize),
      };
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const tmp = cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, cachePath);
    } catch (e) {
      log('cache save failed: ' + e.message);
    }
  }

  function start(opts = {}) {
    loadCache();
    refresh();
    timers.push(setInterval(() => refresh(), opts.refreshMs || 5000));
    if (cachePath) timers.push(setInterval(saveCache, 60000));
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
    saveCache();
  }

  return {
    start,
    stop,
    refresh,
    saveCache,
    getSnapshot,
    getSession,
    get scanning() { return scanning; },
    get progress() { return { ...progress }; },
  };
}

module.exports = { createScanner, IDLE_GAP_MS, RUNNING_WINDOW_MS, PROVIDERS };
