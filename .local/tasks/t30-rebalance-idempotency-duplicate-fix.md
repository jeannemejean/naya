# Rebalance Idempotency + Duplicate Task Prevention

## What & Why

Two P0 bugs make task generation unreliable:

**Bug #1 (rebalance-week):** The rebalance endpoint passes `undefined` for `existingDayCounts` and uses a hardcoded cap of `4`. The time-slot assignment loop doesn't check for tasks already occupying each slot, so running rebalance twice creates overlapping tasks. Tasks marked `_unschedulable` keep their stale `scheduledDate/scheduledTime`, causing them to reappear on the next run.

**Bug #3 (duplicate task generation):** Every call to `generate-weekly` or `generate-daily` blindly inserts new tasks. If a user regenerates after tweaking something, they end up with 2× the tasks on the same days.

## Done looks like

- Running "Rebalance week" once produces a clean, collision-free schedule.
- Running "Rebalance week" a second time immediately after produces the exact same result (idempotent).
- Tasks that cannot be scheduled have their `scheduledDate` and `scheduledTime` nulled out in the DB so they don't reappear.
- The daily cap adapts based on actual work-day length (work hours ÷ average task duration) rather than being hardcoded to `4`.
- Generating the weekly plan when tasks already exist prompts the user: "X tasks already exist for this week — replace or add?" with a **Replace** and **Add to existing** option.
- Choosing **Replace** cancels existing incomplete tasks for that project/week and generates fresh ones.
- Choosing **Add** uses UPSERT logic: tasks with identical title + projectId + same week are updated (date/time), not duplicated.

## Out of scope

- Monthly plan duplicate handling (same pattern, but lower priority — handle weekly/daily only).
- Full AI re-generation on rebalance (rebalance only reschedules; it does not regenerate content).

## Tasks

1. **Pre-build used-slots map in rebalance-week** — Before the time-slot assignment loop, query and build a `Map<date, Set<scheduledTime>>` from already-scheduled tasks for the week (including completed tasks and tasks not in `pending`). Use this map to skip already-occupied slots when assigning times, preventing collisions.

2. **Null out unschedulable tasks** — After `rebalanceTasksForward`, for every task flagged `_unschedulable`, update the DB record to set `scheduledDate = null` and `scheduledTime = null`. Do not leave stale scheduling values.

3. **Dynamic daily cap in rebalance-week** — Replace the hardcoded cap of `4` in the rebalance-week endpoint with a computed value: `Math.floor(workDayMinutes / avgTaskDuration)` clamped between 3 and 8, where `avgTaskDuration` defaults to 45 minutes if no preference is set.

4. **Duplicate-check on generate-weekly** — Before inserting AI-generated tasks, query the DB for incomplete tasks with the same `userId`, `projectId`, and a `scheduledDate` within the target week. If any exist, return a count in the response and let the frontend present the replace/add confirmation (see task 5). Add `clearExisting: boolean` to the request body; when `true`, mark existing tasks `taskStatus = 'cancelled'` before inserting new ones.

5. **Replace/Add confirmation UI** — In the weekly plan generation flow, if the API returns `existingCount > 0`, display an inline confirmation with "Replace" and "Add to existing" buttons before firing the actual generation request. The "Replace" button sends `clearExisting: true`; the "Add" button sends `clearExisting: false` with UPSERT semantics (update date/time on title-matched tasks, insert the rest).

## Relevant files

- `server/routes.ts:3116-3260`
- `server/routes.ts:230`
- `server/routes.ts:2700-2800`
- `client/src/pages/planning.tsx`
- `shared/schema.ts:348-386`
