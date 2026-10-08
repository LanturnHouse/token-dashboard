---
name: AI 토큰 사용량 대시보드
description: A local token-usage monitor read like a weather service reads the sky - a large 지금 reading, a 48-hour hourly strip, and a 특보 only when the burn is abnormal.
colors:
  night-ground: "#161616"
  night-surface: "#1e1e1e"
  night-surface-raised: "#262626"
  hairline: "#2e2e2e"
  hairline-strong: "#3d3d3d"
  ink: "#ececec"
  ink-secondary: "#bdbdbd"
  ink-muted: "#a3a3a3"
  live-mint: "#5be3c0"
  advisory-amber: "#ff9f43"
  focus-steel: "#b5b5b5"
  error-red: "#ff8080"
  day-ground: "#ebebeb"
  day-surface: "#fafafa"
  day-surface-raised: "#f0f0f0"
  day-hairline: "#d6d6d6"
  day-hairline-strong: "#b8b8b8"
  day-ink: "#1a1a1a"
  day-ink-secondary: "#3d3d3d"
  day-ink-muted: "#575757"
  day-live-mint: "#08775a"
  day-advisory-amber: "#a94a07"
  day-focus-steel: "#4a4a4a"
  day-error-red: "#b91c1c"
  ink-opus: "#d97757"
  ink-sonnet: "#6a9bcc"
  ink-haiku: "#788c5d"
  ink-fable: "#b07cc6"
  ink-claude-other: "#888888"
  ink-gpt-astra: "#d4a72c"
  ink-gpt-sol: "#2bb3a3"
  ink-gpt-terra: "#c06c84"
  ink-gpt-luna: "#5cc8e8"
  ink-gpt-other: "#9a9a6a"
typography:
  display:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 5.2vw, 4.75rem)"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  body-dense:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  axis:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Malgun Gothic, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  hairline: "2px"
  sm: "3px"
  dot: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  cell-x: "22px"
  cell-y: "20px"
  page-gutter: "24px"
components:
  cell:
    backgroundColor: "{colors.night-surface}"
    padding: "20px 22px"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-hover:
    backgroundColor: "{colors.night-surface-raised}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "3px 10px"
  chip-active:
    textColor: "{colors.ink}"
  segmented-toggle:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
    typography: "{typography.label}"
  search-input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  live-card:
    backgroundColor: "{colors.night-surface}"
    padding: "14px 16px"
  live-card-hover:
    backgroundColor: "{colors.night-surface-raised}"
  advisory-banner:
    textColor: "{colors.advisory-amber}"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  badge-ended:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.hairline}"
    padding: "0 6px"
  tooltip:
    backgroundColor: "{colors.night-surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 9px"
---

# Design System: AI 토큰 사용량 대시보드

## Overview

**Creative North Star: "The Night Forecast Office"**

The dashboard reads token usage the way a weather service reads the sky. One large, light-weight numeral (지금, the last 60 minutes) is the temperature; a 48-hour hourly strip is the forecast; an amber 특보 appears only when the burn is abnormal and is otherwise absent. Everything sits on a dark neutral gray ground, divided into one 12-column cell grid by 1px hairlines. Nothing floats, nothing casts a shadow, and nothing is stacked as a rounded card.

Color is spent like a signal budget. Mint means exactly one thing (running now), amber means exactly one thing (an advisory), and the model-family inks are a fixed transit-map legend that never changes meaning between charts, dots and legends. All remaining chrome is neutral gray, ink and hairline. Density is that of an instrument panel: 13-14px tabular text, compact controls, generous reading numerals.

The page is built to stay open all day on a side monitor. Motion is limited to slow opacity pulses on live signals and a 0.2s drawer slide, all disabled under reduced motion. Dark is the default; the light theme is a daylight transposition of the same world, not a different one.

**Key Characteristics:**
- Dark neutral gray ground (no blue cast, per the user) with a slightly lighter work surface, divided by 1px hairlines.
- One 12-column cell grid that every panel and the live-session cards lock to.
- Mint reserved for running now; amber reserved for 특보.
- Fixed model-family inks, identical everywhere, brightest when active.
- System sans with tabular numerals; a 300-weight forecast-temperature reading.
- Ended sessions carry a tilted 종료 stamp instead of fading out.

## Colors

A dark neutral gray field carrying two reserved signal colors and a fixed legend of model-family inks.

### Primary
- **Running Mint** (`live-mint`; daylight `day-live-mint`): the only "running now" signal. Used on the 작업 중 badge and its pulsing dot, the running-session count in the 지금 facts, and the current-hour outline, tick and 지금 label on the hourly strip. Never decorative, never a generic accent.

### Secondary
- **Advisory Amber** (`advisory-amber`; daylight `day-advisory-amber`): the 특보 color. Used on the advisory banner (60% mix border, 11% mix fill, full-strength text), its 이번 시간 닫기 button, and the "평소의 N배" comparison under the reading when the hour runs hot. Absent when there is no advisory.

### Tertiary
- **Model-family inks** (`ink-opus`, `ink-sonnet`, `ink-haiku`, `ink-fable`, `ink-claude-other`, `ink-gpt-astra`, `ink-gpt-sol`, `ink-gpt-terra`, `ink-gpt-luna`, `ink-gpt-other`): product truth, defined once in `FAMILY_COLOR` in app.js and shared by the hourly and daily stacked bars, the 지금 split bar, model-share bars, legends and model swatches. They are the same in both themes.

### Neutral
- **Night Ground** (`night-ground`): page background and sticky top bar.
- **Night Surface** (`night-surface`): every grid cell, live card, drawer and sticky table header.
- **Raised Surface** (`night-surface-raised`): hover fills for cards, rows, buttons and chips; chart and gauge tracks; tooltip; mini-table header.
- **Hairline** (`hairline`): the 1px grid gaps, fact and key/value row rules, table row rules, chart gridlines.
- **Strong Hairline** (`hairline-strong`): control borders (buttons, chips, search, segmented toggle, badges), table header rule, day separators in charts, drawer edge, the prompt quote rule.
- **Ink / Secondary Ink / Muted Ink** (`ink`, `ink-secondary`, `ink-muted`): primary values and headings / supporting values, prompt text, idle badge / labels, dt terms, axis text, metadata.
- **Focus Steel** (`focus-steel`): focus rings, caret, selected chip and pressed toggle (18% mix), selected row (13% mix), the value-increase flash (30% mix fading out), and the default gauge fill.
- **Error Red** (`error-red`): error banner and gauges at high use only.

### Named Rules
**The Reserved Mint Rule.** Mint appears only where something is running now. If nothing is running, no mint is on screen except the current-hour marker.

**The Advisory-Only Amber Rule.** Amber is spent only on the 특보 and the hot-hour comparison. It is never a warning color for anything else.

**The Fixed Inks Rule.** A model family has one ink everywhere, in both themes. Provider badges (Claude / GPT) stay neutral ink on a strong hairline so they never compete with model inks. Inactive sessions dim their swatch (0.55 opacity); active ones show full strength.

## Typography

**Display Font:** system sans stack (Pretendard if installed locally, Apple SD Gothic Neo, Malgun Gothic, system-ui, Segoe UI, sans-serif)
**Body Font:** the same stack
**Label/Mono Font:** none distinct; numbers use tabular figures (`font-variant-numeric: tabular-nums`) on the body element and every numeric surface.

**Character:** A single Korean-capable system sans, no web fonts (zero-dependency constraint). Hierarchy comes from size and weight contrast: one oversized 300-weight numeral against compact 600-weight headings.

### Hierarchy
- **Display** (300, clamp(3rem, 5.2vw, 4.75rem), 1, -0.03em): the 지금 reading only. One per page.
- **Headline** (600, 15px, -0.01em): cell headings (지금, 시간별 토큰, 현재 작업 중), brand, drawer title; a muted 12px qualifier may follow inline (최근 48시간).
- **Title** (600, 14px): live-card session titles.
- **Body** (400, 14px, 1.5): base text. **Body-dense** (13px) for facts, key/value lists, the sessions table, buttons and banners.
- **Label** (600, 12px): badges, segmented toggle, table header, legends and metadata (12px regular).
- **Axis** (400, 11px, tabular): chart axes, rate-gauge footnotes, demo badge and 종료 stamp (11px, 600, 0.04em).

### Named Rules
**The Forecast Reading Rule.** The headline number is large and light (weight 300), never bold. Weight goes to headings and labels, size goes to the reading.

**The Tabular Rule.** Every number that can change lines up: tabular numerals everywhere, right-aligned in tables and fact lists.

## Layout

One centered column (max 1400px; 20px side padding, 24px from 1000px, 14px under 600px). Below the top bar, an optional status banner and the 특보 sit above a single 12-column grid whose 1px gaps are filled with the hairline color, so the gaps themselves draw the dividers. Cells span 4, 8 or 12 columns from 1000px up and all cells go full width below. Row 1 is 지금 (4) beside the hourly strip (8); then 현재 작업 중 (12); then daily (8) beside model share (4); rate-limit gauges (12); sessions table (12); pricing details (12).

Cells pad 20px by 22px (16px by 14px under 600px). Live-session cards bleed to the cell edges and form their own 12-column sub-grid of thirds (halves under 800px, single column under 600px); a short final row stretches its rules to the row end while keeping content the width of its neighbours. Charts fill the row height on desktop (min 220px) and fix to 240px below 1000px.

The sessions table never scrolls horizontally: columns are hidden in a fixed order at 1350, 1100, 820 and 520px. The top bar is sticky, and becomes a static two-row grid under 600px. The session drawer slides in from the right at min(720px, 100%).

## Elevation & Depth

Flat. There are no box-shadows anywhere. Depth is tonal: ground, then surface, then raised surface for hover and tracks, with hairlines separating planes. The only overlay is the drawer scrim (`rgba(3, 7, 14, .6)`) behind a surface-colored drawer with a strong-hairline left edge.

### Named Rules
**The Hairline Grid Rule.** Panels are separated by 1px lines, not by shadows, gaps of ground, or rounded card silhouettes. A new panel joins the 12-column grid as another cell.

## Shapes

Square-edged. Cells and live cards have no radius at all; their edges are the grid lines. Controls take a barely-softened 3px corner (buttons, chips, search, segmented toggle, banners, tooltip, table wrapper); small badges and swatches take 2px. The only round forms are status dots (6px circles: filled for 작업 중, hollow ring for 대기). The 종료 stamp is a 1px-bordered label rotated -4deg, like an ink stamp on a ticket. The prompt quote is marked by a single 1px left rule.

## Components

### Buttons
- **Shape:** 3px corners, 1px strong-hairline border, transparent fill.
- **Default:** inherits ink, 13px, 6px 12px padding (close button in the drawer).
- **Hover / Focus:** raised-surface fill; 2px focus-steel outline offset 2px.
- **Advisory close:** amber text and 60%-amber border, 12px/600, hover fills amber at 16%.

### Chips
- **Style:** transparent, strong-hairline border, secondary ink, 12.5px, 3px 10px.
- **State:** hover raises the fill and inks the text; active takes a focus-steel border and an 18% focus-steel fill. Filters 전체 / 작업 중 / 오늘 / 7일.

### Segmented toggle (provider)
A single strong-hairline outline with internal 1px dividers; muted 12px labels; the pressed segment goes ink, 600, 18% focus-steel fill. Shown only when both providers exist.

### Cards / Containers
- **Corner Style:** none (cells, live cards).
- **Background:** night surface; live cards raise on hover and are keyboard-focusable with an inset focus ring.
- **Shadow Strategy:** none (see Elevation).
- **Border:** formed by the hairline grid; live cards draw top and left hairlines into the cell's grid.
- **Internal Padding:** cells 20px 22px; live cards 14px 16px with 6px internal rhythm.

### Inputs / Fields
- **Style:** search field, transparent, strong-hairline border, 3px corners, 6px 10px, muted placeholder, min 270px (full width on mobile).
- **Focus:** border and 2px outline both switch to focus steel.

### Navigation
A sticky top bar on the ground color with a hairline below: brand left (15px/600); demo badge, provider toggle and muted 갱신 time right. Under 600px it becomes two rows and stops sticking.

### Status badges
작업 중: mint text and a mint 6px dot pulsing in opacity over 3s. 대기: secondary ink with a hollow ring. 종료: muted 11px stamp, 1px border, 2px corners, rotated -4deg, no dot.

### 특보 advisory banner
Full width above row 1, only when the last hour exceeds twice the average of the nonzero hours in the 48-hour window. Amber at 60% for the border, 11% for the fill, full strength for 14px/600 text; a dismiss button for the hour on the right.

### 지금 reading block
Headline, the display reading, a muted caption (최근 60분), the comparison line (amber when hot), a 4px model-ink split bar on a raised track, then a hairline-ruled fact list (dt muted left, dd tabular right) with the running count in mint, and a collapsible input/output/cache breakdown.

### Hourly forecast strip
SVG stacked bars in model inks, one per hour, muted 11px axes, hairline gridlines, strong-hairline day separators with day labels. The current hour is outlined in mint (1.5px) with a mint tick and a 지금 label, pulsing slowly in opacity (3.6s). Hover lifts a 7%-ink column and shows a raised tooltip.

### Sessions table
13px, hairline row rules, sticky muted 12px header on the surface color with a strong-hairline rule. Every header is a sort button with a 10px chevron left of the label (40% opacity, full ink when sorted). Rows raise on hover and take a 13% focus-steel fill when selected.

### Rate gauges
6px square-ended bars on a raised track, focus-steel fill, error red at high use, 13px tabular label row and 11px muted footnote.

## Do's and Don'ts

### Do:
- **Do** put every new panel into the 12-column hairline grid as a span-4, span-8 or span-12 cell.
- **Do** keep mint for running-now signals and amber for the 특보 only.
- **Do** take model colors from `FAMILY_COLOR`; the same family is the same ink in every chart, legend, swatch and theme.
- **Do** use tabular numerals for every value and right-align numbers in tables and fact lists.
- **Do** mark ended sessions with the tilted 종료 stamp rather than fading them.
- **Do** keep motion to slow opacity pulses and the 0.2s drawer slide, and switch it off under `prefers-reduced-motion`.
- **Do** define colors as custom properties with both a dark (default) and a daylight value, honoring `prefers-color-scheme` and the `data-theme` override.

### Don't:
- **Don't** add box-shadows or floating, rounded card stacks; depth is tonal and lines are 1px.
- **Don't** use mint or amber as generic accents, hover colors, or brand color.
- **Don't** recolor a model family per chart or per theme, or tint provider badges with model inks.
- **Don't** load web fonts, icon fonts or CDN assets; the stack is system sans only.
- **Don't** bold the 지금 reading; it stays at weight 300.
- **Don't** let the page scroll horizontally; hide table columns in order instead.
