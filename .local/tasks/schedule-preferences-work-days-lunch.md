# Work days and lunch break preferences

## What & Why

Users need two global scheduling controls that currently don't exist:

1. **Work days toggle** — Choose which days of the week allow task scheduling
   (Mon–Fri on, Sat–Sun off by default). The scheduler always avoided weekends
   after Task #10 but without user control — it was hardcoded. Users should be
   able to flip any day on or off.

2. **Lunch break** — A global time window (e.g. 12:30–13:30) where no task
   is ever scheduled. Currently `dayAvailability` supports per-day breaks but
   there's no global lunch default. The generate-daily and rebalance-week
   routes both read `dayAvailability` breaks but ignore `userPreferences` for
   break times.

Both settings belong in a new "Schedule" section in the Settings page.

## Done looks like

- Settings page has a "Schedule" section with:
  - Seven day-of-week toggle buttons (Mon–Sun), default Mon–Fri on, Sat–Sun off
  - Lunch break start + end time selectors (default "12:00" to "13:00"),
    with an enable/disable toggle so it's optional
- Saving the settings persists them immediately (PATCH /api/preferences)
- After saving, clicking "Rebalance week" on the Planning page respects:
  - No tasks on toggled-off days (e.g. if Monday is turned off, tasks skip Monday)
  - No tasks during the lunch window (e.g. 12:00–13:00 is skipped)
- The generate-daily route also respects both settings

## Out of scope

- Per-day lunch overrides (that's `dayAvailability` territory)
- Multiple break windows (only one global lunch break)
- Showing lunch block visually on the time grid (separate task)

## Tasks

1. **Schema + DB** — Add `workDays` (text, comma-separated day abbreviations e.g.
   `"mon,tue,wed,thu,fri"`) and `lunchBreakStart` + `lunchBreakEnd` (text HH:MM)
   to the `user_preferences` table. Run db:push. Update the insert schema and type.

2. **Settings UI** — Add a "Schedule" card to the Settings page with seven
   day-toggle buttons and a lunch break section (enable switch + start/end
   time selects). Wire to PATCH /api/preferences. Load existing prefs on mount
   and pre-select saved values.

3. **Scheduling logic** — In the rebalance-week route, read `workDays` and
   `lunchBreakStart`/`lunchBreakEnd` from preferences. Pass `workDays` into
   `rebalanceTasksForward` to filter the allowed weekday set. Inject the lunch
   break into `breaksForDate` for every day that doesn't already have a
   conflicting break entry. Apply the same to generate-daily's time-assignment
   loop.

## Relevant files

- `shared/schema.ts:96-104`
- `server/routes.ts:993-1013`
- `server/routes.ts:2539-2690`
- `server/routes.ts:217-295`
- `client/src/pages/settings.tsx`
