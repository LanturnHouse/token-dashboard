/* 관제 (control) skin. Registers with the shared core in app.js (window.CUD): same fetch, 5 s refresh,
   1 s ticker, provider filter and drawer. This file owns only the 관제 layout:
   header numerals, 지금 panel, ACTIVE SESSIONS strip, ONE selected session card + LAST 60 MIN metrics,
   ONE path diagram (SVG overlay from getBoundingClientRect), 압축 기록, 재읽기 vs 신규, 노력 수준 분포.
   The 48h chart, 작업 리듬, model share/cost, GPT limits, session table and price table are the 활동 기록
   panels themselves, moved into this layout while the skin is active (and moved back afterwards).
   Refresh = patch in place (morph) so animations, selection, focus, hover and scroll survive. */
(function () {
  'use strict';
  var CUD = window.CUD;
  if (!CUD || !CUD.registerSkin) return;
  var U = CUD.util;
  var esc = U.esc, num = U.num, isObj = U.isObj, tok = U.tok, hasCost = U.hasCost;
  var fmtNum = U.fmtNum, fmtExact = U.fmtExact, fmtCost = U.fmtCost, fmtDur = U.fmtDur;
  var FC = U.FAMILY_COLOR, FL = U.FAMILY_LABEL;

  var ACCRGB = '191,242,58', AMB = '#f6a53a', NET = '#4a4f50';
  var LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  var SEL_KEY = 'cud.sel';
  var STRIP_ROWS = 2;      // collapsed strip: as many chips as fit in 2 rows at the current width (+N)
  var TCAP = 999, MAXD = 8;  // path: effectively no cap (every running agent gets a node), generous nesting depth
  var PATH_ROWS = 4;          // path: per group, top-level nodes beyond 4 wrapped rows fold into a `+N 더 보기` node
  var SKILL_ACTIVE_S = 180;  // a skill counts as "in use" for 3 min after its invocation (logs keep only that time)
  var DONE_MS = 600000;    // ended agents stay visible (gray) for 10 min
  var SPEED = 150;         // px/s of the traveling circles
  var RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function $(id) { return document.getElementById(id); }
  function famColor(m) { return FC[U.family(m)] || '#888888'; }
  function fmtK(v) { v = num(v); return v >= 1e6 ? (v / 1e6).toFixed(2).replace(/0$/, '') + 'M' : Math.round(v / 1e3) + 'K'; }
  function tickL(v) { return v >= 1e6 ? +(v / 1e6).toFixed(2) + 'M' : Math.round(v / 1e3) + 'K'; }
  function pc1(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + '%' : '0%'; }
  function relShort(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)); if (s < 60) return s + 's';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  }
  function shortType(t) { return String(t || 'agent').replace(/-(subagent|purpose)$/, '').toUpperCase().slice(0, 12); }
  function cardTitle(t) { var m = /^세션\s*(\d+)$/.exec(t); return m ? 'SESSION ' + m[1] : t; }
  function costTxt(cost, unk) {
    if (unk && !(num(cost) > 0)) return '단가 미설정';
    return hasCost(cost) ? '≈ ' + fmtCost(cost) : '-';
  }
  function startOf(s) { return s.startedAt || s.firstTs || 0; }

  // ---------- morph: patch an element's children to match an HTML string, keeping existing nodes ----------
  function morph(el, html) {
    if (el._h === html) return false;
    el._h = html;
    var t = document.createElement('template');
    t.innerHTML = html;
    patchKids(el, t.content);
    return true;
  }
  function patchKids(a, b) {
    var an = Array.prototype.slice.call(a.childNodes), bn = Array.prototype.slice.call(b.childNodes);
    if (an.length !== bn.length) {
      while (a.firstChild) a.removeChild(a.firstChild);
      bn.forEach(function (n) { a.appendChild(n); });
      return;
    }
    for (var i = 0; i < an.length; i++) {
      var x = an[i], y = bn[i];
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); continue; }
      if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      if (x.nodeType !== 1) continue;
      var xa = Array.prototype.slice.call(x.attributes);
      xa.forEach(function (at) { if (!y.hasAttribute(at.name)) x.removeAttribute(at.name); });
      Array.prototype.slice.call(y.attributes).forEach(function (at) { if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value); });
      patchKids(x, y);
    }
  }

  // ---------- shell ----------
  var SHELL =
    '<div class="c-range"><i aria-hidden="true"></i><span>LAST 30 DAYS</span></div>' +
    '<section class="hdr">' +
    '<div><h2 class="c-h1">관제</h2><div class="mono sub">LIVE SESSIONS → SELECTED SESSION · PATH · AGENTS · SKILLS · OBSERVED</div></div>' +
    '<div class="panel nowp" id="c-now"></div>' +
    '<div class="cmp30" id="c-cmp30"></div>' +
    '</section>' +
    '<section class="panel hero" id="c-hero" aria-label="작업 중인 세션과 경로">' +
    '<div class="hh" id="c-hh"></div>' +
    '<div class="c-strip" id="c-strip" role="tablist" aria-label="작업 중인 세션"></div>' +
    '<div class="c-sel" id="c-sel" role="tabpanel"><div class="detail" id="c-detail"></div><div class="pathw" id="c-pathw"></div></div>' +
    '<div class="ctxcap" id="c-hb"><span><i class="gy"></i>회색 선 = 연결 · <i class="gl"></i>빛나는 선 = 지금 사용 중</span>' +
    '<span>선택한 세션 1개만 표시 · 스킬은 사용 중(호출 후 3분 이내)일 때만 · 스킬/하위 에이전트는 호출한 에이전트 아래에 연결</span></div>' +
    '<svg id="c-ov" aria-hidden="true"></svg>' +
    '</section>' +
    '<section class="row r1"><div class="panel pcol" id="c-clog"></div></section>' +
    '<section class="row r3"><div class="panel pcol" id="c-reread"></div><div class="panel pcol" id="c-effort"></div><div class="slot" data-slot="rate"></div></section>' +
    '<section class="row r2"><div class="slot" data-slot="hourly"></div><div class="slot" data-slot="heat"></div></section>' +
    '<section class="row r2b"><div class="slot" data-slot="share"></div><div class="slot" data-slot="cost"></div></section>' +
    '<div class="slot solo" data-slot="sessions"></div>' +
    '<div class="slot solo" data-slot="pricing"></div>';

  // 활동 기록 panels reused as-is (their renderers in app.js keep drawing into the same ids)
  function sec(id) { var e = $(id); return e ? e.closest('section, details') : null; }
  var SLOTS = [
    ['rate', function () { return $('rate'); }],
    ['hourly', function () { return sec('hourly-chart'); }],
    ['heat', function () { return sec('heat'); }],
    ['share', function () { return sec('model-share'); }],
    ['cost', function () { return sec('model-cost'); }],
    ['sessions', function () { return sec('sess-body'); }],
    ['pricing', function () { return $('pricing'); }]
  ];
  var moved = [];

  var host = null, built = false, on = false, ro = null;
  var cs = {
    M: null, selId: null, shownSel: null, painted: false, restored: false,
    pathKey: '', ovSig: '', raf: 0, fadeT: 0, fading: false, expanded: false, cols: 0, pcols: {}, pexp: {}, pmap: {}
  };

  function build() {
    host = $('skin-control');
    if (!host) {
      host = document.createElement('div');
      host.id = 'skin-control';
      var adv = $('advisory');
      adv.parentNode.insertBefore(host, adv.nextSibling);
    }
    host.innerHTML = SHELL;
    var strip = $('c-strip');
    strip.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.sc') : null;
      if (b) select(b.getAttribute('data-sid'), false);
    });
    strip.addEventListener('keydown', function (e) {
      var M = cs.M; if (!M || !M.liveChips.length) return;
      var n = M.liveChips.length, i = Math.max(0, indexAll(M, cs.selId)), k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown') i = (i + 1) % n;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') i = (i - 1 + n) % n;
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = n - 1;
      else return;
      e.preventDefault();
      if (indexOf(M, M.liveChips[i].s.id) < 0) cs.expanded = true;
      select(M.liveChips[i].s.id, true);
    });
    $('c-pathw').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pmore]') : null;
      if (!b || !cs.M || !cs.selId) return;
      var g = b.getAttribute('data-pmore'), k = cs.selId + '|' + g;
      cs.pexp[k] = !cs.pexp[k];   // page-session only
      patchSel(cs.M);
      var nb = $('c-pathw').querySelector('[data-pmore="' + g + '"]');
      if (nb) nb.focus();
      sched();
    });
    $('c-hh').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-more-toggle]') : null;
      if (!b || !cs.M) return;
      cs.expanded = !cs.expanded;   // page-session only (never stored)
      renderHero(cs.M);
      sched();
    });
    if (window.ResizeObserver) { ro = new ResizeObserver(sched); ro.observe($('c-hero')); }
    window.addEventListener('resize', sched);
    if (RM.addEventListener) RM.addEventListener('change', function () { cs.ovSig = ''; sched(); });
    else if (RM.addListener) RM.addListener(function () { cs.ovSig = ''; sched(); });
    built = true;
  }

  function movePanels() {
    moved = [];
    SLOTS.forEach(function (sl) {
      var el = sl[1](), slot = host.querySelector('[data-slot="' + sl[0] + '"]');
      if (!el || !slot) return;
      var ph = document.createComment('cud-slot:' + sl[0]);
      el.parentNode.insertBefore(ph, el);
      slot.appendChild(el);
      moved.push([el, ph]);
    });
  }
  function restorePanels() {
    moved.forEach(function (m) {
      if (m[1].parentNode) { m[1].parentNode.insertBefore(m[0], m[1]); m[1].parentNode.removeChild(m[1]); }
    });
    moved = [];
  }
  function brandTag(add) {
    var br = document.querySelector('.topbar .brand');
    var t = br && br.querySelector('.brand-tag');
    if (add && br && !t) {
      t = document.createElement('span');
      t.className = 'brand-tag';
      t.setAttribute('aria-hidden', 'true');
      t.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><rect x="0" y="3" width="2" height="7" fill="currentColor"/><rect x="4" y="0" width="2" height="10" fill="currentColor"/><rect x="8" y="4" width="2" height="6" fill="currentColor"/></svg>DASHBOARD';
      br.insertBefore(t, br.firstChild);
    } else if (!add && t) t.parentNode.removeChild(t);
  }

  function activate() {
    if (!built) build();
    on = true;
    movePanels();
    brandTag(true);
    cs.ovSig = '';
    sched();
  }
  function deactivate() {
    on = false;
    clearTimeout(cs.fadeT); cs.fading = false;
    if ($('c-hero')) $('c-hero').classList.remove('fade');
    restorePanels();
    brandTag(false);
    var ov = $('c-ov');
    if (ov) { ov.innerHTML = ''; }   // stop the SMIL work while hidden
    cs.ovSig = '';
  }

  // ---------- model ----------
  function model(sum) {
    var now = Date.now();
    var C = isObj(sum.ctx) ? sum.ctx : {}, CS = isObj(C.sessions) ? C.sessions : {};
    var prov = CUD.effProvider();
    var live = (Array.isArray(sum.live) ? sum.live : []).filter(isObj).map(U.sessView);
    var inProv = function (s) { return prov === 'all' || s.provider === prov; };
    var liveP = live.filter(function (s) { return inProv(s) && isObj(CS[s.id]); });
    // strip = every LIVE session: running first (by start time, so chips do not hop between refreshes),
    // then waiting ones by most recent activity. Max 8 chips; the selected session always keeps its chip.
    var runL = liveP.filter(function (s) { return s.status === 'busy'; }).sort(function (a, b) { return startOf(a) - startOf(b) || (a.id < b.id ? -1 : 1); });
    var waitL = liveP.filter(function (s) { return s.status !== 'busy'; }).sort(function (a, b) { return b.lastTs - a.lastTs || (a.id < b.id ? -1 : 1); });
    var ordered = runL.concat(waitL), shown = ordered;
    var LN = {}, RUN = {};
    shown.forEach(function (s) { LN[s.id] = []; RUN[s.id] = s.status === 'busy'; });
    var an = Array.isArray(sum.agentsNow) ? sum.agentsNow.filter(isObj) : [];
    an.slice().sort(function (a, b) { return num(a.firstTs || a.lastTs) - num(b.firstTs || b.lastTs); }).forEach(function (a) {
      if (LN[a.session] && RUN[a.session]) LN[a.session].push({ id: String(a.agentId), kind: 'agent', ended: false, parent: a.parentAgentId || null, type: a.agentType || 'agent', desc: a.description, model: a.model, effort: a.effort, tokens: num(a.tokens), since: num(a.firstTs || a.lastTs) || now });
    });
    (Array.isArray(sum.agentsDone) ? sum.agentsDone.filter(isObj) : []).filter(function (a) { return now - num(a.endedTs) <= DONE_MS; }).forEach(function (a) {
      if (LN[a.session]) LN[a.session].push({ id: String(a.agentId), kind: 'agent', ended: true, parent: a.parentAgentId || null, type: a.agentType || 'agent', desc: a.description, model: a.model, effort: a.effort, tokens: num(a.tokens), since: num(a.endedTs) });
    });
    (Array.isArray(sum.skillsNow) ? sum.skillsNow.filter(isObj) : []).filter(function (k) { return num(k.ageSec) <= SKILL_ACTIVE_S; }).forEach(function (k) {
      if (LN[k.session] && RUN[k.session]) LN[k.session].push({ id: 'sk:' + (k.agentId || 'main') + ':' + k.skill, kind: 'skill', ended: false, parent: k.where === 'agent' && k.agentId ? String(k.agentId) : null, where: k.where, skill: String(k.skill || 'skill'), count: num(k.count), ageSec: num(k.ageSec) });
    });
    var chips = shown.map(function (s) {
      var c = CS[s.id], mdl = c.lastModel || '', raw = String(c.lastEffort || '').toLowerCase(), lvl = LEVELS.indexOf(raw);
      var tl = buildTree(LN[s.id]);
      var fresh = !(num(c.turns) > 0) && !(num(c.current) > 0) && !(Array.isArray(c.series) && c.series.length);
      return { s: s, c: c, mdl: mdl, lvl: lvl, eff: raw || 'n/a', tl: tl, nRun: tl.nRun, run: s.status === 'busy', fresh: fresh };
    });
    // default: most recently active RUNNING session, else the most recently active waiting one
    var defId = null, best = -1;
    chips.forEach(function (x) { var k = (x.run ? 1e15 : 0) + num(x.s.lastTs); if (k > best) { best = k; defId = x.s.id; } });
    var nRunL = runL.length, nWaitL = waitL.length;

    var items = U.buildHourly(sum, 6), l60 = U.last60Of(sum, items), avg = U.baselineAvg(items);
    var hc = isObj(sum.hourlyCost) ? sum.hourlyCost : {}, curH = U.hourKey(new Date());
    var hcs = Object.keys(hc).filter(function (k) { return k !== curH && num(hc[k]) > 0; }).map(function (k) { return num(hc[k]); });
    var usualCost = hcs.length ? hcs.reduce(function (a, b) { return a + b; }, 0) / hcs.length : 0;
    var totals = isObj(sum.totals) ? sum.totals : {}, today = isObj(sum.today) ? sum.today : {};
    var busyN = live.filter(function (s) { return s.status === 'busy'; }).length;
    return {
      now: now, prov: prov, C: C, liveChips: chips, chips: chips, defId: defId, moreN: 0, nRunL: nRunL, nWaitL: nWaitL,
      l60: l60, avg: avg, usualCost: usualCost, ratio: avg > 0 ? l60.total / avg : null,
      today: tok(today.tokens), d7: tok(sum.last7d), all: tok(totals.tokens), todayActiveMs: num(today.activeMs),
      busyN: busyN, idleN: live.length - busyN, sessions: num(totals.sessions), agents: num(totals.agents),
      routes: isObj(sum.routes) ? sum.routes : {}
    };
  }
  function indexOf(M, id) { for (var i = 0; i < M.chips.length; i++) if (M.chips[i].s.id === id) return i; return -1; }
  function indexAll(M, id) { for (var i = 0; i < M.liveChips.length; i++) if (M.liveChips[i].s.id === id) return i; return -1; }
  // strip chips on screen: all when expanded (or <= 8), else the first 8 with the selected one swapped into view
  function visibleChips(M, selId, cap) {
    if (cs.expanded || M.liveChips.length <= cap) return M.liveChips.slice();
    var v = M.liveChips.slice(0, cap), si = indexAll(M, selId);
    if (si >= cap) v[cap - 1] = M.liveChips[si];   // the selected chip is never hidden
    return v;
  }
  // columns of the strip grid at the current width (auto-fill keeps empty tracks, so this works before chips exist)
  function stripCols(strip) {
    var t = getComputedStyle(strip).gridTemplateColumns || '';
    var n = (t.match(/[\d.]+px/g) || []).length;
    if (n) return n;
    var w = strip.clientWidth || 0;
    return Math.max(1, Math.floor((w + 8) / 270));
  }

  // visible tree of one session: no practical cap on top-level nodes (the backend already limits ended agents)
  function buildTree(N) {
    N = N || [];
    var byId = {};
    N.forEach(function (n, i) { byId[n.id] = n; n.ord = i; });
    N.forEach(function (n) { n.pn = n.parent && byId[n.parent] && byId[n.parent] !== n ? byId[n.parent] : null; n.kid = []; });
    N.forEach(function (n) { if (n.pn) n.pn.kid.push(n); });
    function active(n, d) { return !n.ended || (d < 6 && n.kid.some(function (c) { return active(c, d + 1); })); }
    function rootOf(n) { var p = n, g = 0; while (p.pn && g++ < 9) p = p.pn; return p; }
    var roots = N.filter(function (n) { return !n.pn; });
    roots.forEach(function (n) { n.rank = n.kind === 'skill' ? 1 : (active(n, 0) ? 0 : 2); });
    var sorted = roots.slice().sort(function (a, b) { return a.rank - b.rank || a.ord - b.ord; });
    var skR = sorted.filter(function (n) { return n.kind === 'skill'; }), agR = sorted.filter(function (n) { return n.kind === 'agent'; });
    // agents first, but up to 2 top-level slots stay reserved for the main session's active skills
    var agKeep = agR.slice(0, TCAP - Math.min(2, skR.length)), keepRoots = agKeep.concat(skR.slice(0, TCAP - agKeep.length)), ks = {};
    function mark(n, d) { if (d > MAXD || ks[n.id]) return; ks[n.id] = 1; n.kid.forEach(function (c) { mark(c, d + 1); }); }
    keepRoots.forEach(function (n) { mark(n, 1); });
    var hid = { A: 0, S: 0 };
    N.forEach(function (n) { if (!ks[n.id]) hid[rootOf(n).kind === 'skill' ? 'S' : 'A']++; });
    function kidsOf(n) { return n.kid.filter(function (c) { return ks[c.id]; }).sort(function (a, b) { return (a.kind === 'skill') - (b.kind === 'skill') || a.ord - b.ord; }); }
    function byOrd(a, b) { return a.ord - b.ord; }
    var key = [];
    function walk(n, d) { key.push(d + n.kind[0] + (n.ended ? 'e' : 'r') + n.id); kidsOf(n).forEach(function (c) { walk(c, d + 1); }); }
    var rA = keepRoots.filter(function (n) { return n.kind === 'agent'; }).sort(function (a, b) { return a.rank - b.rank || a.ord - b.ord; }), rS = keepRoots.filter(function (n) { return n.kind === 'skill'; }).sort(byOrd);
    rA.concat(rS).forEach(function (n) { walk(n, 0); });
    return {
      rootsA: rA, rootsS: rS, kidsOf: kidsOf, hidA: hid.A, hidS: hid.S, total: N.length,
      nRun: N.filter(function (n) { return n.kind === 'agent' && !n.ended; }).length,
      nSkMain: roots.filter(function (n) { return n.kind === 'skill'; }).length,
      key: key.join(',') + '|+' + hid.A + '/' + hid.S
    };
  }

  // ---------- header + 지금 ----------
  function cmpHTML(M) {
    var L = isObj(M.C.last30d) ? M.C.last30d : {};
    return '<div class="l">COMPACTIONS 30D</div><div class="cbig">' + esc(num(L.compactCount)) + '</div>' +
      '<div class="r">(auto ' + esc(num(L.auto)) + ' · manual ' + esc(num(L.manual)) + ')</div>';
  }
  function vline(t) {
    if (t.costUnknown && !(num(t.cost) > 0)) return '<small>GPT 단가 미설정</small>';
    return hasCost(t.cost) ? '<small>≈ ' + esc(fmtCost(t.cost)) + '</small>' : '';
  }
  function nowHTML(M) {
    var p = M.l60.parts, fams = U.familiesFor(M.prov).filter(function (f) { return num(p[f]) > 0; });
    var tot = fams.reduce(function (a, f) { return a + num(p[f]); }, 0) || 1;
    var bar = fams.map(function (f) { return '<span style="flex:' + (num(p[f]) / tot).toFixed(4) + ';background:' + FC[f] + '" title="' + esc(FL[f] + ' ' + fmtNum(p[f])) + '"></span>'; }).join('');
    var lgd = fams.map(function (f) { return '<span><i style="background:' + FC[f] + '"></i>' + esc(FL[f]) + '</span>'; }).join('');
    var ratio = M.ratio == null ? '<div class="nratio none">평소 기록 없음</div>' : '<div class="nratio" title="최근 60분 ÷ 지난 48시간 중 사용이 있던 시간의 평균 (' + esc(fmtNum(M.avg)) + ')">평소의 ' + M.ratio.toFixed(1) + '배</div>';
    var partial = M.all.costUnknown && num(M.all.cost) > 0;
    return '<div><div class="head" style="gap:16px"><span class="title">지금</span><span class="mono">LAST 60 MIN</span></div>' +
      '<div class="bign" title="' + esc(fmtExact(M.l60.total)) + ' 토큰">' + esc(fmtNum(M.l60.total)) + '</div>' + ratio +
      '<div class="sbar" aria-hidden="true">' + bar + '</div><div class="lgs">' + lgd + '</div></div>' +
      '<div><div class="nrow"><span class="k">오늘</span><span class="v">' + esc(fmtNum(M.today.total)) + vline(M.today) + '</span></div>' +
      '<div class="nrow"><span class="k">7일</span><span class="v">' + esc(fmtNum(M.d7.total)) + vline(M.d7) + '</span></div>' +
      '<div class="nrow"><span class="k">전체</span><span class="v">' + esc(fmtNum(M.all.total)) + vline(M.all) + '</span></div>' +
      (partial ? '<div class="nnote">(GPT 일부 단가 미설정 제외)</div>' : '') + '</div>' +
      '<div><div class="nrow"><span class="k">작업 중 · 대기</span><span class="v"><span class="lv">' + M.busyN + '</span> · ' + M.idleN + '</span></div>' +
      '<div class="nrow"><span class="k">오늘 작업시간</span><span class="v" data-live-kpi>' + esc(fmtDur(M.todayActiveMs)) + '</span></div>' +
      '<div class="nrow"><span class="k">전체 세션 · 에이전트</span><span class="v">' + esc(fmtExact(M.sessions)) + ' · ' + esc(fmtExact(M.agents)) + '</span></div></div>';
  }

  // ---------- strip ----------
  function stripHTML(M, selId) {
    var nv = M.chips.length;
    return M.chips.concat(M.hiddenChips || []).map(function (x, i) {
      var s = x.s, on = s.id === selId, t0 = startOf(s), hid = i >= nv;
      var when = x.run
        ? '<span class="cel"' + (t0 ? ' data-live-wall="' + t0 + '"' : '') + '>' + esc(fmtDur(t0 ? M.now - t0 : s.wallMs)) + '</span>'
        : '<span class="cel" title="마지막 활동">' + esc(U.fmtRel(s.lastTs)) + '</span>';
      var mline = x.fresh ? '<span class="cm2 first">첫 호출 대기</span>'
        : '<span class="cm2"><i class="mdot" style="background:' + famColor(x.mdl) + '"></i>' + esc(U.shortModel(x.mdl)) + ' · ' + esc(x.eff) + '</span>';
      return '<button type="button" class="sc' + (on ? ' on' : '') + (x.run ? '' : ' wait') + '"' + (hid ? ' hidden' : '') + ' role="tab" id="c-tab' + i + '" data-sid="' + esc(s.id) + '" aria-controls="c-sel" aria-selected="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '"' +
        ' title="' + esc(s.title + ' · ' + s.project + ' · ' + (x.run ? '작업 중' : '대기') + (x.fresh ? ' · 첫 호출 대기' : ' · ' + U.shortModel(x.mdl) + ' · effort ' + x.eff + ' · ctx ' + fmtExact(x.c.current))) + '">' +
        '<span class="c1"><i class="dot ' + (x.run ? 'run' : 'hol') + '"></i><span class="cn">' + esc(s.title) + '</span><span class="cpj">' + esc(s.project) + '</span>' +
        (x.run ? '' : '<span class="wtag">대기</span>') + when + '</span>' +
        '<span class="c2">' + mline +
        '<span>ctx <b>' + esc(fmtK(x.c.current)) + '</b></span><span class="cag' + (x.nRun ? ' on' : '') + '">AGENTS <b>' + x.nRun + '</b></span></span></button>';
    }).join('');
  }

  // ---------- selected session: card + metric panel ----------
  function cardHTML(x, M) {
    var s = x.s, c = x.c, mdl = x.mdl, mn = U.shortModel(mdl);
    var isCodex = c.provider === 'codex' && num(c.windowTokens) > 0;
    var scale = isCodex ? num(c.windowTokens) : 1000000;
    var cur = num(c.current), f = Math.max(0, Math.min(1, cur / scale)), lvl = x.lvl;
    var ticks = [0, 1, 2, 3, 4].map(function (k) { return '<span style="top:' + (k * 25) + '%">' + (k === 4 ? '0' : tickL(scale * (4 - k) / 4)) + '</span>'; }).join('');
    var auto = num(c.lastAutoPre) > 0 ? '<div class="gauto" style="bottom:' + (Math.min(1, num(c.lastAutoPre) / scale) * 100).toFixed(2) + '%" title="관측된 자동 압축 지점 ' + esc(fmtExact(c.lastAutoPre)) + ' 토큰"></div>' : '';
    var ser = Array.isArray(c.series) ? c.series.map(num) : [], n = ser.length;
    var tsl = (Array.isArray(c.seriesTs) ? c.seriesTs : []).map(function (t) { return U.ts(t); });
    var gap = n > 1 && tsl.length === n ? (tsl[n - 1] - tsl[0]) / (n - 1) : 0;
    var xOf = function (i) { return 79 - (n - 1 - i); }, yOf = function (v) { return 38 - 36 * Math.min(1, v / scale); };
    var sw = '';
    if (n > 1 && tsl.length === n) (Array.isArray(c.compactions) ? c.compactions : []).forEach(function (cp) {
      var t = U.ts(cp.ts); if (t < tsl[0] - gap || t > tsl[n - 1] + gap) return;
      var bi = 0, bd = Infinity; tsl.forEach(function (xx, i) { var dd = Math.abs(xx - t); if (dd < bd) { bd = dd; bi = i; } });
      sw += '<line x1="' + xOf(bi) + '" x2="' + xOf(bi) + '" y1="0" y2="40" stroke="' + AMB + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
    });
    if (n > 1) sw += '<polyline points="' + ser.map(function (v, i) { return xOf(i) + ',' + yOf(v).toFixed(1); }).join(' ') + '" fill="none" stroke="#bff23a" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    if (!x.run && n > 1) sw = sw.replace('stroke="#bff23a"', 'stroke="#bff23a" stroke-opacity=".55"');
    var tip = s.title + ' · ' + s.project + ' · ' + (x.run ? '작업 중' : '대기') + '\n현재 컨텍스트 ' + fmtExact(cur) + ' 토큰 / 눈금 ' + fmtExact(scale) + (isCodex ? ' (윈도우)' : ' (표시 눈금)');
    var t0 = startOf(s), fp = (f * 100).toFixed(2);
    var effTxt = x.fresh ? 'N/A' : (lvl >= 0 ? LEVELS[lvl] : (c.lastEffort ? String(c.lastEffort) : 'N/A'));
    var effDim = x.fresh || (lvl < 0 && !c.lastEffort);
    // a session with no API call yet: empty gauge (no lime line at 0), calm hint instead of numbers
    var gaugeIn = x.fresh
      ? '<div class="ghint">아직 호출 기록 없음</div>'
      : '<div class="gclip"><div class="gfill" style="height:' + fp + '%"></div></div>' +
        '<div class="gcap" style="bottom:' + fp + '%"><i class="gnode"></i></div>' +
        '<div class="gval" style="' + (f > .88 ? 'top:' + (100 - f * 100 + 3).toFixed(1) + '%' : 'bottom:calc(' + fp + '% + 5px)') + '">' + esc(fmtK(cur)) + '</div>' + auto;
    return '<div class="scol"><article class="scard' + (x.run ? '' : ' wait') + (x.fresh ? ' fresh' : '') + '" data-sid="' + esc(s.id) + '" title="' + esc(tip) + '">' +
      '<div class="sc-h"><span class="sc-t">' + esc(cardTitle(s.title)) + '</span>' + (isCodex ? '<span class="win">WINDOW ' + esc(fmtK(scale)) + '</span>' : '') +
      (x.run ? '' : '<span class="wtag">대기</span>') + '<i class="dot ' + (x.run ? 'run' : 'hol') + '"></i></div>' +
      '<div class="sc-sub">' + (mdl ? '<i class="mdot" style="background:' + famColor(mdl) + ';margin-right:6px"></i>' : '') + esc(s.project) + '</div>' +
      '<div class="gauge"><div class="gt">' + ticks + '</div><div class="gb">' + gaugeIn + '</div></div>' +
      '<div class="saw"><svg viewBox="0 0 80 40" preserveAspectRatio="none" role="img" aria-label="최근 ' + n + '회 호출의 컨텍스트 크기">' + sw + '</svg></div>' +
      '<div class="sawcap"><span>' + (n ? 'LAST ' + n + ' CALLS' : 'NO CALLS YET') + '</span><span>PEAK ' + (num(c.peak) > 0 ? esc(fmtK(c.peak)) : '—') + '</span></div></article>' +
      '<div class="eb"><div class="eb-r"><span class="mono">MODEL</span>' + (mdl ? '<b class="mdl" title="' + esc(mdl) + '"><i class="mdot" style="background:' + famColor(mdl) + '"></i>' + esc(mn) + '</b>' : '<b class="mdl dim">—</b>') + '</div>' +
      '<div class="eb-r"><span class="mono">EFFORT</span><b' + (effDim ? ' class="dim"' : '') + '>' + esc(effTxt) + '</b></div>' +
      '<div class="meter" role="meter" aria-label="노력 수준" aria-valuemin="0" aria-valuemax="5" aria-valuenow="' + (x.fresh ? 0 : lvl + 1) + '">' + LEVELS.map(function (xx, i) { return '<i' + (!x.fresh && i <= lvl ? ' class="f"' : '') + '></i>'; }).join('') + '</div>' +
      '<div class="eb-s">COMPACT <b' + (num(c.compactCount) > 0 ? ' class="amb"' : '') + '>' + num(c.compactCount) + '</b> · RE-READ <b>' + esc(fmtNum(c.reread)) + '</b> · <b>' + esc(costTxt(s.cost, s.costUnknown)) + '</b> · <b' + (x.run && t0 ? ' data-live-wall="' + t0 + '"' : '') + '>' + esc(fmtDur(t0 ? M.now - t0 : s.wallMs)) + '</b></div></div>' +
      '<i class="c-rnode"></i></div>';
  }
  // right-hand panel when a session is selected: THIS session only (never the global baseline)
  function sessSideHTML(x, M) {
    var s = x.s, c = x.c;
    var has60 = isObj(c.last60), pk = isObj(c.peakHour) ? c.peakHour : { total: 0, cost: 0 };
    var tokV = has60 ? num(c.last60.total) : num(s.total);
    var costV = has60 ? c.last60.cost : s.cost;
    var costKnown = !(s.costUnknown && !(num(costV) > 0)) && hasCost(costV);
    var tokF = has60 ? (num(pk.total) > 0 ? Math.min(1, tokV / num(pk.total)) : 0) : (tokV > 0 ? 1 : 0);
    var costF = has60 ? (num(pk.cost) > 0 && costKnown ? Math.min(1, num(costV) / num(pk.cost)) : 0) : (num(costV) > 0 ? 1 : 0);
    var comps = Array.isArray(c.compactions) ? c.compactions : [];
    var auto = c.compactAuto != null ? num(c.compactAuto) : comps.filter(function (k) { return k.trigger === 'auto'; }).length;
    var man = c.compactManual != null ? num(c.compactManual) : comps.filter(function (k) { return k.trigger === 'manual'; }).length;
    var other = Math.max(0, num(c.compactCount) - auto - man);
    var basis = has60 ? 'LAST 60 MIN' : 'ALL TIME';
    var scaleT = has60 ? '이 세션 최고 1시간 ' + (num(pk.total) > 0 ? fmtNum(pk.total) : '—') : '세션 전체';
    var scaleC = has60 ? '이 세션 최고 1시간 ' + (num(pk.cost) > 0 ? '≈ ' + fmtCost(pk.cost) : '—') : '세션 전체';
    var big = '<span style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;justify-content:flex-end">';
    return '<div class="mblk"><div class="shead"><span class="lab" style="color:var(--ink-2)">THIS SESSION · ' + basis + '</span><span class="sname" title="' + esc(s.title) + '">' + esc(s.title) + '</span></div>' +
      (x.fresh ? '<div class="shint">아직 호출 기록 없음</div>' : '') +
      '<div class="mbig" style="margin-top:14px"><span class="mono">TOKENS</span>' + big + '<b>' + esc(fmtNum(tokV)) + '</b>' + (has60 ? '<small>세션 전체 ' + esc(fmtNum(s.total)) + '</small>' : '') + '</span></div>' +
      '<div class="mtrack"><i style="width:' + (tokF * 100).toFixed(1) + '%;background:var(--c-acc)"></i></div><div class="mscale"><span>0</span><span>' + esc(scaleT) + '</span></div></div>' +
      '<div class="mblk"><div class="mbig"><span class="mono">COST</span>' + big + '<b>' + (costKnown ? '≈ ' + esc(fmtCost(costV)) : (s.costUnknown ? '단가 미설정' : '≈ $0.00')) + '</b>' + (has60 ? '<small>세션 전체 ' + esc(costTxt(s.cost, s.costUnknown)) + '</small>' : '') + '</span></div>' +
      '<div class="mtrack"><i style="width:' + (costF * 100).toFixed(1) + '%;background:rgba(191,242,58,.7)"></i></div><div class="mscale"><span>0</span><span>' + esc(scaleC) + '</span></div></div>' +
      '<div class="mblk"><div class="mbig"><span class="lab">COMPACTIONS · THIS SESSION</span><b>' + num(c.compactCount) + '</b></div>' +
      '<div class="msplit">' + (auto ? '<i style="flex:' + auto + '"></i>' : '') + (man ? '<i class="m" style="flex:' + man + '"></i>' : '') + (other ? '<i class="o" style="flex:' + other + '"></i>' : '') + '</div>' +
      '<div class="mscale"><span>AUTO ' + auto + '</span><span>MANUAL ' + man + (other ? ' · 기록 없음 ' + other : '') + '</span></div></div>';
  }
  function sideHTML(M) {
    var L = isObj(M.C.last30d) ? M.C.last30d : {};
    var tokF = M.avg > 0 ? Math.min(1, M.l60.total / (M.avg * 2)) : 0;
    var costF = M.usualCost > 0 && hasCost(M.l60.cost) ? Math.min(1, num(M.l60.cost) / (M.usualCost * 2)) : 0;
    var ratio = M.ratio == null ? '평소 기록 없음' : '평소의 ' + M.ratio.toFixed(1) + '배';
    var auto = num(L.auto), man = num(L.manual);
    return '<div class="mblk"><span class="lab" style="color:var(--ink-2)">ALL SESSIONS · LAST 60 MIN</span>' +
      '<div class="mbig" style="margin-top:14px"><span class="mono">TOKENS</span><span style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;justify-content:flex-end"><b>' + esc(fmtNum(M.l60.total)) + '</b><small>' + esc(ratio) + '</small></span></div>' +
      '<div class="mtrack"><i style="width:' + (tokF * 100).toFixed(1) + '%;background:var(--ink)"></i><u style="left:50%"></u></div><div class="mscale"><span>0</span><span>평소</span><span>평소 × 2</span></div></div>' +
      '<div class="mblk"><div class="mbig"><span class="mono">COST</span><b>' + (hasCost(M.l60.cost) ? '≈ ' + esc(fmtCost(M.l60.cost)) : '-') + '</b></div>' +
      '<div class="mtrack"><i style="width:' + (costF * 100).toFixed(1) + '%;background:var(--c-acc)"></i><u style="left:50%"></u></div><div class="mscale"><span>0</span><span>평소</span><span>평소 × 2</span></div></div>' +
      '<div class="mblk"><div class="mbig"><span class="lab amb">COMPACTIONS 30D</span><b class="amb">' + num(L.compactCount) + '</b></div>' +
      '<div class="msplit">' + (auto ? '<i style="flex:' + auto + '"></i>' : '') + (man ? '<i class="m" style="flex:' + man + '"></i>' : '') + '</div>' +
      '<div class="mscale"><span>AUTO ' + auto + '</span><span>MANUAL ' + man + '</span></div></div>';
  }

  // ---------- path ----------
  function tagOf(n) {
    if (n.kind === 'skill') return n.pn ? 'AGENT · ' + shortType(n.pn.type) : (n.where === 'agent' ? 'AGENT' : 'MAIN');
    return n.pn ? 'SUB OF ' + shortType(n.pn.type) : '';
  }
  function nodeHTML(n, now) {
    var tg = tagOf(n), tgh = tg ? '<div class="n-g"><span class="tg">' + esc(tg) + '</span></div>' : '';
    if (n.kind === 'skill') {
      return '<div class="nd sk act" title="' + esc(n.skill + ' · ' + n.count + '회 · 마지막 호출 ' + relShort(n.ageSec * 1000) + ' 전 · ' + tg) + '"><div class="n-t"><i class="dot run"></i><span class="tp skn">' + esc(n.skill) + '</span></div>' +
        '<div class="n-f"><span><span class="sk4">SKILL</span> · ' + n.count + '× · ' + relShort(n.ageSec * 1000) + ' ago</span></div>' + tgh + '</div>';
    }
    var done = n.ended;
    return '<div class="nd ' + (done ? 'done' : 'run') + '" title="' + esc(n.type + ' · ' + (n.desc || '-') + '\n' + U.shortModel(n.model) + ' · effort ' + (n.effort || '-') + ' · ' + fmtExact(n.tokens) + ' 토큰' + (done ? ' · 종료 ' : ' · 시작 ') + relShort(now - n.since) + ' 전') + '">' +
      '<div class="n-t"><i class="dot ' + (done ? 'hol' : 'run') + '"></i><span class="tp">' + esc(n.type) + '</span></div>' +
      '<div class="n-d">' + esc(n.desc || '-') + '</div>' +
      '<div class="n-m"><i class="mdot" style="background:' + famColor(n.model) + '"></i>' + esc(U.shortModel(n.model)) + ' · ' + esc(n.effort || '-') + '</div>' + tgh +
      '<div class="n-f"><span>' + esc(fmtNum(n.tokens)) + ' tok</span>' + (done ? '<span class="ended">ENDED ' + relShort(now - n.since) + '</span>' : '<span>RUN <b>' + relShort(now - n.since) + '</b></span>') + '</div></div>';
  }
  function treeHTML(tl, list, now) {
    return list.map(function (n) {
      var k = tl.kidsOf(n);
      return '<div class="tn" data-id="' + esc(n.id) + '" data-act="' + (n.ended ? 0 : 1) + '">' + nodeHTML(n, now) + (k.length ? '<div class="kids">' + treeHTML(tl, k, now) + '</div>' : '') + '</div>';
    }).join('');
  }
  function subtree(tl, n) { var c = 1; tl.kidsOf(n).forEach(function (k) { c += subtree(tl, k); }); return c; }
  function subRun(tl, n) { return (n.kind === 'skill' || !n.ended) || tl.kidsOf(n).some(function (k) { return subRun(tl, k); }); }
  // one group's top-level nodes, folded to PATH_ROWS wrapped rows at the measured column count (+N node = last item of row 4)
  // One group's top-level nodes as N independent column stacks (N = the grid's current column count), so a node sits
  // right under the previous node of its column (+ its hanging children): no holes under shorter neighbours.
  // Columns are assigned round-robin by first appearance and remembered (per session, group and N), so a node never
  // jumps to another column on refresh (an agent that ends just moves to the end of its own column); new nodes append.
  // Fold: when a column holds more than PATH_ROWS nodes, every column shows its first PATH_ROWS and the 4th slot of the
  // right-most column that has a 4th node becomes `+N 더 보기` (N = hidden nodes incl. their children). Expanded: all
  // nodes, `접기` takes the slot the next node would take (end of the last row).
  function foldGroup(tl, list, g, sid, now, keyOut) {
    var N = Math.max(1, cs.pcols[g] || 1), mk = sid + '|' + g + '|' + N, fk = sid + '|' + g, exp = !!cs.pexp[fk];
    var map = cs.pmap[mk] || (cs.pmap[mk] = { col: {}, next: 0 });
    list.forEach(function (n) { if (map.col[n.id] == null) { map.col[n.id] = map.next % N; map.next++; } });
    var cols = [], c;
    for (c = 0; c < N; c++) cols.push([]);
    list.forEach(function (n) { cols[map.col[n.id]].push(n); });
    var over = cols.some(function (cl) { return cl.length > PATH_ROWS; }), btnCol = -1, hid = [];
    if (over && !exp) {
      for (c = N - 1; c >= 0 && btnCol < 0; c--) if (cols[c].length >= PATH_ROWS) btnCol = c;
      cols = cols.map(function (cl, ci) { var keep = ci === btnCol ? PATH_ROWS - 1 : PATH_ROWS; hid = hid.concat(cl.slice(keep)); return cl.slice(0, keep); });
    } else if (over) btnCol = map.next % N;
    var btn = '';
    if (over) {
      var nHid = hid.reduce(function (acc, n) { return acc + subtree(tl, n); }, 0);
      var hot = hid.some(function (n) { return subRun(tl, n); });
      btn = '<div class="tn" data-more="1" data-act="0"><button type="button" class="more pmore' + (hot ? ' hot' : '') + '" data-pmore="' + g + '" aria-expanded="' + (exp ? 'true' : 'false') + '"' +
        (exp ? '' : ' title="' + nHid + '개 노드 숨김' + (hot ? ' (실행 중 포함)' : '') + '"') + '>' + (exp ? '접기' : '+' + nHid + ' 더 보기') + '</button></div>';
    }
    keyOut.push(g + N + (over ? (exp ? 'x' : 'c') + btnCol : '') + ':' + cols.map(function (cl) { return cl.map(function (n) { return n.id; }).join('.'); }).join('/'));
    return cols.map(function (cl, ci) { return '<div class="pcolm">' + treeHTML(tl, cl, now) + (ci === btnCol ? btn : '') + '</div>'; }).join('');
  }
  function pathHTML(x, now) {
    var tl = x.tl, A = tl.rootsA, Sx = tl.rootsS, sid = x.s.id, fk = [];
    var nA = A.length, nS = Sx.length, grp = [];
    var showA = A.length > 0 || Sx.length === 0, showS = Sx.length > 0;
    if (showA) {
      var body = A.length ? foldGroup(tl, A, 'A', sid, now, fk) : '<div class="tn" data-empty="1" data-act="0"><div class="nd nemp">에이전트·스킬 없음</div></div>';
      grp.push({ w: Math.max(1, Math.min(6, nA)), html: '<section class="grp" data-g="A"><div class="gch"><span class="pchip' + (tl.nRun ? ' on' : '') + '">AGENTS<b>' + tl.nRun + ' RUNNING</b></span></div><div class="items">' + body + '</div></section>' });
    }
    if (showS) grp.push({ w: nS <= 2 ? 1 : (nS <= 4 ? 2 : 3), html: '<section class="grp" data-g="S"><div class="gch"><span class="pchip on">SKILLS<b>' + tl.nSkMain + ' ACTIVE</b></span></div><div class="items">' + foldGroup(tl, Sx, 'S', sid, now, fk) + '</div></section>' });
    var cols = grp.length > 1 ? grp.map(function (g) { return 'minmax(190px,' + g.w + 'fr)'; }).join(' ') : 'minmax(0,1fr)';
    return { html: '<div class="pbox" id="c-pbox" data-tn="' + tl.total + '"><div class="lg" style="grid-template-columns:' + cols + '">' + grp.map(function (g) { return g.html; }).join('') + '</div></div>', key: fk.join(',') };
  }

  // ---------- hero rendering + selection ----------
  function resolveSel(M) {
    var ids = M.liveChips.map(function (x) { return x.s.id; });
    if (!ids.length) return null;
    if (!cs.restored) {
      cs.restored = true;
      try { var sv = localStorage.getItem(SEL_KEY); if (ids.indexOf(sv) >= 0) cs.selId = sv; } catch (e) { /* 저장소 없음 */ }
    }
    if (cs.selId == null || ids.indexOf(cs.selId) < 0) cs.selId = M.defId;  // selected session closed (no longer live) -> default; a session that only stopped running stays selected
    return cs.selId;
  }
  function renderHero(M) {
    var hero = $('c-hero'), strip = $('c-strip'), sel = $('c-sel');
    var selId = resolveSel(M);
    if (!cs.cols) cs.cols = stripCols(strip);
    var cap = Math.max(1, cs.cols) * STRIP_ROWS;
    M.chips = visibleChips(M, selId, cap);
    M.hiddenChips = M.liveChips.filter(function (x) { return M.chips.indexOf(x) < 0; });
    var n = M.chips.length, hidden = M.hiddenChips.length, over = M.liveChips.length > cap;
    var tgl = over
      ? '<button type="button" class="chipmore" data-more-toggle aria-controls="c-strip" aria-expanded="' + (cs.expanded ? 'true' : 'false') + '">' + (cs.expanded ? '접기' : '+' + hidden + ' 더 보기') + '</button>'
      : '';
    morph($('c-hh'), '<span class="lab">LIVE SESSIONS<em> · </em>작업 중 <b>' + M.nRunL + '</b><em> · </em>대기 <i>' + M.nWaitL + '</i></span>' + tgl);
    if (n) {
      strip.className = 'c-strip' + (cs.expanded && over ? ' xp' : '');
      strip.setAttribute('role', 'tablist');
      morph(strip, stripHTML(M, selId));
      var tb = strip.querySelector('.sc.on');
      if (tb) {
        sel.setAttribute('aria-labelledby', tb.id);
        // narrow screens scroll the expanded strip inside a bounded box: keep the selected chip in view there
        if (strip.scrollHeight > strip.clientHeight + 1) {
          var top = tb.offsetTop - strip.offsetTop, bot = top + tb.offsetHeight;
          if (top < strip.scrollTop) strip.scrollTop = top - 4;
          else if (bot > strip.scrollTop + strip.clientHeight) strip.scrollTop = bot - strip.clientHeight + 4;
        }
      }
    } else {
      strip.className = 'c-strip none';
      strip.removeAttribute('role');
      sel.removeAttribute('aria-labelledby');
      morph(strip, '<div class="stripe"><i class="dot hol"></i>작업 중이거나 대기 중인 세션 없음</div>');
    }
    $('c-hb').hidden = !n;
    if (cs.fading) return;  // the pending fade paints with the newest model
    if (!n) { paintEmpty(M); return; }
    if (cs.painted && cs.shownSel === selId) patchSel(M);
    else if (!cs.painted || cs.shownSel == null || RM.matches) paintSel(M);
    else {
      cs.fading = true;
      hero.classList.add('fade');
      clearTimeout(cs.fadeT);
      cs.fadeT = setTimeout(function () {
        cs.fading = false;
        if (!on) return;
        paintSel(cs.M);
        requestAnimationFrame(function () { hero.classList.remove('fade'); });
      }, 80);
    }
  }
  function detailParts(M) {
    var i = indexAll(M, cs.selId), x = M.liveChips[i], ph;
    return { x: x, detail: cardHTML(x, M) + '<div class="sidew"><div class="side' + (x.run ? '' : ' wait') + '">' + sessSideHTML(x, M) + '</div></div>', path: (ph = pathHTML(x, M.now)).html, key: x.s.id + '#' + x.tl.key + '#' + ph.key };
  }
  function paintSel(M) {
    var d = detailParts(M), det = $('c-detail'), pw = $('c-pathw');
    $('c-sel').className = 'c-sel';
    det.className = 'detail';
    det.innerHTML = d.detail; det._h = d.detail;
    pw.innerHTML = d.path; pw._h = d.path;
    cs.pathKey = d.key; cs.shownSel = d.x.s.id; cs.painted = true;
    cs.ovSig = '';
    sched();
  }
  function patchSel(M) {
    var d = detailParts(M), det = $('c-detail'), pw = $('c-pathw');
    morph(det, d.detail);
    if (d.key !== cs.pathKey) { pw.innerHTML = d.path; pw._h = d.path; cs.pathKey = d.key; }  // structure changed: rebuild
    else morph(pw, d.path);  // same nodes and states: only text/values
  }
  function paintEmpty(M) {
    var det = $('c-detail'), pw = $('c-pathw');
    $('c-sel').className = 'c-sel empty';
    det.className = 'detail nosel';
    morph(det, '<div class="sidew"><div class="side">' + sideHTML(M) + '</div></div>');
    if (pw.firstChild) { pw.innerHTML = ''; pw._h = ''; }
    cs.pathKey = ''; cs.shownSel = null; cs.painted = false;
  }
  function select(id, focus) {
    var M = cs.M; if (!M || indexAll(M, id) < 0) return;
    if (id !== cs.selId) {
      cs.selId = id;
      try { localStorage.setItem(SEL_KEY, id); } catch (e) { /* 저장 실패 무시 */ }
      renderHero(M);
    }
    if (focus) { var b = $('c-strip').querySelector('.sc[data-sid="' + String(id).replace(/["\\]/g, '') + '"]'); if (b) b.focus(); }
  }

  // ---------- 압축 기록 / 재읽기 vs 신규 / 노력 수준 분포 ----------
  // GPT sessions without a title come back as their id: show a short form instead of a 36-char uuid
  function sessLabel(r) {
    var t = String(r.session || '');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) return (r.provider === 'codex' ? 'GPT ' : '세션 ') + t.slice(0, 8);
    return t || '-';
  }
  function clogHTML(M) {
    var L = isObj(M.C.last30d) ? M.C.last30d : {};
    // a resumed/forked session repeats its parent's history: show one row per compaction event
    var seen = {};
    var rec = (Array.isArray(M.C.recent) ? M.C.recent.filter(isObj) : []).filter(function (r) {
      var k = r.ts + '|' + r.preTokens + '|' + r.postTokens;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).slice(0, 6);
    var maxPre = Math.max.apply(null, rec.map(function (r) { return num(r.preTokens); }).concat([1]));
    var list = rec.length ? '<div class="clg">' + rec.map(function (r) {
      var chip = r.trigger === 'auto' ? '<span class="cm">AUTO</span>' : (r.trigger === 'manual' ? '<span class="cm man">MANUAL</span>' : '<span class="cm na" title="트리거 기록 없음">N/A</span>');
      return '<div class="cl"><div class="cl1"><span class="t">' + esc(U.fmtMDHM(U.ts(r.ts))) + '</span><span class="s" title="' + esc(r.session) + '">' + esc(sessLabel(r)) + '</span>' + chip +
        '<span class="v">' + esc(fmtK(r.preTokens)) + ' → ' + esc(fmtK(r.postTokens)) + '</span></div>' +
        '<div class="cbw"><div class="cbp"><i class="bf" style="width:' + (num(r.preTokens) / maxPre * 100).toFixed(2) + '%"></i><i class="af" style="width:' + Math.max(0.8, num(r.postTokens) / maxPre * 100).toFixed(2) + '%"></i></div><small>' + (num(r.durationMs) ? esc(fmtDur(r.durationMs)) : '-') + '</small></div></div>';
    }).join('') + '</div>' : '<div class="cempty">최근 30일 동안 압축 기록이 없습니다.</div>';
    return '<div class="head"><h2 class="title">압축 기록</h2><span class="mono">COMPACTION LOG</span></div>' +
      '<div class="nums"><div><div class="mono">COUNT · 30D</div><div class="n">' + num(L.compactCount) + '</div></div>' +
      '<div><div class="mono">AVG BEFORE</div><div class="n">' + esc(fmtNum(L.avgPre)) + '</div></div>' +
      '<div><div class="mono">DROPPED</div><div class="n amb">' + esc(fmtNum(L.droppedTokens)) + '</div></div></div>' + list +
      '<div class="fn">30일 집계는 Claude 기준' + (num(L.codexCount) ? ' (GPT ' + esc(num(L.codexCount)) + '건은 트리거 · 소요시간 기록 없음)' : '') + '. 회색 막대 = 압축 전, 강조색 막대 = 압축 후.</div>';
  }
  function rereadHTML(M) {
    var t = M.all, cr = t.cacheRead, fresh = t.input + t.output + t.cacheCreate, tot = cr + fresh;
    return '<div class="head"><h2 class="title">재읽기 vs 신규</h2><span class="mono">ALL TIME</span></div>' +
      '<div class="rr"><div class="l"><span class="mono">CACHE RE-READ</span><span class="p">' + pc1(cr, tot) + '</span></div>' +
      '<div class="rbig" title="' + esc(fmtExact(cr)) + ' 토큰">' + esc(fmtNum(cr)) + '</div><div class="rb"><i style="--hc:#bff23a;background:rgba(' + ACCRGB + ',.55);width:' + (tot ? cr / tot * 100 : 0).toFixed(2) + '%"></i></div></div>' +
      '<div class="rr"><div class="l"><span class="mono">NEW · INPUT + OUTPUT + CACHE WRITE</span><span class="p">' + pc1(fresh, tot) + '</span></div>' +
      '<div class="rbig" title="' + esc(fmtExact(fresh)) + ' 토큰">' + esc(fmtNum(fresh)) + '</div><div class="rb"><i style="--hc:#b9bdbb;background:rgba(185,189,187,.55);width:' + (tot ? Math.max(0.5, fresh / tot * 100) : 0).toFixed(2) + '%"></i></div></div>' +
      '<div style="margin-top:16px;border-top:1px solid var(--c-line2);padding-top:10px">' +
      '<div class="sm"><span>INPUT</span><b>' + esc(fmtNum(t.input)) + '</b></div><div class="sm"><span>OUTPUT</span><b>' + esc(fmtNum(t.output)) + '</b></div><div class="sm"><span>CACHE WRITE</span><b>' + esc(fmtNum(t.cacheCreate)) + '</b></div></div>' +
      '<div class="fn" style="font-size:13px;color:var(--ink-2)">매 호출마다 대화 전체를 다시 읽는 비용 (캐시 읽기)</div>';
  }
  var EA = { low: .18, medium: .32, high: .5, xhigh: .72, max: .95 };
  function effBg(k) { return k === 'unknown' ? 'transparent' : 'rgba(' + ACCRGB + ',' + EA[k] + ')'; }
  function effortHTML(M) {
    var R = M.routes, TE = isObj(R.totalsByEffort) ? R.totalsByEffort : {}, EF = LEVELS.concat(['unknown']);
    var v = function (k) { return isObj(TE[k]) ? num(TE[k].tokens) : 0; };
    var eTot = EF.reduce(function (a, k) { return a + v(k); }, 0);
    return '<div class="head"><h2 class="title">노력 수준 분포</h2><span class="mono">EFFORT SPLIT · ' + esc(num(R.rangeDays) || 30) + 'D</span></div>' +
      '<div class="es">' + (eTot ? EF.map(function (k) { return '<i style="width:' + (v(k) / eTot * 100).toFixed(3) + '%;background:' + effBg(k) + '" title="' + esc((k === 'unknown' ? '기록 없음' : k) + ' ' + pc1(v(k), eTot)) + '"></i>'; }).join('') : '') + '</div>' +
      '<div style="margin-top:12px">' + EF.map(function (k) {
        return '<div class="er"><span class="hsw" style="background:' + effBg(k) + (k === 'unknown' ? ';background-image:var(--c-dots);background-size:10px 10px' : '') + '"></span><span class="k">' + (k === 'unknown' ? '기록 없음' : k.toUpperCase()) + '</span><span class="tk">' + esc(fmtNum(v(k))) + '</span><span class="pc">' + pc1(v(k), eTot) + '</span></div>';
      }).join('') + '</div><div class="fn">호출마다 기록된 노력 수준 기준 토큰 비율 (낮음 → 높음 = 옅은 색 → 짙은 색). 기록 없음 = 로그에 노력 수준이 없는 호출.</div>';
  }

  // ---------- render (every 5 s refresh, provider change, skin switch) ----------
  function render(sum) {
    if (!on || !built) return;
    var M = model(sum || {});
    cs.M = M;
    morph($('c-cmp30'), cmpHTML(M));
    morph($('c-now'), nowHTML(M));
    renderHero(M);
    morph($('c-clog'), clogHTML(M));
    morph($('c-reread'), rereadHTML(M));
    morph($('c-effort'), effortHTML(M));
    sched();
  }

  // ---------- path geometry (runtime, from getBoundingClientRect) ----------
  function sched() { if (!on) return; cancelAnimationFrame(cs.raf); cs.raf = requestAnimationFrame(layout); }
  function layout() {
    if (!on) return;
    var hero = $('c-hero'), ov = $('c-ov');
    if (!hero || !ov) return;
    var stripEl = $('c-strip');
    if (cs.M && stripEl && !/\bnone\b/.test(stripEl.className)) {
      var nc = stripCols(stripEl);
      if (nc !== cs.cols) { cs.cols = nc; renderHero(cs.M); }
    }
    var pchg = false;
    [].forEach.call(hero.querySelectorAll('#c-pbox .grp'), function (g) {
      var k = g.getAttribute('data-g'), it = g.querySelector(':scope > .items');
      var c = it ? (getComputedStyle(it).gridTemplateColumns.match(/[\d.]+px/g) || []).length : 0;
      if (c && c !== cs.pcols[k]) { cs.pcols[k] = c; pchg = true; }
    });
    if (pchg && cs.M && cs.painted && !cs.fading) patchSel(cs.M);   // fold point moved (width change): rebuild the path once
    var hr = hero.getBoundingClientRect(), W = Math.round(hr.width), H = Math.round(hr.height);
    if (!W || !H) return;
    function rc(el) { var r = el.getBoundingClientRect(); return { l: Math.round(r.left - hr.left), r: Math.round(r.right - hr.left), t: Math.round(r.top - hr.top), b: Math.round(r.bottom - hr.top) }; }
    var gd = [], jt = [], port = '', paths = [];
    function ln(x1, y1, x2, y2) { if (x1 === x2 && y1 === y2) return; gd.push('M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2); }
    function jn(x, y) { jt.push('<rect x="' + (x - 2) + '" y="' + (y - 2) + '" width="5" height="5"/>'); }
    var pbox = $('c-pbox'), rn = hero.querySelector('.c-rnode');
    if (pbox && rn && !cs.fading) {
      var pr = rc(pbox), q0 = rc(rn), x0 = Math.round((q0.l + q0.r) / 2), y0 = Math.round((q0.t + q0.b) / 2), railX = pr.l + 8;
      var kidsWalk = function (tn, nd) {
        var kidsEl = tn.querySelector(':scope > .kids'); if (!kidsEl) return;
        var px = nd.l + 11, pb = nd.b, kt = [].filter.call(kidsEl.children, function (c) { return c.classList.contains('tn'); }), ly = pb;
        kt.forEach(function (c) { ly = Math.max(ly, rc(c.querySelector(':scope > .nd')).t + 17); });
        ln(px, pb, px, ly);
        kt.forEach(function (c) {
          var cr = rc(c.querySelector(':scope > .nd')), y = cr.t + 17;
          ln(px, y, cr.l, y); jn(px, y);
          if (c.getAttribute('data-act') === '1') paths.push({ p: [[px, pb], [px, y], [cr.l, y]], child: true });
          kidsWalk(c, cr);
        });
      };
      var grps = [].map.call(pbox.querySelectorAll('.grp'), function (g) {
        var gc = rc(g.querySelector('.gch'));
        var items = [].filter.call(g.querySelectorAll(':scope > .items > .tn, :scope > .items > .pcolm > .tn'), function (tn) { return !tn.hasAttribute('data-more'); }).map(function (tn) {
          var plain = tn.hasAttribute('data-more') || tn.hasAttribute('data-empty'), q = rc(tn.querySelector(':scope > .nd, :scope > .more'));
          q.tn = tn; q.act = tn.getAttribute('data-act') === '1'; q.plain = plain; q.my = plain ? Math.round((q.t + q.b) / 2) : q.t + 17; return q;
        });
        var minT = Math.min.apply(null, items.map(function (q) { return q.t; }));
        // first node of its column stack drops straight from the bus; the others hook off the column's left gutter trunk
        items.forEach(function (q) { var pc = q.tn.parentNode; q.first = pc.classList.contains('pcolm') ? pc.firstElementChild === q.tn : q.t - minT < 8; });
        return { busY: Math.round((gc.t + gc.b) / 2), items: items };
      });
      if (grps.length) {
        var busY0 = grps[0].busY, stacked = grps.length > 1 && grps[1].busY - busY0 > 40;
        var itemPts = function (q) {
          var cx = Math.round((q.l + q.r) / 2);
          if (q.first) return { top: [[cx, 0], [cx, q.t]], join: cx, first: true };
          var gx = q.l - 7; return { top: [[gx, 0], [gx, q.my], [q.l, q.my]], join: gx };
        };
        grps.forEach(function (g) { g.items.forEach(function (q) { q.ip = itemPts(q); q.ip.top[0][1] = g.busY; if (!q.ip.first) q.ip.top[1][1] = q.my; }); });
        var allX = [x0]; grps.forEach(function (g) { g.items.forEach(function (q) { allX.push(q.ip.join); }); });
        if (stacked) allX.push(railX);
        var busL = Math.min.apply(null, allX), busR = Math.max.apply(null, allX);
        ln(x0, y0, x0, busY0); jn(x0, busY0);
        port += '<circle cx="' + x0 + '" cy="' + y0 + '" r="5" fill="#181918" stroke="#8d9694" stroke-width="1"/>';
        grps.forEach(function (g, gi) {
          var js = [];
          g.items.forEach(function (q) {
            js.push(q.ip.join); var t = q.ip.top; for (var i = 1; i < t.length; i++) ln(t[i - 1][0], t[i - 1][1], t[i][0], t[i][1]); jn(q.ip.join, g.busY);
            if (!q.plain) kidsWalk(q.tn, q);
          });
          if (gi === 0 || !stacked) ln(Math.min.apply(null, js.concat([busL])), g.busY, Math.max.apply(null, js.concat([busR])), g.busY);
          else { ln(railX, g.busY, Math.max.apply(null, js), g.busY); ln(railX, busY0, railX, g.busY); jn(railX, busY0); jn(railX, g.busY); }
        });
        // in-use routes: card node -> bus -> node (running agents, active skills)
        grps.forEach(function (g, gi) {
          g.items.forEach(function (q) {
            if (!q.act || q.plain) return;
            var p = [[x0, y0], [x0, busY0]], st = stacked && gi > 0;
            if (st) p.push([railX, busY0], [railX, g.busY]);
            p.push([q.ip.join, st ? g.busY : busY0]);
            if (!st && g.busY !== busY0) p.push([q.ip.join, g.busY]);
            q.ip.top.forEach(function (a) { p.push(a.slice()); });
            paths.push({ p: p });
          });
        });
      }
    }
    var T = 8, Mg = 7, tc = 'rgba(' + ACCRGB + ',.5)', o = [];
    [[Mg, Mg, 1, 1], [W - Mg, Mg, -1, 1], [Mg, H - Mg, 1, -1], [W - Mg, H - Mg, -1, -1]].forEach(function (c) {
      o.push('<path d="M' + (c[0] + c[2] * T) + ' ' + c[1] + 'H' + c[0] + 'V' + (c[1] + c[3] * T) + '" fill="none" stroke="' + tc + '" stroke-width="1"/>');
    });
    o.push('<g transform="translate(.5 .5)"><path d="' + gd.join('') + '" fill="none" stroke="' + NET + '" stroke-width="1" shape-rendering="crispEdges"/><g fill="' + NET + '">' + jt.join('') + '</g>' + port + '</g>');
    var ds = '', mv = '', ns = '', anim = !RM.matches;
    paths.forEach(function (pt, ix) {
      var p = pt.p.filter(function (q, i) { return i === 0 || Math.abs(q[0] - pt.p[i - 1][0]) > .1 || Math.abs(q[1] - pt.p[i - 1][1]) > .1; });
      var d = 'M' + p.map(function (q) { return q[0] + ' ' + q[1]; }).join('L'), len = 0;
      for (var i = 1; i < p.length; i++) len += Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]);
      var id = 'c-ap' + ix, dur = Math.max(.8, len / SPEED), beg = '-' + (dur * ((ix * 0.618034) % 1)).toFixed(2) + 's', s0 = p[0], e0 = p[p.length - 1];
      ds += '<path id="' + id + '" d="' + d + '" fill="none" stroke="#bff23a" stroke-width="2" stroke-linejoin="miter"/>';
      ns += '<circle cx="' + e0[0] + '" cy="' + e0[1] + '" r="7" fill="rgba(' + ACCRGB + ',.18)" stroke="#bff23a" stroke-width="1.1" stroke-opacity=".7"/><circle cx="' + e0[0] + '" cy="' + e0[1] + '" r="3.5" fill="#fff"/>';
      if (pt.child) ns += '<circle cx="' + s0[0] + '" cy="' + s0[1] + '" r="5" fill="rgba(' + ACCRGB + ',.18)" stroke="#bff23a" stroke-width="1.1" stroke-opacity=".7"/><circle cx="' + s0[0] + '" cy="' + s0[1] + '" r="2.5" fill="#fff"/>';
      if (anim) {
        // animated parts live OUTSIDE the drop-shadow group so the filter is not re-rasterized every frame
        mv += '<path d="' + d + '" fill="none" stroke="#bff23a" stroke-width="4.5" stroke-linecap="round" stroke-opacity=".45" stroke-dasharray="44 ' + (Math.ceil(len) + 88) + '"><animate attributeName="stroke-dashoffset" from="44" to="-' + Math.ceil(len) + '" dur="' + dur.toFixed(2) + 's" begin="' + beg + '" repeatCount="indefinite"/></path>';
        mv += '<circle cx="' + e0[0] + '" cy="' + e0[1] + '" r="6" fill="none" stroke="#bff23a" stroke-width="1.2"><animate attributeName="r" values="6;12;6" dur="2.4s" begin="' + beg + '" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values=".9;0;.9" dur="2.4s" begin="' + beg + '" repeatCount="indefinite"/></circle>';
        mv += '<g class="orb"><circle r="9" fill="rgba(' + ACCRGB + ',.16)"/><circle r="6" fill="rgba(' + ACCRGB + ',.32)" stroke="#bff23a" stroke-width="1" stroke-opacity=".8"/><circle r="3.2" fill="#fff"/><animateMotion dur="' + dur.toFixed(2) + 's" begin="' + beg + '" repeatCount="indefinite" calcMode="linear"><mpath href="#' + id + '"/></animateMotion></g>';
      } else {
        mv += '<g class="orb" transform="translate(' + e0[0] + ' ' + e0[1] + ')"><circle r="9" fill="rgba(' + ACCRGB + ',.16)"/><circle r="6" fill="rgba(' + ACCRGB + ',.32)" stroke="#bff23a" stroke-width="1" stroke-opacity=".8"/><circle r="3.2" fill="#fff"/></g>';
      }
    });
    if (paths.length) o.push('<g class="lit">' + ds + ns + '</g>' + mv);
    var html = o.join(''), sig = W + 'x' + H + '|' + anim + '|' + html;
    host.setAttribute('data-chk', 'sw=' + document.documentElement.scrollWidth + '/' + window.innerWidth + ' tabs=' + $('c-strip').querySelectorAll('.sc').length +
      ' cards=' + hero.querySelectorAll('.scard').length + ' paths=' + (pbox ? 1 : 0) + ' lit=' + paths.length + ' sel=' + (cs.shownSel || '-'));
    if (sig === cs.ovSig) return;  // same structure and geometry: keep the running SMIL animations untouched
    cs.ovSig = sig;
    ov.setAttribute('width', W); ov.setAttribute('height', H); ov.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    ov.innerHTML = html;
    host.setAttribute('data-ovbuilds', String(num(host.getAttribute('data-ovbuilds')) + 1));
  }

  CUD.registerSkin('control', { activate: activate, deactivate: deactivate, render: render });
})();
