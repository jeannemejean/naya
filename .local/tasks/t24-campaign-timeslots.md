# Campaign Tasks: Time Slot Assignment

  ## What & Why
  When a campaign is launched, tasks are created with a `scheduledDate` but no `scheduledTime`. The daily task generator doesn't see these timeless campaign tasks as occupying any slot, so it can place other tasks on top of them. The result is overlapping or unscheduled tasks in the time-grid view.

  The fix replaces the simple `dayCounts` counter with a per-day time-cursor system, so each campaign sub-task is assigned a concrete, non-overlapping `scheduledTime` and `scheduledEndTime` the moment it is created during launch.

  ## Done looks like
  - After launching a campaign, every created task has a `scheduledTime` and `scheduledEndTime` (e.g. 09:00–09:30)
  - Opening the Planning week view shows campaign tasks as solid time blocks — none appear in the "Unscheduled" strip
  - No two tasks on the same day overlap: if task A ends at 10:30, task B starts at 10:45 (15-min buffer)
  - The lunch window (12:00–13:00) is respected — no task spans it
  - Days already full of existing tasks receive no new campaign tasks; scheduling spills to the next available workday within the phase

  ## Out of scope
  - Changing how the daily task generator schedules non-campaign tasks
  - User preferences for campaign task start times (uses fixed 9 AM start)
  - Any UI changes

  ## Tasks
  1. **Add time helpers to registerRoutes** — Add two small functions (`hhmmToMin` / `minToHHMM`) in module scope inside `registerRoutes`, before the launch route, so the launch route can use them without duplicating the per-route closures already used by generate-daily.

  2. **Replace dayCounts with dayNextSlot** — Build a `dayNextSlot` map (date → next free minute) from existing tasks' `scheduledTime` + `estimatedDuration` instead of counting tasks per day. Add `dayHasCapacity(dateStr, durationMin)` (returns true if the slot would fit before 18:00, skipping lunch) and `assignSlot(dateStr, durationMin)` (returns the HH:MM string and advances the cursor).

  3. **Update nextAvailableDayBounded** — Replace all `(dayCounts.get(ds) || 0) < DAILY_CAP` checks with `dayHasCapacity(ds, 30)`. Remove `DAILY_CAP`, `dayCounts`, and `reserveDay`.

  4. **Assign scheduledTime and scheduledEndTime on createTask** — In the sub-task creation loop, call `assignSlot(scheduledDateStr, sub.estimatedDuration)` and pass the result as `scheduledTime` and `scheduledEndTime` to `storage.createTask`.

  ## Relevant files
  - `server/routes.ts:5164-5316`
  