# v2 changes (contract shared by backend + frontend)

## 1. Estimated cost (backend: lib/scanner.js + new lib/pricing.js)
`lib/pricing.js` exports `PRICES` and `priceFor(model)` and `costOf(rec)`. USD per 1M tokens:

| match (substring of model id, check in this order) | input | output | cacheRead |
|---|---|---|---|
| `fable` or `mythos` | 10 | 50 | 0.25 |
| `opus-5-5` | 4 | 20 | 0.20 |
| `opus-5`, `opus-4-8`, `opus-4-7`, `opus-4-6`, `opus-4-5` | 5 | 25 | 0.50 |
| `opus` (other/older, e.g. opus-4-1, opus-4) | 15 | 75 | 1.50 |
| `sonnet-4-6` | 3 | 15 | 0.30 |
| `sonnet-4-5`, `sonnet-4` (older 4.x) | 3 | 15 | 0.30 |
| `sonnet` (5.5, 5 and anything else) | 2 | 10 | 0.20 |
| `haiku-5-5` | 0.10 | 0.50 | 0.01 |
| `haiku-4-5` | 1 | 5 | 0.10 |
| `haiku` (other) | 1 | 5 | 0.10 |
| default (unknown) | use opus-5-5 prices |

Cache writes: 5-minute TTL = 1.25 × input, 1-hour TTL = 2 × input.
From usage: `cache_creation.ephemeral_1h_input_tokens` (1h writes); 5m writes = `cache_creation_input_tokens - 1h` (min 0). If `usage.speed === "fast"`, multiply the whole record cost by 2.
`cost = (input*in + output*out + cw5m*in*1.25 + cw1h*in*2 + cacheRead*read) / 1e6`.

Every token object (`{input, output, cacheCreate, cacheRead, total}`) gains two fields: `cacheCreate1h` (subset of cacheCreate) and `cost` (USD, float). `total` stays the token sum (excludes cost). Make addTok/addInto/copyTok/zeroTok handle the new fields so every aggregate (totals, today, last7d, byModel, daily, session, agent, sessionTotal, agentTokens) automatically carries cost.
summary gains `pricing: { note: "API 정가 기준 추정치 (구독 요금과 무관)", table: [...rows above...] }`.
daily entries gain `cost` (number) and `costByFamily {opus,sonnet,haiku,fable,other}`.

## 2. Hourly by model family (backend)
Per transcript hourly becomes `{ 'YYYY-MM-DDTHH': { opus, sonnet, haiku, fable, other, cost } }` (token totals per family). summary keeps `hourly: {key: number}` (sum) for compatibility AND adds `hourlyByFamily: { key: {opus,sonnet,haiku,fable,other} }` (48 zero-filled keys, chronological) and `hourlyCost: {key: number}`.
Bump CACHE_VERSION so old caches are discarded.

## 3. Frontend (public/*)
- **Every table sortable by clicking its header**: sessions table, drawer "by model" breakdown table, drawer agents table, and any other table. Generic implementation (e.g. `data-sort` + `data-type="num|text"` on th, sort state per table id, survives the 5 s refresh). Clicking the same header toggles asc/desc; first click on numeric columns = desc, text = asc.
- **Sort arrow (▲/▼) appears on the LEFT of the header label** (e.g. `▼ 토큰`), only on the active column. Keep header buttons right-aligned for numeric columns.
- **Hourly chart (48h)**: stacked bars by model family, same colors as daily chart (opus=#d97757, sonnet=#6a9bcc, haiku=#788c5d, fable=#b07cc6, other=#888). Tooltip lists per-family tokens + estimated cost for that hour. Add a legend like the daily chart.
- **Estimated cost**: 
  - KPI cards: show `≈ $123.45` under today / 7d / total token numbers (format: `$1,234` when ≥ 1000, else 2 decimals).
  - Add a KPI or small line "추정 비용" explanation tooltip: `API 정가 기준 추정치 — 실제 구독 요금과 다를 수 있음`.
  - Daily chart tooltip shows cost. Model share section shows cost per model alongside tokens.
  - Sessions table: new sortable column `추정 비용` (sessionTotal.cost) next to 합계.
  - Live cards: session cost.
  - Drawer: cost per model in breakdown table (new column), cost per agent in agents table (new column), session total cost.
  - Small "가격표" expandable (details/summary) at the bottom showing summary.pricing.table.
