---
title: Strategy page — per-project rewrite
---
# Strategy Page — Per-Project Rewrite

## What & Why
The Strategy page currently ignores which project the user is working on. All intelligence briefs, weekly strategies, and reports use a single global Brand DNA record, which is meaningless when the user runs multiple distinct projects (Agence JMD vs. Naya vs. Encore Merci). This task makes the entire Strategy page project-aware and adds a full three-section UI.

## Done looks like
- Opening Strategy and selecting "Agence JMD" loads Agence JMD's per-project Brand DNA for the intelligence brief and strategy generation — zero contamination from other projects
- Switching to a different project refreshes all data on the page instantly
- Section 1 "Strategic Intelligence" shows Naya's prose analysis of the selected project, with a Refresh button that saves back only to that project's record
- Section 2 "Weekly Command" shows an empty state with a context textarea when no strategy exists for the week, and filled sub-cards (Focus / Angles & Moves / Direction) once generated
- Generated strategies are stored with a projectId and retrieved per project per week
- "Regenerate" clears and re-shows the input form; "Add to planner" pushes a task linked to the selected project
- Section 3 "Conditional Rules" (existing) is preserved intact; new rules are linked to the selected project via projectId
- The page header reads "Strategy — [Project Name]" and updates as the selector changes

## Out of scope
- Changes to any other page or component
- Filtering Conditional Rules display by project (rules remain global in display, only new ones carry projectId)
- Any change to the global Brand DNA in Settings

## Tasks

1. **Schema: add projectId to strategyReports** — Add a nullable `projectId integer` column referencing projects to the `strategyReports` table in `shared/schema.ts`. Update the relations block to include the projects relation. Run `npm run db:push`.

2. **Storage: update getStrategyReport to filter by projectId** — Update the `getStrategyReport` method signature in `server/storage.ts` (interface + implementation) to accept an optional `projectId` parameter. When provided, add it as an `and()` condition in the query. Update `createStrategyReport` to accept and persist `projectId`.

3. **Server: make refresh-intelligence project-aware** — In `server/routes.ts`, update `POST /api/brand-dna/refresh-intelligence` to read `projectId` from `req.body`. When present, load the project's Brand DNA via `storage.getBrandDnaForProject(userId, projectId)` instead of the global record. Save the generated summary back using `storage.upsertBrandDnaForProject(userId, projectId, { nayaIntelligenceSummary, lastStrategyRefreshAt })`. The prompt construction stays identical.

4. **Server: make strategy/generate project-aware + add weekContext** — In `server/routes.ts`, update `POST /api/strategy/generate` to read `projectId` and `weekContext` from `req.body`. Load DNA via `getBrandDnaForProject` when projectId is present. Pass `weekContext` through to `generateStrategyInsights`. Save the returned report with `projectId`. Update `GET /api/strategy/report` to read `projectId` from query params and pass it to `getStrategyReport`.

5. **openai.ts: add weekContext to StrategyAnalysisRequest and prompt** — Add `weekContext?: string` to the `StrategyAnalysisRequest` interface. In the `generateStrategyInsights` prompt, append `"- User's focus this week: ${request.weekContext || 'Not specified'}"` to the Brand Profile block.

6. **Frontend: rewrite strategy.tsx** — Full rewrite of `client/src/pages/strategy.tsx`:
   - Project selector as pill buttons at the top of the page (defaulting to primary or first project); all queries depend on `selectedProjectId`
   - Section 1: Strategic Intelligence card fetching from `/api/projects/:id/brand-dna`, prose display with indigo background, 5-line clamp + "Read more", Refresh button + "Updated X days ago"
   - Section 2: Weekly Command — empty state with context textarea and generate button; filled state with three sub-cards (Weekly Focus, Angles & Moves with "+ Add to planner" per recommendation, Direction this week)
   - Section 3: Conditional Rules preserved exactly as-is with `projectId: selectedProjectId` added to the create mutation body
   - Dynamic page header showing selected project name

## Relevant files
- `shared/schema.ts:486-495`
- `server/storage.ts:219-220,772-786`
- `server/routes.ts:515-600,4315-4393`
- `server/services/openai.ts:83-91,460-499`
- `client/src/pages/strategy.tsx`