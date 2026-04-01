---
title: Fix Rebalance week button
---
# Fix "Rebalance week" button

## What & Why

Two bugs make the Rebalance week button fail or do nothing:

### Bug 1 — Error toast when clicking the button

The user sees "Failed to rebalance week" (red error toast) when clicking the
button. Root cause: The onError handler in the planning page fires whenever
the mutationFn promise rejects. This happens when:
- The session has expired (401 → apiRequest throws)
- The page was loaded before the Task #7 code deployed (404)

Both cases now return real errors. The fix: show the actual error text in the
toast so the user understands what happened (e.g. "Session expired — please
refresh"), and add a session-aware retry message.

### Bug 2 — Rebalance runs but doesn't move tasks (the real problem)

Even after a successful 200 response, March 13 still has 22 tasks. Multiple
rebalance runs don't reduce this pile.

Root cause: The `rebalanceTasksForward` function correctly computes new dates
for overflow tasks, but the `changed` variable in the save loop compares
`task.scheduledDate` (already overwritten to the new date by the rebalance)
with `date` (the byDate key — same new date). They are always equal, so
`moved` always stays 0 and — more critically — the route never actually
confirms what changed.

More importantly, on a SECOND rebalance run: tasks that were moved to March 15
by the first run now show up on March 15. The second rebalance sees March 15
with 27 tasks and cap=4. The overflow logic pushes 23 of them back onto
`orderedDates[orderedDates.length - 1]` which is... March 15. So effectively
tasks stay on March 15 indefinitely and the pile never gets cleared.

The underlying design problem: `rebalanceTasksForward` has no awareness of
tasks beyond its `endDate` (the end of the current week). It can't spread
overflow tasks into NEXT week. With 39 tasks and only 4 days × 4 cap = 16
slots available, 23 tasks always overflow to the last slot (March 15). The
same 23 tasks are always on March 15 regardless of how many times you run the
rebalance.

## Done looks like

- Clicking Rebalance week when session is expired shows "Session expired —
  please refresh the page" instead of "Failed to rebalance week"
- After clicking Rebalance week, the time grid refreshes and shows tasks
  spread across the week (no day has more than 4 tasks)
- Tasks that can't fit in the current week are moved to the NEXT week
  (not piled onto the last day of the current week)
- The "moved" count in the success toast is non-zero when there was actually
  work to do

## Changes needed

### 1. Fix `rebalanceTasksForward` overflow beyond current week

Change the overflow logic from "pile onto last date" to "spill into the next
available day beyond endDate". The function should accept an optional
`absoluteMax` date (e.g. end of next week). Tasks that can't fit in the
current week range get their date set to the first available day after
`endDate` that has room.

### 2. Fix `rebalanceTasksForward` endDate parameter in rebalance-week route

The route currently passes `weekEnd` (end of current week) as `endDate`. Pass
`weekEnd + 7 days` as the max overflow date so tasks can spill into next week.
OR simply pass 2 weeks of dates as the range.

### 3. Fix `changed` detection in the rebalance-week save loop

The `changed` variable currently compares `task.scheduledDate` (already the
NEW date from `rebalanceTasksForward`) with `date` — they're always equal.
Instead, store the ORIGINAL `scheduledDate` and `scheduledTime` BEFORE calling
`rebalanceTasksForward`, then compare after. This gives an accurate `moved`
count and confirms the route is actually working.

### 4. Improve onError message

In `planning.tsx` `rebalanceWeekMutation.onError`, capture the actual error
message and show it:

```js
onError: (err: any) => {
  const msg = err?.message || 'Failed to rebalance week.';
  const isAuth = msg.includes('401');
  toast({
    title: isAuth ? 'Session expired' : 'Error',
    description: isAuth
      ? 'Your session expired. Please refresh the page.'
      : msg,
    variant: 'destructive',
  });
},
```

## Relevant files

- `server/routes.ts:217-276` — `rebalanceTasksForward` function
- `server/routes.ts:2529-2637` — rebalance-week route
- `client/src/pages/planning.tsx:268-288` — `rebalanceWeekMutation`