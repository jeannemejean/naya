# Scheduling Consistency & Cleanup

## What & Why

Three related bugs make the Planning page and Dashboard show different
task counts and allow stale time data after drag-and-drop:

1. **Dashboard task count wrong** — `getTasks` (used by the dashboard/
   Today's Tasks component) filters by `dueDate`, which generate-daily
   always sets to the date the run happened. So all tasks generated on
   March 12 — even those scheduled for March 13, 14, etc. — appear in
   the dashboard on March 12. The Planning page uses the range query
   (filters by `scheduledDate`) which is correct. The fix is to change
   Today's Tasks to use the range query for today's date, making both
   views consistent.

2. **March 13 pile-up from old data** — 22 tasks exist on March 13
   from generation runs before the task-cap fix. Users have no way to
   clean this up without deleting tasks manually. Add a "Rebalance week"
   button in the Planning header that calls a new server endpoint to
   redistribute all pending tasks for the current week using the same
   `rebalanceTasksForward` logic (≤4/day cap), then re-assigns time
   slots per the updated schedule.

3. **Drag-and-drop doesn't update `scheduledEndTime`** — when a task
   is dragged to a new time slot, only `scheduledDate` and
   `scheduledTime` are PATCHed. `scheduledEndTime` goes stale. The fix
   is to compute `scheduledEndTime = scheduledTime + estimatedDuration`
   in the PATCH payload sent by the TimeGrid drag handler, and ensure
   the server PATCH handler accepts and persists it.

## Done looks like

- Dashboard (Today's Tasks) shows the same 6 tasks as Planning does for
  today — not 21 or more
- "Rebalance week" button in the Planning header redistributes tasks
  so no single day has more than 4, and time slots are reassigned
- After dragging a task in the time grid, `scheduledEndTime` matches
  `scheduledTime + estimatedDuration` in the database

## Out of scope

- Changing the `dueDate` column semantics globally (only Today's Tasks
  query is changed; other consumers of `getTasks` are unchanged)
- AI-powered rescheduling (rebalance uses the existing deterministic
  algorithm, no AI call)
- Changing the daily cap — the rebalance uses the existing cap of 4/day

## Tasks

1. **Fix Today's Tasks query** — Change `todays-tasks.tsx` to fetch
   today's tasks via `/api/tasks/range?start=today&end=today` instead
   of `/api/tasks?date=today`, so it filters by `scheduledDate` like
   the Planning page does. Update any downstream logic that depends on
   the shape of the response (same `Task[]` shape, no changes needed).

2. **Add rebalance-week endpoint** — Add `POST /api/tasks/rebalance-week`
   that takes `{ weekStart: string, clientToday: string }`, loads all
   non-completed tasks in the week range, runs `rebalanceTasksForward`
   (already implemented in routes.ts), reassigns time slots per day,
   and bulk-updates `scheduledDate` + `scheduledTime` + `scheduledEndTime`
   for each task. Returns a summary `{ moved: number, days: Record<string, number> }`.

3. **Add "Rebalance week" button** — In the Planning page header (next
   to "Refine this week"), add a compact "Rebalance" button that calls
   the new endpoint and shows a toast with the summary. Only visible in
   week and day views.

4. **Fix drag PATCH to include scheduledEndTime** — In `time-grid.tsx`
   `handleDrop`, compute `scheduledEndTime = minutesToHHMM(snapped + duration)`
   and include it in the PATCH payload. Verify the server PATCH handler
   already accepts `scheduledEndTime` (it does — check routes.ts line 1550).

## Relevant files

- `client/src/components/todays-tasks.tsx:174-179`
- `client/src/pages/planning.tsx:511-519`
- `server/routes.ts:1465-1493,2025-2270`
- `client/src/components/time-grid.tsx:420-439`
