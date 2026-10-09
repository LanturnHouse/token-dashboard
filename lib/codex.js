'use strict';
// Codex (OpenAI GPT) rollout log parsing (read-only, no I/O).
// Input: one parsed JSON line from ~/.codex/sessions/**/rollout-*.jsonl.
// The scanner owns aggregates and the incremental file reading; this module only
// interprets records and reports effects through a `sink`:
//   sink.timeline(ms)                  any record with a timestamp
//   sink.usage(id, rec)                one API response (id dedupes it)
//   sink.retract(id)                   undo a fallback usage record
//   sink.prompt(text)                  a human prompt (already cleaned)
//   sink.meta(cwd, version)            session cwd / cli version (first wins)
//   sink.price(model, in, out, cacheRead, cacheWrite) -> {cost, unknown}
//   sink.compact(ev)                   a 'compacted' record {ts, trigger, preTokens, postTokens:null, durationMs:null, approx}
// Usage records carry rec.effort (turn_context effort of their turn, else the latest one).

const BUSY_MS = 10 * 60 * 1000;   // task_started and file touched within 10 min -> busy
const IDLE_MS = 30 * 60 * 1000;   // file touched within 30 min -> idle
const TURN_KEEP = 64;             // turn_id -> model entries kept per file
const IMPORT_TURN = /^external-import/;
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const TAG_RE = /<\/?[A-Za-z][\w:-]*(\s[^>]*)?\/?>/g;

const str = (x) => (typeof x === 'string' ? x : '');
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Per-file parse state (plain JSON-serializable object, stored in the scanner cache).
function createCxState() {
  return {
    metaSeen: false,
    isSub: false,            // spawned or guardian subagent (session_meta.source is an object)
    parentId: null,          // parent thread id (subagents)
    sessionHint: null,       // session_id field (root session id for subagents)
    nickname: '',
    startTs: null,           // session_meta timestamp (ms)
    cwd: '',
    version: '',
    originator: '',
    imported: false,         // imported from another tool (external-import turn)
    model: '',               // latest turn_context model (fallback when a turn has no model)
    turnModels: {},          // turn_id -> model (bounded by TURN_KEEP)
    turnOrder: [],
    effort: '',              // latest turn_context effort (fallback when a turn has no effort entry)
    turnEfforts: {},         // turn_id -> effort (bounded by TURN_KEEP)
    effortOrder: [],
    window: null,            // latest token_count info.model_context_window
    windowTs: -1,
    task: '',                // '' | 'started' | 'done' (last task event)
    taskTs: null,
    hasTur: false,           // file has token_usage_record lines (they win over token_count)
    tcIds: [],               // fallback token_count usage ids applied before hasTur was known
    tcSeq: 0,
    tcLastKey: '',
    tcLastTs: '',
    rate: null,              // latest rate_limits seen in this file
  };
}

function setTurnModel(cx, turnId, model) {
  if (!hasOwn(cx.turnModels, turnId)) {
    cx.turnOrder.push(turnId);
    while (cx.turnOrder.length > TURN_KEEP) delete cx.turnModels[cx.turnOrder.shift()];
  }
  cx.turnModels[turnId] = model;
}

function setTurnEffort(cx, turnId, effort) {
  if (!cx.turnEfforts) { cx.turnEfforts = {}; cx.effortOrder = []; }
  if (!hasOwn(cx.turnEfforts, turnId)) {
    cx.effortOrder.push(turnId);
    while (cx.effortOrder.length > TURN_KEEP) delete cx.turnEfforts[cx.effortOrder.shift()];
  }
  cx.turnEfforts[turnId] = effort;
}

// Effort of a usage record: its turn's turn_context effort, else the latest one seen.
function effortFor(cx, turnId) {
  if (turnId && cx.turnEfforts && hasOwn(cx.turnEfforts, turnId)) return cx.turnEfforts[turnId];
  return cx.effort || 'unknown';
}

function modelFor(cx, turnId) {
  if (turnId && hasOwn(cx.turnModels, turnId)) return cx.turnModels[turnId];
  return cx.model || 'unknown';
}

// Codex usage -> our token fields. cached_input_tokens and cache_write_input_tokens are subsets of input_tokens.
function toRec(u, ts, model, sink) {
  const inTok = num(u.input_tokens);
  const cached = num(u.cached_input_tokens);
  const cw = num(u.cache_write_input_tokens);
  const out = num(u.output_tokens);
  if (inTok + cached + cw + out === 0) return null; // reasoning tokens are already inside output
  const input = Math.max(0, inTok - cached - cw);
  const price = sink.price(model, input, out, cached, cw);
  return {
    ts, model, input, output: out, cacheCreate: cw, cacheCreate1h: 0, cacheRead: cached,
    fast: false, cost: price.cost, costUnknown: price.unknown,
  };
}

function pickWindow(w) {
  if (!w || typeof w !== 'object') return null;
  return { used_percent: num(w.used_percent), window_minutes: num(w.window_minutes), resets_at: num(w.resets_at) };
}

function onMeta(st, p, t, sink) {
  const cx = st.cx;
  if (cx.metaSeen) return;
  cx.metaSeen = true;
  cx.startTs = t !== null ? t : null;
  cx.cwd = str(p.cwd);
  cx.version = str(p.cli_version);
  cx.originator = str(p.originator);
  if (/import/i.test(cx.originator)) cx.imported = true;
  sink.meta(cx.cwd, cx.version);
  const src = p.source;
  if (src && typeof src === 'object' && src.subagent && typeof src.subagent === 'object') {
    const sub = src.subagent;
    const spawn = sub.thread_spawn && typeof sub.thread_spawn === 'object' ? sub.thread_spawn : null;
    cx.isSub = true;
    cx.parentId = str(p.parent_thread_id) || (spawn ? str(spawn.parent_thread_id) : '') || null;
    cx.sessionHint = str(p.session_id) || null;
    cx.nickname = str((spawn && spawn.agent_nickname) || p.agent_nickname);
    const guardian = typeof sub.other === 'string' ? /guardian/i.test(sub.other) : false;
    const agentType = guardian ? 'guardian' : (cx.nickname || (spawn ? 'subagent' : str(sub.other) || 'subagent'));
    st.meta = { agentType, description: '', toolUseId: null, workflowPhase: null };
  }
}

function onTurn(st, p, sink) {
  const cx = st.cx;
  if (p.cwd) sink.meta(str(p.cwd), '');
  const eff = str(p.effort) || 'unknown';
  cx.effort = eff;
  if (typeof p.turn_id === 'string' && p.turn_id) setTurnEffort(cx, p.turn_id, eff);
  if (typeof p.model === 'string' && p.model) {
    cx.model = p.model;
    if (typeof p.turn_id === 'string' && p.turn_id) setTurnModel(cx, p.turn_id, p.model);
  }
}

function onUsageRecord(st, p, t, sink) {
  const cx = st.cx;
  if (t === null || !p.usage || typeof p.usage !== 'object') return;
  if (!cx.hasTur) {
    // The file has exact per-response records: drop fallback token_count usage applied so far.
    cx.hasTur = true;
    for (const id of cx.tcIds) sink.retract(id);
    cx.tcIds = [];
  }
  const rec = toRec(p.usage, t, modelFor(cx, str(p.turn_id)), sink);
  if (rec) rec.effort = effortFor(cx, str(p.turn_id));
  if (rec) sink.usage(str(p.response_id) || 'tur:' + (++cx.tcSeq), rec);
}

function onEvent(st, p, t, rawTs, sink) {
  const cx = st.cx;
  switch (p.type) {
    case 'task_started':
      cx.task = 'started';
      cx.taskTs = t;
      if (typeof p.turn_id === 'string' && IMPORT_TURN.test(p.turn_id)) cx.imported = true;
      break;
    case 'task_complete':
    case 'turn_aborted':
      cx.task = 'done';
      cx.taskTs = t;
      break;
    case 'user_message': {
      const clean = str(p.message).replace(REMINDER_RE, ' ').replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
      if (clean) sink.prompt(clean);
      break;
    }
    case 'thread_settings_applied':
      if (p.thread_settings && typeof p.thread_settings.model === 'string') cx.model = p.thread_settings.model;
      break;
    case 'token_count': {
      if (p.rate_limits && typeof p.rate_limits === 'object' && t !== null) {
        if (!cx.rate || t >= cx.rate.ts) {
          const rl = p.rate_limits;
          cx.rate = {
            ts: t, limit_id: str(rl.limit_id), plan_type: str(rl.plan_type),
            primary: pickWindow(rl.primary), secondary: pickWindow(rl.secondary),
          };
        }
      }
      const info = p.info;
      // context window size of the model (latest by timestamp)
      if (info && typeof info === 'object' && typeof info.model_context_window === 'number' && info.model_context_window > 0) {
        const wt = t !== null ? t : 0;
        if (wt >= (typeof cx.windowTs === 'number' ? cx.windowTs : -1)) { cx.windowTs = wt; cx.window = info.model_context_window; }
      }
      // Fallback usage (only until the file proves it has token_usage_record lines).
      const last = info && typeof info === 'object' ? info.last_token_usage : null;
      if (cx.hasTur || !last || typeof last !== 'object' || t === null) break;
      const key = [last.input_tokens, last.cached_input_tokens, last.cache_write_input_tokens, last.output_tokens].join(',');
      if (key === cx.tcLastKey && rawTs === cx.tcLastTs) break; // identical repeat at the same instant
      cx.tcLastKey = key;
      cx.tcLastTs = rawTs;
      const rec = toRec(last, t, modelFor(cx, ''), sink);
      if (!rec) break;
      rec.effort = cx.effort || 'unknown';
      const id = 'tc:' + (++cx.tcSeq);
      sink.usage(id, rec);
      cx.tcIds.push(id);
      break;
    }
    default:
      break;
  }
}

// Interpret one parsed line. Unknown types are ignored.
function processRecord(st, o, sink) {
  let t = null;
  if (typeof o.timestamp === 'string') {
    const p = Date.parse(o.timestamp);
    if (!Number.isNaN(p)) { t = p; sink.timeline(p); }
  }
  const p = o.payload && typeof o.payload === 'object' ? o.payload : {};
  switch (o.type) {
    case 'session_meta': onMeta(st, p, t, sink); break;
    case 'turn_context': onTurn(st, p, sink); break;
    case 'token_usage_record': onUsageRecord(st, p, t, sink); break;
    case 'event_msg': onEvent(st, p, t, str(o.timestamp), sink); break;
    case 'compacted': {
      // Codex context compaction: no trigger / duration / post size in the log (post = next call, filled by the scanner).
      if (t === null || typeof sink.compact !== 'function') break;
      const lu = p.latest_token_usage_record && typeof p.latest_token_usage_record === 'object' ? p.latest_token_usage_record.usage : null;
      sink.compact({ ts: t, trigger: 'unknown', preTokens: lu && typeof lu === 'object' ? num(lu.input_tokens) : 0, postTokens: null, durationMs: null, approx: true });
      break;
    }
    default: break;
  }
}

// Session status from the last task event and the file's last write time.
function statusOf(cx, mtimeMs, now) {
  if (cx.task === 'started' && now - mtimeMs <= BUSY_MS) return 'busy';
  if (now - mtimeMs <= IDLE_MS) return 'idle';
  return 'ended';
}

module.exports = {
  BUSY_MS,
  IDLE_MS,
  createCxState,
  processRecord,
  statusOf,
  pickWindow,
};
