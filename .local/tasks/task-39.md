---
title: Fix rebalance-week: seed dayNextSlot from completed tasks
---
# Fix rebalance-week: seed dayNextSlot from completed tasks

## What & Why

In the `POST /api/tasks/rebalance-week` handler, `getNextSlotForDate` returns:
- For today: `Math.max(window.start, clientNowMin + 15)`
- For other days: `window.start`

Neither path accounts for completed tasks that already occupy specific time slots on those dates. `allTasks` (fetched at the start of the handler) includes both completed and pending tasks. The pending tasks are extracted into `pending` and then rebalanced. But completed tasks are never consulted for slot seeding, so `dayNextSlot` starts cold for every date.

Example: A user completes a task at 09:00–09:30 on Monday. Current time is 11:00. The rebalancer calls `getNextSlotForDate('Monday')` → not in map → returns `window.start = 09:00` (or `clientNowMin + 15 = 11:15` for today). For days other than today, the cursor starts at 09:00, which can collide with completed tasks at 09:00–09:30.

Fix: Before the main placement loop (`allRebalancedSorted` iteration), seed `dayNextSlot` for each date by scanning completed tasks in `allTasks` and advancing the cursor past their end times. For today, also apply `clientNowMin + 15` as the floor.

## Done looks like

- After clicking "Rebalance week", no rebalanced task is placed at the same time slot as a completed task on the same date.
- For today's date, the first rebalanced task is placed after both the current time AND any completed tasks' end times.
- For other dates in the week, the first rebalanced task is placed after any completed tasks' end times (not blindly at window.start).
- No changes to any other endpoint or function.

## Out of scope

- Changes to `rebalanceTasksForward` itself.
- Changes to `generate-daily`.
- UI changes.

## Tasks

1. **Seed `dayNextSlot` from completed tasks before the placement loop** — After `allRebalancedSorted` is built but before the `for (const task of allRebalancedSorted)` loop, iterate over `allTasks` to find completed tasks with valid `scheduledDate` and `scheduledTime`. For each, compute their end time and advance `dayNextSlot` for that date past the end time if it's greater than the current value. For today's date, take the max of the completed-tasks cursor and `clientNowMin + 15`.

## Relevant files

- `server/routes.ts:3571-3584`