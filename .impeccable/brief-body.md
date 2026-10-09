# Surface: main dashboard (public/index.html)

Scope: the whole dashboard page plus its session drawer. Mode: Operate.
Audience/job: the author, glancing from a side monitor for a few seconds: what is running now, how hard tokens are burning, and the rhythm of the last weeks; occasional drill-down into one session.
Constraints: zero dependencies, no external fonts/CDNs, light enough to stay open all day, Korean UI, dark default (neutral gray, never blue-tinted), model-family colors fixed, no horizontal page scroll, sortable headers with the arrow left of the label. Keep all existing data and functions (provider toggle, live ticking, drawer polling, filters, 특보 banner, ?theme, ?force-advisory).
Owner feedback baked in: panels must be clearly separated; no "지금" marker on the hourly chart; nothing heavy.
History: replaces the "night forecast" world after the owner compared mockups (comp: .impeccable/review/mocks/b-activity).

## Direction contract

THESIS: Token usage read as a work rhythm, like a developer's contribution graph: WHEN you worked with agents (30 days x 24 hours) is the picture, and the live state sits beside it in a calm side column. Refuses the category default of a KPI-card row stacked over two charts.

OWN-WORLD: Dark neutral gray ground (#121212) with filled panels (#1a1a1a), 1px strong borders, 10px radius, 16px gutters, no shadows. The heat grid speaks in brightness only (five neutral steps from #222 to #f0f0f0), so the rhythm reads before any color does; model inks appear only in bars and dots, and mint is reserved for work running now. Large light numerals for the reading, tabular figures everywhere, generous spacing. The light theme is the same grays inverted.

STORY: In one glance the visitor sees what is running now and how the last 60 minutes compare with usual, then reads the 30-day rhythm, the 48-hour bars and the model split, and finally drops into the session table or a session drawer.

FIRST VIEWPORT: Top bar with product name left; DEMO badge, provider toggle and update time right. A 360px left column: 지금 (72px light numeral for the last 60 minutes, "평소의 N배", family split bar, 오늘/7일/전체 with costs, work time, session and agent counts), 작업 중 list (mint dot for running, hollow for idle), GPT 사용 한도. The right column leads with the 작업 리듬 panel: daily stacked strip aligned above a 24x30 heat grid with hour labels, a legend and the busiest-hours line; then 최근 48시간, then model share beside model cost. The full-width 세션 목록 and the collapsed 가격표 close the page.

FORM: Developer contribution graph (the pick card, "Mock B"), position 1 on the ordered list; seed key ae92289f (re-roll 1).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
