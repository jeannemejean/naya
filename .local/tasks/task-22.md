---
title: Campaign Launch v2 — Temporal deployment + Content Calendar
---
# Campaign Launch v2 — Temporal Deployment

## What & Why

Currently, launching a campaign dumps every generated task onto today's date and never creates content calendar entries from the campaign's `contentPlan`. The campaign already contains all the data needed for correct temporal distribution: phases with duration strings ("Weeks 1–2", "Month 3"), tasks tagged with a phase number, and content pieces tagged with a week label. This task makes the launch route read all of that and spread everything correctly across the calendar, and adds a start date picker to the creation form so the user can anchor the campaign to a specific week.

## Done looks like

- The campaign creation form has a "Campaign start date" date input (defaults to today) between the duration selector and optional context field; this date is saved on the campaign record on generate
- Launching a 3-month campaign set to start March 23 → Phase 1 tasks appear in Planning on the week of March 23 (Mon/Wed/Fri pattern), Phase 2 tasks appear several weeks later, Phase 3 tasks appear in the final phase date range
- Content Calendar (Pipeline view) shows all content pieces from the campaign's `contentPlan` as "Idea" draft cards with scheduled dates matching their week label (e.g. "Week 3" → Wednesday of week 3 at 10:00 AM)
- The launch success toast reads: "Campaign launched — N tasks scheduled across phases · M content pieces added to your calendar"
- The campaign detail view shows a compact deployment summary block with start date, end date, and a "Tasks and content pieces deployed" confirmation line (when `tasksGenerated` is true)
- `CalendarDays` icon imported in `campaigns.tsx` for the summary block

## Out of scope

- Load-aware scheduling / daily cap (handled separately in the v3 follow-up task)
- Content task decomposition into sub-tasks (also in v3)
- Custom work-day preferences

## Tasks

1. **Add date helper functions to routes.ts** — Define four standalone helper functions outside any route handler: `parsePhaseDateRange(duration, startDate, campaignDurationStr)` (parses "Weeks 1–2" / "Month 3" strings into `{start, end}` date objects), `dateToStr(d)`, `addWeeks(d, weeks)`, `addDays(d, days)`, and `mapFormatToContentType(format)` (maps AI format strings like "carousel" / "reel" to the content schema's `contentType` values: post/story/article/email).

2. **Rebuild `/api/campaigns/:id/launch`** — Replace the current flat "put everything on today" handler with phase-aware scheduling: resolve `startDate` from request body, campaign record, or today; build a phase→date-range map using `parsePhaseDateRange`; group generated tasks by phase; distribute each phase's tasks across Mon/Wed/Fri using `addDays` offsets; clamp dates within the phase range; `await` each `createTask`. Then iterate `contentPlan`, parse the week label, compute Wednesday-of-that-week at 10:00 AM via `addDays`, and `createContent` for each piece with `contentStatus: 'idea'` and `status: 'draft'`. Update campaign record with `tasksGenerated: true`, `status: 'active'`, and resolved `startDate`. Respond with `{ campaign, tasksCreated, contentCreated }`.

3. **Add startDate input to creation form in campaigns.tsx** — Add a `startDate` state variable (initialised to today's date string). Render a date `<input>` in the creation form between the duration selector and the optional context toggle. Pass `startDate` to the generate mutation body so it is saved on the campaign record. Pass `selectedCampaign?.startDate` to the launch mutation body.

4. **Update launchMutation and add deployment summary** — Change `onSuccess` type to include `contentCreated: number`, invalidate `/api/content` query cache, and update the toast description to show both counts. In the detail panel, add the compact deployment summary block after the status badge row (start date, optional end date, "deployed" confirmation line when `tasksGenerated`). Add `CalendarDays` to the lucide import list.

## Relevant files

- `server/routes.ts:5045-5097`
- `server/storage.ts:175,201,685,1178`
- `client/src/pages/campaigns.tsx:1-16,602-614`