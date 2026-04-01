---
title: Campaign Performance Loop + Technical Debt
---
# Campaign Performance Loop + Technical Debt

## What & Why

Two lower-priority but valuable improvements, bundled to keep the task count manageable:

**Campaign Performance Loop (F5):** Campaigns currently end without any feedback. The AI has no way to learn what worked for this specific user. A post-campaign review — simple ratings on content quality, audience response, and task execution — closes this loop and improves future campaign generation.

**Technical Debt (TD4 + TD5):**
- *TD4 — Project list pagination:* `GET /api/projects` returns all projects without any limit. As users accumulate projects, this becomes slow and over-fetches data.
- *TD5 — Date utility consolidation:* Multiple files (`routes.ts`, `campaigns.tsx`, `planning.tsx`, `storage.ts`) each reimplement the same date formatting, timezone handling, ISO week, and work-day calculations. This duplication causes subtle inconsistencies (as seen in bugs #5 and #6). Centralising these into shared utility modules eliminates the drift.

## Done looks like

- After a campaign's `endDate` passes, a "Review this campaign" prompt appears the next time the user opens the Campaigns page for that project. It shows three 1–5 star ratings: Content quality / Audience response / Task execution.
- Ratings are stored on the campaign record. When the AI generates future campaigns for the same project, it receives a summary of past campaign ratings as additional context.
- `GET /api/projects` accepts `?limit=N&offset=N` query params (default limit = 50). The frontend handles the case where `projects.length >= limit` by showing a "Load more" or pagination control.
- A `server/utils/dateUtils.ts` file exists with shared helpers: `formatDate()`, `addDays()`, `addWeeks()`, `getISOWeek()`, `isWorkDay()`, `campaignDateToStr()`. The equivalent duplication in `routes.ts` is replaced with imports from this module.
- A `client/src/lib/dateUtils.ts` file exists with shared client-side helpers: `formatDisplayDate()`, `getISOWeekNumber()`, `isToday()`, `isPast()`. All inline date logic in `planning.tsx`, `campaigns.tsx`, `strategy.tsx`, and `dashboard.tsx` imports from this module.

## Out of scope

- Automated AI analysis of campaign performance beyond using the rating as context (future ML work).
- Real-time campaign metrics from social platforms (separate integration task).
- Full pagination UI with page numbers (Load more pattern is sufficient for now).

## Tasks

1. **Campaign review rating fields** — Add `reviewContentQuality`, `reviewAudienceResponse`, `reviewTaskExecution` (all integer, nullable, 1–5) and `reviewedAt` (timestamp, nullable) to the `campaigns` table in `shared/schema.ts`. Run `db:push`.

2. **Review endpoints + AI context** — Add `PATCH /api/campaigns/:id/review` to store the three ratings and set `reviewedAt`. In the campaign generation prompt, if past campaigns for the same project have ratings, include a brief summary ("Your last campaign scored X/5 on task execution — this plan adjusts pacing accordingly").

3. **Post-campaign review UI** — On the Campaigns page, for any campaign with `status = 'completed'` and `reviewedAt = null` and `endDate < today`, display a compact "How did this campaign go?" review card with three star-rating inputs and a Submit button. After submission, show a brief "Thanks — Naya will use this for your next campaign" confirmation.

4. **Project list pagination** — Add `?limit=N&offset=N` support to `GET /api/projects`. Default limit = 50. In the frontend, detect when `projects.length >= 50` and show a "Show more" button that appends the next page to the list.

5. **Shared date utility modules** — Create `server/utils/dateUtils.ts` exporting the date helpers currently duplicated across `routes.ts`. Create `client/src/lib/dateUtils.ts` exporting client-side equivalents. Replace the most critical duplicates first: `getISOWeek` (fixes Bug #5 permanently), `formatDate` (fixes the `toISOString()` timezone bug), `isWorkDay`. Update imports in the files that use these helpers.

## Relevant files

- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `client/src/pages/campaigns.tsx`
- `client/src/pages/planning.tsx`
- `client/src/pages/strategy.tsx`
- `client/src/pages/dashboard.tsx`