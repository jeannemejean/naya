# Task Status Field + Paused Campaign Visibility

## What & Why

The `tasks` table has no `status` field, so when a campaign is paused there is no way to suppress its tasks from the planning view. Currently `deleteCampaignFutureTasks` deletes future tasks outright, leaving past-dated incomplete tasks still visible on the calendar and in the week view. This fix adds a proper lifecycle status to every task and makes pause/resume/redeploy honour it.

## Done looks like

- A `taskStatus` column (`active | paused | cancelled`) exists on the `tasks` table and is synced to the DB.
- Pausing a campaign marks ALL its incomplete tasks (past and future) as `paused`; they disappear from the planning calendar immediately.
- Resuming a campaign sets those tasks back to `active` before rescheduling.
- Every endpoint that reads tasks for planning (`getTasksInRange`, `getTasks`) silently excludes `paused` and `cancelled` tasks unless an explicit `includeInactive` flag is passed.
- The `deleteAllIncompleteCampaignTasks` storage method is updated to mark tasks `cancelled` rather than physically deleting them (preserves audit history).
- No tasks from a paused campaign appear on the calendar, week grid, or today's task list.

## Out of scope

- UI badge or filter to view paused/cancelled tasks (future work).
- Migration of the existing `completed` boolean to use the new status field — keep `completed` as-is for backward compatibility.

## Tasks

1. **Schema + DB migration** — Add `taskStatus text("task_status").notNull().default("active")` to the `tasks` table in `shared/schema.ts`, then run `npm run db:push` to apply.

2. **Update storage methods** — Rename `deleteCampaignFutureTasks` → `pauseCampaignTasks`; change its implementation to UPDATE tasks to `taskStatus='paused'` (all incomplete tasks for the campaign, no date filter). Update `deleteAllIncompleteCampaignTasks` to UPDATE to `taskStatus='cancelled'` instead of deleting. Add `resumeCampaignTasks(campaignId)` that sets `taskStatus='active'` for all tasks of that campaign. Update `IStorage` interface accordingly.

3. **Filter task reads** — In `getTasksInRange` and `getTasks` in `storage.ts`, add a WHERE clause that excludes `taskStatus = 'paused'` and `taskStatus = 'cancelled'` by default. Add an optional `includeInactive` parameter for admin use.

4. **Update route handlers** — In the pause route, call `pauseCampaignTasks` instead of `deleteCampaignFutureTasks`. In the resume route, call `resumeCampaignTasks` before rescheduling. In the redeploy route, call `deleteAllIncompleteCampaignTasks` (now marks cancelled). Ensure the frontend's `redeployMutation` and `resumeMutation` still invalidate `['/api/tasks']`.

5. **Frontend planning filter** — In `planning.tsx`, add a client-side guard to filter out any tasks where `taskStatus === 'paused' || taskStatus === 'cancelled'` in the calendar/week grid render, as a safety net in case old data exists before the server-side filter is fully propagated.

## Relevant files

- `shared/schema.ts:348-386`
- `server/storage.ts`
- `server/routes.ts:5416`
- `client/src/pages/planning.tsx`
- `client/src/pages/campaigns.tsx`
