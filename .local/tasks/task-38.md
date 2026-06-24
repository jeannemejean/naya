---
title: Fix generate-daily scheduling collisions + duplicate prevention
---
# Fix generate-daily scheduling collisions + duplicate prevention

## What & Why

`POST /api/tasks/generate-daily` has two root-cause bugs that produce overlapping tasks and duplicate plan runs:

**Bug 1 — Per-day slot cursor resets cause overflow collisions (Root Causes 1 & 3 from attached analysis)**

The `byDate` outer loop declares `curSlot`, `overflowDate`, `overflowSlot`, `overflowEnd`, and `overflowBreaks` as local variables inside each loop iteration. When Monday's tasks overflow onto Tuesday (via `genTryOverflowSlot`), the overflow tasks are written to the DB with real times on Tuesday. But when the outer loop later processes Tuesday, it recalculates `curSlot` from `existingWeekTasks` — which was fetched before generation started and does not include Monday's overflow. Tuesday's cursor therefore starts at 09:00 regardless of overflow, placing Tuesday's own tasks at 09:00 on top of Monday's overflow tasks already at 09:00. Additionally, if Wednesday also overflows to Tuesday, Wednesday's `overflowSlot` also starts from `dayStartMin`, creating a second collision.

Fix: Replace the per-date `curSlot`, `overflowDate`, `overflowSlot`, `overflowEnd`, `overflowBreaks`, and `dayFull` variables with a single global `dayNextSlot: Map<string, number>` that persists across the entire loop. Seed the map from `existingWeekTasks` before the loop begins. When any task is assigned to a date (whether as a native or overflow task), advance `dayNextSlot` for that date. When the outer loop processes a date, it reads its starting cursor from `dayNextSlot` rather than recomputing from scratch. `genTryOverflowSlot` should also read from and write to `dayNextSlot` so all placements on a given date — regardless of which outer iteration placed them — coordinate correctly.

**Bug 2 — Repeated generation accumulates duplicate tasks**

Every call to `generate-daily` calls `storage.createTask()` for each new task without checking whether non-completed generated tasks already exist for the same project and week. A user who runs "Generate my plan" twice ends up with double the tasks, many at the same times.

Fix: Add a `replaceExisting` flag to the request body. When `replaceExisting: true`, before any AI calls, null out `scheduledDate`, `scheduledTime`, and `scheduledEndTime` on all existing non-completed tasks with `source = 'generated'` or `source = 'ai'` for the active project/week (so they are removed from the schedule but not hard-deleted). On the frontend, before calling `generate-daily`, check whether non-completed generated tasks already exist this week for the active project. If they do, show a small confirmation dialog: "You already have N tasks scheduled this week — replace them with a fresh plan, or add to what's already there?" with three choices: Replace, Add to existing, Cancel. Send `replaceExisting: true` or `false` accordingly.

## Done looks like

- Generating a plan produces tasks with no time overlaps (no two tasks share the same date + time slot).
- Generating a plan a second time for a week that already has tasks shows a "Replace or Add?" dialog rather than silently accumulating.
- Choosing "Replace" clears the stale generated tasks' scheduled times and creates a fresh conflict-free schedule.
- Choosing "Add to existing" appends new tasks without touching existing ones, still conflict-free.
- Rebalancing after generation also produces a conflict-free schedule (this was fixed in T#37 and should remain unaffected).

## Out of scope

- Changes to `rebalanceTasksForward` or the `rebalance-week` endpoint (fixed in T#37).
- Changes to `generate-weekly` (uses a different mechanism).
- Changes to `assignLanes` in the frontend (display-only fallback — data should be correct before it runs).
- Hard-deleting existing tasks (only clear their scheduled times).

## Tasks

1. **Build global `dayNextSlot` map, seed it from `existingWeekTasks`, and replace per-iteration `curSlot`/overflow variables** — Before the `byDate` outer loop, build `dayNextSlot: Map<string, number>` seeded from existing non-completed scheduled tasks for each date. In the inner loop, read from `dayNextSlot.get(date)` instead of the local `curSlot`, and write back to `dayNextSlot.set(date, ...)` after each placement. Update `genTryOverflowSlot` to read from and write to `dayNextSlot` for each overflow date rather than the local `overflowSlot` variable.

2. **Add `replaceExisting` flag to `generate-daily` endpoint** — At the start of the handler (before AI calls), if `req.body.replaceExisting === true`, find all non-completed tasks with `source = 'generated'` or `source = 'ai'` for the active project in the current week from `existingWeekTasks`, and call `storage.updateTask` on each to set `scheduledDate`, `scheduledTime`, and `scheduledEndTime` to `null`. Re-fetch `existingWeekTasks` after this cleanup so the slot-seeding in task 1 starts from a clean baseline.

3. **Add "Replace or Add?" dialog in planning.tsx** — Before calling `generateDailyMutation.mutateAsync()`, check if non-completed generated tasks already exist this week for the active project (use the already-fetched tasks query). If yes, show a simple dialog with the count and three actions: Replace (sends `replaceExisting: true`), Add to existing (sends `replaceExisting: false`), and Cancel. If no existing generated tasks, proceed directly without a dialog.

## Relevant files

- `server/routes.ts:3017-3194`
- `client/src/pages/planning.tsx:297-361`