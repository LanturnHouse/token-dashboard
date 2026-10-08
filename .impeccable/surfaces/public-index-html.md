---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/app.js","public/style.css"]
---

# Surface: main dashboard (public/index.html)

Scope: the whole dashboard page plus its session drawer. Mode: Operate.
Audience/job: the author, glancing from a side monitor for a few seconds: what is running now, how hard tokens are burning, today's total and cost; occasional drill-down into one session.
Constraints: zero dependencies, no external fonts/CDNs, light enough to stay open all day, Korean UI, dark default, model-family colors fixed, no horizontal scroll, sortable headers. Keep all existing data, functions, filters, provider toggle, demo badge, live ticking, drawer polling.
Unresolved: none.

## Direction contract

THESIS: Read token usage like a weather service reads the sky: a large "지금" (now) reading, a 48-hour hourly forecast strip, and an advisory (특보) only when the burn is abnormal. Refuses the category default of a row of equal KPI cards over two charts and a table.

OWN-WORLD: Night-sky navy ground (#0B1220) with a slightly lighter navy work surface; panels divided by 1px hairlines, no shadows, no rounded card stacks; one 12-column cell grid every panel locks to. Mint (#5BE3C0) is reserved exclusively for "running now"; amber (#FF9F43) only for the 특보 advisory. Model-family inks (Opus coral, Sonnet blue, Haiku olive, Fable violet, GPT families) are identical everywhere and brightest when active. System sans with tabular numerals; large light-weight numerals for readings, like a forecast's temperature. Ended sessions carry a quiet "종료" stamp state instead of fading away.

STORY: The visitor sees in one glance whether anything is running and how hard it is burning right now, compares the current hour with the last 48, notices an advisory if one fires, then scans live sessions and drops into the table or a session drawer when needed.

FIRST VIEWPORT: Top bar: product name left, provider toggle and last-update time right, hairline below. Row 1 (12 cols): "지금" block (4 cols): tokens in the last 60 minutes as the large reading with its model-ink split bar, then today's total, today's estimated cost, active time, and the running session count in mint. Beside it (8 cols) the 48-hour hourly strip: one column per hour, stacked model inks, the current hour outlined in mint, day boundaries labeled, hover reveals exact values. A full-width 특보 banner appears above row 1 only when the last hour exceeds 2x the average of the nonzero hours in the 48-hour window (otherwise absent). Row 2: running/idle session cards with mint live indicator and ticking time. Below the fold: 30-day daily (8 cols) and model share (4 cols), GPT rate-limit gauges, then the sessions table.

FORM: 기상청 동네예보 (weather service now + hourly forecast), position 5 on the ordered list; raises kept from ticket wallet (stamped states), Crouwel grid (one cell grid), transit diagram (fixed line inks), orienteering (one color reserved for active), design annual (hairline division). Seed key ae92289f.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
