---
title: Campaign + daily planning scheduling fixes (redeploy, weekend filter, adaptive cap)
---
# Campaign + Daily Planning Scheduling Fixes

  ## What & Why
  Three follow-up bugs in the scheduling system after T#26:

  1. **Stale bad campaign tasks still in DB** — Campaigns launched before the T#26
     fix have wrong scheduled dates (weekends, overlaps). A redeploy route cleans
     all incomplete tasks and re-schedules from scratch.

  2. **Weekend tasks in daily generation** — `rebalanceTasksForward` distributes
     tasks correctly by workday, but the output isn't filtered before `byDate` is
     built, so tasks on off-days or weekends can still slip through.

  3. **Tasks piling up on a single day** — The `dailyCap=4` passed to
     `rebalanceTasksForward` is sometimes already exceeded by existing tasks,
     so new tasks can't land on those days and instead pile onto the next available
     day. The fix makes the cap adaptive: at least "busiest existing day + 2".

  ## Done looks like
  - Active campaign detail panel has a "Redeploy" button that deletes all
    incomplete campaign tasks and re-schedules everything from today
  - Daily generation never places tasks on weekends or user off-days
  - Daily generation distributes new tasks more evenly when some days are
    already overloaded
  - Server starts cleanly with no TS errors

  ## Implementation

  ### Fix 1 — server/routes.ts: POST /api/campaigns/:id/redeploy
  Add a new route before `createServer(app)`. It:
  - Validates campaign exists for the user
  - Deletes ALL incomplete campaign tasks (no date filter) using
    `db.delete(tasks).where(and(eq(tasks.campaignId, id), eq(tasks.completed, false)))`
  - Updates campaign to `{ tasksGenerated: false, status: 'active' }`
  - Performs the same inline scheduling as the resume route (use today as
    startDate, apply backward scheduling from publication dates). Returns
    `{ campaign, tasksCreated }`.

  Note: do NOT proxy to the launch route — do it inline (same pattern as the
  resume route from T#27) so no content items are duplicated.

  ### Fix 1b — client/src/pages/campaigns.tsx: Redeploy button + mutation
  - Add `redeployMutation` that calls POST /api/campaigns/:id/redeploy and
    invalidates `["/api/campaigns", selectedProjectId]` and `["/api/tasks"]`
  - Add Redeploy button next to Pause in the active state (only when
    `selectedCampaign.tasksGenerated === true`)
  - Toast: "Campaign redeployed — tasks rescheduled from today"

  ### Fix 2 — server/routes.ts: Weekend safety filter
  After line 2724 (`.filter((t: any) => !t._unschedulable)`), add:
  ```ts
  const safeRebalanced = rebalanced.filter((t: any) => {
    const ds: string = t.scheduledDate || todayStr;
    const dow = new Date(ds + 'T00:00:00').getDay();
    return userWorkDaysGen.has(DAY_ABBRS[dow]) && !genOffDates.has(ds);
  });
  ```
  Then replace the `for (const pending of rebalanced as PendingTask[])` loop
  with `for (const pending of safeRebalanced as PendingTask[])`.

  ### Fix 3 — server/routes.ts: Adaptive daily cap
  Replace the static `4` in the `rebalanceTasksForward` call (line 2723) with:
  ```ts
  const maxExistingOnAnyDay = existingDayCounts.size > 0
    ? Math.max(...Array.from(existingDayCounts.values()))
    : 0;
  const effectiveDailyCap = Math.max(4, maxExistingOnAnyDay + 2);
  ```
  Then use `effectiveDailyCap` as the cap argument.

  ## Relevant files
  - `server/routes.ts:2716-2731` (rebalance + byDate)
  - `server/routes.ts:5409+` (pause/resume/redeploy routes area)
  - `client/src/pages/campaigns.tsx` (redeploy button + mutation)