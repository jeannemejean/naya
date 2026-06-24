---
title: Analytics: per-project operations dashboard
---
# Analytics Per-Project Dashboard

## What & Why
The Analytics page currently shows generic fake data with no project filter. This replaces it with a live operations dashboard that reads real data already in the database — task completion rates, content pipeline status, campaign counts, and the current week's strategy — all scoped per project. No new database tables or migrations are required; all storage methods needed already exist.

## Done looks like
- Selecting a project in Analytics shows live stats for that project only
- Four KPI cards at the top: task completion rate %, content published count, active campaigns count, total pipeline items
- A weekly execution rhythm area chart (last 4 weeks, completed vs total) using Recharts AreaChart
- A content pipeline breakdown with four horizontal progress bars (idea / draft / ready / published)
- A tasks-by-type bar chart (Recharts BarChart) and a campaigns summary panel (active / completed / draft counts)
- A strategy-this-week section showing the current week's focus, recommendations, and weekly plan; empty state with a link to `/strategy` if none exists
- Switching projects resets all panels and loads fresh data
- Skeleton loading state while the query runs; a friendly empty state when all metrics are zero
- Dark mode works throughout

## Out of scope
- Existing routes (`/api/metrics`, `/api/metrics/history`, `/api/analytics/insights`, `/api/analytics/content-performance`) are untouched — only add the new route
- No new schema columns or db:push needed
- No AI-generated insights on this page (that is the existing `/api/analytics/insights` route, kept separate)

## Tasks

1. **Add `GET /api/analytics/project-summary` route** — Compute task totals/completion rate, tasks-by-energy, tasks-by-type, content-by-status, content-by-platform, campaign counts, current-week strategy report, and 4-week weekly completion trend in a single server-side aggregation. Call `storage.getTasks(userId, undefined, projectId)` (no dueDate filter) to get all tasks. Validate projectId as a finite positive integer; return 400 if invalid.

2. **Rewrite `analytics.tsx`** — Replace the entire file content. Import Recharts (AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer). Remove all fake/simulated data, the timeframe select, and the old performance-insights query. Add project pill selector (same pattern as Strategy and Campaigns pages: slice first 5 projects as pills, overflow select). Single query to `/api/analytics/project-summary?projectId=X`. Render: four KPI stat cards (CheckCircle2 indigo / FileText violet / Rocket amber / Layers cyan icons), weekly execution AreaChart (two areas: completed=indigo, total=slate/dashed), content pipeline horizontal div-bars (idea=yellow, draft=blue, ready=green, published=purple), tasks-by-type BarChart (indigo), campaigns summary (three dot-rows + total tasks generated), strategy-this-week card (indigo left border, focus + recommendations + weeklyPlan rows; null → dashed empty state with Link to /strategy). Skeleton on `isLoading`, empty state when all counts are zero.

## Relevant files
- `server/routes.ts`
- `server/storage.ts:588-603,670-680,785-800`
- `client/src/pages/analytics.tsx`
- `client/src/pages/strategy.tsx`
- `client/src/pages/campaigns.tsx`