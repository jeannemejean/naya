# Campaign Launch v3 — Load-aware scheduling

## What & Why

The current campaign launch route creates every task on today's date with no decomposition and no awareness of existing workload — causing task pile-ups and making content tasks unactionable (a "Publish carousel" task gives the user no lead-up steps). This replaces that with:
1. **Content task decomposition** — a content task like "Publish LinkedIn carousel" becomes 4 ordered sub-tasks (Angle & structure → Write copy → Design slides → Schedule) spread across multiple days before the publication date.
2. **Load-aware scheduling** — tasks are spread using a daily cap of 4 tasks across ALL projects, skipping full days automatically.
3. **Phase-aware placement** — sub-tasks are anchored to each phase's date range so Phase 1 tasks don't bleed into Phase 2 weeks.
4. **Content Calendar integration** — each content plan piece from the campaign is also created as a draft "idea" entry in the Content Calendar with a scheduled date.

## Done looks like

- Launching a 1-month campaign with 8 generated tasks produces more than 8 tasks (content tasks become 2–4 sub-tasks each), spread across multiple days
- A "Publish LinkedIn carousel" task becomes: Angle & structure → Write copy → Design slides → Schedule, each on a separate day before the publication date
- No single day ever receives more than 4 tasks total (counting all other projects' existing tasks)
- Sub-tasks for Phase 1 fall within Phase 1's date range; Phase 2 tasks fall within Phase 2's dates
- The Content Calendar shows content plan pieces as "idea" draft cards with scheduled dates
- The launch success toast reads: "Campaign deployed 🚀 · N tasks scheduled across phases (respecting your existing workload) · M content ideas added to your calendar"
- The `/api/content` query cache is invalidated on launch so the Content Calendar shows new items immediately

## Out of scope

- Weekend scheduling preferences (Mon–Fri assumed as work days)
- Letting the user configure the daily cap (hardcoded to 4)
- Retroactively re-scheduling tasks if the user's workload changes after launch

## Tasks

1. **Add date/phase helper functions to routes.ts** — Define standalone helper functions before the launch route: `addDays(date, n)`, `dateToStr(date)`, `parsePhaseDateRange(phaseDuration, campaignStart, campaignDuration)` (parses "Weeks 1-2" or "Month 1" strings into `{start, end}` date objects), and `mapFormatToContentType(format)` (maps AI-returned format strings like "carousel", "reel" to the content schema's `contentType` enum).

2. **Add `decomposeContentTask` function** — Add the content task decomposition function before the launch route. It detects whether a task is content-type by title keywords or type field, then returns an array of `SubTask` objects with `daysBeforePublication` offsets. Video tasks → 4 sub-tasks over 5 days; newsletters/articles → 4 sub-tasks over 4 days; carousels → 4 sub-tasks over 3 days; generic posts → 2 sub-tasks over 1 day; non-content tasks → pass through as-is with offset 0.

3. **Rebuild the launch route** — Replace the current `/api/campaigns/:id/launch` handler with the full load-aware version: load existing tasks across the campaign period via `getTasksInRange`, build a `dayCounts` map, iterate tasks by phase using `phaseRanges`, decompose each task with `decomposeContentTask`, place sub-tasks on the next available day within the phase range that is under the daily cap, then create Content Calendar entries for all `contentPlan` pieces. Respond with `{ campaign, tasksCreated, contentCreated }`.

4. **Update `launchMutation` in campaigns.tsx** — Change the `onSuccess` type signature to `{ campaign: Campaign; tasksCreated: number; contentCreated: number }`, add invalidation of `/api/content` query cache, and update the toast to show the "Campaign deployed 🚀" message with the full breakdown description.

## Relevant files

- `server/routes.ts:5045-5097`
- `server/storage.ts:175`
- `server/storage.ts:201`
- `server/storage.ts:685`
- `server/storage.ts:1178`
- `client/src/pages/campaigns.tsx:602-614`
