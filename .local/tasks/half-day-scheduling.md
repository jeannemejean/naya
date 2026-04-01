# Half-day availability scheduling

## What & Why
The `dayAvailability` table already stores `dayType` (full | half-am | half-pm | off | travel | deep-work) and the time-grid already displays these states visually. But the scheduling engine — `rebalanceTasksForward`, the rebalance-week route, and the generate-daily route — completely ignores `dayType` when assigning task times. A user who marks Thursday as "half PM" still gets tasks scheduled at 9:00 AM. This fix wires the existing UI state into the scheduling pipeline so tasks are only placed inside the actual working window for that day.

## Done looks like
- Marking a day as "Half AM" in the planning time-grid prevents any task from being scheduled after 12:00 on that day; tasks that would overflow go to the next available working day
- Marking a day as "Half PM" prevents scheduling before 13:00; overflow tasks move forward
- Marking a day as "Day Off" causes it to be treated like a non-working day — no tasks assigned, all overflow to next work day
- "Rebalance week" respects these per-day windows exactly as generate-daily does
- No UI changes required — the dropdown already exists in the time-grid

## Out of scope
- Travel and deep-work day types (those are cosmetic labels, no scheduling change needed)
- Changing the half-day split hour (hardcoded at 12:00/13:00 for now)
- Changing the planning UI dropdown

## Tasks

1. **Per-date effective windows** — In both the `rebalance-week` route and the `generate-daily` route, after loading `weekAvailability`, build a `dayTypeByDate` map. In the per-day scheduling loop, compute `effectiveDayStart` and `effectiveDayEnd` per date: `half-am` → start stays the same, end capped at 12:00; `half-pm` → start shifted to 13:00, end stays the same; `off` → mark the date as fully blocked. Use these per-date window values instead of the global `dayStartMin` / `dayEndMin` when running the break-aware slot finder.

2. **Exclude off-days from rebalance** — Extend `rebalanceTasksForward` to accept an optional `offDates?: Set<string>` parameter. Filter them from `orderedDates` the same way non-working-days are filtered. Pass the off-date set (built from `dayAvailability` entries with `dayType === "off"`) from both the rebalance-week and generate-daily call sites.

## Relevant files
- `server/routes.ts:230-318`
- `server/routes.ts:2000-2025`
- `server/routes.ts:2291-2295`
- `server/routes.ts:2620-2730`
- `shared/schema.ts:113-129`
