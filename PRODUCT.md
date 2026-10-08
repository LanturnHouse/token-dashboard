# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primarily the author: a solo developer who runs many Claude Code sessions and sub-agents in parallel (plus some OpenAI Codex/GPT work). The dashboard sits open on a side monitor or a corner window while agents work. Its job is a glance of a few seconds: what is running right now, how much has been used today, and is anything burning unusually fast. Secondary audience: other Claude Code / Codex users who get it from GitHub or YouTube as a free open-source tool.

## Product Purpose

A local, read-only monitor of AI coding-agent token usage. It reads the logs Claude Code (`~/.claude`) and Codex (`~/.codex`) already write and shows tokens, active work time, estimated API list-price cost, and live session/sub-agent activity. Success means the user can answer "what is working now and what is it costing" at a glance, and can drill into one session's per-model and per-agent breakdown when needed.

## Positioning

It is built on the agents' own local transcripts, so it sees per-session and per-sub-agent detail (which model each sub-agent used, how long it worked) and live status, with no account, API key, or network access. It never writes to the logs and can never send input to an agent.

## Operating Context

- Runs as `node server.js` or a single Windows exe; opens at http://localhost:7777, bound to 127.0.0.1 only, no login.
- Refreshes every 5 s; live work-time cells tick every second; an open session drawer polls every 2 s.
- Viewed long-running in a background window, often at narrow or small sizes; occasionally full screen for analysis.
- Demo mode (`--demo`, port 7778) masks titles, paths and prompts for screen recording; videos and screenshots are made from it.

## Capabilities and Constraints

- Providers: Claude Code and Codex, auto-detected; Claude / GPT / 전체 toggle shown only when both exist.
- Data shown: today / 7-day / total tokens (input, output, cache write, cache read), estimated cost, today's active time, running session count; GPT plan rate-limit gauges (5-hour, weekly); live session cards with running sub-agents; 30-day daily and 48-hour hourly stacked charts by model family; model share; sortable, searchable, filterable sessions table; session drawer with per-model (own / agents) and per-agent tables.
- Model families have fixed identity colors (Opus, Sonnet, Haiku, Fable, Claude other; GPT Astra, Sol, Terra, Luna, GPT other) used across every chart, dot and legend.
- Zero dependencies: vanilla HTML/CSS/JS served from `public/` and embedded into the exe; no external fonts, CDNs or libraries; must stay light (it runs all day).
- UI language is Korean. Dark theme is the default; light follows the OS setting.
- Cost is an API list-price estimate, not a bill; some GPT models have no published price ("단가 미설정").
- No horizontal page scroll at any width; table headers are click-to-sort with the arrow left of the label.

## Brand Commitments

- Name: "AI 토큰 사용량 대시보드" (token-dashboard).
- Dark theme default (binding).
- Keep it light: no heavy visuals or effects that cost CPU/GPU in an always-open tab (binding).

## Evidence on Hand

- Real local usage data (tens of sessions, ~1,100 sub-agents, ~11.6B tokens) and the masked demo server for screenshots.
- Screenshots in `docs/images/`, YouTube thumbnail and assets in `docs/youtube/`, demo video https://youtu.be/CYhLtgvjr_0.
- No testimonials, user counts or benchmarks exist; do not invent any.

## Product Principles

1. Glance first: the current state (running now, today's burn) must read in seconds from across the desk.
2. Truth from the logs: show what the transcripts say; label estimates as estimates.
3. Read-only and local, always.
4. Quiet when idle, clear when something is happening.
5. Light enough to leave open all day.
