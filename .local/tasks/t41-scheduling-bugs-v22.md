# Three Scheduling Bug Fixes (V22)

## What & Why

Three separate bugs make the schedule unreliable:

1. **`generate-daily` places tasks on top of completed ones** — `genSeedSlotForDate` filters out completed tasks when computing the latest occupied time slot, so new tasks get scheduled into slots that are already visually taken by completed tasks, causing double-booking on the calendar.

2. **Campaign sub-tasks scheduled out of order** — When the ideal date for a sub-task (Script, Shoot, Edit…) is already full, the placement loop moves forward until it finds a free day. There's no guard preventing it from jumping past the next sub-task's target date, so "Edit video" can end up on the calendar *before* "Film video".

3. **Runaway daily task cap allows 10+ tasks per day** — `effectiveDailyCap` is computed as `maxExistingOnAnyDay + 2`, with no ceiling. When a week already has 8 tasks on one day, the cap becomes 10, allowing even more to pile up on subsequent generate runs.

A "Clear week" tool is also needed to let users flush stale over-loaded weeks from the DB (data created by the old broken cap) and regenerate them cleanly.

## Done looks like

- Completing 2 tasks at 09:00 and 09:30, then running "Generate my plan → Replace" places new tasks starting at 10:00 or later, with no visual overlap in the time grid.
- Deploying or redeploying a campaign always shows Script → Shoot → Edit → Publish in correct calendar order.
- Generating a plan for any week never produces more than 6 tasks in a single day.
- A "Clear week" button appears next to "Rebalance week" in the planning view; clicking it unschedules all non-completed AI/generated tasks for that week, then shows a prompt to regenerate.

## Out of scope

- Changing any other part of the scheduling or rebalance logic.
- Deleting tasks (clear-week only unschedules them, setting scheduledDate/Time to null).
- Fixing any pre-existing TypeScript errors in other files.

## Tasks

1. **Fix `genSeedSlotForDate` completed-task exclusion** — Remove `&& !t.completed` from the filter inside `genSeedSlotForDate` so completed tasks' time slots are respected as occupied when placing new tasks.

2. **Cap `effectiveDailyCap` at 6** — Change the cap formula from `Math.max(4, maxExistingOnAnyDay + 2)` to `Math.min(6, Math.max(4, maxExistingOnAnyDay + 1))` to prevent runaway task density.

3. **Add `lastSubtaskDate` tracking to campaign launch loop** — Declare `lastSubtaskDate: Date | null = null` before the sub-task inner loop and enforce that each sub-task is scheduled strictly after the previous one. Update `lastSubtaskDate` after each successful placement. Add the same fix to the redeploy loop.

4. **Add `POST /api/tasks/clear-week` endpoint** — Accepts `weekStart` (YYYY-MM-DD), computes weekEnd, finds all non-completed generated/AI tasks in that range, sets their `scheduledDate`, `scheduledTime`, and `scheduledEndTime` to null, and returns `{ cleared: N }`.

5. **Add "Clear week" button in planning UI** — Add a mutation and button alongside the existing "Rebalance week" control. On success, show a toast with count cleared and prompt the user to run "Generate my plan".

## Relevant files

- `server/routes.ts:3094-3112` — `genSeedSlotForDate` (Bug 1)
- `server/routes.ts:3019-3022` — `effectiveDailyCap` (Bug 1b)
- `server/routes.ts:5856-5884` — campaign launch sub-task loop (Bug 2)
- `server/routes.ts:6286-6310` — campaign redeploy sub-task loop (Bug 2b)
- `client/src/pages/planning.tsx:279,607` — "Rebalance week" button (Bug 3 UI)
