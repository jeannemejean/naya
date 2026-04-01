# Naya v26 — 5 UX + Intelligence Fixes

## What & Why

Five targeted fixes from the v26 master update spec:

1. **Planning grid readability** — task blocks are too small, title always hidden. Increase pixel density and minimum heights.
2. **Slot-collision guard** — generated tasks can land on the same time slot. Prevent overlaps before writing to DB.
3. **Dashboard tiles redesign** — replace "Today" (AI daily brief) and "This Week" (weekly briefing) with instant, data-driven tiles: "Next Up" (next pending task + progress bar) and "Week Pulse" (Mon–Fri completion bars). No AI calls.
4. **Strategy reasoning above grid** — `lastStrategySignal` currently lives in a side panel below the grid. Move/add the reasoning banner directly above `<TimeGrid>` so users see Naya's rationale alongside the plan.
5. **Full Brand DNA in task generation** — the current `generateDailyTasks` prompt passes ~6 Brand DNA fields. The full schema has 30+. Rewrite the prompt to include offers, price range, voice keywords, content pillars, audience psychology, etc., and replace the system message with Naya's strategic intelligence voice.

## Done looks like

- Planning grid: tasks are at least 44px tall, title is always visible, completed tasks are greyed out + desaturated + strikethrough
- No task time overlap in generated plans
- Dashboard "Next Up" tile shows the next pending task with energy emoji and a progress mini-bar (no AI, instant load)
- Dashboard "This Week" tile shows 5 vertical bars (Mon–Fri) with completion fill (no AI, instant load)
- A "🧠 [focus]" banner appears directly above the time grid after plan generation, with "Why these tasks?" expand toggle
- Generated tasks reference the actual business name, offer name, audience, platform, and brand voice — not generic descriptions

## Out of scope

- Changes to other AI functions (generateCampaign, generateContent, etc.)
- Database schema changes
- Changes to the weekly briefing or monthly plan features
- i18n updates for new copy (use hardcoded EN strings)

## Tasks

1. **Planning grid readability (time-grid.tsx)** — Update `PX_PER_HOUR` from 64→80, minimum task height from 28→44px, set `showTitle = true` always, `showDuration` threshold 48→56, `showFull` threshold 64→72. Change completed task opacity from `opacity-40` to `opacity-35 saturate-0`, add `opacity-60` to the title line-through class.

2. **Slot-collision guard (routes.ts)** — In the `generate-daily` route, before writing AI tasks to the DB, collect already-scheduled time slots for the day. For each AI task, if its `scheduledTime` collides with an existing slot, push it forward by its own duration until a free slot is found. The existing `genTryPlaceOnDate` mechanism already does overflow day-handling — this guard needs to apply at the AI-output stage, before the placement call, to de-duplicate within the AI batch itself.

3. **Dashboard bento tiles (dashboard.tsx)** — Replace `BentoTileToday` with `BentoTileNextAction` (fetches today's tasks via `/api/tasks/range`, shows next pending task sorted by scheduledTime, energy emoji, duration, progress bar). Replace `BentoTileThisWeek` with `BentoTileWeekPulse` (fetches week tasks, renders 5 vertical bar charts Mon–Fri with completion fill, today highlighted in indigo, past in emerald). Update JSX usage. Add `Activity` to lucide imports if not already present. Remove now-unused weekly briefing queries/mutations from the old tiles.

4. **Strategy reasoning banner (planning.tsx)** — The `lastStrategySignal` block currently renders in a right-column side panel (line ~797). Add/move the compact reasoning banner (indigo background, focus text, "Why these tasks?" toggle) to appear directly above the `<TimeGrid>` component inside the main column. Use `strategyExpanded` state which already exists.

5. **Full Brand DNA prompt for task generation (openai.ts)** — In `generateDailyTasks`, replace the existing `const prompt = ...` variable and the `callClaude(...)` call that follows it with the v26 prompt. The new prompt: extracts offers, contentPillars, brandVoice keywords from the full brandDna object; uses a 5-step strategic reasoning chain (goal anchor, highest leverage, task selection, specificity check, schedule); includes comprehensive business intelligence context (30+ fields); outputs the same JSON shape. Update the system message to Naya's strategic intelligence voice. Keep `max_tokens: 8000` and `CLAUDE_MODELS.smart`. Also add the missing Brand DNA fields to the `brandDnaInput` object passed from `routes.ts` so the new prompt fields are populated: `offers`, `offer`, `contentPillarsDetailed`, `brandVoiceKeywords`, `brandVoiceAntiKeywords`, `priceRange`, `clientJourney`, `revenueTarget`, `activeBusinessPriority`, `competitorLandscape`, `editorialTerritory`, `geographicFocus`, `currentBusinessStage`, `teamStructure`.

## Relevant files

- `client/src/components/time-grid.tsx:74,229,265-267,279,310`
- `server/routes.ts:2526-3234`
- `client/src/pages/dashboard.tsx:724-838,1323-1325`
- `client/src/pages/planning.tsx:136-137,739-758,797-845`
- `server/services/openai.ts:270-519`
