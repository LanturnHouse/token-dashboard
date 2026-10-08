# Claude Usage Dashboard — Spec

> **변경(2026-10-08):** PIN 로그인 기능은 제거됨. 로컬 전용(127.0.0.1)으로 인증 없이 동작. 아래 PIN/쿠키/로그인 관련 내용은 더 이상 유효하지 않음.

Read-only web dashboard of local Claude Code usage. **Node.js 24, zero npm dependencies** (only built-in modules: http, fs, path, os, crypto, url). Windows host. UI text in Korean.

## Files
- `config.json` — `{ "pin": "1234", "port": 7777, "host": "0.0.0.0", "claudeDir": "" }` (empty claudeDir → `os.homedir()/.claude`). Created with defaults if missing.
- `server.js` — HTTP server + scanner.
- `lib/scanner.js` — data parsing/aggregation (exported `createScanner(claudeDir)` with `refresh()` and `getSnapshot()`).
- `public/index.html`, `public/app.js`, `public/style.css` — dashboard UI.
- `public/login.html` — PIN entry page.
- `start.bat` — `node server.js`.
- `README.md` (Korean): how to set PIN/port, run.

## Data sources (under claudeDir)
1. `projects/<projDir>/<sessionId>.jsonl` — main session transcript, one JSON per line.
2. `projects/<projDir>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json` — subagent transcripts. meta example: `{"agentType":"general-purpose","description":"Port strategies","toolUseId":"toolu_...","spawnDepth":1,"requestShape":"background","model":"sonnet","workflowPhase":"Verify"}` (model / workflowPhase optional).
3. `sessions/<pid>.json` — live processes: `{"pid":16628,"sessionId":"...","cwd":"D:\\x","startedAt":1791432774037,"kind":"interactive","entrypoint":"claude-desktop","name":"title","status":"busy"|"idle","updatedAt":..,"statusUpdatedAt":..}`. Ignore `*.key` files. A session is "live" if its pid file exists AND the process is alive (`process.kill(pid, 0)` in try/catch; EPERM counts as alive).

### Transcript line types (ignore unknown types; skip malformed lines)
- `{"type":"assistant","message":{"id":"msg_..","model":"claude-opus-5-5","usage":{"input_tokens","output_tokens","cache_creation_input_tokens","cache_read_input_tokens"}},"timestamp":"ISO","cwd","sessionId","version"}`
  **IMPORTANT: one API message is split across several lines with the same `message.id`; usage is repeated. Dedupe by message.id — count usage once per id (use the last seen line's usage).** Skip model `"<synthetic>"`.
- `{"type":"user","message":{"role":"user","content": string | array},"timestamp","cwd","isSidechain"}` — a real human prompt is when content is a string, or an array containing a `{"type":"text"}` block and no `tool_result` block. Text starting with `<` (e.g. `<command-name>`, `<system-reminder>`) still counts but strip tags for display. Count prompts and keep the last prompt text (truncate 300 chars).
- `{"type":"custom-title","customTitle":"..."}`, `{"type":"agent-name","agentName":"..."}`, `{"type":"last-prompt","lastPrompt":"..."}` — use for session title (custom-title > agent-name > first prompt truncated 60).
- Any line with `timestamp` contributes to time tracking.

## Incremental parsing (critical: ~1.7GB, 1100+ files)
Per file keep state `{size, offset, mtimeMs, partialLine, ...aggregates, seenMsgIds:Set}`. On refresh: stat; if size < offset → reset and reparse; else read only bytes [offset, size) via `fs.open`/`read` in 4MB chunks, split lines, keep trailing incomplete line in `partialLine`. Don't keep full content in memory. Initial scan async, non-blocking (yield with `setImmediate` between files) so the server answers immediately with `scanning: true, progress`. Refresh every 5 s (only files whose size/mtime changed). Persist cache to `.cache/scan-cache.json` (state minus partial details; seenMsgIds may be dropped if too big — instead store last N=2000 ids) on exit and every 60 s to speed restart; optional, fall back to full scan if invalid.

## Aggregates
Per transcript (session or subagent):
- tokens: `{input, output, cacheCreate, cacheRead, total}` (total = sum of all four) and `byModel: {model: tokens-obj}`.
- `firstTs`, `lastTs` (ms), `wallMs = lastTs-firstTs`, `activeMs` = sum of gaps between consecutive timestamps where gap ≤ 5 min (IDLE_GAP).
- `apiCalls` (unique message ids), `prompts` (human prompts, main sessions only), `lastPrompt`, `title`, `cwd`, `version`, `models` (set → array), `primaryModel` (most output tokens).
- `daily: { "YYYY-MM-DD" (local time): tokens total }` and `hourly` for last 48h: `{ "YYYY-MM-DDTHH": total }`.
Per session: own transcript + `agents: [{agentId, agentType, description, model (meta.model or primaryModel), workflowPhase, tokens, firstTs, lastTs, wallMs, activeMs, apiCalls, running}]`; `sessionTotal` = own + all agents. A subagent `running` = file mtime within last 60 s and session live.
Session `status`: `"busy"|"idle"` from live pid file, else `"ended"`. Session `project` = cwd basename (fallback projDir).

## HTTP API (all require auth except /login, /api/login)
- `POST /api/login` body `{pin}` → if equal (crypto.timingSafeEqual on padded buffers) set cookie `cud_auth=<random token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`; tokens kept in memory Set + persisted to `.cache/tokens.json`. Rate limit: 5 wrong tries per IP per minute → 429.
- `POST /api/logout`.
- `GET /api/summary` → `{scanning, progress:{done,total}, generatedAt, totals:{tokens, byModel, sessions, agents, activeMs}, today:{tokens, byModel, activeMs}, last7d, daily:[{date,total,byModel}] (last 30 days), hourly (last 48h), live:[session summaries currently live], sessions:[summary per session sorted by lastTs desc] }`. Session summary = everything except per-day maps; include `agentCount`, `agentTokens`, own tokens, sessionTotal.
- `GET /api/session/:id` → full session incl. agents list and daily map.
- Static files from `public/`. Unauthed request to `/` → redirect `/login.html`; unauthed `/api/*` → 401.
- No endpoint ever writes to Claude data or sends input to Claude. Server must only read claudeDir.

## UI (dark theme default, light via prefers-color-scheme, Korean labels, responsive)
Top: KPI cards — 오늘 토큰 / 7일 토큰 / 전체 토큰 / 오늘 작업시간(active) / 실행 중 세션 수. Token numbers formatted (1.2M, 34.5K) with tooltip of exact value. Breakdown chips: input / output / cache write / cache read.
"현재 작업 중" panel: live sessions cards with status dot (busy=green pulsing "작업 중", idle=gray "대기"), title, project, cwd, last prompt, elapsed since start, session tokens, running subagents list.
Charts (hand-drawn SVG, no libraries): 30-day daily stacked bars by model family (opus/sonnet/haiku/fable/other with fixed colors) and 48h hourly bars. Hover tooltips.
Model share: horizontal bar of total tokens by model.
Sessions table: search box, filter (전체/실행중/오늘/7일), sortable columns: 상태, 제목, 프로젝트, 모델, 토큰(본인), 에이전트 수, 에이전트 토큰, 합계, 작업시간(active), 경과(wall), 마지막 활동 (relative time). Click row → detail drawer/modal: token breakdown by model, timeline info, last prompt, agents table (유형, 설명, 모델, 토큰, 작업시간, 시작, 상태). 
Auto-refresh every 5 s (keep scroll/open drawer). Show "스캔 중 x/y" banner while scanning. Logout button.
Login page: centered PIN input (inputmode=numeric, password type), Enter submits, error message.
