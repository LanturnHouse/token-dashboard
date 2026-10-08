# v3: multi-provider (Claude + GPT/Codex)

On startup, auto-detect which providers have local usage logs:
- **claude**: `~/.claude/projects` exists and has `*.jsonl` (current behaviour).
- **codex** (GPT): `~/.codex/sessions/**/rollout-*.jsonl` exists. Override dir via config `codexDir` ("" → `os.homedir()/.codex`).
If a provider has no logs, it simply doesn't appear (no errors, no empty UI for it). Re-check every 60 s so a newly installed provider shows up without restart.

## Codex log format (one JSON per line, `{timestamp, type, payload}`)
- `type:"session_meta"` → payload `{id, session_id, cwd, originator, cli_version, model_provider, source, parent_thread_id?, agent_nickname?}`.
  - `source` is `"vscode"` / `"cli"` / … for a main session, or `{"subagent": {...}}` for a subagent:
    - `{"subagent":{"thread_spawn":{"parent_thread_id":"…","depth":1,"agent_path":…}}}` → spawned agent of that parent.
    - `{"subagent":{"other":"guardian"}}` → the auto-review agent; parent = `payload.parent_thread_id` if present.
  - A subagent whose parent id resolves to a known session is listed in that session's `agents` (agentType = `thread_spawn` → agent_nickname or "subagent", guardian → "guardian"); if the parent is unknown, show it as its own session.
- `type:"turn_context"` → payload has `model` (e.g. `gpt-6-astra`, `gpt-5.6-sol`, `codex-auto-review`), `cwd`, `effort`. The current model applies to following token events.
- `type:"event_msg"`, payload.type:
  - `token_count` → `payload.info.last_token_usage` = `{input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}` for ONE API call. **OpenAI semantics: `cached_input_tokens` is a subset of `input_tokens`.** Map to our token object: `input = input_tokens - cached_input_tokens - cache_write_input_tokens` (min 0), `cacheRead = cached_input_tokens`, `cacheCreate = cache_write_input_tokens`, `output = output_tokens` (reasoning is already inside output; don't add). Ignore events where `info` is null or all four are 0. Ignore `total_tokens` (unreliable in imported sessions). Each non-zero token_count = 1 apiCall. Dedupe: skip an event identical to the previous one in the same file with the same timestamp.
  - `payload.rate_limits` (when non-null) → keep the latest per provider: `{primary:{used_percent, window_minutes, resets_at}, secondary:{…}, plan_type}`. Expose in summary as `providers.codex.rateLimits` and show it in the UI as two small gauges ("5시간 한도 4%", "주간 한도 1%", with reset time) on the GPT side.
  - `user_message` → human prompt (`payload.message`, strip `<system-reminder>…</system-reminder>` blocks and tags; skip if empty after stripping). Counts prompts, lastPrompt, first prompt for title.
  - `task_started` / `task_complete` → status: session is `busy` if the last of these is task_started and the file mtime is within 10 min; `idle` if file mtime within 30 min; else `ended`. Codex has no pid files.
- Session title: `~/.codex/session_index.jsonl` may map ids to thread names — use it if present (inspect the file; be defensive), else first prompt (60 chars).
- Sessions whose `originator` contains "import" or whose agent messages are `[external_agent_tool_call…` imports from Claude: mark `imported: true`, and EXCLUDE them from totals (they duplicate Claude usage), but list them only if they have real token_count usage.

## Data model changes
- Every session and agent gets `provider: "claude" | "codex"`.
- Model family: add `gpt` family (any model id starting with `gpt` or `codex` or `o1/o3/o4`), color `#d4a72c`. `FAMILIES` everywhere (backend byFamily, hourlyByFamily, dailyByFamily, costByFamily; frontend colors/legends) gains `gpt`.
- Pricing: GPT prices are unknown to us → `config.json` gets `"codexPricing": {}` (model-substring → `{input, output, cacheRead, cacheWrite}` USD/MTok). If no matching entry, cost = 0 and the token object gets `costUnknown: true` (propagate: an aggregate is costUnknown if any part is). UI shows "단가 미설정" instead of $0 for those, and the pricing details panel explains how to set `codexPricing` in config.json.
- `/api/summary?provider=claude|codex|all` (default `all`) and `/api/session/:id` work across providers (ids are unique; prefix not needed). All totals/today/last7d/daily/hourly/model share/live/sessions are computed for the selected provider filter. Summary includes `providers: { claude: {available:true, sessions:n}, codex: {available:true, sessions:n, rateLimits} }` (only detected providers present) regardless of filter.
- The demo/mask mode (lib/mask.js) must mask codex sessions too (titles, cwd, prompts, nicknames) — run its leak check again.

## UI
- When more than one provider is available: a segmented toggle in the top bar — `Claude` / `GPT` / `전체`. Remember the choice in localStorage (try/catch). Default `전체`. When only one provider is available, hide the toggle entirely and just show that provider.
- Header title: "AI 토큰 사용량 대시보드" (page `<title>` too).
- Sessions table: small provider badge (Claude / GPT) in the 제목 cell when filter = 전체.
- Live panel includes busy/idle Codex sessions.
- Everything else (sorting, live ticking, drawer, colors) works the same for Codex sessions.
