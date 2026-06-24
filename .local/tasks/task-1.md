---
title: Planning page: date, color & intelligence fixes
---
# Planning Page: Date, Color & Intelligence Fixes

## What & Why
Fix four compounding bugs that make the planning page untrustworthy: tasks appearing in the past due to UTC date math on the client, inconsistent project color assignment based on array position, energy/intelligence signals that are in the data model but invisible or too subtle in the UI, and an empty Strategy Intelligence section that should show real AI output.

## Done looks like
- Today's date cell is always highlighted correctly regardless of the user's timezone
- Generated tasks always fall on the current local date, never yesterday
- Week/day navigation stays anchored to the selected local date
- Every project's color is consistent across page refreshes and after adding/removing projects
- Every task card in day view shows an energy type badge (Focus / Creative / Admin / etc.) and a time-of-day hint when set
- Week view compact cards show a legible energy emoji pill, not just a trailing character
- The day view has a "Naya's read on today" strategy panel that shows: current focus, why today's tasks were chosen, current bottleneck, suggested next move — with a clear placeholder when no strategy has been generated yet

## Out of scope
- Server-side timezone handling (server runs UTC consistently — only the client formatter needs fixing)
- Redesigning the overall layout of the planning page
- Changing how tasks are fetched or sorted

## Tasks
1. **Fix local date formatting** — Replace `formatDate(d)` which uses `d.toISOString()` (UTC) with a version that uses `d.getFullYear()`, `d.getMonth()`, `d.getDate()` (local). Apply this single helper everywhere in the file: today highlight, range query params, navigation math, week/month boundary calculations.

2. **Fix color stability** — Update `getProjectColor` to derive color from `projectId % palette.length` instead of `projects.findIndex(...)`. This makes colors stable regardless of the order the API returns projects.

3. **Improve energy badge visibility** — In the full day-view task card: ensure energy badge renders prominently in the badge row; add `recommendedTimeOfDay` as a small hint below it (🌅 Morning / ☀️ Afternoon / 🌙 Evening). In the compact week-view card: replace the trailing emoji with a small colored pill showing the emoji + abbreviated label so it's legible at small sizes.

4. **Add Strategy Intelligence panel** — Add a persistent "Naya's read on today" card in the day view. Store the last `{ focus, reasoning }` from generate-daily in component state (`lastStrategySignal`). Render it with: focus as a headline, reasoning as body (max 3 lines, expandable), a "Current bottleneck" field derived from the reasoning or explicitly from a new `bottleneck` field if the AI returns one, a "Suggested next move" field. When no signal exists: show a clear placeholder with a dashed border and "Generate tasks to see Naya's strategic read" — never an empty void.

## Relevant files
- `client/src/pages/planning.tsx:1-613`