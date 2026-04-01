# Smart Generation + UX Improvements

## What & Why

After the foundational bugs are fixed (status field, rebalance idempotency, cascade deletion), a set of P1/P2 improvements makes the task engine feel genuinely intelligent rather than purely manual:

- **Amélioration #1 (Auto-reactivity):** When a user changes a project priority, completes a task, or pauses/resumes a campaign, the planning view doesn't update automatically. The user has to manually navigate away and back. Frontend mutations that affect scheduling should invalidate the task query cache immediately.
- **Amélioration #4 (Orphan cleanup):** Tasks whose project or campaign has been deleted linger in the DB and surface in queries. A scheduled cleanup endpoint would remove them proactively.
- **Amélioration #3 (Task state visibility):** There's no visual distinction between AI-generated tasks, campaign tasks, manual tasks, overdue tasks, and overflowed tasks in the planning calendar.
- **Minor #1 (Error boundaries):** A single React component crash brings down the whole dashboard or planning page. Wrapping complex widgets in an `ErrorBoundary` contains the damage.
- **Minor #4 (Type safety):** `(project as any)` and `(task as any)` casts in dashboard.tsx and planning.tsx bypass type checking and hide real bugs.
- **Minor #5 (Frontend paused filter):** The planning calendar should apply the client-side `taskStatus` guard even before the server-side filter is applied to cached data.

## Done looks like

- Changing a project's priority or status, completing a task, or toggling a campaign immediately refreshes the planning/tasks view without a page reload.
- A cleanup endpoint exists and is called at app startup and on planning page load; it cancels tasks referencing deleted projects and clears tasks overdue by 90+ days.
- The planning calendar shows colour-coded badges: a small coloured dot or label distinguishing campaign tasks, AI-generated tasks, manual tasks, overdue tasks (red/orange), and tasks overflowed from a previous week.
- Dashboard and planning pages render an "This section encountered an error — Retry" fallback widget instead of a blank screen when a component crashes.
- No `as any` casts remain on `Task` or `Project` objects in dashboard.tsx or planning.tsx; all types come from the Drizzle schema.
- Paused and cancelled tasks are filtered on the client before rendering the calendar grid.

## Out of scope

- WebSocket-based real-time push (invalidation is query-level polling only).
- Full test suite for all mutations (separate testing task).
- Amélioration #2 confirmation UI for duplicate generation (that is handled in Task #30).

## Tasks

1. **Auto-invalidation on key mutations** — In every frontend mutation that changes project status/priority, completes a task, or pauses/resumes/redeploys a campaign, add `queryClient.invalidateQueries({ queryKey: ['/api/tasks'] })` to the `onSuccess` callback if not already present. Also invalidate `['/api/projects']` when project status changes.

2. **Orphan cleanup endpoint** — Create `POST /api/tasks/cleanup` in routes.ts that: (a) marks `taskStatus='cancelled'` on tasks whose `projectId` references a non-existent project; (b) marks `taskStatus='cancelled'` on tasks belonging to a campaign with `status='paused'`; (c) marks `taskStatus='cancelled'` on incomplete tasks with `scheduledDate` more than 90 days in the past. Return counts of each category. Call this endpoint on planning page mount and on initial auth success.

3. **Task state visual indicators in planning** — In the planning calendar/week grid, add a small coloured dot or pill badge on each task card based on its `source` and dates: campaign tasks get an indigo badge, AI-generated tasks get a teal badge, overdue tasks (scheduledDate < today and incomplete) get a red/orange border, overflowed tasks (source = 'replan' and scheduledDate > original scheduledDate) get an amber accent.

4. **React ErrorBoundary wrappers** — Create a reusable `ErrorBoundary` component that catches render errors and shows "This section encountered an error" with a retry button. Wrap the Dashboard's main task widget, the Planning calendar, and the Campaign detail panel in this boundary.

5. **Replace `as any` with Drizzle types** — Import `Task` and `Project` from `@shared/schema` in dashboard.tsx and planning.tsx. Replace every `(task as any)` and `(project as any)` cast with the correct typed access. Fix any type errors revealed — do not suppress them with additional `any` casts.

6. **Client-side paused/cancelled task filter** — In planning.tsx, before building the calendar day map, filter out any task where `task.taskStatus === 'paused' || task.taskStatus === 'cancelled'`. This acts as a client-side safety net on top of the server-side filter added in Task #29.

## Relevant files

- `client/src/pages/planning.tsx`
- `client/src/pages/dashboard.tsx`
- `client/src/pages/campaigns.tsx`
- `server/routes.ts`
- `shared/schema.ts:348-386`
