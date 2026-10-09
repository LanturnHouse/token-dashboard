---
name: AI 토큰 사용량 대시보드
description: A local token-usage monitor drawn like a developer's contribution graph - 30 days by 24 hours of work rhythm in brightness alone, with the live state in a calm side column.
colors:
  ground: "#121212"
  surface: "#1a1a1a"
  surface-2: "#222222"
  line: "#2c2c2c"
  line-strong: "#3d3d3d"
  ink: "#ececec"
  ink-2: "#bdbdbd"
  muted: "#9e9e9e"
  live: "#5be3c0"
  advisory: "#ff9f43"
  focus: "#b5b5b5"
  err: "#ff8080"
  heat-1: "#3a3a3a"
  heat-2: "#5c5c5c"
  heat-3: "#8f8f8f"
  heat-4: "#c8c8c8"
  heat-5: "#f0f0f0"
  light-ground: "#ececec"
  light-surface: "#fafafa"
  light-surface-2: "#f0f0f0"
  light-line: "#e2e2e2"
  light-line-strong: "#d0d0d0"
  light-ink: "#1a1a1a"
  light-ink-2: "#3d3d3d"
  light-muted: "#595959"
  light-live: "#08775a"
  light-advisory: "#a94a07"
  light-focus: "#4a4a4a"
  light-err: "#b91c1c"
  ink-opus: "#d97757"
  ink-sonnet: "#6a9bcc"
  ink-haiku: "#788c5d"
  ink-fable: "#b07cc6"
  ink-other: "#888888"
  ink-gpt-astra: "#d4a72c"
  ink-gpt-sol: "#2bb3a3"
  ink-gpt-terra: "#c06c84"
  ink-gpt-luna: "#5cc8e8"
  ink-gpt-other: "#9a9a6a"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Segoe UI Light, Segoe UI, Apple SD Gothic Neo, system-ui, sans-serif"
    fontSize: "72px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  brand:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  body-dense:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
rounded:
  cell: "2px"
  stamp: "3px"
  control: "8px"
  panel: "10px"
  pill: "999px"
  dot: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  gutter: "16px"
  panel-pad: "20px"
  page-pad: "20px"
components:
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  chip-active:
    backgroundColor: "{colors.line}"
    textColor: "{colors.ink}"
  segmented-toggle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "4px 14px"
  segmented-toggle-pressed:
    backgroundColor: "{colors.line}"
    textColor: "{colors.ink}"
  search-input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 12px 0 34px"
  advisory-banner:
    textColor: "{colors.advisory}"
    rounded: "{rounded.panel}"
    padding: "10px 16px"
  badge-ended:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.stamp}"
    padding: "0 6px"
  heat-cell:
    rounded: "{rounded.cell}"
    height: "13px"
  tooltip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "6px"
    padding: "6px 9px"
---

# Design System: AI 토큰 사용량 대시보드

## Overview

**Creative North Star: "The Contribution Graph"**

Token usage is read as a work rhythm, the way a developer reads a contribution graph: when you worked with agents (30 days by 24 hours) is the picture, and the live state sits beside it in a calm 360px side column. The page refuses a row of KPI cards stacked over two charts. A dark neutral gray ground carries filled panels, each closed off by a 1px strong border and a 10px radius, with 16px gutters of ground between them. Nothing casts a shadow.

The heat grid speaks in brightness only: six neutral steps from the panel's own raised fill to near white, so the rhythm reads before any color does. Color is a short list of meanings. Mint means exactly one thing (running now), amber means exactly one thing (the 특보), and the ten model-family inks are a fixed legend that appears only in bars, split strips and dots. Everything else is gray ink on gray fill. One large, light numeral (지금, the last 60 minutes) is the reading; tabular figures keep every other number aligned.

Built to stay open all day: no blur, no gradients, no icon fonts, system fonts only. Motion is a slow opacity pulse on the 작업 중 dot, a 0.6s value flash and a 0.2s drawer slide, all disabled under reduced motion. Dark is the default; the light theme is the same grays inverted, not a different world.

**Key Characteristics:**
- Dark neutral gray ground (#121212, never blue-tinted) with clearly separated filled panels.
- Contribution-graph form: daily stacked strip aligned above a day-by-hour heat grid sharing one column axis.
- Heat in brightness only; mint for running now; amber for the 특보; fixed model inks.
- One 72px weight-300 reading; everything else 12-15px.
- No shadows, no current-time marker on the 48-hour chart, nothing heavy.
- Table sort arrows sit left of header labels.

## Colors

A neutral gray field with two reserved signal colors, a brightness-only heat ramp, and a fixed legend of model inks.

### Primary
- **Running Mint** (`live`; light `light-live`): the only "running now" signal. The pulsing 작업 중 dot, the 작업 중 badge text, the running count in the 지금 facts.

### Secondary
- **Advisory Amber** (`advisory`; light `light-advisory`): the 특보 banner (60% mix border, 11% mix fill over the panel color, full-strength text) and its dismiss button. Absent when there is no advisory.

### Tertiary
- **Model-family inks** (`ink-opus`, `ink-sonnet`, `ink-haiku`, `ink-fable`, `ink-other`, `ink-gpt-astra`, `ink-gpt-sol`, `ink-gpt-terra`, `ink-gpt-luna`, `ink-gpt-other`): product truth, defined once in `FAMILY_COLOR` in app.js. Used in the daily strip, 48-hour bars, the 지금 split bar, model share and cost bars, legends and swatch dots. Identical in both themes.

### Neutral
- **Charcoal Ground** (`ground`): page background, sticky top bar, search field fill.
- **Panel Fill** (`surface`): every panel, the drawer, the sticky table header, the provider toggle.
- **Raised Fill** (`surface-2`): hover fills, tooltip, heat level 0 (`heat-0`, same value).
- **Quiet Rule** (`line`): row rules inside panels, bar and gauge tracks, gridlines, pressed segment and active chip fill.
- **Panel Edge** (`line-strong`): panel borders, control borders, table header rule, drawer edge.
- **Ink / Secondary Ink / Muted Ink** (`ink`, `ink-2`, `muted`): values and headings; supporting text and the default gauge fill; labels, notes, axes, metadata.
- **Focus Gray** (`focus`): focus ring, caret, accent-color, selection, selected-row and value-flash tints.
- **Error Red** (`err`): error banner and gauges at high use only.
- **Heat ramp** (`heat-1` to `heat-5`): contribution cells, dark to light on the dark theme and inverted on the light theme.

### Named Rules
**The Brightness-Only Heat Rule.** The heat grid and its legend use only the neutral ramp. No hue, no model ink, no mint, no amber in a heat cell, ever.

**The Reserved Mint Rule.** Mint appears only where something is running now. If nothing is running, no mint is on screen.

**The Advisory-Only Amber Rule.** Amber is spent only on the 특보 banner. It is never a warning color, a hover color or an accent.

**The Fixed Inks Rule.** A model family has one ink everywhere. Provider badges (Claude / GPT) stay neutral ink on a strong border so they never compete with model inks.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI Light, Segoe UI, Apple SD Gothic Neo, system-ui)
**Body Font:** Segoe UI Variable Text (with Segoe UI, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, sans-serif)
**Label/Mono Font:** none distinct; tabular figures (`font-variant-numeric: tabular-nums`) are set on the body and so apply everywhere.

**Character:** A single Korean-capable system sans (zero-dependency constraint), with `word-break: keep-all` so Hangul wraps at words. Hierarchy comes from one very large light numeral against compact 12-15px text.

### Hierarchy
- **Display** (300, 72px, 1, -0.02em; 60px under 400px wide): the 지금 reading only. One per page.
- **Brand** (600, 18px; 17px on mobile): product name in the top bar.
- **Headline** (600, 15px): panel headings and the drawer title; a muted 12px note sits right-aligned on the same baseline.
- **Title** (600, 14px, 1.35): live-session titles, gauge labels, table titles.
- **Body** (400, 14px, 1.45): base text. **Body-dense** (13px): tables, buttons, model rows, fact captions.
- **Label** (400-500, 12px): notes, axes, legends, table headers, metadata. 11px is used only for the 종료 label and provider badges.

### Named Rules
**The Light Reading Rule.** The headline number is large and light (weight 300), never bold. Size carries the reading; weight goes to headings.

**The Tabular Rule.** Every number that can change lines up: tabular numerals everywhere, right-aligned in tables and fact lists.

## Layout

One centered column, max 1400px, 20px side padding (14px under 600px). Below the top bar, an optional status banner and the 특보 sit above a two-column grid: a fixed 360px left column and a fluid right column, 16px gap. The left column stacks 지금, 작업 중 and (GPT only) 사용 한도. The right column leads with 작업 리듬, then 최근 48시간, then 모델별 점유율 beside 모델별 추정 비용. The 세션 목록 and the collapsed 가격표 span full width below. At 1099px the paired model panels stack; at 999px the two columns collapse to one.

Panels pad 20px (16px under 600px). The 작업 리듬 panel is one coordinate system: a 44px label gutter plus N equal day columns at 3px column gap; the daily strip (96px tall, bars 72% of column width on a strong baseline), the date row and the 13px-cell hour grid share it. The sessions table never scrolls horizontally: columns drop in a fixed order at 1350, 1100, 820 and 520px. The top bar is sticky 56px, and becomes a static two-row grid under 600px. The drawer slides in from the right at min(720px, 100%).

## Elevation & Depth

Flat. There are no box-shadows. Separation is a filled panel (`surface`) on the ground, outlined by a 1px `line-strong` border, with 16px of ground between panels; inside a panel, items are divided by 1px `line` rules. The only overlay is the drawer scrim (`rgba(0,0,0,.6)`) behind a panel-colored drawer with a strong left edge.

### Named Rules
**The Separated Panel Rule.** Panels are unmistakably separate: fill, strong border, radius and a gutter of ground, never shadows. A new section is a new panel with a heading row, not a divider inside an existing one.

## Shapes

Soft but not bubbly. Panels and the 특보 banner take 10px; inputs and buttons 8px; pills (toggle, chips, demo badge, dismiss button) are fully round; heat cells, swatches and bar tops take 2px; the 종료 label takes 3px and provider badges 4px. Status dots are 8px circles: filled for 작업 중, a 1.5px hollow ring for 대기. Bars (split strip, tracks, gauges) are rounded to half their height. The prompt quote is a single 1px left rule.

## Components

### Panels
- **Corner Style:** 10px. **Background:** `surface`. **Border:** 1px `line-strong`. **Padding:** 20px. **Heading row:** h2 left, muted 12px note right, 14px below.

### Buttons
- **Shape:** 8px, 1px strong border, transparent fill, 13px, 6px 12px (drawer 닫기).
- **Hover / Focus:** `surface-2` fill; 2px focus outline offset 2px.

### Chips and provider toggle
- Chips are pills with a strong border, secondary ink, 12px; active takes the `line` fill, ink and weight 600 (filters 전체 / 작업 중 / 오늘 / 7일).
- The provider toggle is a pill group on `surface` with a strong border; pressed segment goes `line` fill, ink, 600. Shown only when both providers exist.

### Inputs / Fields
- Search: 34px tall, 8px radius, strong border, `ground` fill, search glyph drawn as inline SVG at left; focus is a 2px focus outline.

### Navigation
A sticky top bar on the ground color with a 1px `line` rule below: product name left; DEMO badge (pill, strong border, only in demo mode), provider toggle and muted update time right.

### 지금 reading
Heading, the 72px display numeral, a muted 13px caption (최근 60분), the "평소의 N배" line (ink-2; ink and 600 when high), a 6px rounded split bar in model inks, then hairline-ruled fact rows (label ink-2 left, value 600 right; the running count in mint) and a collapsible input / output / cache breakdown.

### Heat grid (signature)
Daily stacked strip above a day-by-hour grid of 13px cells (2px radius, 3px gap) in six brightness steps; hover outlines a cell in ink. Hour labels at left, date labels beneath the strip, a legend (적음 to 많음 swatches) and the busiest-hours line below.

### Status badges
작업 중: mint text, mint 8px dot pulsing in opacity over 3.6s. 대기: muted text, hollow ring. 종료: 11px ink-2 label with a 1px muted border, 3px radius, no dot.

### 특보 advisory banner
Full width above the grid, only when the last hour runs well above usual. Amber at 60% border, 11% fill, full-strength 14px/600 text, a pill dismiss button (이번 시간 닫기) at right.

### Charts and bars
48-hour chart: SVG stacked bars in model inks, muted 12px axes, `line` gridlines, hover wash at 7% ink and a `surface-2` tooltip. No current-time marker. Model share and cost rows: 8px dot, name, 8px rounded track, percent or cost, 44px min row height.

### Sessions table
13px, `line` row rules, sticky muted 12px header on `surface` with a strong rule. Every header is a sort button with the 10px chevron left of the label (45% opacity, full ink when sorted). Rows hover to `surface-2`, selected rows take a 13% focus tint.

## Do's and Don'ts

### Do:
- **Do** put every new section in a panel: `surface` fill, 1px `line-strong` border, 10px radius, 20px padding, heading row.
- **Do** render any frequency or intensity as the neutral heat ramp (`heat-0` to `heat-5`), brightness only.
- **Do** keep mint for running-now signals and amber for the 특보 only.
- **Do** take model colors from `FAMILY_COLOR`; the same family is the same ink in every chart, legend and dot, in both themes.
- **Do** use tabular numerals and right-align numbers in tables and fact lists.
- **Do** place sort chevrons to the left of header labels in every sortable table.
- **Do** define colors as custom properties with dark default and light values, honoring `prefers-color-scheme`, `data-theme` and `?theme=light|dark`.
- **Do** keep motion to the dot pulse, the value flash and the drawer slide, and switch it off under `prefers-reduced-motion`.

### Don't:
- **Don't** tint the ground or panels blue; grays stay neutral.
- **Don't** add box-shadows, gradients, blur or any effect that costs CPU or GPU in an always-open tab.
- **Don't** add a "지금" marker or current-hour highlight to the 48-hour chart.
- **Don't** use mint or amber as generic accents, hover colors or brand color, and never inside the heat grid.
- **Don't** recolor a model family per chart or theme, or tint provider badges with model inks.
- **Don't** load web fonts, icon fonts or CDN assets; the stack is system fonts only.
- **Don't** bold the 지금 reading; it stays at weight 300.
- **Don't** let the page scroll horizontally; hide table columns in order instead.
