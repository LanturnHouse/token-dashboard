'use strict';
// Estimated API list-price cost (USD). Pure functions, no I/O.
// Rows are checked in order; the first row whose `match` substring appears in the model id wins.

const NOTE = 'API 정가 기준 추정치 (구독 요금과 무관)';
const CACHE_WRITE_5M_MULT = 1.25; // 5-minute TTL cache write = 1.25 x input price
const CACHE_WRITE_1H_MULT = 2;    // 1-hour TTL cache write = 2 x input price
const FAST_MULT = 2;              // usage.speed === 'fast' doubles the record cost

const PRICES = [
  { match: ['fable', 'mythos'], label: 'fable, mythos', input: 10, output: 50, cacheRead: 0.25 },
  { match: ['opus-5-5'], label: 'opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
  { match: ['opus-5', 'opus-4-8', 'opus-4-7', 'opus-4-6', 'opus-4-5'], label: 'opus-5, opus-4-5..4-8', input: 5, output: 25, cacheRead: 0.5 },
  { match: ['opus'], label: 'opus (older)', input: 15, output: 75, cacheRead: 1.5 },
  { match: ['sonnet-4-6'], label: 'sonnet-4-6', input: 3, output: 15, cacheRead: 0.3 },
  { match: ['sonnet-4-5', 'sonnet-4'], label: 'sonnet-4.x (older)', input: 3, output: 15, cacheRead: 0.3 },
  { match: ['sonnet'], label: 'sonnet (5.5, 5, other)', input: 2, output: 10, cacheRead: 0.2 },
  { match: ['haiku-5-5'], label: 'haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01 },
  { match: ['haiku-4-5'], label: 'haiku-4-5', input: 1, output: 5, cacheRead: 0.1 },
  { match: ['haiku'], label: 'haiku (other)', input: 1, output: 5, cacheRead: 0.1 },
];

// Used when no row matches. Same prices as opus-5-5.
const DEFAULT_PRICE = { match: [], label: 'default (unknown)', input: 4, output: 20, cacheRead: 0.2 };

function priceFor(model) {
  const m = String(model || '').toLowerCase();
  for (const row of PRICES) {
    if (row.match.some((s) => m.includes(s))) return row;
  }
  return DEFAULT_PRICE;
}

// rec: { model, input, output, cacheCreate, cacheCreate1h, cacheRead, fast }
// cacheCreate is the total cache write; cacheCreate1h is the 1-hour subset of it.
function costOf(rec) {
  const p = priceFor(rec.model);
  const input = Number(rec.input) || 0;
  const output = Number(rec.output) || 0;
  const cw = Number(rec.cacheCreate) || 0;
  const cw1h = Math.min(Number(rec.cacheCreate1h) || 0, cw);
  const cw5m = Math.max(0, cw - cw1h);
  const read = Number(rec.cacheRead) || 0;
  let usd =
    (input * p.input +
      output * p.output +
      cw5m * p.input * CACHE_WRITE_5M_MULT +
      cw1h * p.input * CACHE_WRITE_1H_MULT +
      read * p.cacheRead) / 1e6;
  if (rec.fast) usd *= FAST_MULT;
  return usd;
}

// Table for summary.pricing.table (display rows, USD per 1M tokens).
function pricingTable() {
  return [...PRICES, DEFAULT_PRICE].map((r) => ({
    match: r.label,
    input: r.input,
    output: r.output,
    cacheRead: r.cacheRead,
    cacheWrite5m: +(r.input * CACHE_WRITE_5M_MULT).toFixed(4),
    cacheWrite1h: +(r.input * CACHE_WRITE_1H_MULT).toFixed(4),
  }));
}

// GPT (OpenAI Codex) list prices, USD per 1M tokens. Source: OpenAI official pricing page,
// standard tier, short context (<=272K), checked 2026-10-08. Matched by substring, longest key first.
const GPT_NOTE = '출처: OpenAI 공식 가격표, 2026-10-08 기준, 단기 컨텍스트(≤272K). ' +
  'ChatGPT 요금제(plan_type)로 쓴 Codex 사용량은 토큰 단위로 과금되지 않으며, API 정가 기준 추정치입니다.';
const GPT_PRICES = {
  'gpt-6-astra': { input: 10, cacheRead: 1.0, cacheWrite: 12.5, output: 50 },
  'gpt-6.1-sol': { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 },
  'gpt-6-sol': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  'gpt-6-luna': { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-5.6-sol': { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 20 },
  'gpt-5.6-terra': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cacheRead: 0.02, cacheWrite: 0.25, output: 1.2 },
  'gpt-5.3-codex': { input: 1.75, cacheRead: 0.175, cacheWrite: 1.75, output: 14 },
};

// Merge: config.codexPricing entries (same key replaces, new keys added) over the built-in table.
// Returns rows [{match, input, output, cacheRead, cacheWrite}] in match order (longest key first).
// Unknown models (e.g. codex-auto-review) match nothing and are reported as costUnknown.
function codexPriceRows(configPricing) {
  const merged = {};
  for (const k of Object.keys(GPT_PRICES)) merged[k] = { ...GPT_PRICES[k] };
  const cfg = configPricing && typeof configPricing === 'object' ? configPricing : {};
  for (const k of Object.keys(cfg)) {
    const v = cfg[k];
    if (!v || typeof v !== 'object' || !k) continue;
    const input = Number(v.input), output = Number(v.output);
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
    merged[k.toLowerCase()] = {
      input, output,
      cacheRead: Number.isFinite(Number(v.cacheRead)) ? Number(v.cacheRead) : input,
      cacheWrite: Number.isFinite(Number(v.cacheWrite)) ? Number(v.cacheWrite) : input,
    };
  }
  return Object.keys(merged)
    .sort((a, b) => b.length - a.length)
    .map((k) => ({ match: k.toLowerCase(), ...merged[k] }));
}

// GPT cost for one API response (usd). unknown=true when no row matches.
function codexCostOf(rows, model, input, output, cacheRead, cacheWrite) {
  const m = String(model || '').toLowerCase();
  const row = rows.find((r) => m.includes(r.match));
  if (!row) return { cost: 0, unknown: true };
  const usd = (input * row.input + cacheRead * row.cacheRead + cacheWrite * row.cacheWrite + output * row.output) / 1e6;
  return { cost: usd, unknown: false };
}

module.exports = {
  PRICES,
  DEFAULT_PRICE,
  NOTE,
  FAST_MULT,
  GPT_NOTE,
  GPT_PRICES,
  priceFor,
  costOf,
  pricingTable,
  codexPriceRows,
  codexCostOf,
};
