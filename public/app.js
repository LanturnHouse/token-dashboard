/* AI 토큰 사용량 대시보드 - 프런트엔드 (바닐라 JS, 외부 라이브러리 없음) */
(function () {
  'use strict';

  // Claude families, then GPT lines. FAMILIES is the stack order (Claude first, then GPT).
  var CLAUDE_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable', 'other'];
  var GPT_FAMILIES = ['gpt-astra', 'gpt-sol', 'gpt-terra', 'gpt-luna', 'gpt-other'];
  var FAMILIES = CLAUDE_FAMILIES.concat(GPT_FAMILIES);
  var FAMILY_LABEL = {
    opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', other: '기타',
    'gpt-astra': 'GPT Astra', 'gpt-sol': 'GPT Sol', 'gpt-terra': 'GPT Terra', 'gpt-luna': 'GPT Luna', 'gpt-other': 'GPT 기타'
  };
  var FAMILY_COLOR = {
    opus: '#d97757', sonnet: '#6a9bcc', haiku: '#788c5d', fable: '#b07cc6', other: '#888888',
    'gpt-astra': '#d4a72c', 'gpt-sol': '#2bb3a3', 'gpt-terra': '#c06c84', 'gpt-luna': '#5cc8e8', 'gpt-other': '#9a9a6a'
  };
  // ?theme=light|dark overrides prefers-color-scheme (CSS keys off data-theme on <html>).
  // ?force-advisory=1 renders the 특보 banner with the current numbers (dev check, harmless, shipped).
  var QS = (function () { try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; } })();
  if (QS.get('theme') === 'light' || QS.get('theme') === 'dark') document.documentElement.setAttribute('data-theme', QS.get('theme'));
  var FORCE_ADVISORY = QS.get('force-advisory') === '1';
  var PROVIDER_KEY = 'cud.provider';   // localStorage: 'claude' | 'codex' | 'all'
  var PROVIDER_LABEL = { claude: 'Claude', codex: 'GPT' };
  var REFRESH_MS = 5000;     // 전체 데이터 갱신 주기
  var DRAWER_MS = 2000;      // 드로어 열려 있을 때 세션 상세 갱신 주기
  var TICK_MS = 1000;        // 실행 중 시간 표시 갱신 주기 (데이터 재요청 없음)
  var IDLE_GAP_MS = 300000;  // 마지막 활동 이후 이 시간까지만 실행 중 시간에 더함
  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;
  var COST_NOTE = 'API 정가 기준 추정치 — 실제 구독 요금과 다를 수 있음';

  var state = {
    summary: null,       // /api/summary 응답
    details: {},         // sessionId -> 세션 상세 (실행 중 에이전트 표시 및 드로어용 캐시)
    // 테이블별 정렬 상태 (data-table 이름 -> {key, dir}). 갱신에도 유지된다.
    sorts: {
      sess: { key: 'lastTs', dir: -1 },
      models: { key: 'total', dir: -1 },
      agents: { key: 'firstTs', dir: 1 }
    },
    filter: 'all',       // all | live | today | week
    query: '',
    openId: null,        // 드로어에서 보고 있는 세션 id
    drawer: null,        // 드로어 세션 상세 데이터
    timer: null,
    drawerTimer: null,
    drawerBusy: false,
    tickTimer: null,
    liveKpi: null,       // 오늘 작업시간 실시간 계산용 {base, busy:[lastTs]}
    inFlight: false,
    again: false,               // 요청 중 갱신/제공자 변경이 생기면 끝난 뒤 한 번 더 요청
    provider: loadProvider(),   // 전체 | Claude | GPT 선택 (claude | codex | all)
    providerMulti: false,       // 두 개 이상 제공자가 감지되었을 때만 토글 표시
    error: '',
    liveMore: false,     // 작업 중 목록: 대기 세션 전체 펼침 여부 (메모리에만 보관)
    advDismissed: null   // 특보를 닫은 시간 키 (메모리에만 보관)
  };

  function loadProvider() {
    try {
      var v = localStorage.getItem(PROVIDER_KEY);
      return v === 'claude' || v === 'codex' || v === 'all' ? v : 'all';
    } catch (e) { return 'all'; }
  }
  function saveProvider(v) {
    try { localStorage.setItem(PROVIDER_KEY, v); } catch (e) { /* 저장 실패 무시 */ }
  }
  // 실제 요청에 쓰는 제공자: 토글이 숨겨진 경우(제공자 1개)는 항상 all
  function effProvider() { return state.providerMulti ? state.provider : 'all'; }

  // ---------- 공통 유틸 ----------
  function $(id) { return document.getElementById(id); }
  function isObj(v) { return v !== null && typeof v === 'object'; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 셀 키(data-cell)용: 따옴표 등 선택자를 깨는 문자 제거
  function kslug(v) { return String(v).replace(/[^\w-]/g, '_'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hourKey(d) { return dayKey(d) + 'T' + pad(d.getHours()); }
  function shortDate(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mdOf(key) { return parseInt(key.slice(5, 7), 10) + '/' + parseInt(key.slice(8, 10), 10); }
  // 10/8 18:05 형식 (초기화 / 관측 시각)
  function fmtMDHM(t) {
    if (!t) return '-';
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 타임스탬프: 숫자(ms) 또는 ISO 문자열 모두 허용
  function ts(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'string' && v) {
      var p = Date.parse(v);
      return isFinite(p) ? p : num(v);
    }
    return 0;
  }

  // 비용: 값이 실제로 있을 때만 숫자, 없으면 null (UI에서 숨김)
  function hasCost(v) { return v != null && v !== '' && isFinite(Number(v)); }
  function zeroTok() { return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, total: 0, cost: null, costUnknown: false }; }

  // 토큰 객체 정규화 ({input,output,cacheCreate,cacheRead,total,cost} / 숫자 / {tokens:{...}})
  function tok(x) {
    if (typeof x === 'number' || typeof x === 'string') {
      var t = zeroTok(); t.total = num(x); return t;
    }
    if (!isObj(x)) return zeroTok();
    if (x.input === undefined && x.total === undefined && isObj(x.tokens)) return tok(x.tokens);
    var input = num(x.input), output = num(x.output);
    var cacheCreate = num(x.cacheCreate != null ? x.cacheCreate : x.cache_creation_input_tokens);
    var cacheRead = num(x.cacheRead != null ? x.cacheRead : x.cache_read_input_tokens);
    var total = x.total != null ? num(x.total) : input + output + cacheCreate + cacheRead;
    return {
      input: input, output: output, cacheCreate: cacheCreate, cacheRead: cacheRead, total: total,
      cost: hasCost(x.cost) ? Number(x.cost) : null,
      costUnknown: !!x.costUnknown   // 단가 미설정(GPT 등) 사용분이 섞여 있음
    };
  }
  function addTok(a, b) {
    return {
      input: a.input + b.input,
      output: a.output + b.output,
      cacheCreate: a.cacheCreate + b.cacheCreate,
      cacheRead: a.cacheRead + b.cacheRead,
      total: a.total + b.total,
      cost: (a.cost == null && b.cost == null) ? null : num(a.cost) + num(b.cost),
      costUnknown: !!(a.costUnknown || b.costUnknown)
    };
  }
  // 값이 {total,...} / {tokens} / 숫자 중 무엇이든 대표 값을 돌려줌
  function valOf(e) {
    if (!isObj(e)) return e;
    if (e.total != null) return e.total;
    if (e.tokens != null) return e.tokens;
    return e;
  }
  function sumVals(o) {
    var s = 0;
    Object.keys(o).forEach(function (k) { s += num(o[k]); });
    return s;
  }
  // {opus,sonnet,...} 형태의 family 값만 추려 숫자로
  function famNums(o) {
    var p = {};
    FAMILIES.forEach(function (f) {
      var v = Number(o[f]);
      if (isFinite(v) && v > 0) p[f] = v;
    });
    return p;
  }

  // 모델 family (백엔드 lib/scanner.js familyOf와 동일한 규칙)
  function family(model) {
    var m = String(model || '').toLowerCase();
    if (m.indexOf('mythos') >= 0) return 'fable';
    if (m.indexOf('opus') >= 0) return 'opus';
    if (m.indexOf('sonnet') >= 0) return 'sonnet';
    if (m.indexOf('haiku') >= 0) return 'haiku';
    if (m.indexOf('fable') >= 0) return 'fable';
    if (m.indexOf('gpt') === 0 || m.indexOf('codex') === 0 || /^o[134]/.test(m) || m === 'unknown') {
      if (m.indexOf('astra') >= 0) return 'gpt-astra';
      if (m.indexOf('sol') >= 0) return 'gpt-sol';
      if (m.indexOf('terra') >= 0) return 'gpt-terra';
      if (m.indexOf('luna') >= 0) return 'gpt-luna';
      return 'gpt-other';
    }
    return 'other';
  }
  // 제공자 필터에 속한 family 목록 (Claude: Claude만, GPT: GPT만, 전체: 둘 다)
  function familiesFor(prov) {
    if (prov === 'claude') return CLAUDE_FAMILIES;
    if (prov === 'codex') return GPT_FAMILIES;
    return FAMILIES;
  }
  // {family: 토큰} -> 범례 HTML. 표시 범위 합계가 0인 family는 숨김
  function legendHTML(parts, prov) {
    return familiesFor(prov).filter(function (f) { return num(parts[f]) > 0; }).map(function (f) {
      return '<span><i style="background:' + FAMILY_COLOR[f] + '"></i>' + esc(FAMILY_LABEL[f]) + '</span>';
    }).join('');
  }
  // [{parts}] 항목들의 family별 합계
  function sumParts(items) {
    var p = {};
    items.forEach(function (it) {
      Object.keys(it.parts || {}).forEach(function (f) { p[f] = (p[f] || 0) + num(it.parts[f]); });
    });
    return p;
  }
  function modelColor(model) { return FAMILY_COLOR[family(model)]; }
  function shortModel(model) { return model ? String(model).replace(/^claude-/, '') : '-'; }
  function modelTag(model, dim) {
    if (!model) return '<span class="muted">-</span>';
    return '<span class="model"><i class="sw" style="background:' + modelColor(model) + (dim ? ';opacity:.55' : '') + '"></i>' +
      esc(shortModel(model)) + '</span>';
  }

  // byModel (객체 또는 배열) -> [{model, t}] 토큰 큰 순
  function modelList(bm) {
    var out = [];
    if (Array.isArray(bm)) {
      bm.forEach(function (e) {
        if (isObj(e)) out.push({ model: String(e.model || e.name || 'unknown'), t: tok(e.tokens != null ? e.tokens : e) });
      });
    } else if (isObj(bm)) {
      Object.keys(bm).forEach(function (k) { out.push({ model: k, t: tok(bm[k]) }); });
    }
    return out.filter(function (m) { return m.t.total > 0; })
      .sort(function (a, b) { return b.t.total - a.t.total; });
  }
  // byModel -> family별 합계
  function famParts(bm) {
    var p = {};
    modelList(bm).forEach(function (m) {
      var f = family(m.model);
      p[f] = (p[f] || 0) + m.t.total;
    });
    return p;
  }
  // 날짜/시간 키 기반 항목 -> [{key,total,byModel,cost}] 정렬
  function keyedEntries(src) {
    var out = [];
    if (Array.isArray(src)) {
      src.forEach(function (e) {
        if (!isObj(e)) return;
        var k = e.date || e.key || e.hour;
        if (k) out.push({ key: String(k), total: valOf(e), byModel: e.byModel, cost: e.cost });
      });
    } else if (isObj(src)) {
      Object.keys(src).forEach(function (k) {
        var e = src[k];
        out.push({ key: k, total: valOf(e), byModel: isObj(e) ? e.byModel : undefined, cost: isObj(e) ? e.cost : undefined });
      });
    }
    return out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  }

  // 표시 포맷
  function fmtNum(n) {
    n = num(n);
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function fmtExact(n) { return num(n).toLocaleString('ko-KR'); }
  // 추정 비용: 1000 이상은 정수($1,234), 미만은 소수 2자리
  function fmtCost(v) {
    if (!hasCost(v)) return '-';
    var n = Number(v);
    if (Math.abs(n) >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toFixed(2);
  }
  function costCell(v) {
    return hasCost(v) ? esc(fmtCost(v)) : '<span class="muted">-</span>';
  }
  // 단가 미설정 토큰(GPT 모델 등)이 있으면 그 사실을 함께 표시
  function costHTML(v, unk) {
    if (unk) {
      if (hasCost(v) && Number(v) > 0) {
        return '<span title="단가 미설정 모델 사용분은 제외">' + esc(fmtCost(v)) + ' <span class="cost-unk">+ 미설정</span></span>';
      }
      return '<span class="cost-unk" title="이 모델의 API 단가가 설정되지 않음 (config.json codexPricing)">단가 미설정</span>';
    }
    return costCell(v);
  }
  function costText(v, unk) {
    if (unk) return hasCost(v) && Number(v) > 0 ? fmtCost(v) + ' (GPT 일부 단가 미설정 제외)' : '단가 미설정';
    return hasCost(v) ? fmtCost(v) : '-';
  }
  function numHTML(n) {
    return '<span title="' + esc(fmtExact(n)) + ' 토큰">' + esc(fmtNum(n)) + '</span>';
  }
  // 1시간 미만은 "2분 13초", 그 이상은 "1시간 5분"
  function fmtDur(ms) {
    ms = num(ms);
    if (ms <= 0) return '0초';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + '초';
    var m = Math.floor(s / 60);
    if (m < 60) return m + '분 ' + (s % 60) + '초';
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return h + '시간' + (rm ? ' ' + rm + '분' : '');
    return Math.floor(h / 24) + '일 ' + (h % 24) + '시간';
  }
  function fmtRel(t) {
    if (!t) return '-';
    var d = Date.now() - t;
    if (d < 60000) return '방금 전';
    if (d < HOUR_MS) return Math.floor(d / 60000) + '분 전';
    if (d < DAY_MS) return Math.floor(d / HOUR_MS) + '시간 전';
    return Math.floor(d / DAY_MS) + '일 전';
  }
  function fmtTime(t) {
    if (!t) return '-';
    return new Date(t).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }
  function fmtClock(t) {
    return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  // 프롬프트의 <command-name> 같은 태그 제거 (표시용)
  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function basename(p) {
    var parts = String(p || '').split(/[\\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }
  function statusInfo(s) {
    if (s === 'busy') return { cls: 'busy', label: '작업 중' };
    if (s === 'idle') return { cls: 'idle', label: '대기' };
    return { cls: 'ended', label: '종료' };
  }
  function badge(st) {
    return '<span class="badge ' + st.cls + '"><i class="dot"></i>' + st.label + '</span>';
  }

  // ---------- 실시간 시간 표시 ----------
  // 실행 중이면 activeMs + min(now - lastTs, IDLE_GAP), 아니면 activeMs 그대로
  function liveAttrs(activeMs, lastTs, running) {
    return ' data-live-active="' + esc(num(activeMs)) + '" data-last-ts="' + esc(ts(lastTs)) + '"' +
      (running ? ' data-running="1"' : '');
  }
  function setText(el, t) {
    if (el.textContent !== t) el.textContent = t;
  }
  function tickActive(el, now) {
    var v = num(el.getAttribute('data-live-active'));
    if (el.getAttribute('data-running') === '1') {
      var last = num(el.getAttribute('data-last-ts'));
      if (last > 0) v += Math.min(Math.max(0, now - last), IDLE_GAP_MS);
    }
    setText(el, fmtDur(v));
  }
  function tickWall(el, now) {
    var start = num(el.getAttribute('data-live-wall'));
    if (start > 0 && now >= start) setText(el, fmtDur(now - start));
  }
  function tickLive() {
    var now = Date.now();
    document.querySelectorAll('[data-live-active]').forEach(function (el) { tickActive(el, now); });
    document.querySelectorAll('[data-live-wall]').forEach(function (el) { tickWall(el, now); });
    if (state.liveKpi) {
      var v = state.liveKpi.base;
      state.liveKpi.busy.forEach(function (last) {
        if (last > 0) v += Math.min(Math.max(0, now - last), IDLE_GAP_MS);
      });
      // 두 테마 모두 같은 값을 쓴다 (활동 기록 + 관제)
      document.querySelectorAll('[data-live-kpi]').forEach(function (kEl) { setText(kEl, fmtDur(v)); });
    }
  }
  function startTicker() {
    if (state.tickTimer) return;
    state.tickTimer = setInterval(tickLive, TICK_MS);
  }

  // ---------- 데이터 정규화 ----------
  function sessView(raw) {
    var s = isObj(raw) ? raw : {};
    var own = tok(s.tokens != null ? s.tokens : s.ownTokens);
    var agentTok = tok(s.agentTokens);
    var agentCount = s.agentCount != null ? num(s.agentCount) : (Array.isArray(s.agents) ? s.agents.length : 0);
    var sessTok = s.sessionTotal != null ? tok(s.sessionTotal) : null;
    var total = sessTok ? sessTok.total : own.total + agentTok.total;
    var cost = sessTok && sessTok.cost != null
      ? sessTok.cost
      : (own.cost != null && agentTok.cost != null ? own.cost + agentTok.cost : null);
    var model = s.primaryModel || s.model || (Array.isArray(s.models) && s.models[0]) || '';
    return {
      raw: s,
      id: String(s.id != null ? s.id : (s.sessionId != null ? s.sessionId : '')),
      title: String(s.title || s.customTitle || s.name || '(제목 없음)'),
      project: String(s.project || basename(s.cwd) || '-'),
      cwd: String(s.cwd || ''),
      model: String(model || ''),
      modelsAll: Array.isArray(s.modelsAll) ? s.modelsAll.map(String) : [],
      status: s.status === 'busy' || s.status === 'idle' ? s.status : 'ended',
      own: own.total,
      agentCount: agentCount,
      agentTokens: agentTok.total,
      total: total,
      cost: cost,
      costUnknown: !!(sessTok && sessTok.costUnknown),
      provider: s.provider === 'codex' ? 'codex' : 'claude',
      imported: !!s.imported,
      activeMs: num(s.activeMs),
      wallMs: num(s.wallMs),
      firstTs: ts(s.firstTs),
      startedAt: ts(s.startedAt),
      lastTs: ts(s.lastTs),
      lastPrompt: String(s.lastPrompt || '')
    };
  }
  function unwrap(d) {
    if (!isObj(d)) return {};
    if (isObj(d.session)) {
      return Object.assign({}, d.session, {
        agents: d.agents != null ? d.agents : d.session.agents,
        daily: d.daily != null ? d.daily : d.session.daily
      });
    }
    return d;
  }
  function agentsOf(id, raw) {
    var list = raw && Array.isArray(raw.agents) ? raw.agents : null;
    if (!list) {
      var d = state.details[id];
      list = d && Array.isArray(d.agents) ? d.agents : [];
    }
    return list.filter(isObj);
  }

  // ---------- API ----------
  function api(path) {
    return fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---------- 정렬 (모든 테이블 공통) ----------
  // get(row, key) -> 문자열 또는 숫자, tie(a,b) -> 동점 시 보조 정렬
  function sortRows(name, rows, get, tie) {
    var st = state.sorts[name];
    return rows.slice().sort(function (a, b) {
      var va = get(a, st.key), vb = get(b, st.key);
      var r = typeof va === 'string' ? va.localeCompare(String(vb), 'ko') : num(va) - num(vb);
      if (r !== 0) return r * st.dir;
      return tie ? tie(a, b) : 0;
    });
  }
  // 정렬 헤더: 화살표는 라벨 왼쪽
  function thSort(label, key, type, cls) {
    return '<th data-sort="' + key + '" data-type="' + type + '"' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<button type="button"><span class="arr"></span>' + esc(label) + '</button></th>';
  }
  // 정렬 표시: 라벨 왼쪽의 작은 SVG 쉐브론 (활성: 방향 표시, 비활성: 흐리게 위아래)
  var CHEV_UP = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 6.5 5 3.5 8 6.5"/></svg>';
  var CHEV_DOWN = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
  var CHEV_IDLE = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4 5 1.8 8 4M2 6 5 8.2 8 6"/></svg>';
  function updateSortHeaders() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      var table = th.closest('table');
      var name = table ? table.getAttribute('data-table') : '';
      var st = Object.prototype.hasOwnProperty.call(state.sorts, name) ? state.sorts[name] : null;
      var key = th.getAttribute('data-sort');
      var on = !!st && key === st.key;
      th.setAttribute('aria-sort', on ? (st.dir > 0 ? 'ascending' : 'descending') : 'none');
      var arr = th.querySelector('.arr');
      if (arr) arr.innerHTML = on ? (st.dir > 0 ? CHEV_UP : CHEV_DOWN) : CHEV_IDLE;
    });
  }

  // ---------- 렌더: 상태 배너 / KPI ----------
  function renderStatus() {
    var sum = state.summary || {};
    var b = $('banner');
    if (state.error) {
      b.hidden = false;
      b.className = 'banner error';
      b.textContent = state.error;
    } else if (sum.scanning) {
      var p = sum.progress || {};
      b.hidden = false;
      b.className = 'banner';
      b.textContent = '스캔 중 ' + num(p.done) + '/' + num(p.total) + ' — 완료되면 자동으로 갱신됩니다.';
    } else {
      b.hidden = true;
    }
    var gen = ts(sum.generatedAt);
    $('updated').innerHTML = gen ? '업데이트 <b>' + esc(fmtClock(gen)) + '</b>' : '';
  }

  // ---------- 렌더: 지금 블록 / 특보 ----------
  // 합계 행의 보조 줄: 추정 비용 (+ 단가 미설정 안내)
  function costLine(t) {
    if (!(hasCost(t.cost) || t.costUnknown)) return '';
    var partial = t.costUnknown && hasCost(t.cost) && t.cost > 0;
    var txt = t.costUnknown && !partial ? 'GPT 단가 미설정' : '≈ ' + fmtCost(t.cost);
    return '<div class="kv-c" title="' + esc(COST_NOTE) + '">' + esc(txt) + '</div>' +
      (partial ? '<div class="kv-n">(GPT 일부 단가 미설정 제외)</div>' : '');
  }
  function totRow(label, t) {
    return '<div class="kv-row"><div><div class="kv-l">' + esc(label) + '</div>' + costLine(t) + '</div>' +
      '<div class="kv-v" title="' + esc(fmtExact(t.total)) + ' 토큰">' + esc(fmtNum(t.total)) + '</div></div>';
  }
  function smallRow(label, valueHTML) {
    return '<div class="kv-row"><span class="kv-l">' + esc(label) + '</span><span class="kv-v">' + valueHTML + '</span></div>';
  }
  // 최근 60분 판독: summary.last60 (없으면 이번 시간으로 대체)
  function last60Of(sum, items) {
    var l = isObj(sum.last60) ? sum.last60 : null;
    if (l) return { total: num(l.total), parts: famNums(l.byFamily), cost: l.cost };
    var cur = items[items.length - 1] || { total: 0, parts: {} };
    return { total: cur.total, parts: cur.parts || {}, cost: null };
  }
  // 평소 기준: 48시간 창에서 0이 아닌 '지난' 시간들의 평균 (진행 중인 이번 시간 제외)
  function baselineAvg(items) {
    var s = 0, n = 0;
    items.slice(0, -1).forEach(function (it) { if (it.total > 0) { s += it.total; n++; } });
    return n ? s / n : 0;
  }
  // 지금 블록: 최근 60분 토큰(큰 수치), 평소 대비, 모델별 비율 막대, 요약 수치, 입력/출력/캐시 분해
  function renderNow(sum, items) {
    var totals = sum.totals || {};
    var today = sum.today || {};
    var liveList = (Array.isArray(sum.live) ? sum.live : []).filter(isObj).map(sessView);
    var busyN = liveList.filter(function (s) { return s.status === 'busy'; }).length;
    var idleN = liveList.length - busyN;
    state.liveKpi = {
      base: num(today.activeMs),
      busy: liveList.filter(function (s) { return s.status === 'busy'; }).map(function (s) { return s.lastTs; })
    };
    var l60 = last60Of(sum, items);
    var curT = l60.total;
    var reading = $('now-val');
    setText(reading, fmtNum(curT));
    reading.title = fmtExact(curT) + ' 토큰';
    $('now-caption').textContent = '최근 60분' + (curT > 0 ? '' : ' · 사용 없음');
    var avg = baselineAvg(items);
    var vs = $('now-vs');
    var ratio = avg > 0 ? curT / avg : null;
    vs.textContent = ratio == null ? '평소 기록 없음' : '평소의 ' + ratio.toFixed(1) + '배';
    vs.classList.toggle('hi', ratio != null && ratio > 2);
    vs.title = ratio == null ? '' : '최근 60분 ÷ 지난 48시간 중 사용이 있던 시간의 평균 (' + fmtNum(avg) + ')';
    var parts = l60.parts;
    $('now-bar').innerHTML = curT > 0
      ? FAMILIES.filter(function (f) { return num(parts[f]) > 0; }).map(function (f) {
        return '<i style="flex-grow:' + num(parts[f]) + ';background:' + FAMILY_COLOR[f] + '" data-tip="' +
          esc(FAMILY_LABEL[f] + ' ' + fmtNum(parts[f])) + '"></i>';
      }).join('')
      : '';
    $('now-facts').innerHTML =
      totRow('오늘', tok(today.tokens)) + totRow('7일', tok(sum.last7d)) + totRow('전체', tok(totals.tokens));
    $('now-facts2').innerHTML =
      smallRow('오늘 작업시간', '<span data-live-kpi>' + esc(fmtDur(today.activeMs)) + '</span>') +
      smallRow('세션 · 에이전트', esc(fmtExact(totals.sessions)) + ' · ' + esc(fmtExact(totals.agents)));
    var brows = [['오늘', tok(today.tokens)], ['7일', tok(sum.last7d)], ['전체', tok(totals.tokens)]];
    $('now-break').innerHTML = '<div class="table-wrap"><table class="mini"><thead><tr><th></th>' +
      '<th class="num">입력</th><th class="num">출력</th><th class="num">캐시 쓰기</th><th class="num">캐시 읽기</th>' +
      '</tr></thead><tbody>' +
      brows.map(function (r) {
        var t = r[1];
        return '<tr><th scope="row">' + r[0] + '</th>' + [t.input, t.output, t.cacheCreate, t.cacheRead].map(function (v) {
          return '<td class="num" title="' + esc(fmtExact(v)) + ' 토큰">' + esc(fmtNum(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  // 특보: 최근 60분 토큰이 48시간 중 0이 아닌 '지난' 시간 평균의 2배를 넘을 때만 표시 (이번 시간 안에서만 닫기)
  function renderAdvisory(items, sum) {
    var el = $('advisory');
    var curT = last60Of(sum, items).total;
    var avg = baselineAvg(items);
    var hot = curT > 0 && avg > 0 && curT > 2 * avg;
    var show = (hot && state.advDismissed !== hourKey(new Date())) || FORCE_ADVISORY;
    el.hidden = !show;
    if (!show) { el.setAttribute('data-txt', ''); return; }
    var txt = '특보 · 최근 60분 토큰 사용량이 평소의 ' + (avg > 0 ? (curT / avg).toFixed(1) + '배' : '— (평소 기록 없음)') + ' (' + fmtNum(curT) + ')';
    if (el.getAttribute('data-txt') === txt) return; // 같은 내용이면 버튼 포커스 유지를 위해 다시 쓰지 않음
    el.setAttribute('data-txt', txt);
    el.innerHTML = '<span>' + esc(txt) + '</span>' +
      '<button type="button" class="adv-close" data-adv-close>이번 시간 닫기</button>';
  }

  // 가격표 (summary.pricing.table): 값이 없으면 영역 숨김
  function renderPricing(sum) {
    var det = $('pricing');
    var p = isObj(sum.pricing) ? sum.pricing : null;
    var rows = p && Array.isArray(p.table) ? p.table.filter(isObj) : [];
    if (!rows.length) { det.hidden = true; return; }
    det.hidden = false;
    var priceCell = function (v) { return hasCost(v) ? esc('$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')) : '-'; };
    $('pricing-body').innerHTML = '<div class="price-sub">Claude</div>' +
      '<div class="table-wrap"><table class="mini"><thead><tr>' +
      '<th>모델 (부분 일치)</th><th class="num">입력 /1M</th><th class="num">출력 /1M</th><th class="num">캐시 읽기 /1M</th><th class="num">캐시 쓰기 5분 /1M</th><th class="num">캐시 쓰기 1시간 /1M</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.match || r.model || r.name || '-') + '</td>' +
          '<td class="num">' + priceCell(r.input) + '</td>' +
          '<td class="num">' + priceCell(r.output) + '</td>' +
          '<td class="num">' + priceCell(r.cacheRead) + '</td>' +
          '<td class="num">' + priceCell(r.cacheWrite5m) + '</td>' +
          '<td class="num">' + priceCell(r.cacheWrite1h) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' + (p.note ? '<p class="note">' + esc(p.note) + '</p>' : '') + renderCodexPricing(p);
  }
  function renderCodexPricing(p) {
    var cx = isObj(p.codex) ? p.codex : null;
    if (!cx || !Array.isArray(cx.table) || !cx.table.length) return '';
    var pc = function (v) { return hasCost(v) ? esc('$' + Number(v).toFixed(Number(v) < 1 ? 3 : 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')) : '-'; };
    return '<div class="price-sub">GPT (OpenAI)</div>' +
      '<div class="table-wrap"><table class="mini"><thead><tr>' +
      '<th>모델 (부분 일치)</th><th class="num">입력 /1M</th><th class="num">출력 /1M</th><th class="num">캐시 읽기 /1M</th><th class="num">캐시 쓰기 /1M</th>' +
      '</tr></thead><tbody>' +
      cx.table.map(function (r) {
        return '<tr><td>' + esc(r.match) + '</td><td class="num">' + pc(r.input) + '</td><td class="num">' + pc(r.output) +
          '</td><td class="num">' + pc(r.cacheRead) + '</td><td class="num">' + pc(r.cacheWrite) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="note">' + esc(cx.note || '') + '</p>' +
      '<p class="note">' + esc(cx.configNote || '') + '</p>';
  }

  // ---------- 렌더: GPT 사용 한도 (Codex rate_limits) ----------
  function winLabel(min) {
    min = num(min);
    if (min >= 10080) return '주간 한도';
    if (min >= 60) return Math.round(min / 60) + '시간 한도';
    return Math.round(min) + '분 한도';
  }
  function gaugeHTML(w) {
    if (!isObj(w)) return '';
    var p = Math.min(100, Math.max(0, num(w.used_percent)));
    var reset = num(w.resets_at) ? fmtMDHM(num(w.resets_at) * 1000) : '-';
    var label = winLabel(w.window_minutes);
    return '<div class="gl"><div class="gl-h"><span class="gl-l">' + esc(label) + '</span><b class="gl-p">' + esc(String(Math.round(p))) + '%</b></div>' +
      '<div class="bar' + (p >= 80 ? ' hi' : '') + '" role="meter" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(p) + '"><i style="width:' + p + '%"></i></div>' +
      '<div class="gl-r">초기화 ' + esc(reset) + '</div></div>';
  }
  function renderRate(sum) {
    var el = $('rate');
    var cx = isObj(sum.providers) && isObj(sum.providers.codex) ? sum.providers.codex : null;
    var rl = cx && isObj(cx.rateLimits) ? cx.rateLimits : null;
    var show = !!rl && effProvider() !== 'claude';
    el.hidden = !show;
    if (!show) return;
    $('plan').textContent = '요금제 ' + (rl.plan_type || '-');
    $('rate-body').innerHTML = gaugeHTML(rl.primary) + gaugeHTML(rl.secondary) +
      (rl.observedAt ? '<div class="gl-f">관측 ' + esc(fmtMDHM(ts(rl.observedAt))) + '</div>' : '');
  }
  function renderProvider() {
    var el = $('provider');
    el.hidden = !state.providerMulti;
    el.querySelectorAll('[data-provider]').forEach(function (b) {
      var on = b.getAttribute('data-provider') === state.provider;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------- 렌더: 작업 중 ----------
  function liveCost(s) {
    if (s.costUnknown) {
      return hasCost(s.cost) && Number(s.cost) > 0
        ? '≈ ' + esc(fmtCost(s.cost)) + ' <span class="cost-unk">+ 미설정</span>'
        : '<span class="cost-unk">단가 미설정</span>';
    }
    return hasCost(s.cost) ? '≈ ' + esc(fmtCost(s.cost)) : '';
  }
  var LIVE_CAP = 6; // 작업 중 목록: 실행 중 전부 + 대기는 합계 6행까지, 나머지는 펼치기
  // 실행 중 에이전트를 유형별로 묶어 "유형 ×N" 으로 요약 (많은 유형은 "유형 ×N · 유형 ×M")
  function groupAgents(agents) {
    var order = [], cnt = {};
    agents.forEach(function (a) {
      var t = String(a.agentType || 'agent');
      if (!cnt[t]) { cnt[t] = 0; order.push(t); }
      cnt[t]++;
    });
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    return order.map(function (t) { return t + ' ×' + cnt[t]; }).join(' · ');
  }
  function renderLive() {
    var sum = state.summary || {};
    var list = (Array.isArray(sum.live) ? sum.live : []).filter(isObj).map(sessView);
    var busyN = list.filter(function (s) { return s.status === 'busy'; }).length;
    $('lcount').innerHTML = '<span class="mint">작업 중 ' + busyN + '</span> · 대기 ' + (list.length - busyN);
    var el = $('live');
    var ae = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
    var focusId = ae ? ae.getAttribute('data-open') : null;
    var focusMore = !!(ae && ae.hasAttribute('data-live-more'));
    if (!list.length) {
      el.innerHTML = '<div class="empty">현재 작업 중인 세션이 없습니다.</div>';
      return;
    }
    var idleShown = Math.max(0, LIVE_CAP - busyN), idleSeen = 0, hidden = 0;
    var shown = list.filter(function (s) {
      if (s.status === 'busy' || state.liveMore) return true;
      idleSeen++;
      if (idleSeen <= idleShown) return true;
      hidden++;
      return false;
    });
    if (state.liveMore) hidden = list.length - busyN - idleShown;
    el.innerHTML = shown.map(function (s) {
      var busy = s.status === 'busy';
      var agents = busy
        ? (Array.isArray(s.raw.runningAgents) ? s.raw.runningAgents : agentsOf(s.id, s.raw).filter(function (a) { return !!a.running; })).filter(isObj)
        : [];
      var t0 = s.startedAt || s.firstTs;
      var elapsed = t0 ? Date.now() - t0 : s.wallMs;
      var names = groupAgents(agents);
      return '<div class="lr" role="button" data-open="' + esc(s.id) + '" tabindex="0">' +
        '<i class="dot ' + (busy ? 'busy' : 'idle') + '" aria-hidden="true"></i>' +
        '<div class="lt"><div class="lt-t" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
        '<div class="lt-s">' + esc(s.project) + ' · ' + esc(shortModel(s.model)) + ' <span class="sr-only">' + (busy ? '작업 중' : '대기') + '</span></div>' +
        (names ? '<div class="lt-a" title="' + esc(names) + '">' + esc(names) + '</div>' : '') + '</div>' +
        '<div class="lr-r"><div class="lr-e"' + (t0 ? ' data-live-wall="' + esc(t0) + '"' : '') + '>' + esc(fmtDur(elapsed)) + '</div>' +
        '<div class="lr-c" title="' + esc(COST_NOTE) + '">' + liveCost(s) + '</div></div></div>';
    }).join('') + (hidden > 0
      ? '<button type="button" class="lr-more" data-live-more aria-expanded="' + (state.liveMore ? 'true' : 'false') + '">' +
        '<svg class="disc lm-chev" width="8" height="10" viewBox="0 0 8 10" aria-hidden="true"><path d="M1.5 1 6.5 5 1.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        (state.liveMore ? '대기 접기' : '대기 ' + hidden + '개 더 보기') + '</button>'
      : '');
    if (focusId) {
      var again = el.querySelector('[data-open="' + String(focusId).replace(/"/g, '') + '"]');
      if (again) again.focus();
    } else if (focusMore) {
      var mb = el.querySelector('[data-live-more]');
      if (mb) mb.focus();
    }
  }

  // ---------- 차트 (SVG 직접 생성) ----------
  function widthOf(el) {
    var w = el ? Math.floor(el.clientWidth) : 0;
    return w >= 200 ? w : 640;
  }
  // 축 눈금: 최댓값이 플롯의 80% 이상을 채우도록 눈금 간격과 개수(4~6)를 계산한다.
  // 간격 후보: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^k
  var TICK_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  function niceScale(v) {
    if (!(v > 0)) return { max: 1, step: 0.25, n: 4 };
    var p0 = Math.floor(Math.log(v) / Math.LN10), best = null;
    for (var e = p0 - 1; e <= p0; e++) {
      for (var i = 0; i < TICK_STEPS.length; i++) {
        var st = TICK_STEPS[i] * Math.pow(10, e);
        var k = Math.ceil(v / st - 1e-9);
        if (k < 4 || k > 6) continue;
        var fill = v / (k * st);
        if (fill < 0.8) continue;
        if (!best || k < best.n || (k === best.n && fill > best.fill)) best = { max: k * st, step: st, n: k, fill: fill };
      }
    }
    if (best) return best;
    var m = Math.pow(10, p0 + 1);
    return { max: m, step: m / 4, n: 4 };
  }
  function tipParts(parts) {
    return FAMILIES.filter(function (f) { return parts[f] > 0; })
      .map(function (f) { return ' · ' + FAMILY_LABEL[f] + ' ' + fmtNum(parts[f]); }).join('');
  }
  // 항목 -> 차트용 {label,total,parts,tip}
  function toItem(e, label, key) {
    var parts = e ? famParts(e.byModel) : {};
    var total = e ? (e.total != null ? tok(e.total).total : sumVals(parts)) : 0;
    if (total > 0 && sumVals(parts) === 0) parts = { other: total };
    var tip = key + '  ' + fmtExact(total) + ' 토큰' + tipParts(parts);
    if (e && hasCost(e.cost)) tip += ' · 추정 ' + fmtCost(e.cost);
    return { label: label, total: total, parts: parts, tip: tip };
  }
  // o.fill: 컨테이너(position:relative)를 채우도록 SVG를 절대 배치 (레이아웃 피드백 방지)
  function stackedBars(items, o) {
    var W = o.width, H = o.height;
    var pl = 46, pr = 8, pt = 10, pb = 24;
    var iw = W - pl - pr, ih = H - pt - pb;
    var max = 0;
    items.forEach(function (it) { if (it.total > max) max = it.total; });
    var sc = niceScale(max), yMax = sc.max;
    var n = Math.max(1, items.length);
    var slot = iw / n;
    var bw = Math.max(1, slot * 0.72);
    var out = [];
    for (var g = 0; g <= sc.n; g++) {
      var gy = pt + ih - ih * g / sc.n;
      out.push('<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (pl - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' +
        esc(fmtNum(sc.step * g)) + '</text>');
    }
    items.forEach(function (it, i) {
      var x = pl + i * slot + (slot - bw) / 2;
      var base = pt + ih;
      if (it.total > 0) {
        FAMILIES.forEach(function (f) {
          var v = (it.parts && it.parts[f]) || 0;
          if (v <= 0) return;
          var h = ih * v / yMax;
          base -= h;
          out.push('<rect x="' + x.toFixed(1) + '" y="' + base.toFixed(1) + '" width="' + bw.toFixed(1) +
            '" height="' + Math.max(0.5, h).toFixed(1) + '" fill="' + FAMILY_COLOR[f] + '"/>');
        });
      }
      out.push('<rect class="hit" x="' + (pl + i * slot).toFixed(1) + '" y="' + pt + '" width="' +
        slot.toFixed(1) + '" height="' + ih + '" data-tip="' + esc(it.tip) + '"/>');
      var showLabel = o.labelEvery ? i % o.labelEvery === 0 : it.show !== false;
      if (showLabel) {
        out.push('<text class="axis" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) +
          '" text-anchor="middle">' + esc(it.label) + '</text>');
      }
    });
    if (max === 0) {
      out.push('<text class="axis" x="' + (W / 2) + '" y="' + (pt + ih / 2) + '" text-anchor="middle">기록 없음</text>');
    }
    var style = o.fill ? ' style="position:absolute;left:0;top:0;width:100%;height:100%"' : '';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"' + style +
      ' role="img" aria-label="' + esc(o.label) + '">' + out.join('') + '</svg>';
  }
  // rows: [{label, value, color, cost?}]
  function hbars(rows, width) {
    var sum = 0, max = 0;
    rows.forEach(function (r) { sum += r.value; if (r.value > max) max = r.value; });
    var anyCost = rows.some(function (r) { return hasCost(r.cost); });
    var labelW = Math.min(140, Math.floor(width * 0.38));
    var valW = anyCost ? 170 : 110;
    var barW = Math.max(40, width - labelW - valW);
    var rowH = 30;
    var H = rows.length * rowH + 4;
    var out = [];
    rows.forEach(function (r, i) {
      var cy = i * rowH + 16;
      var len = max > 0 ? Math.max(2, barW * r.value / max) : 0;
      var pct = sum > 0 ? Math.round(r.value / sum * 100) : 0;
      out.push('<text class="hl" x="0" y="' + (cy + 4) + '">' + esc(r.label) + '</text>');
      out.push('<rect class="track" x="' + labelW + '" y="' + (cy - 8) + '" width="' + barW + '" height="16" rx="2"/>');
      out.push('<rect x="' + labelW + '" y="' + (cy - 8) + '" width="' + len.toFixed(1) + '" height="16" rx="2" fill="' +
        r.color + '"><title>' + esc(r.label + ': ' + fmtExact(r.value) + ' 토큰') + '</title></rect>');
      out.push('<text class="hv" x="' + (labelW + barW + 8) + '" y="' + (cy + 4) + '">' +
        esc(fmtNum(r.value)) + ' · ' + pct + '%' + (r.unk && !(num(r.cost) > 0) ? ' · 단가 미설정' : hasCost(r.cost) ? ' · ' + esc(fmtCost(r.cost)) + (r.unk ? ' +' : '') : '') + '</text>');
    });
    return '<svg viewBox="0 0 ' + width + ' ' + H + '" width="' + width + '" height="' + H +
      '" role="img" aria-label="모델별 점유율">' + out.join('') + '</svg>';
  }

  function renderCharts() {
    var sum = state.summary || {};
    renderHeat(sum);
    renderHourly(sum);
    renderModelPanels(sum);
    watchChartSize();
  }
  // 차트 영역 폭이 바뀌면(창 크기 변경 등) 실제 크기로 다시 그려 SVG가 찌그러지지 않게 한다.
  var sizeObserver = null;
  function watchChartSize() {
    if (sizeObserver || typeof ResizeObserver === 'undefined') return;
    sizeObserver = new ResizeObserver(function () {
      var h = $('hourly-chart');
      if (h && (widthOf(h) !== h._drawnW || Math.max(120, Math.floor(h.clientHeight || 0)) !== h._drawnH)) renderHourly(state.summary || {});
    });
    if ($('hourly-chart')) sizeObserver.observe($('hourly-chart'));
  }

  // ---- 작업 리듬: 일별 막대 띠 + 24시간 x 날짜 히트맵 (같은 열 좌표계) ----
  // summary.heat: 최근 30일 [{date, hours[24], total}] 오래된 날 -> 최신 날. 없으면 빈 달력
  function heatDays(sum) {
    var src = Array.isArray(sum.heat) ? sum.heat.filter(isObj) : [];
    if (src.length) {
      return src.map(function (d) {
        var hrs = [];
        for (var h = 0; h < 24; h++) hrs.push(num(Array.isArray(d.hours) ? d.hours[h] : 0));
        return { date: String(d.date), hours: hrs };
      });
    }
    var out = [], now = new Date();
    for (var i = 29; i >= 0; i--) {
      var hz = [];
      for (var k = 0; k < 24; k++) hz.push(0);
      out.push({ date: dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)), hours: hz });
    }
    return out;
  }
  // 0이 아닌 칸들의 분위수(25/50/75/92%)로 1..5단계를 정한다. 0 = 사용 없음
  function heatCuts(days) {
    var nz = [];
    days.forEach(function (d) { d.hours.forEach(function (v) { if (v > 0) nz.push(v); }); });
    nz.sort(function (a, b) { return a - b; });
    function q(p) { return nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 0; }
    return [q(0.25), q(0.5), q(0.75), q(0.92)];
  }
  function heatLevel(v, cuts) {
    if (!(v > 0)) return 0;
    var l = 1;
    for (var i = 0; i < cuts.length; i++) if (v > cuts[i]) l = i + 2;
    return l;
  }
  function renderHeat(sum) {
    var all = heatDays(sum);
    var cuts = heatCuts(all);
    var narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches;
    var days = narrow ? all.slice(-14) : all;
    var n = days.length;
    var map = {};
    keyedEntries(sum.daily).forEach(function (e) { map[e.key] = e; });
    var items = days.map(function (d) { return toItem(map[d.date] || null, mdOf(d.date), d.date); });
    var maxD = 0;
    items.forEach(function (it) { if (it.total > maxD) maxD = it.total; });
    var strip = items.map(function (it) {
      var segs = FAMILIES.map(function (f) {
        var v = it.parts[f];
        return v > 0 ? '<i style="height:' + Math.max(1, v / maxD * 96).toFixed(2) + 'px;background:' + FAMILY_COLOR[f] + '"></i>' : '';
      }).join('');
      return '<div class="dcol" data-tip="' + esc(it.tip) + '"><div class="strip">' + segs + '</div></div>';
    }).join('');
    var dates = days.map(function (d, i) {
      return '<div class="dl">' + (i % 5 === 0 ? esc(mdOf(d.date)) : '') + '</div>';
    }).join('');
    var hourLabels = '';
    for (var hr = 0; hr < 24; hr++) hourLabels += '<span>' + (hr % 6 === 0 ? pad(hr) + '시' : '') + '</span>';
    var cells = days.map(function (d) {
      var m = mdOf(d.date), out = '';
      for (var k = 0; k < 24; k++) {
        var v = d.hours[k];
        out += '<i class="c l' + heatLevel(v, cuts) + '" data-tip="' + m + ' ' + k + '시 · ' + esc(fmtNum(v)) + ' 토큰"></i>';
      }
      return '<div class="hcol">' + out + '</div>';
    }).join('');
    var sums = [];
    for (var h2 = 0; h2 < 24; h2++) sums.push({ h: h2, v: 0 });
    all.forEach(function (d) { d.hours.forEach(function (v, h) { sums[h].v += v; }); });
    var busiest = sums.filter(function (x) { return x.v > 0; })
      .sort(function (a, b) { return b.v - a.v || a.h - b.h; }).slice(0, 3)
      .map(function (x) { return x.h + '시'; }).join(' · ');
    var heatEl = $('heat');
    var noHeat = !Array.isArray(sum.heat) || !sum.heat.length;
    if (noHeat) {
      // 서버가 옛 버전이라 30일 데이터(heat)를 보내지 않는 경우: 빈 판 대신 이유를 알려 준다
      var msgHtml = '<div class="empty heat-empty">활동 지도 데이터가 없습니다. 대시보드 서버가 이전 버전으로 실행 중입니다. 서버를 한 번 종료했다가 다시 실행해 주세요 (start.bat).</div>';
      if (heatEl._html !== msgHtml) { heatEl._html = msgHtml; heatEl.innerHTML = msgHtml; tip.hidden = true; }
      $('heat-h').textContent = '작업 리듬';
      var legEl0 = $('hleg'); if (legEl0._html !== '') { legEl0._html = ''; legEl0.innerHTML = ''; }
      return;
    }
    var html = '<div class="hg hg-s"><div></div>' + strip + '</div>' +
      '<div class="hg hg-d"><div></div>' + dates + '</div>' +
      '<div class="hg hg-h"><div class="hlab">' + hourLabels + '</div>' + cells + '</div>';
    if (heatEl._html !== html) {
      heatEl._html = html;
      heatEl.style.setProperty('--n', n);
      heatEl.innerHTML = html;
      tip.hidden = true;
    }
    $('heat-h').textContent = '작업 리듬 · 최근 ' + n + '일';
    var legHtml = '<div class="sc"><span>적음</span><span class="sws"><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i></span><span>많음</span></div>' +
      (busiest ? '<div class="ins">가장 많이 쓴 시간대: ' + esc(busiest) + '</div>' : '');
    var legEl = $('hleg');
    if (legEl._html !== legHtml) { legEl._html = legHtml; legEl.innerHTML = legHtml; }
  }

  // 48시간 항목 배열 (마지막 항목 = 현재 시각이 속한 시간). step: 시간 라벨 간격. 자정은 날짜로 표시
  function buildHourly(sum, step) {
    var hmap = {};
    keyedEntries(sum.hourly).forEach(function (e) { hmap[e.key] = e; });
    var hbf = isObj(sum.hourlyByFamily) ? sum.hourlyByFamily : null;
    var hcost = isObj(sum.hourlyCost) ? sum.hourlyCost : {};
    var items = [];
    var now = Date.now();
    for (var i = 47; i >= 0; i--) {
      var d = new Date(now - i * HOUR_MS);
      var k = hourKey(d);
      var h = d.getHours();
      var label = h === 0 ? shortDate(d) : pad(h) + '시';
      var it, cost = null;
      if (hbf && isObj(hbf[k])) {
        var parts = famNums(hbf[k]);
        var total = sumVals(parts);
        it = { label: label, total: total, parts: parts, tip: k.replace('T', ' ') + '시  ' + fmtExact(total) + ' 토큰' + tipParts(parts) };
        if (hasCost(hbf[k].cost)) cost = Number(hbf[k].cost);
      } else {
        it = toItem(hmap[k] || null, label, k);
      }
      if (cost == null && hasCost(hcost[k])) cost = Number(hcost[k]);
      if (cost != null) it.tip += ' · 추정 ' + fmtCost(cost);
      it.show = h === 0 || h % step === 0;
      items.push(it);
    }
    return items;
  }
  // 최근 48시간: hourlyByFamily가 있으면 family 색 스택, 자정 열에 날짜 라벨
  function renderHourly(sum) {
    var el = $('hourly-chart');
    var w = widthOf(el);
    var h = Math.max(120, Math.floor(el.clientHeight || 0));
    el._drawnW = w; el._drawnH = h;
    var items = buildHourly(sum, w < 560 ? 12 : 6);
    el.innerHTML = stackedBars(items, { width: w, height: h, label: '최근 48시간 시간별 토큰', fill: true });
    $('hourly-legend').innerHTML = legendHTML(sumParts(items), effProvider());
  }

  // ---- 모델별 점유율 / 모델별 추정 비용 (같은 상위 8개 + 기타) ----
  function pctText(sh) {
    return sh >= 1 ? Math.round(sh) + '%' : sh >= 0.1 ? sh.toFixed(1) + '%' : '<0.1%';
  }
  function renderModelPanels(sum) {
    var byModel = (sum.totals || {}).byModel;
    var rows = modelList(byModel).map(function (m) {
      return { label: shortModel(m.model), value: m.t.total, color: modelColor(m.model), cost: m.t.cost, unk: !!m.t.costUnknown, rest: false, unpriced: 0 };
    });
    var sumAll = 0;
    rows.forEach(function (r) { sumAll += r.value; });
    if (rows.length > 9) {
      var rest = rows.splice(8), agg = { label: '기타 ' + rest.length + '개', value: 0, color: FAMILY_COLOR.other, cost: null, unk: false, rest: true, unpriced: 0 };
      rest.forEach(function (r) {
        agg.value += r.value;
        if (hasCost(r.cost)) agg.cost = (agg.cost || 0) + Number(r.cost);
        if (r.unk) { agg.unk = true; agg.unpriced++; }
      });
      rows.push(agg);
    }
    var shareEl = $('model-share'), costEl = $('model-cost');
    if (!rows.length) {
      shareEl.innerHTML = costEl.innerHTML = '<div class="empty">모델 사용 기록이 없습니다.</div>';
      return;
    }
    var maxT = 0;
    rows.forEach(function (r) { if (r.value > maxT) maxT = r.value; });
    shareEl.innerHTML = rows.map(function (r) {
      return '<div class="mr mr-sh"><i class="fdot" style="background:' + r.color + '"></i>' +
        '<span class="mn" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<div class="track"><i style="width:' + (maxT > 0 ? r.value / maxT * 100 : 0).toFixed(2) + '%;background:' + r.color + '"></i></div>' +
        '<span class="mp">' + esc(pctText(sumAll > 0 ? r.value / sumAll * 100 : 0)) + '</span>' +
        '<span class="mt" title="' + esc(fmtExact(r.value)) + ' 토큰">' + esc(fmtNum(r.value)) + '</span></div>';
    }).join('');
    var byCost = rows.slice().sort(function (a, b) { return num(b.cost) - num(a.cost); });
    var maxC = 0;
    byCost.forEach(function (r) { if (num(r.cost) > maxC) maxC = num(r.cost); });
    costEl.innerHTML = byCost.map(function (r) {
      var unpriced = r.unk && !(num(r.cost) > 0);
      var sub = r.rest && r.unpriced ? '<small>단가 미설정 ' + r.unpriced + '개 포함</small>' : '';
      return '<div class="mr mr-co"><i class="fdot" style="background:' + r.color + '"></i>' +
        '<span class="mn" title="' + esc(r.label) + '">' + esc(r.label) + sub + '</span>' +
        '<div class="track"><i style="width:' + (maxC > 0 && !unpriced ? num(r.cost) / maxC * 100 : 0).toFixed(2) + '%;background:' + r.color + '"></i></div>' +
        '<span class="mv' + (unpriced ? ' unk' : '') + '">' + (unpriced ? '단가 미설정' : esc(fmtCost(r.cost))) + '</span></div>';
    }).join('');
  }

  // 드로어 모델 행: byModelTotal(없으면 byModel) 기준, 본인(byModel)·에이전트(byModelAgents) 분해
  function modelRows(d) {
    var hasTotal = isObj(d.byModelTotal);
    var list = modelList(hasTotal ? d.byModelTotal : d.byModel);
    var own = isObj(d.byModel) ? d.byModel : {};
    var agents = hasTotal && isObj(d.byModelAgents) ? d.byModelAgents : {};
    var sumT = list.reduce(function (a, m) { return a + m.t.total; }, 0);
    list.forEach(function (m) {
      m.own = own[m.model] != null ? tok(own[m.model]) : zeroTok();
      m.agent = agents[m.model] != null ? tok(agents[m.model]) : zeroTok();
      m.share = sumT > 0 ? m.t.total / sumT * 100 : 0;
    });
    return list;
  }

  // 세션 테이블 모델 셀: 주 모델 이름 + 나머지 모델은 family 색 점 (title에 모델명)
  function sessModelsHTML(s) {
    var extra = s.modelsAll.filter(function (m) { return m && m !== s.model; });
    var dots = extra.length
      ? '<span class="mdots" style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle">' +
        extra.map(function (m) {
          return '<i class="sw" title="' + esc(m) + '" style="background:' + modelColor(m) + '"></i>';
        }).join('') + '</span>'
      : '';
    return modelTag(s.model) + dots;
  }

  // ---------- 렌더: 세션 테이블 ----------
  function sessGet(s, key) {
    if (key === 'status') return { busy: 0, idle: 1, ended: 2 }[s.status];
    if (key === 'title' || key === 'project' || key === 'model') return String(s[key]).toLowerCase();
    if (key === 'cost') return hasCost(s.cost) ? Number(s.cost) : -1;
    return num(s[key]);
  }
  function sessRow(s, showBadge) {
    var busy = s.status === 'busy';
    var pb = showBadge
      ? '<span class="pbadge pb-' + s.provider + '">' + PROVIDER_LABEL[s.provider] + '</span>' +
        (s.imported ? '<span class="pbadge pb-imp" title="다른 도구에서 가져온 세션">가져옴</span>' : '')
      : '';
    return '<tr data-id="' + esc(s.id) + '" tabindex="0"' + (state.openId === s.id ? ' class="selected"' : '') + '>' +
      '<td>' + badge(statusInfo(s.status)) + '</td>' +
      '<td class="ttl" title="' + esc(s.title) + '"><div class="ttl-in"><span class="ttl-t">' + esc(s.title) + '</span>' + pb + '</div></td>' +
      '<td>' + esc(s.project) + '</td>' +
      '<td>' + sessModelsHTML(s) + '</td>' +
      '<td class="num">' + numHTML(s.own) + '</td>' +
      '<td class="num">' + esc(fmtExact(s.agentCount)) + '</td>' +
      '<td class="num">' + numHTML(s.agentTokens) + '</td>' +
      '<td class="num strong">' + numHTML(s.total) + '</td>' +
      '<td class="num c-cost">' + costHTML(s.cost, s.costUnknown) + '</td>' +
      '<td class="num"' + liveAttrs(s.activeMs, s.lastTs, busy) + '>' + esc(fmtDur(s.activeMs)) + '</td>' +
      '<td class="num"' + (busy && s.firstTs ? ' data-live-wall="' + esc(s.firstTs) + '"' : '') + '>' + esc(fmtDur(s.wallMs)) + '</td>' +
      '<td class="num" title="' + esc(fmtTime(s.lastTs)) + '">' + esc(fmtRel(s.lastTs)) + '</td>' +
      '</tr>';
  }
  function renderSessions() {
    var sum = state.summary || {};
    var all = (Array.isArray(sum.sessions) ? sum.sessions : []).filter(isObj).map(sessView);
    var now = Date.now();
    var startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    var todayMs = startToday.getTime();
    var q = state.query.trim().toLowerCase();
    var rows = all.filter(function (s) {
      if (state.filter === 'live' && s.status === 'ended') return false;
      if (state.filter === 'today' && !(s.lastTs >= todayMs)) return false;
      if (state.filter === 'week' && !(s.lastTs >= now - 7 * DAY_MS)) return false;
      if (q) {
        var hay = (s.title + ' ' + s.project + ' ' + s.cwd + ' ' + s.model).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    rows = sortRows('sess', rows, sessGet, function (a, b) { return b.lastTs - a.lastTs; });
    var showBadge = effProvider() === 'all' && state.providerMulti;
    // 비용 정보가 하나도 없으면(구버전 백엔드) 비용 열 숨김
    var anyCost = all.some(function (s) { return hasCost(s.cost); });
    var table = document.querySelector('table[data-table="sess"]');
    if (table) table.classList.toggle('no-cost', !anyCost);
    $('sess-count').textContent = rows.length + ' / ' + all.length + '개';
    $('sess-body').innerHTML = rows.length
      ? rows.map(function (s) { return sessRow(s, showBadge); }).join('')
      : '<tr><td colspan="12" class="empty">조건에 맞는 세션이 없습니다.</td></tr>';
    updateSortHeaders();
    updateFilterChips();
  }
  function updateFilterChips() {
    document.querySelectorAll('#filters [data-filter]').forEach(function (b) {
      var on = b.getAttribute('data-filter') === state.filter;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ---------- 드로어 (세션 상세) ----------
  function section(title, inner) {
    return '<section class="dsec"><h3>' + title + '</h3>' + inner + '</section>';
  }
  // cell: 패치 대상 키 (data-cell), extra: 추가 속성 문자열
  function kv(k, v, cell, extra) {
    return '<dt>' + esc(k) + '</dt><dd' + (cell ? ' data-cell="' + cell + '"' : '') + (extra || '') + '>' + esc(v) + '</dd>';
  }
  function tokenTableHTML(own, agentTok, grand) {
    var fields = ['input', 'output', 'cacheCreate', 'cacheRead', 'total'];
    function row(label, t, cls, rk) {
      return '<tr class="' + cls + '"><th scope="row">' + label + '</th>' +
        fields.map(function (f) {
          var v = t[f];
          return '<td class="num" data-cell="tok:' + rk + ':' + f + '" data-val="' + v + '" title="' + esc(fmtExact(v)) + '">' +
            esc(fmtNum(v)) + '</td>';
        }).join('') + '</tr>';
    }
    return '<div class="table-wrap"><table class="mini"><thead><tr><th></th>' +
      '<th class="num">입력</th><th class="num">출력</th><th class="num">캐시 쓰기</th><th class="num">캐시 읽기</th><th class="num">합계</th>' +
      '</tr></thead><tbody>' +
      row('본인', own, '', 'own') + row('에이전트', agentTok, '', 'agent') + row('합계', grand, 'strong', 'grand') +
      '</tbody></table></div>';
  }
  function modelGet(m, key) {
    if (key === 'model') return shortModel(m.model).toLowerCase();
    if (key === 'cost') return hasCost(m.cost) ? Number(m.cost) : -1;
    return num(m[key]); // own, agent, total, share
  }
  // 입력 행: modelRows() 결과 {model, t(합계), own, agent, share}
  function modelTableHTML(models) {
    var anyCost = models.some(function (m) { return hasCost(m.t.cost); });
    var rows = models.map(function (m) {
      return {
        model: m.model, k: kslug(m.model), own: m.own.total, agent: m.agent.total,
        total: m.t.total, cost: m.t.cost, unk: !!m.t.costUnknown, share: m.share
      };
    });
    rows = sortRows('models', rows, modelGet);
    return '<div class="table-wrap"><table class="mini" data-table="models"><thead><tr>' +
      thSort('모델', 'model', 'text') +
      thSort('본인', 'own', 'num', 'num') +
      thSort('에이전트', 'agent', 'num', 'num') +
      thSort('합계', 'total', 'num', 'num') +
      (anyCost ? thSort('추정 비용', 'cost', 'num', 'num') : '') +
      thSort('비중', 'share', 'num', 'num') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + modelTag(r.model) + '</td>' +
          '<td class="num" data-cell="mod:' + r.k + ':own" data-val="' + r.own + '">' + numHTML(r.own) + '</td>' +
          '<td class="num" data-cell="mod:' + r.k + ':agent" data-val="' + r.agent + '">' + numHTML(r.agent) + '</td>' +
          '<td class="num" data-cell="mod:' + r.k + ':total" data-val="' + r.total + '">' + numHTML(r.total) + '</td>' +
          (anyCost ? '<td class="num" data-cell="mod:' + r.k + ':cost"' +
            (hasCost(r.cost) ? ' data-val="' + r.cost + '"' : '') + '>' + costHTML(r.cost, r.unk) + '</td>' : '') +
          '<td class="num" data-cell="mod:' + r.k + ':share">' + r.share.toFixed(1) + '%</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }
  // 행 = {a: 에이전트 원본, k: 셀 키}
  function agentGet(r, key) {
    var a = r.a;
    if (key === 'agentType') return String(a.agentType || '').toLowerCase();
    if (key === 'description') return String(a.description || '').toLowerCase();
    if (key === 'model') return String(a.model || '').toLowerCase();
    var t = tok(a.tokens);
    if (key === 'tokens') return t.total;
    if (key === 'cost') return hasCost(t.cost) ? t.cost : -1;
    if (key === 'activeMs') return num(a.activeMs);
    if (key === 'firstTs') return ts(a.firstTs);
    if (key === 'running') return a.running ? 1 : 0;
    return 0;
  }
  function agentsTableHTML(rows, sessLast) {
    if (!rows.length) return '<div class="empty">에이전트 없음</div>';
    var anyCost = rows.some(function (r) { return hasCost(tok(r.a.tokens).cost); });
    var sorted = sortRows('agents', rows, agentGet);
    return '<div class="table-wrap"><table class="mini agents" data-table="agents"><thead><tr>' +
      thSort('유형', 'agentType', 'text') +
      thSort('설명', 'description', 'text') +
      thSort('모델', 'model', 'text') +
      thSort('토큰', 'tokens', 'num', 'num') +
      (anyCost ? thSort('추정 비용', 'cost', 'num', 'num') : '') +
      thSort('작업시간', 'activeMs', 'num', 'num') +
      thSort('시작', 'firstTs', 'num', 'num') +
      thSort('상태', 'running', 'num') +
      '</tr></thead><tbody>' +
      sorted.map(function (r) {
        var a = r.a, k = r.k;
        var t = tok(a.tokens);
        var running = !!a.running;
        var last = ts(a.lastTs) || sessLast;
        return '<tr><td>' + esc(a.agentType || '-') + (a.workflowPhase ? ' <span class="muted small">' + esc(a.workflowPhase) + '</span>' : '') + '</td>' +
          '<td class="desc" title="' + esc(a.description || '') + '">' + esc(a.description || '-') + '</td>' +
          '<td>' + modelTag(a.model) + '</td>' +
          '<td class="num" data-cell="agent:' + k + ':tokens" data-val="' + t.total + '">' + numHTML(t.total) + '</td>' +
          (anyCost ? '<td class="num" data-cell="agent:' + k + ':cost"' +
            (hasCost(t.cost) ? ' data-val="' + t.cost + '"' : '') + '>' + costHTML(t.cost, t.costUnknown) + '</td>' : '') +
          '<td class="num" data-cell="agent:' + k + ':active"' + liveAttrs(a.activeMs, last, running) + '>' +
            esc(fmtDur(a.activeMs)) + '</td>' +
          '<td class="num">' + esc(fmtTime(ts(a.firstTs))) + '</td>' +
          '<td data-cell="agent:' + k + ':status">' +
            (running ? badge({ cls: 'busy', label: '작업 중' }) : '<span class="muted">완료</span>') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }
  function drawDrawerCharts(body, models, daily) {
    var hb = body.querySelector('[data-hbars]');
    if (hb) {
      hb.innerHTML = hbars(models.map(function (m) {
        return { label: shortModel(m.model), value: m.t.total, color: modelColor(m.model), cost: m.t.cost };
      }), widthOf(hb));
    }
    var db = body.querySelector('[data-daily]');
    if (db) {
      var dbf = isObj(state.drawer && state.drawer.dailyByFamily) ? state.drawer.dailyByFamily : null;
      var dcost = isObj(state.drawer && state.drawer.dailyCost) ? state.drawer.dailyCost : {};
      var items = daily.slice(-30).map(function (e) {
        var label = e.key.slice(5).replace('-', '/');
        if (dbf && isObj(dbf[e.key])) {
          var parts = famNums(dbf[e.key]);
          var total = sumVals(parts);
          var it = { label: label, total: total, parts: parts, tip: e.key + '  ' + fmtExact(total) + ' 토큰' + tipParts(parts) };
          if (hasCost(dcost[e.key])) it.tip += ' · 추정 ' + fmtCost(dcost[e.key]);
          return it;
        }
        return toItem(e, label, e.key);
      });
      db.innerHTML = stackedBars(items, { width: widthOf(db), height: 170, labelEvery: 5, label: '세션 일별 토큰' });
      var dl = body.querySelector('[data-dlegend]');
      if (dl) dl.innerHTML = legendHTML(sumParts(items), effProvider());
    }
  }

  // 셀 패치: 값만 교체하고, 증가했으면 짧게 강조. 실행 중 시간 셀은 틱이 텍스트를 담당
  function flash(el) {
    el.classList.remove('flash');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('flash');
    clearTimeout(el._flashT);
    el._flashT = setTimeout(function () { el.classList.remove('flash'); }, 600);
  }
  function syncAttrs(el, src) {
    Array.prototype.slice.call(el.attributes).forEach(function (a) {
      if (!src.hasAttribute(a.name)) el.removeAttribute(a.name);
    });
    Array.prototype.slice.call(src.attributes).forEach(function (a) {
      if (el.getAttribute(a.name) !== a.value) el.setAttribute(a.name, a.value);
    });
  }
  function patchCell(el, src) {
    var oldV = el.getAttribute('data-val'), newV = src.getAttribute('data-val');
    var increased = oldV !== null && newV !== null && num(newV) > num(oldV);
    var live = src.hasAttribute('data-live-active') || src.hasAttribute('data-live-wall');
    syncAttrs(el, src);
    if (live) {
      var now = Date.now();
      if (el.hasAttribute('data-live-active')) tickActive(el, now);
      else tickWall(el, now);
    } else if (el.innerHTML !== src.innerHTML) {
      el.innerHTML = src.innerHTML;
    }
    if (increased) flash(el);
  }
  function sortSig(name) {
    return name + ':' + state.sorts[name].key + ':' + state.sorts[name].dir;
  }

  function renderDrawer() {
    var body = $('drawer-body');
    var d = state.drawer;
    if (!d) return;
    var sc = body.scrollTop;
    var s = sessView(d);
    $('drawer-title').textContent = s.title;

    var own = tok(d.tokens != null ? d.tokens : d.ownTokens);
    var agentRows = agentsOf(s.id, d).slice()
      .sort(function (a, b) { return ts(a.firstTs) - ts(b.firstTs); })
      .map(function (a, i) {
        var id = a.id != null ? a.id : (a.agentId != null ? a.agentId : i);
        return { a: a, k: kslug(id) + '_' + i };
      });
    var agentTok = agentRows.reduce(function (acc, r) { return addTok(acc, tok(r.a.tokens)); }, zeroTok());
    var grand = addTok(own, agentTok);
    if (d.sessionTotal != null) {
      var st = tok(d.sessionTotal);
      grand.total = st.total;
      if (st.cost != null) grand.cost = st.cost;
      grand.costUnknown = !!st.costUnknown;
    }
    var models = modelRows(d);
    var daily = keyedEntries(d.daily);
    var busy = s.status === 'busy';

    var html = '';
    html += '<div class="drawer-top">' + badge(statusInfo(s.status)) +
      '<span class="muted small">' + esc(s.project) + '</span>' +
      ((hasCost(grand.cost) || grand.costUnknown)
        ? '<span class="chip-s" data-cell="chip:cost" data-val="' + grand.cost + '" title="' + esc(COST_NOTE) + '">세션 추정 비용 <b>' + (grand.costUnknown ? esc(costText(grand.cost, true)) : '≈ ' + esc(fmtCost(grand.cost))) + '</b></span>'
        : '') +
      '</div>';
    html += '<p class="path" title="' + esc(s.cwd) + '">' + esc(s.cwd || '-') + '</p>';
    html += section('토큰 사용량', tokenTableHTML(own, agentTok, grand));
    html += section('모델별 토큰', models.length
      ? '<div class="chart" data-hbars data-cell="hbars"></div>' + modelTableHTML(models)
      : '<div class="empty">기록 없음</div>');
    html += section('타임라인', '<dl class="kv">' +
      kv('시작', fmtTime(ts(d.firstTs))) +
      kv('마지막 활동', fmtTime(ts(d.lastTs))) +
      kv('경과 시간', fmtDur(d.wallMs), 'kv:wall',
        busy && ts(d.firstTs) ? ' data-live-wall="' + esc(ts(d.firstTs)) + '"' : '') +
      kv('작업 시간', fmtDur(d.activeMs), 'kv:active', liveAttrs(d.activeMs, d.lastTs, busy)) +
      ((hasCost(grand.cost) || grand.costUnknown) ? kv('추정 비용 (정가 기준)', costText(grand.cost, grand.costUnknown), 'kv:cost', hasCost(grand.cost) ? ' data-val="' + grand.cost + '"' : '') : '') +
      kv('API 호출', fmtExact(d.apiCalls)) +
      kv('프롬프트 수', fmtExact(d.prompts)) +
      kv('주 모델', shortModel(s.model)) +
      kv('버전', d.version || '-') +
      '</dl>');
    html += section('마지막 프롬프트', s.lastPrompt
      ? '<blockquote class="prompt">' + esc(clip(stripTags(s.lastPrompt), 300)) + '</blockquote>'
      : '<div class="empty">없음</div>');
    html += section('일별 토큰 (최근 30일)', daily.length
      ? '<div class="legend dlegend" data-dlegend></div><div class="chart" data-daily data-cell="daily"></div>' : '<div class="empty">기록 없음</div>');
    html += section('에이전트 (' + agentRows.length + ')', agentsTableHTML(agentRows, ts(d.lastTs)));

    // 구조(셀 키 순서 + 정렬 상태)가 같으면 셀만 패치, 다르면 전체 교체
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var srcCells = Array.prototype.slice.call(tmp.querySelectorAll('[data-cell]'));
    var keys = srcCells.map(function (c) { return c.getAttribute('data-cell'); });
    var sig = keys.join('|') + '#' + sortSig('models') + '#' + sortSig('agents');
    var canPatch = body.getAttribute('data-sig') === sig && body.childNodes.length > 0;
    var liveCells = Object.create(null);
    if (canPatch) {
      Array.prototype.forEach.call(body.querySelectorAll('[data-cell]'), function (c) {
        liveCells[c.getAttribute('data-cell')] = c;
      });
      canPatch = keys.every(function (k) { return !!liveCells[k]; });
    }
    if (canPatch) {
      srcCells.forEach(function (src) {
        var k = src.getAttribute('data-cell');
        if (k === 'hbars' || k === 'daily') return; // 차트는 아래에서 다시 그림
        patchCell(liveCells[k], src);
      });
    } else {
      body.innerHTML = html;
      body.setAttribute('data-sig', sig);
    }
    drawDrawerCharts(body, models, daily);
    updateSortHeaders();
    body.scrollTop = sc;
  }
  function loadDrawer(id) {
    var body = $('drawer-body');
    return api('/api/session/' + encodeURIComponent(id)).then(function (d) {
      if (state.openId !== id) return;
      state.drawer = unwrap(d);
      state.details[id] = state.drawer;
      renderDrawer();
    }).catch(function (e) {
      if (state.openId !== id) return;
      if (state.drawer) return; // 이전 내용 유지
      body.removeAttribute('data-sig');
      body.innerHTML = '<p class="error-text">세션 정보를 불러오지 못했습니다. (' + esc(e && e.message) + ')</p>';
    });
  }
  // 드로어가 열려 있는 동안 세션 상세를 2초마다 갱신
  function startDrawerPoll() {
    if (state.drawerTimer) return;
    state.drawerTimer = setInterval(function () {
      if (!state.openId || state.drawerBusy) return;
      state.drawerBusy = true;
      loadDrawer(state.openId).then(function () { state.drawerBusy = false; });
    }, DRAWER_MS);
  }
  function stopDrawerPoll() {
    clearInterval(state.drawerTimer);
    state.drawerTimer = null;
    state.drawerBusy = false;
  }
  function openDrawer(id) {
    if (!id) return;
    state.openId = id;
    state.drawer = null;
    var dr = $('drawer');
    dr.classList.add('open');
    dr.setAttribute('aria-hidden', 'false');
    $('overlay').hidden = false;
    var body = $('drawer-body');
    body.removeAttribute('data-sig');
    body.innerHTML = '<p class="muted">불러오는 중…</p>';
    body.scrollTop = 0;
    renderSessions();
    loadDrawer(id);
    startDrawerPoll();
  }
  function closeDrawer() {
    state.openId = null;
    state.drawer = null;
    stopDrawerPoll();
    var dr = $('drawer');
    dr.classList.remove('open');
    dr.setAttribute('aria-hidden', 'true');
    $('overlay').hidden = true;
    renderSessions();
  }

  // ---------- 갱신 루프 ----------
  // 실행 중 세션의 에이전트 목록이 summary에 없으면 상세를 가져온다
  function fetchLiveDetails(sum) {
    var live = (Array.isArray(sum.live) ? sum.live : []).filter(isObj).slice(0, 12);
    var keep = {};
    var jobs = live.map(function (s) {
      var id = String(s.id != null ? s.id : (s.sessionId || ''));
      if (!id) return Promise.resolve();
      keep[id] = true;
      if (Array.isArray(s.agents) || Array.isArray(s.runningAgents)) return Promise.resolve();
      return api('/api/session/' + encodeURIComponent(id)).then(function (d) {
        state.details[id] = unwrap(d);
      }, function () { /* 상세 조회 실패는 무시 (이전 값 유지) */ });
    });
    Object.keys(state.details).forEach(function (k) {
      if (!keep[k] && k !== state.openId) delete state.details[k];
    });
    return Promise.all(jobs);
  }
  function renderAll() {
    renderProvider();
    renderStatus();
    var hourly = buildHourly(state.summary || {}, 6);
    renderNow(state.summary || {}, hourly);
    renderAdvisory(hourly, state.summary || {});
    renderRate(state.summary || {});
    renderLive();
    renderCharts();
    renderSessions();
    renderPricing(state.summary || {});
    renderSkin();
    tickLive();
  }
  function scheduleNext() {
    clearTimeout(state.timer);
    state.timer = setTimeout(refresh, REFRESH_MS);
  }
  function refresh() {
    if (state.inFlight) { state.again = true; return; }
    state.inFlight = true;
    clearTimeout(state.timer);
    var prov = effProvider();
    api('/api/summary?provider=' + encodeURIComponent(prov))
      .then(function (sum) {
        if (effProvider() !== prov) { state.again = true; return; } // 제공자가 바뀜: 이 응답은 버리고 다시 요청
        state.summary = isObj(sum) ? sum : {};
        var prv = isObj(state.summary.providers) ? state.summary.providers : {};
        var multi = Object.keys(prv).length > 1;
        if (multi !== state.providerMulti) { state.providerMulti = multi; state.again = true; }
        state.error = '';
        return fetchLiveDetails(state.summary);
      })
      .then(function () {
        renderAll(); // 드로어는 DRAWER_MS 주기로 따로 갱신
      })
      .catch(function (err) {
        state.error = '데이터를 불러오지 못했습니다. 다음 주기에 다시 시도합니다. (' + (err && err.message ? err.message : 'error') + ')';
        renderStatus();
      })
      .then(function () {
        state.inFlight = false;
        if (state.again) { state.again = false; refresh(); }
        else scheduleNext();
      });
  }

  // ---------- 툴팁 ----------
  var tip = $('tip');
  document.addEventListener('mouseover', function (e) {
    var el = e.target;
    var t = el && el.closest ? el.closest('[data-tip]') : null;
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.hidden = false;
    placeTip(e);
  });
  document.addEventListener('mousemove', placeTip);
  function placeTip(e) {
    if (tip.hidden) return;
    var x = e.clientX + 14, y = e.clientY + 14;
    var r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }

  // ---------- 이벤트 바인딩 ----------
  $('provider').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-provider]') : null;
    if (!b) return;
    var v = b.getAttribute('data-provider');
    if (v === state.provider) return;
    state.provider = v;
    saveProvider(v);
    renderProvider();
    refresh();
  });
  $('q').addEventListener('input', function (e) {
    state.query = e.target.value;
    renderSessions();
  });
  $('filters').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-filter]') : null;
    if (!b) return;
    state.filter = b.getAttribute('data-filter');
    renderSessions();
  });
  // 모든 정렬 가능한 테이블 공통 핸들러 (th[data-sort] + table[data-table])
  document.addEventListener('click', function (e) {
    var th = e.target.closest ? e.target.closest('th[data-sort]') : null;
    if (!th) return;
    var table = th.closest('table');
    var name = table ? table.getAttribute('data-table') : '';
    if (!Object.prototype.hasOwnProperty.call(state.sorts, name)) return;
    var key = th.getAttribute('data-sort');
    var st = state.sorts[name];
    if (st.key === key) {
      st.dir = -st.dir;
    } else {
      st.key = key;
      st.dir = (th.getAttribute('data-type') === 'text' || key === 'status' || key === 'running') ? 1 : -1;
    }
    if (name === 'sess') renderSessions();
    else renderDrawer();
  });
  $('sess-body').addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
    if (tr) openDrawer(tr.getAttribute('data-id'));
  });
  $('live').addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-live-more]')) { state.liveMore = !state.liveMore; renderLive(); return; }
    var card = e.target.closest ? e.target.closest('[data-open]') : null;
    if (card) openDrawer(card.getAttribute('data-open'));
  });
  function keyOpen(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest ? e.target.closest('[data-id], [data-open]') : null;
    if (!el || el.tagName === 'INPUT') return;
    e.preventDefault();
    openDrawer(el.getAttribute('data-id') || el.getAttribute('data-open'));
  }
  $('sess-body').addEventListener('keydown', keyOpen);
  $('live').addEventListener('keydown', keyOpen);
  $('advisory').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-adv-close]') : null;
    if (!b) return;
    state.advDismissed = hourKey(new Date());
    $('advisory').hidden = true;
  });
  $('drawer-close').addEventListener('click', closeDrawer);
  $('overlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.openId) closeDrawer();
  });
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (state.summary) renderCharts();
      if (state.drawer) renderDrawer();
    }, 150);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  // ---------- 테마 (스킨) ----------
  // data-skin="activity|control" on <html>. 선택 순서: ?skin= > localStorage['cud.skin'] > activity.
  // 같은 데이터·갱신 루프를 쓰고, 관제 화면은 skins/control.js 가 registerSkin 으로 붙는다.
  var SKIN_KEY = 'cud.skin';
  var skins = {};   // name -> { activate(), deactivate(), render(summary) }
  function validSkin(v) { return v === 'activity' || v === 'control'; }
  function initialSkin() {
    var q = QS.get('skin');
    if (validSkin(q)) return q;
    try { var v = localStorage.getItem(SKIN_KEY); if (validSkin(v)) return v; } catch (e) { /* 저장소 없음 */ }
    return 'activity';
  }
  state.skin = initialSkin();
  document.documentElement.setAttribute('data-skin', state.skin);
  function renderSkinPicker() {
    document.querySelectorAll('#skinpick [data-skin]').forEach(function (b) {
      var on = b.getAttribute('data-skin') === state.skin;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
  }
  function renderSkin() {
    var sk = skins[state.skin];
    if (sk && state.summary) sk.render(state.summary);
  }
  function setSkin(name, save) {
    if (!validSkin(name) || name === state.skin) { renderSkinPicker(); return; }
    var prev = skins[state.skin];
    if (prev) prev.deactivate();
    state.skin = name;
    document.documentElement.setAttribute('data-skin', name);
    if (save) { try { localStorage.setItem(SKIN_KEY, name); } catch (e) { /* 저장 실패 무시 */ } }
    renderSkinPicker();
    tip.hidden = true;
    var next = skins[name];
    if (next) next.activate();
    if (state.summary) { renderCharts(); renderSkin(); tickLive(); }
  }
  $('skinpick').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-skin]') : null;
    if (b) setSkin(b.getAttribute('data-skin'), true);
  });
  $('skinpick').addEventListener('keydown', function (e) {
    var order = ['activity', 'control'];
    var i = order.indexOf(state.skin), n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + order.length - 1) % order.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = order.length - 1;
    else return;
    e.preventDefault();
    setSkin(order[n], true);
    var nb = document.querySelector('#skinpick [data-skin="' + order[n] + '"]');
    if (nb) nb.focus();
  });
  renderSkinPicker();

  // 스킨 모듈이 쓰는 공통 코어 (상태 · 포맷 · 정규화 · 드로어). 화면 구조는 각 스킨이 소유한다.
  window.CUD = {
    registerSkin: function (name, impl) {
      skins[name] = impl;
      if (state.skin === name) {
        impl.activate();
        if (state.summary) { renderCharts(); renderSkin(); tickLive(); }
      }
    },
    state: state,
    effProvider: effProvider,
    openDrawer: openDrawer,
    util: {
      FAMILIES: FAMILIES, FAMILY_LABEL: FAMILY_LABEL, FAMILY_COLOR: FAMILY_COLOR,
      isObj: isObj, num: num, esc: esc, ts: ts, tok: tok, hasCost: hasCost, family: family, familiesFor: familiesFor,
      shortModel: shortModel, fmtNum: fmtNum, fmtExact: fmtExact, fmtCost: fmtCost, fmtDur: fmtDur, fmtRel: fmtRel,
      fmtMDHM: fmtMDHM, fmtClock: fmtClock, hourKey: hourKey, sessView: sessView,
      buildHourly: buildHourly, last60Of: last60Of, baselineAvg: baselineAvg
    }
  };

  // DEMO 배지: /api/meta 가 demo:true 일 때만 상단바에 표시
  api('/api/meta')
    .then(function (m) {
      if (!m || !m.demo) return;
      var top = document.querySelector('.top-actions');
      if (!top) return;
      var b = document.createElement('span');
      b.className = 'demo-badge';
      b.textContent = 'DEMO · 개인정보 가림';
      top.insertBefore(b, top.firstChild);
    })
    .catch(function () { /* 메타 조회 실패 시 배지만 생략 */ });

  startTicker();
  refresh();
})();
