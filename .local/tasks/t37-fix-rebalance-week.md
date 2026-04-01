# Fix Rebalance-Week Scheduling Conflicts

## What & Why

The `/api/tasks/rebalance-week` endpoint produces scheduling conflicts after
multiple invocations. Analysis identified three specific bugs in
`server/routes.ts` that cause this:

**Bug A — `existingDayCounts` is always `undefined` (line ~3454)**
`rebalanceTasksForward` is called with `undefined` for the existing-day-counts
parameter. This makes the distribution algorithm treat every day as empty,
ignoring tasks that are already scheduled there. Fix: build a
`Map<string, number>` from `allTasks` (which includes completed tasks) and
pass it instead of `undefined`.

**Bug B — Overflow tasks collide with the next day's own tasks (lines ~3553–3630)**
The current `byDate` loop handles each day independently. When Monday's tasks
overflow to Tuesday via `tryOverflowSlot`, those overflow tasks are placed
starting at some time on Tuesday. But when the loop then processes Tuesday's
own tasks, it resets `curSlot = window.start` (09:00). Both Monday's overflow
and Tuesday's own tasks then start at 09:00 — direct conflict. Fix: replace
the per-day loop with a single-pass approach that uses a `dayNextSlot` Map to
track which time slot is already claimed on each date across the entire loop
(including overflow placements).

**Bug C — `_unschedulable` tasks reappear on every rebalance (after main loop)**
Tasks that `rebalanceTasksForward` marks `_unschedulable` are filtered out of
`rebalanced`, but their DB records are never updated. Their old `scheduledDate`
stays in the DB, so `getTasksInRange` returns them again on the next call,
creating an infinite conflict loop. Fix: after the main scheduling loop, find
which tasks from `pending` were NOT in `rebalanced`, and clear their
`scheduledDate`, `scheduledTime`, and `scheduledEndTime` to `null`.

## Done looks like

- Calling rebalance-week once produces a conflict-free schedule (no two tasks
  share the same time slot on the same day).
- Calling rebalance-week a second time on the same week produces no further
  changes (idempotent).
- Tasks that cannot fit within the available week have their scheduled date/time
  cleared, rather than being silently stuck with stale dates.
- No changes to any other endpoint or function outside the rebalance-week handler.

## Out of scope

- Changes to `rebalanceTasksForward` itself.
- Changes to any other endpoint.
- UI changes.

## Tasks

1. **Bug A fix** — Build `existingDayCountsForRebal` from `allTasks` before
   calling `rebalanceTasksForward`, and pass it as the fifth argument instead of
   `undefined`. Also add `.filter((t: any) => !t._unschedulable)` on the result
   (this was already there but belongs here logically).

2. **Bug B fix** — Replace the `byDate` map + per-day loop (the section starting
   at "const byDate = new Map..." through the closing "res.json") with a
   single-pass approach: maintain a `dayNextSlot: Map<string, number>` that
   tracks the next available minute on each date. Sort all rebalanced tasks by
   date then priority, then iterate them in one pass, using `getNextSlotForDate`
   to read the current cursor and `claimSlot` to advance it after each
   placement. When a day is full, move to `nextWorkDay` and record the slot
   there too.

3. **Bug C fix** — After the main scheduling loop (and before `res.json`), find
   all tasks in `pending` whose IDs are not in the scheduled `rebalanced` set,
   and call `storage.updateTask` on each to clear `scheduledDate`,
   `scheduledTime`, and `scheduledEndTime` to `null`.

## Relevant files

- `server/routes.ts:3396-3635`
