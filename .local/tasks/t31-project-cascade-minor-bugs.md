# Project Cascade Deletion + Minor Bug Fixes

## What & Why

Several P1/P2 issues degrade day-to-day stability:

**Bug #4:** Deleting a project leaves orphaned tasks, campaigns, content, goals, personas, and strategy profiles in the DB. These ghost records appear in queries and can cause foreign-key errors.

**Bug #5:** Two endpoints both handle task completion — `/api/tasks/:id/complete` and `/api/tasks/:id/toggle` — creating ambiguity and potential double-execution in the frontend.

**Bug #6:** The week-number display in Strategy uses `Math.ceil(date / 7)`, which can return `5` for late-month dates and doesn't match ISO week numbering.

**Bug #7:** The Quick Capture classification relies on a hardcoded `setTimeout(4500ms)` to wait for server processing. On a slow server this races and leaves the UI in a stuck state.

**Minor #3:** `refetchInterval: 4000` on Quick Capture and `5000` on Milestone Triggers hammers the server unnecessarily. These should be 15 seconds minimum.

## Done looks like

- Deleting a project removes (or marks cancelled) all its dependent records atomically — no orphaned data remains.
- There is exactly one endpoint for task completion. Frontend calls only that endpoint.
- Strategy page displays correct week numbers matching standard calendar weeks.
- Quick Capture classification reliably updates the UI within 10 seconds using polling, not a fixed delay.
- Dashboard refetch intervals are 15 seconds; manual actions still trigger immediate invalidation.

## Out of scope

- Soft-delete / recycle bin for projects (full deletion only for now).
- Pagination on project lists (separate task).

## Tasks

1. **Project cascade deletion** — Wrap the `deleteProject` handler in a DB transaction that first marks incomplete tasks `taskStatus='cancelled'`, then deletes campaigns, content, goals, strategy profiles, brand DNA records, quick-capture entries, and target personas for that project — in that order — before deleting the project itself. All within a single `db.transaction()` call.

2. **Remove duplicate `/complete` endpoint** — Delete the `POST /api/tasks/:id/complete` handler. Search the frontend for any call to that path and replace with calls to `POST /api/tasks/:id/toggle`. No behaviour change; just one canonical endpoint.

3. **Fix ISO week number in Strategy** — Replace `Math.ceil(now.getDate() / 7)` with a proper ISO-8601 week number calculation using the date-fns `getISOWeek` function (already available in the project).

4. **Replace Quick Capture setTimeout with polling** — Remove the `setTimeout(4500)` in dashboard.tsx. After firing the classify request, start a `setInterval` that checks every 500 ms (up to 10 s / 20 attempts) whether the entry's `classifiedType` has changed from the server. On success or timeout, clear the interval and invalidate the tasks query.

5. **Reduce aggressive refetch intervals** — Change `refetchInterval: 4000` (Quick Capture) and `refetchInterval: 5000` (Milestone Triggers) to `refetchInterval: 15000` in dashboard.tsx. Ensure that user-triggered mutations still call `queryClient.invalidateQueries` for immediate refresh.

## Relevant files

- `server/routes.ts:954`
- `server/storage.ts`
- `server/routes.ts:1961-1985`
- `client/src/pages/strategy.tsx:107`
- `client/src/pages/dashboard.tsx:250,333`
- `shared/schema.ts`
