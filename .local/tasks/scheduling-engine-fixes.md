# Scheduling Engine & Task Distribution Fixes

## What & Why

Four interconnected bugs make the generated plan feel broken:

**A — Tasks scheduled in the past.** Clicking "Generate plan" at 4 PM produces tasks with scheduledTime values like 09:00, 09:30, 10:00 — all hours that have already gone. The slot cursor always starts at workDayStart regardless of the current time of day.

**B — Time grid visual chaos.** The `assignLanes` function in the time-grid component receives ALL tasks for a day, including those with no scheduledTime. Unscheduled tasks all get assigned startMin = 07:00 (the grid-start fallback), so they stack in parallel lanes at the top of the grid, creating visual noise. Only tasks with a real scheduledTime should enter the lane-assignment algorithm.

**C — Today over-scheduled, rest of week empty.** With 4 projects × 5 tasks each, up to 20 tasks can be created for a single day. The realism engine is given a fixed capacity (300 min by default) regardless of how much of the working day has already elapsed, so at 4 PM it still thinks 5 hours are available. The fix is to cap per-project output to 2 tasks, hard-cap daily total to 8, then run the existing `rebalanceTasksForward` across the full week BEFORE saving — so tasks automatically spread forward.

**D — Slot cursor and scheduledTime assignment must happen after rebalancing.** Currently time-slots are assigned per-project before rebalancing moves tasks to different days. After the refactor, time assignment must happen per-day after rebalancing, using the correct slot cursor: `max(workDayStart, currentTime + 15 min)` for today, `workDayStart` for future days.

Note: `todays-tasks.tsx` date handling was already fixed (uses local date constructor, not toISOString). No change needed there.

## Done looks like

- Clicking "Generate plan" at 4 PM produces tasks starting from ~4:15 PM onward — no tasks in the past
- With <90 min remaining today, at most 1–2 tasks are placed today; the rest appear on tomorrow and later this week
- Week view shows a balanced spread (not 20 tasks on one day, 0 on others)
- Time grid never shows stacked/overlapping cards at 7 AM; unscheduled tasks are rendered outside the positioned grid area
- Dashboard and Planning task counts match (already done — no regression)

## Out of scope

- Per-project scheduling preferences (different work hours per project)
- Multi-week spreading (only the current week's remaining days)
- Retroactive rescheduling of already-saved tasks

## Tasks

1. **Fix time-grid assignLanes** — Change `assignLanes(dayTasks)` to `assignLanes(scheduledTasks)` where `scheduledTasks = dayTasks.filter(t => t.scheduledTime != null)`. Render unscheduled tasks as a compact vertical list outside the absolute-positioned grid area (not as absolutely-positioned TaskBlock elements), with a small "Unscheduled" label. The existing dashed-block rendering from the prior session is close but still passes all tasks to assignLanes — fix the root call site.

2. **Pass clientTime from frontend** — In the generate-daily mutation in `planning.tsx` and `todays-tasks.tsx`, add `clientTime` (HH:MM, current local time) to the POST body alongside `clientToday`.

3. **Accept clientTime server-side, shift slot cursor** — In `routes.ts` generate-daily: parse `req.body.clientTime`, compute `nowFloorMin = hhmmToMinutes(clientTime)`, set initial `currentSlotMin = Math.max(dayStartMin, nowFloorMin + 15)` for today. For future days it stays at `dayStartMin`. Also compute `remainingMinutesToday = max(0, dayEndMin - nowFloorMin - 15)` and pass it to `runRealismValidation`.

4. **Add remainingMinutesOverride to realism engine** — In `realism.ts`, add optional `remainingMinutesOverride?: number` to `RealismInput`. In `runRealismValidation`, replace `deriveCapacity(operatingProfile)` with `input.remainingMinutesOverride ?? deriveCapacity(operatingProfile)` for today's capacity. This lets the engine correctly limit today to ~2 tasks when only 90 min remain.

5. **Reduce task caps + collect-then-rebalance-then-save** — In `routes.ts` generate-daily: set `TASKS_PER_PROJECT_MAX = 2`, `DAILY_TASK_CAP = 8`. Refactor the per-project loop to collect all candidate tasks into an in-memory `allPendingTasks` array WITHOUT saving. After all projects are processed, compute `weekEndStr` (Sunday of current week from `todayStr`), call `rebalanceTasksForward(allPendingTasks, todayStr, weekEndStr, 4)`, then assign scheduledTime per day (step 6), then save.

6. **Move scheduledTime assignment to after rebalancing** — After rebalancing assigns each task its final `scheduledDate`, group tasks by date. For each date, run the slot-cursor time-assignment loop: use `max(dayStartMin, nowFloorMin + 15)` for today, `dayStartMin` for future dates. Assign `scheduledTime` and `scheduledEndTime` on the in-memory task objects before passing them to `storage.createTask`.

## Relevant files

- `client/src/components/time-grid.tsx:106-142,627-700`
- `client/src/pages/planning.tsx`
- `client/src/components/todays-tasks.tsx:165-180`
- `server/routes.ts:217-279,1843-1845,2020-2240`
- `server/services/realism.ts:35-85`
