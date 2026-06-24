# Weekly Intelligence Briefing

## What & Why

The Strategy page currently shows AI recommendations on demand — the user has to ask. Naya's vision demands the inverse: proactive intelligence delivered automatically. Every Monday (or first app open of the week) Naya should produce a "Weekly Intelligence Briefing" that tells the founder exactly where to focus without requiring any prompt.

This is the first step toward Naya becoming an always-on strategic partner rather than a reactive tool.

## Done looks like

- A `strategyReports` table stores one weekly briefing per user per week.
- On first app open each week (or automatically at 8am Monday in the user's timezone), a briefing is generated in the background without blocking page load.
- The Dashboard displays a prominent but collapsible "This Week's Intelligence" banner containing:
  - One strategic focus sentence ("This week, your primary leverage is…")
  - 2–3 "what you're doing well" observations drawn from recent task completion patterns
  - 1–2 risk flags ("You haven't prospected in 12 days", "Campaign X is behind target")
  - 3 recommended moves with "Add to plan" one-click action
  - A brief energy/tone note based on the user's operating profile
- The banner is dismissible per week and does not regenerate on every page refresh (stored in DB).
- If no brand DNA / strategy data exists yet for the user, the briefing gracefully prompts them to complete onboarding instead of generating empty content.

## Out of scope

- Email / push notification delivery of briefings (future work).
- Per-project briefings (this is a user-level weekly briefing).
- Retroactive briefings for past weeks.

## Tasks

1. **`strategyReports` schema** — Add a `strategyReports` table to `shared/schema.ts` with fields: `userId`, `weekStart` (YYYY-MM-DD, the Monday), `content` (JSONB storing the structured briefing), `generatedAt`, and `dismissed` (boolean). Run `db:push`.

2. **Generation endpoint** — Create `POST /api/strategy/generate-weekly-briefing`. It checks if a report already exists for the current ISO week; if not, it calls OpenAI with the user's Brand DNA, recent task completion data (last 14 days), active campaigns, and project goals to generate the structured briefing. Store the result. Return the report.

3. **Auto-trigger on Dashboard load** — On the Dashboard page mount, call the generation endpoint (fire-and-forget via a background mutation). Also expose `GET /api/strategy/weekly-briefing` to retrieve the current week's report for display.

4. **Dashboard briefing banner** — Add a collapsible "Intelligence Briefing" card near the top of the Dashboard. Render each section of the briefing with calm, minimal styling matching Naya's premium aesthetic. Include a dismiss button that sets `dismissed = true` for the week. "Add to plan" buttons on recommended moves call the existing task creation flow.

## Relevant files

- `shared/schema.ts`
- `server/routes.ts`
- `server/services/openai.ts`
- `client/src/pages/dashboard.tsx`
