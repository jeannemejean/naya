# Campaign Scheduling: Backward Sub-task Scheduling + Workday Fix

  ## What & Why
  The campaign launch route has several scheduling bugs producing overlapping/weekend tasks:

  1. **Multiple tasks at the same time** — `campaignDayCounts` starts empty so existing tasks aren't counted, allowing too many tasks to pile onto one day
  2. **Weekend tasks** — `isWorkDay()` in the launch route hardcodes Mon–Fri, ignoring the user's configured work days and calendar off-days
  3. **`daysBeforePublication` never used** — the scheduling loop ignores the backward offsets defined in `decomposeContentTask()` (e.g. script at -5 days, shoot at -3), so all sub-tasks bunch up sequentially
  4. **Daily generation overlap** — when placing tasks on future dates, `curSlot` starts at window start without checking existing tasks already on that day, causing the daily generator to overlap with campaign tasks
  5. **Phase key mismatch** — `t.phase || 1` can produce a string key when phase is stored as a string, breaking phase grouping

  ## Done looks like
  - Launching a campaign: video sub-tasks spread backward from a publication date (script Mon, shoot Tue, edit Thu, publish Fri)
  - No tasks on Saturdays/Sundays, or on user-configured off days
  - No time overlaps between campaign tasks and daily-generated tasks
  - `campaignDayCounts` counts from existing tasks so overloaded days are skipped
  - Phase grouping works even when phase numbers come in as strings from JSON

  ## Out of scope
  - Changing the content calendar injection (contentPlan → draft ideas)
  - UI changes
  - Campaign generation logic

  ## Tasks
  1. **Add `assignPublicationDates` helper** — Add near `computePhaseRanges` (inside `registerRoutes`). Takes phase tasks array + phase date range, spaces N publication dates evenly across the phase, snaps each to a workday. Uses `isWorkDayFn` callback so it respects the user's actual work schedule.

  2. **Fix `isWorkDay` in launch route** — After loading the campaign, fetch user preferences and day-availability range (off days). Replace the hardcoded Mon–Fri `isWorkDay` with one that checks `campaignWorkDaySet` (from `parseWorkDays`) and `campaignOffDates`. Both `parseWorkDays` and `DAY_ABBRS` are already defined at module scope.

  3. **Fix `campaignDayCounts` initialization** — Initialize from `existingTasks` (already loaded above) so existing tasks count toward the 3-per-day cap. 

  4. **Rewrite phase scheduling loop with backward scheduling** — Replace the cursor-based loop with publication-date anchoring: for each task in the phase, compute a pub date via `assignPublicationDates`, then schedule each sub-task at `pubDate + sub.daysBeforePublication`. Clamp to phase start / campaign start. Find nearest available workday forward. Keep `campaignDayCounts`, `assignSlot`, `scheduledTime`/`scheduledEndTime` assignment. Remove `globalCursor` (no longer needed).

  5. **Fix daily generation `curSlot`** — Inside the `for (const [date, dateTasks] of Array.from(byDate.entries()))` loop, before setting `curSlot`, find the latest existing scheduled task end time for that date from `existingWeekTasks` and use it as the floor (instead of always starting from `genWindow.start`).

  6. **Fix phase key parsing** — Change `const p = t.phase || 1` to `const p = parseInt(String(t.phase), 10) || 1` when building `tasksByPhase`.

  ## Relevant files
  - `server/routes.ts:5071-5094` (computePhaseRanges — add assignPublicationDates nearby)
  - `server/routes.ts:5167-5225` (launch route — isWorkDay fix, campaignDayCounts fix)
  - `server/routes.ts:5232-5306` (scheduling loop to rewrite)
  - `server/routes.ts:2786-2790` (daily generation curSlot)
  