## Dashboard UX Redesign — Compact Bento Command Center

### Problem
The top of the dashboard is three stacked verbose text blocks (DailyBrief, OperatingProfileChip, IntelligenceBriefing) that the user has to read before reaching their actual tasks. It's a reading panel, not a command center.

### Solution
Replace the top section with a **compact 3-tile bento row** that surfaces everything at a glance, then shows the task grid below unchanged.

---

### New top section — 3 bento tiles (horizontal row, ~120px tall each)

**Tile 1 — "Today" (lg:col-span-2 / wide)**
- Greeting text (1 line, truncated — from `brief.content.greeting`)
- 3 priority tasks as numbered compact rows with a subtle check icon area (not interactive, just visual reference — clicking should scroll to the task in TodaysTasks)
- If carryover exists: amber chip "⚠ 1 carried over"
- Collapsed by default, no toggle needed — all visible inline
- Remove the current expanded/collapsed DailyBrief card entirely

**Tile 2 — "This Week" (medium)**
- Strategic focus: 2 lines of text from `briefing.focus`
- Best recommended move (first of `recommendedMoves`): title + duration chip + "+ Add" button
- Link at bottom: "Full briefing →" opens a Sheet/drawer with the full IntelligenceBriefing content (What's Working, Watch For, all recommended moves, energy note)
- If no briefing yet: "Generating this week's plan…" shimmer

**Tile 3 — "My State" (small, same height)**
- Persona name + icon (from `OperatingProfileChip` data)
- Energy level: compact 4-button row (⚡ High / ○ Medium / ↓ Low / ✕ Depleted) — current selection highlighted
- If avoidance trigger: amber pill "Watch: {trigger}"
- Replaces both `OperatingProfileChip` and `EnergySelector` from their current positions

---

### Changes to right column

**AIRecommendations** — make compact:
- Remove description text (currently shown below title in each rec card)
- Show: icon + title + type badge only, all on one line
- Full description visible on hover (tooltip) or on click expand
- Result: 3 recs fit in ~100px instead of ~200px

**EnergySelector** — remove from right column (it's now in Tile 3 above)

---

### What stays the same
- TodaysTasks component (left, main content)
- SchedulePreview component
- QuickCapture
- PersonaCard
- SelfCareBlock
- All data fetching/mutation logic — only the render layer changes

---

### Files to change
- `client/src/pages/dashboard.tsx` — main layout + DailyBrief + IntelligenceBriefing + OperatingProfileChip + AIRecommendations + EnergySelector components

### Done looks like
- Opening the dashboard: immediately see today's 3 tasks without scrolling past text walls
- Bento top row is compact (~100–130px tall), scannable in 3 seconds
- Full weekly intelligence still accessible via "Full briefing →" drawer
- Energy selector accessible from My State tile
- AI recs compact in right column
- No regressions on data — same API calls, same mutations
