# Scheduling Intelligence Overhaul

## What & Why

A deep audit of the live scheduling data and all AI/scheduling code reveals
12 distinct issues — ranging from critical bugs that cause visual chaos to
silent design weaknesses that make the schedule look dumb. This plan fixes
the 8 highest-impact ones in one pass.

---

## Issues found (evidence-based)

### 1. Cross-project time slot collision (CRITICAL BUG)
Each project's AI independently assigns `scheduledTime`. With 4 projects, all
four can claim `09:00` for their first task. The March 13 data confirms this:
3 tasks from 3 different projects (Agence JMD, Encore Merci, Naya) all land
at `09:00–10:00`. They appear as overlapping blocks in the time grid.

**Root cause:** Time assignment in the generate-daily save loop runs a
`curSlot` cursor per date, but only sees tasks from the CURRENT iteration.
Each project's AI call is independent and doesn't know what the others
suggested. Fix: maintain a single cross-project slot cursor for each calendar
date, applied after all projects are collected.

### 2. Existing DB tasks ignored by rebalance (CRITICAL)
`rebalanceTasksForward` only balances the NEWLY generated tasks against each
other (max 4/day across new tasks). It has no awareness that March 13 already
has 22 tasks in the DB from previous runs. New tasks from the current run
still pile onto March 13 even though it's already full.

**Fix:** Before calling `rebalanceTasksForward`, load existing non-completed
tasks for the entire week from the DB. Add their counts to the `slotUsage`
map so existing tasks are treated as already-consumed slots.

### 3. No deduplication — tasks accumulate across runs (CRITICAL)
`generate-daily` creates tasks without checking if similar ones already exist.
Running it twice creates duplicates. Confirmed in data: "Identify 3 potential
new clients based on mutual values" = 2 copies on March 12 (IDs 230, 248),
"Create a draft for an introductory post" = 2 copies across March 12–13 (IDs
234, 243), "Explore your brand essence" = 2 copies on March 14 (IDs 237, 240).

**Fix:** Before generating for a project, check if that project already has
tasks in the week range. If the project's task count for the week is already
≥ weekly cap (e.g., 8), skip generation for that project and return the
existing tasks instead of generating new ones.

### 4. Realism engine is per-project, not per-day (DESIGN WEAKNESS)
Each project's tasks are validated in isolation. If project A generates 120
min of tasks and project B generates 120 min, realism for B doesn't know A
already consumed half the day. The total can exceed the day's capacity.

**Fix:** Run a single realism pass after ALL projects have been collected into
`allPendingTasks`, not one pass per project during the collection loop.
Pass all tasks for today combined as `candidateTasks`.

### 5. Break windows only applied to today (BUG)
`breaksForDate = isToday ? todayBreaks : []`. Tasks scheduled for future days
get zero break avoidance. A user with a daily lunch 12:30–13:30 can have
future tasks scheduled right into it.

**Fix:** Load day availability records for the full week at the start of
generate-daily (one DB query), then pass the breaks for each date's availability
to the time-assignment loop instead of always using `[]` for future days.

### 6. AI is asked to generate 5 tasks but only 2 are used (WASTE)
The AI prompt says "Maximum 5 tasks total" and reasons through an 8-step
chain to produce up to 5. Then `.slice(0, perProjectCap)` discards tasks 3–5.
This wastes time and tokens, and sometimes the most strategic task ends up
at index 2 and gets dropped.

**Fix:** Tell the AI the exact count it should produce in the prompt
(`perProjectCap`, currently 2). Remove the "Maximum 5 tasks" instruction and
replace it with "Generate exactly N tasks — no more."

### 7. Invalid AI output values saved to DB (DATA QUALITY)
The AI occasionally returns `recommendedTimeOfDay: "late_morning"` (not a
valid enum — must be `morning | afternoon | evening | anytime`). Some tasks
land in the DB with `task_energy_type: null` even though the prompt says it's
required. These break color coding in the time grid and time-of-day scheduling.

**Fix:** Add a normalisation step between AI response and `storage.createTask`:
- Map `late_morning` → `morning`, `early_morning` → `morning`, etc.
- Default `taskEnergyType` to `'execution'` if missing/invalid.
- Default `estimatedDuration` to 30 if missing.

### 8. `toISOString()` UTC date bug in `rebalanceTasksForward` (BUG)
`rebalanceTasksForward` builds its date range using `cur.toISOString().split('T')[0]`,
which converts to UTC. In timezones ahead of UTC (France = UTC+1 to UTC+2),
midnight local time is 23:00 or 22:00 UTC the previous day. This means the
date range can be off by one day, placing tasks on the wrong date.

**Fix:** Replace `toISOString()` with a local-date formatter identical to the
`formatDate()` pattern used everywhere else in the codebase:
`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`.

---

## Done looks like

- Generating a plan with 4 projects produces no time-slot collisions — each
  project's tasks appear in different time slots in the time grid
- Running generate-daily twice on the same day does NOT create duplicate tasks
  for the same project — existing tasks are detected and generation is skipped
- A day that already has 4+ tasks in the DB stays at ≤ 4 total after a new
  generate-daily run (new tasks spill to the next open day)
- The AI prompt asks for exactly the number of tasks that will be saved (no
  silent truncation)
- No tasks land with `task_energy_type: null` or invalid `recommendedTimeOfDay`
- Future days with breaks have tasks scheduled around those breaks

## Out of scope

- Changing the daily cap (stays at 4/day)
- AI-powered global cross-project prioritisation (would require a new OpenAI
  call with all project contexts combined — future work)
- Fixing the existing pile-up of 22 tasks on March 13 (data cleanup task #7
  handles this separately)

## Tasks

1. **Fix time-slot cursor to be cross-project** — In the time-assignment
   section of `generate-daily`, initialise one `curSlot` per calendar date
   BEFORE the project loop, carry it across projects, and use it for all task
   time assignments on that date.

2. **Load existing week tasks into rebalance** — Before calling
   `rebalanceTasksForward`, query `getTasksInRange` for the full week. Build
   a `slotUsage` pre-map with their per-day counts so the rebalancer knows
   which days are already full.

3. **Skip generation if project already has tasks this week** — At the start
   of each project loop iteration, check whether that project already has
   pending (non-completed) tasks in the current week. If count ≥ weekly cap,
   push existing tasks into `allPendingTasks` (no new AI call), add to
   `skippedProjects` with reason "Already has tasks this week".

4. **Move realism validation to after all projects collected** — Remove the
   per-project `runRealismValidation` call. After `allPendingTasks` is fully
   assembled, run one realism pass for each date group (not per project).

5. **Load week availability for break avoidance** — Query all day_availability
   records for the week at the top of the route. In the time-assignment loop,
   use each date's actual breaks (not just today's) when checking `isInBreak`.

6. **Pass exact task count to AI** — Compute `perProjectCap` before the
   prompt is built. Replace "Maximum 5 tasks total" with "Generate exactly
   ${perProjectCap} tasks" in `generateDailyTasks` prompt. Pass
   `perProjectCap` as a new field in `DailyTasksRequest`.

7. **Normalise AI output before saving** — Add a `normaliseTaskData()`
   function called on each `taskData` before `storage.createTask`. Maps
   invalid time-of-day strings, defaults missing energy types to `execution`,
   defaults missing durations to 30.

8. **Fix `toISOString()` UTC date bug in `rebalanceTasksForward`** — Replace
   the ISO string date extraction with a local-date formatter in the
   `dateRange()` helper.

## Relevant files

- `server/routes.ts:217-279`
- `server/routes.ts:1844-2313`
- `server/services/openai.ts:341-440`
- `server/services/realism.ts`
- `server/storage.ts:531-545,1116-1140`
