# Founder State Regulation + Smart Daily Brief

## What & Why

Two related features that make Naya's daily experience uniquely human-aware:

**Founder State Regulation (F3):** The user's energy level directly determines what kind of work they should do today. On a depleted day, a 6-task deep-work plan is counterproductive. Naya needs a simple, non-intrusive way to capture energy level and use it to adapt task generation — without being gamified or preachy.

**Smart Daily Brief (F4):** The current "Generate Daily Plan" is a manual button. The vision is an automatic morning brief that appears on first app open, respects today's energy level, surfaces carry-overs from yesterday, and reminds the user of upcoming strategic milestones — without them having to ask.

These two features are bundled because they both live on the Dashboard and both feed from and into the same energy-aware task context.

## Done looks like

- A subtle "How are you today?" energy selector appears on the Dashboard — a small 4-option row (High / Medium / Low / Depleted) with simple icons, no streaks or gamification. It disappears once set for the day, resets each morning.
- The selected energy level is stored in the user's preferences and persists for the calendar day.
- When energy is Low or Depleted: task generation caps at 3 tasks instead of the usual limit; task types prioritize `admin` and `creative` energy over `deep_work`; a gentle note appears in the daily brief ("Light execution day. Your 3 priorities are…").
- When emotional context is set to "grief" or "recovery": AI-generated text uses reduced urgency; suggestions favour 1–2 anchor tasks.
- A "Today's Brief" card appears automatically on the Dashboard on first open each day (stored in DB so it doesn't regenerate on every refresh). It contains: the 3 most important tasks for today (respecting energy and available time), 1 carry-over from yesterday, and 1 strategic reminder about upcoming milestones.
- The daily brief is dismissible and does not reappear until the next calendar day.

## Out of scope

- Medical-grade energy tracking or cycle tracking (the feature is user-controlled, opt-in only).
- Push/email notifications for the daily brief.
- Integration with wearables or third-party wellness APIs.

## Tasks

1. **Extend user preferences schema** — Add `currentEnergyLevel` (text: high | medium | low | depleted), `currentEmotionalContext` (text, nullable: grief | transition | peak | recovery | null), `energyUpdatedDate` (text YYYY-MM-DD), `dailyBriefDate` (text YYYY-MM-DD), and `dailyBriefContent` (JSONB) to the `userPreferences` table or a new `userOperatingProfile` table. Run `db:push`.

2. **Energy update endpoint** — Add `PATCH /api/user/energy` that saves `currentEnergyLevel`, `currentEmotionalContext`, and `energyUpdatedDate` = today. Include a guard: if `energyUpdatedDate` is already today, do a simple update (idempotent). Expose `GET /api/user/energy` to read back the current state.

3. **Propagate energy level to task generation** — In `generate-daily` and `rebalance-week` endpoints, read the user's current energy level. When `low` or `depleted`, cap `dailyCap` at 3 and bias task selection to `taskEnergyType: admin | creative`. When emotional context is set, pass it to the OpenAI prompt to soften urgency language.

4. **Smart Daily Brief endpoint** — Create `POST /api/tasks/daily-brief` that: checks if `dailyBriefDate` = today (returns stored brief if so); otherwise fetches today's scheduled tasks, yesterday's incomplete tasks, and the next upcoming campaign milestone; calls OpenAI to generate a structured brief JSON; stores it in `dailyBriefContent` + sets `dailyBriefDate` = today; returns the brief. Also expose `GET /api/tasks/daily-brief` to retrieve without regenerating.

5. **Dashboard energy widget + daily brief card** — Add the energy selector row to the Dashboard (compact, minimal, calm design — no emojis or gamification). Auto-call the daily brief endpoint on Dashboard mount (fire-and-forget). Render the brief as a clean card with today's 3 tasks, 1 carry-over, and 1 strategic reminder. Include dismiss and "adjust my energy" interactions.

## Relevant files

- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `server/services/openai.ts`
- `client/src/pages/dashboard.tsx`
