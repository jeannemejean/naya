# Schedule Preview Dashboard Widget

## What & Why
Replace the existing "Tomorrow" card on the dashboard with a richer "What's ahead" widget that gives the user an at-a-glance view of tomorrow's schedule and the week ahead. The current Tomorrow card just shows bullet-point task titles. The new widget should feel like a real schedule — showing time slots, energy types, project colors, and a compact week strip — making it instantly readable without needing to open the Planner.

## Done looks like
- The Tomorrow card is replaced with a two-tab widget: "Tomorrow" and "This Week"
- Tomorrow tab: shows tasks sorted by scheduled time (if set), with colored energy badges (🧠 deep work, 🎨 creative, 📋 admin…), project color indicators, estimated duration, and total time load for the day. Tasks without a scheduled time appear in a separate "Unscheduled" section.
- This Week tab: compact 5–7 day strip where each day column shows the day name, date, task count, a small colored bar chart breaking down task load by project, and total estimated hours. Days off or half-days (from dayAvailability) show a badge.
- Approaching goal deadlines are shown at the bottom of the Tomorrow tab.
- A "Open Planner" link at the bottom navigates to /planning.

## Out of scope
- Editing or rescheduling tasks from within the widget
- Showing subtask details
- Real-time push updates (polling every 5 min is fine)

## Tasks

1. **Backend endpoint** — Add `GET /api/dashboard/schedule-preview` that returns tasks for the next 7 days (`scheduledDate`, `scheduledTime`, `estimatedDuration`, `taskEnergyType`, `title`, `priority`, `projectId`, `completed`), grouped by date, joined with project names and colors. Also include `dayAvailability` states for those dates and approaching goal deadlines within 7 days. Reuse existing storage methods (`getTasksInRange`, `getDayAvailabilityRange`, `getProjectGoals`).

2. **SchedulePreview component** — Create `client/src/components/schedule-preview.tsx` with two tabs:
   - **Tomorrow tab**: tasks sorted by `scheduledTime` rendered as time-stamped rows with a left-border colored by project, energy badge, and duration pill. Unscheduled tasks grouped below. Footer shows total estimated hours and approaching deadlines.
   - **This Week tab**: 7 horizontally-scrollable day columns, each showing day label, date, task count, a stacked color bar (one segment per project proportional to task count), and total estimated hours. Half-day / off availability badges on day headers.

3. **Replace in dashboard** — In `client/src/pages/dashboard.tsx`, swap the `<TomorrowPreview />` import and usage for `<SchedulePreview />`. Delete `client/src/components/tomorrow-preview.tsx`.

## Relevant files
- `client/src/components/tomorrow-preview.tsx`
- `client/src/pages/dashboard.tsx:9,734`
- `server/routes.ts:1526-1538`
- `server/storage.ts:548-580`
- `shared/schema.ts:315-350`
