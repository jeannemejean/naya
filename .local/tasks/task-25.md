---
title: Campaign launch: strict phase order
---
# Campaign Launch: Strict Phase Order

  ## What & Why
  Campaign task scheduling has two bugs:

  1. **Phase ordering not guaranteed** — phases are iterated from `Object.entries()` which doesn't guarantee numeric order. Tasks from Phase 3 can land before Phase 1.

  2. **Phase date ranges are unreliable** — `parsePhaseDateRange` parses AI-generated strings like "Weeks 1–2" which are inconsistent. When parsing fails, the fallback collapses the entire phase to campaign day 1.

  The fix: replace the string-parsing approach with mathematical division of the campaign duration evenly across phases, and rewrite the scheduling loop to process phases in strict numeric order (1 → 2 → 3) using a running date cursor.

  ## Done looks like
  - Launching a 3-month campaign starting March 23: Phase 1 tasks appear in week 1, Phase 2 tasks appear ~weeks 4-6, Phase 3 tasks appear in the final month
  - Phases never overlap: Phase N tasks always start after Phase N-1 tasks
  - Tasks within a phase are placed sequentially — the cursor advances after each sub-task, so no two campaign tasks share the same day
  - No more than 3 campaign tasks per day (in addition to whatever existing tasks are on the calendar)
  - All tasks still get `scheduledTime` and `scheduledEndTime` (preserved from T#24)

  ## Out of scope
  - Changing anything about content calendar injection (contentPlan items)
  - Any UI changes
  - Changing how the daily task generator works

  ## Tasks
  1. **Replace parsePhaseDateRange with computePhaseRanges** — Remove the existing `parsePhaseDateRange` function. Add `computePhaseRanges(phases, startDate, campaignDurationDays)` which sorts phases by number and divides the total campaign duration into N equal segments (one per phase), returning guaranteed non-overlapping sequential date ranges.

  2. **Rewrite the task scheduling loop with a phase-ordered cursor** — Replace the current `for (const [phaseNumStr, phaseTasks] of Object.entries(tasksByPhase))` block with a version that: (a) sorts phase numbers ascending before iterating, (b) uses a running `cursor` date that starts at `phaseRange.start` and advances forward as each sub-task is placed, and (c) caps at 3 campaign tasks per day per the new spec. The time-slot logic from T#24 (`assignSlot`, `scheduledTime`, `scheduledEndTime`) must be preserved — use `dayHasCapacity(ds, sub.estimatedDuration)` to decide if a day has room, and call `assignSlot()` before creating each task.

  3. **Update phase range computation call site** — In the launch route, replace the per-phase `parsePhaseDateRange` loop with a single call to `computePhaseRanges(phases, startDate, campaignDurationDays)`. Note: `campaignDurationDays` is already computed just above as `campaignDays` — reuse it.

  ## Relevant files
  - `server/routes.ts:5065-5098` (parsePhaseDateRange to replace)
  - `server/routes.ts:5269-5349` (phase range computation + scheduling loop to rewrite)