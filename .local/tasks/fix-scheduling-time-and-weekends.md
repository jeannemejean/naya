# Fix weekend scheduling and past-time placement

## What & Why

Three scheduling bugs remain that put tasks in the wrong place on the calendar:

1. **Tasks land on weekends.** The rebalance function uses `[...weekdays, ...weekends]` as the date pool, so when weekday slots fill up, tasks overflow onto Saturday/Sunday. Seven tasks are currently sitting on weekends (March 14 Sat, March 15 Sun, March 21 Sat) even though the user works Mon–Fri 09:00–18:00.

2. **Today's tasks are placed in the past.** The rebalance-week route always starts today's time cursor at 09:00, regardless of the current time. Running rebalance at 17:45 places tasks at 09:00 — already 8+ hours gone. Task 248 is currently stuck at 09:00 on March 12 for this reason.

3. **`clientTime` is never sent to rebalance-week.** `generate-daily` already uses `clientTime` to avoid scheduling in the past, but the rebalance-week route ignores it entirely.

## Done looks like

- Clicking "Rebalance week" never places tasks on Saturday or Sunday
- Existing weekend tasks (March 14, 15, 21) are picked up by the next rebalance and moved to the next available weekday
- Running rebalance at 17:45 places today's tasks in the remaining window (17:45 onward) or moves them to tomorrow if no time is left today
- No task appears in the time grid at a time that has already passed

## Out of scope

- Adding a "work days" preference toggle (Mon–Fri is assumed for now)
- Changing how generate-daily assigns times (already correct)

## Tasks

1. **Remove weekends from the date pool.** In `rebalanceTasksForward`, change `orderedDates` to only contain weekdays. The existing 14-day overflow extension means next-week weekdays are already available for overflow — no other changes needed.

2. **Pass `clientTime` from the planning page to rebalance-week.** Include `clientTime` (HH:MM) in the POST body so the backend knows the user's current local time.

3. **Use `clientTime` in the rebalance-week route.** For today's date, start the time cursor at `max(dayStartMin, currentTime + 15)`. If no room remains in today's workday, bump the task's `scheduledDate` forward to the next weekday and assign it a morning slot there.

## Relevant files

- `server/routes.ts:252-254`
- `server/routes.ts:2539-2660`
- `client/src/pages/planning.tsx:268-297`
