# Naya Voice & Identity (V23)

## What & Why

Several screens in Naya feel like generic SaaS product instead of reflecting Naya's identity as a personal AI Operating System. This task sweeps the product to align copy, prompts, and UI with Naya's true voice: direct, human, personal, and behaviorally aware.

Eight changes are needed across the landing page, AI prompts, dashboard, sidebar, onboarding, and strategy page — plus a shared voice constant that standardizes the system prompt used across all AI endpoints.

## Done looks like

- **Landing page**: Hero reads "Your AI Operating System for building without burning out." Feature cards describe real capabilities in Naya's voice. Footer updated to 2025.
- **Daily brief prompt**: Uses the user's operating profile (persona, energy rhythm, avoidance triggers) in the OpenAI call. Persona-specific coaching lines ("If they're a Builder…") are included in the system prompt.
- **Dashboard**: A compact `OperatingProfileChip` card appears below the daily brief showing persona icon, energy rhythm, and first avoidance trigger. Only visible when a persona has been detected.
- **Weekly briefing prompt**: System message uses Naya's voice and includes persona/avoidance context.
- **Sidebar**: "Library" section label is renamed to "Knowledge". "Reading Hub" page is renamed to "Knowledge Hub" in both sidebar and the reading-hub page title.
- **Onboarding**: A step 0 welcome screen appears before the first form step, introducing Naya with its identity statement. `TOTAL_STEPS` increments to 12, all subsequent step references shift by 1.
- **Strategy page**: Placeholder text uses Naya's voice ("Give Naya a moment to think…") and loading text reads "Naya is thinking about your week…".
- **Shared voice constant**: A new file `server/naya-voice.ts` exports `NAYA_SYSTEM_VOICE` and it is imported in the daily-brief, weekly-briefing, and generate-daily AI calls.

## Out of scope

- Changing any scheduling, rebalancing, or campaign logic.
- Changing the data model or database schema.
- Changing the energy system or brand DNA collection.
- Adding new API endpoints beyond what is described above.

## Tasks

1. **Create `server/naya-voice.ts`** — Export `NAYA_SYSTEM_VOICE` constant with Naya's full voice definition. Import and use it in the system messages for `POST /api/tasks/daily-brief`, `POST /api/strategy/generate-weekly-briefing`, and the OpenAI call inside `POST /api/tasks/generate-daily`.

2. **Enhance daily brief prompt** — Inside `POST /api/tasks/daily-brief`, fetch the user's operating profile (with `.catch(() => null)`) and inject persona, energy rhythm, and avoidance triggers into `briefPrompt`. Add persona-conditional coaching lines (Builder / Strategist / Creative / Analytical) to the system instructions.

3. **Rewrite landing page copy** — Update all hero text, feature card descriptions, CTA button labels, and footer in `landing.tsx` with the copy specified in the V23 doc. No layout or structural changes — copy only.

4. **Add `OperatingProfileChip` to dashboard** — Add a small inline component in `dashboard.tsx` that queries `/api/persona/my-persona` and `/api/me/operating-profile`, then renders a persona icon + rhythm + avoidance trigger chip. Place it just after the `<DailyBrief />` component. Returns null if no persona is detected.

5. **Update weekly briefing system prompt** — In `POST /api/strategy/generate-weekly-briefing`, replace the current system message with `NAYA_SYSTEM_VOICE` and add the user's persona and avoidance context to the prompt body.

6. **Rename sidebar section and reading-hub title** — In `sidebar.tsx`, change the section label "Library" → "Knowledge". In `reading-hub.tsx` (or wherever the page title lives), change "Reading Hub" → "Knowledge Hub".

7. **Add onboarding welcome screen (step 0)** — In `onboarding.tsx`, add a new step 0 rendered before step 1. Show the Naya welcome message with a "Let's begin →" button. Increment `TOTAL_STEPS` to 12 and shift all step number references by 1 (step 1 → 2, etc.). Use the `prev()`/`next()` helpers so navigation still works. The welcome screen should have no form fields and no back button.

8. **Update strategy page voice** — In `strategy.tsx`, replace the two placeholder/loading strings with Naya's voice versions as specified in the V23 doc.

## Relevant files

- `server/routes.ts:1261` — `POST /api/tasks/daily-brief`
- `server/routes.ts:4717` — `POST /api/strategy/generate-weekly-briefing`
- `client/src/pages/landing.tsx`
- `client/src/pages/dashboard.tsx`
- `client/src/pages/onboarding.tsx:75` — `TOTAL_STEPS = 11`
- `client/src/pages/strategy.tsx`
- `client/src/components/sidebar.tsx:52` — Library section label
