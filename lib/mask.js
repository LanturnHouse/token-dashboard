'use strict';
// DEMO mode privacy masking (server-side). Deep-copies API payloads and replaces
// personal / path-like values so the real text never reaches the browser.
// Numbers, timestamps, model names, statuses and token/cost objects are left untouched.

const crypto = require('crypto');

const MASK = '(가려짐)';
const SALT = crypto.randomBytes(32).toString('hex'); // per process, never persisted
const GENERIC_AGENT_TYPES = new Set([
  'general-purpose', 'Explore', 'Plan', 'workflow-subagent', 'claude-code-guide', 'statusline-setup', 'guardian', 'subagent',
]);
const GENERIC_SKILLS = new Set(['init', 'review', 'security-review', 'simplify', 'loop', 'schedule', 'claude-api', 'update-config', 'keybindings-help', 'batch', 'debug', 'verify', 'compact', 'model', 'clear',
  'anthropic-skills:pdf', 'anthropic-skills:docx', 'anthropic-skills:xlsx', 'anthropic-skills:pptx',
  'anthropic-skills:built-in-browser', 'anthropic-skills:chrome-browser']);
const SKILL_NS = 'anthropic-skills:';
// Strings that look like a user path or name (drive path, Users folder, the owner's name).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OWNER = (() => { try { return require('os').userInfo().username || ''; } catch { return ''; } })();
const SENSITIVE = new RegExp((OWNER ? escapeRe(OWNER) + '|' : '') + String.raw`\\users\\|/users/|/home/|^[a-z]:[\\/]|[a-z]:\\`, 'i');

const sessions = new Map(); // real session id -> { fake, n }
const byFake = new Map();   // fake session id -> real session id (reverse map)
const projects = new Map(); // real project key -> 'project-X'
const agentNums = new Map(); // real session id -> Map(real agentId -> k)
const SAFE = new Set();     // masked values we generated; the final scrub must not touch them
let nextN = 0;

// uuid-like 36-char id: sha256(salt + real) -> 32 hex chars, 8-4-4-4-12
function fakeIdFor(real) {
  const hex = crypto.createHash('sha256').update(SALT + '\0' + String(real)).digest('hex').slice(0, 32);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}

// 0 -> A, 25 -> Z, 26 -> AA ...
function letters(i) {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function projLabel(key) {
  if (!key) return '';
  if (!projects.has(key)) projects.set(key, 'project-' + letters(projects.size));
  const v = projects.get(key);
  SAFE.add(v);
  return v;
}

// Register sessions; numbering is by firstTs ascending within each new batch, then fixed.
function registerSessions(rows) {
  const fresh = new Map();
  for (const r of rows) {
    if (r && r.id && !sessions.has(r.id) && !fresh.has(r.id)) fresh.set(r.id, r);
  }
  const list = [...fresh.values()].sort((a, b) => (a.firstTs || 0) - (b.firstTs || 0));
  for (const r of list) {
    const fake = fakeIdFor(r.id);
    sessions.set(r.id, { fake, n: ++nextN });
    byFake.set(fake, r.id);
  }
}

function agentK(sid, agentId) {
  let m = agentNums.get(sid);
  if (!m) { m = new Map(); agentNums.set(sid, m); }
  if (!m.has(agentId)) m.set(agentId, m.size + 1);
  return m.get(agentId);
}

function cleanType(t) {
  if (!t) return '';
  return GENERIC_AGENT_TYPES.has(t) ? t : 'custom-agent';
}

const skillNums = new Map();
function cleanSkill(name) {
  if (typeof name !== 'string' || !name) return name;
  if (GENERIC_SKILLS.has(name)) return name;
  if (!skillNums.has(name)) skillNums.set(name, skillNums.size + 1);
  // user-added skills can live in the anthropic-skills namespace too: keep the namespace, mask the name
  return (name.startsWith(SKILL_NS) ? SKILL_NS : '') + 'custom-skill #' + skillNums.get(name);
}

function maskText(v) {
  return typeof v === 'string' && v ? MASK : v;
}

function maskAgent(a, sid) {
  const out = { ...a };
  const type = cleanType(a.agentType);
  if (Object.prototype.hasOwnProperty.call(a, 'agentType')) out.agentType = type;
  if (a.agentId) {
    const k = agentK(sid, a.agentId);
    out.agentId = fakeIdFor('agent|' + sid + '|' + a.agentId);
    if (Object.prototype.hasOwnProperty.call(a, 'description')) {
      out.description = (type || 'agent') + ' 작업 #' + k;
    }
  }
  if (a.toolUseId) out.toolUseId = fakeIdFor('tool|' + a.toolUseId);
  if (a.parentAgentId) out.parentAgentId = fakeIdFor('agent|' + sid + '|' + a.parentAgentId);
  return out;
}

// 관제 fields keyed by real session id -> masked id (entries of unknown sessions are dropped).
function remapKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const reg = sessions.get(k);
    if (reg) out[reg.fake] = obj[k];
  }
  return out;
}

// agentsNow / agentsDone: { session, agentId, parentAgentId, agentType, description, ... }
function maskAgentList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && sessions.has(a.session))
    .map((a) => {
      const out = maskAgent(a, a.session);
      out.session = sessions.get(a.session).fake;
      return out;
    });
}

function maskControl(out) {
  if (out.routes && typeof out.routes === 'object') out.routes.sessions = remapKeys(out.routes.sessions);
  if (out.ctx && typeof out.ctx === 'object') {
    out.ctx.sessions = remapKeys(out.ctx.sessions);
    out.ctx.recent = (Array.isArray(out.ctx.recent) ? out.ctx.recent : []).map((c) => {
      const reg = sessions.get(c.sessionId);
      return { ...c, sessionId: reg ? reg.fake : null, session: reg ? '세션 ' + reg.n : '(other session)' };
    });
  }
  if (Array.isArray(out.agentsNow)) out.agentsNow = maskAgentList(out.agentsNow);
  if (Array.isArray(out.agentsDone)) out.agentsDone = maskAgentList(out.agentsDone);
  // skill names can be user-defined (project/company specific): keep only well-known generic names,
  // everything else becomes a stable placeholder ('custom-skill #k').
  if (Array.isArray(out.skillsNow)) {
    out.skillsNow = out.skillsNow
      .filter((x) => x && sessions.has(x.session))
      .map((x) => {
        const o = { ...x, session: sessions.get(x.session).fake, skill: cleanSkill(x.skill) };
        if (x.agentId) o.agentId = fakeIdFor('agent|' + x.session + '|' + x.agentId);
        return o;
      });
  }
  if (Array.isArray(out.skills30d)) {
    out.skills30d = out.skills30d.filter((x) => x).map((x) => ({ ...x, skill: cleanSkill(x.skill) }));
  }
}

// row: a session summary object (already a copy). Uses the real id before rewriting it.
function maskRow(row) {
  const real = row.id;
  const reg = sessions.get(real);
  const proj = projLabel(row.project || row.projDir);
  row.id = reg.fake;
  row.projDir = proj;
  row.project = proj;
  row.cwd = proj ? 'C:\\work\\' + proj : '';
  if (row.cwd) SAFE.add(row.cwd);
  row.title = '세션 ' + reg.n;
  if (Object.prototype.hasOwnProperty.call(row, 'lastPrompt')) row.lastPrompt = maskText(row.lastPrompt);
  if (Object.prototype.hasOwnProperty.call(row, 'firstPrompt')) row.firstPrompt = maskText(row.firstPrompt);
  if (Object.prototype.hasOwnProperty.call(row, 'pid')) row.pid = null;
  if (Array.isArray(row.agents)) row.agents = row.agents.map((a) => maskAgent(a, real));
  if (Array.isArray(row.runningAgents)) row.runningAgents = row.runningAgents.map((a) => maskAgent(a, real));
  return row;
}

// Final recursive pass: any remaining string that looks like a path or name is replaced.
function scrub(v) {
  if (typeof v === 'string') return SENSITIVE.test(v) && !SAFE.has(v) ? MASK : v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = scrub(v[i]);
    return v;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = scrub(v[k]);
    return v;
  }
  return v;
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function maskSummary(obj) {
  const out = deepCopy(obj);
  const sessRows = Array.isArray(out.sessions) ? out.sessions : [];
  const liveRows = Array.isArray(out.live) ? out.live : [];
  registerSessions([...sessRows, ...liveRows].map((r) => ({ id: r && r.id, firstTs: r && r.firstTs })));
  out.sessions = sessRows.map(maskRow);
  out.live = liveRows.map(maskRow);
  maskControl(out);
  return scrub(out);
}

function maskSession(obj) {
  const out = deepCopy(obj);
  registerSessions([{ id: out.id, firstTs: out.firstTs }]);
  // number agents by firstTs ascending so "작업 #k" follows start order
  const agents = (Array.isArray(obj.agents) ? obj.agents : [])
    .filter((a) => a && a.agentId)
    .slice()
    .sort((x, y) => (x.firstTs || 0) - (y.firstTs || 0));
  for (const a of agents) agentK(obj.id, a.agentId);
  return scrub(maskRow(out));
}

// Demo URL id -> real session id; null when the id was never issued by this process.
function realIdOf(fake) {
  return byFake.get(fake) || null;
}

module.exports = { maskSummary, maskSession, realIdOf, MASK };
