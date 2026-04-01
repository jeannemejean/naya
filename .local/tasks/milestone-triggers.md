# Conditional Milestone Triggers

## What & Why
Let users define conditional planning rules in natural language ("When I sign my first client, unlock my onboarding sequence"). Naya parses these rules, stores them, monitors for matches at plan-generation time, and automatically injects the unlocked tasks into the next planning cycle. The goal is to give the planner a "trigger-based" layer so the system adapts to business events rather than just the passage of time.

## Done looks like
- Typing a conditional phrase in Quick Capture ("Quand j'ai signé mon premier client…") creates a milestone trigger automatically with a 🎯 badge in the Capture Inbox showing how many tasks will be unlocked
- The Strategy page (previously a placeholder) shows all active rules with status, condition summary, task count, and history of triggered rules
- Users can add rules manually from the Strategy page via a free-text input, edit, dismiss, or delete them
- On "Generate my plan", any watching trigger whose keywords match recently completed tasks or captures is fired — its tasks flow into the plan through the same rebalance pipeline as normal generated tasks
- Triggered triggers show date + tasks created; a contextual note is included in the AI generation response

## Out of scope
- Real-time watching (triggers check only at generate-daily time, not continuously)
- Multi-condition AND/OR logic (one condition per trigger)
- Pushing tasks directly to the DB without going through generate-daily

## Tasks

1. **Schema** — Add `milestone_triggers` table to `shared/schema.ts` with all fields from the spec (rawCondition, conditionType, conditionSummary, conditionKeywords as jsonb, tasksToUnlock as jsonb, schedulingMode, status, triggeredAt, triggeredByTaskId). Add `milestoneTriggerId` integer field to the `tasks` table. Add insert schema and type exports. Add the relation to users. Run `npm run db:push`.

2. **Storage layer** — Add CRUD methods to `server/storage.ts` for milestone triggers: createMilestoneTrigger, getMilestoneTriggers (by userId + optional status filter), getMilestoneTrigger (by id), updateMilestoneTrigger, deleteMilestoneTrigger.

3. **Milestone intelligence service** — Create `server/services/milestone-intelligence.ts` with two exported functions: `parseMilestoneTrigger(rawText, projectContext)` (calls OpenAI to extract conditionType, conditionSummary, conditionKeywords, tasksToUnlock, schedulingMode, reasoning using the prompt from the spec) and `checkMilestoneTriggers(userId, projectId, context)` (loads all `watching` triggers, matches conditionKeywords against recently completed task titles + captures + workspace notes, returns triggered triggers with a confidence threshold of ≥60%).

4. **API routes** — Add CRUD routes for `/api/milestone-triggers` (GET, POST, PATCH/:id, DELETE/:id). Modify `POST /api/capture` to detect conditional phrasing (quand/when/si/if/dès que/once/après) and fire `parseMilestoneTrigger` in background, setting `classifiedType = "milestone_trigger"` and `routingStatus = "routed"` on the capture entry. Inject `checkMilestoneTriggers` into the generate-daily route after the context-loading phase; for each triggered milestone, mark it triggered and add its `tasksToUnlock` to `allPendingTasks` with `source = "milestone_trigger"` and `milestoneTriggerId` set.

5. **Quick Capture badge (dashboard.tsx)** — In the Capture Inbox section of the dashboard, when a capture has `classifiedType = "milestone_trigger"`, render a 🎯 badge card showing the conditionSummary and task count (fetched from the linked milestone trigger). Include a "View tasks" expander that shows the tasksToUnlock list. Updates reactively after the background parse completes.

6. **Strategy page** — Replace the placeholder in `client/src/pages/strategy.tsx` with a full page: "Conditional Planning Rules" section listing watching triggers (conditionSummary, task count, "Watching" badge) and triggered rules (date, tasks created, "Triggered" badge). "Add a rule" opens a textarea; on submit it calls POST /api/milestone-triggers, Naya parses and confirms the extracted tasks before saving. Each rule can be edited, dismissed, or deleted inline.

## Relevant files
- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts:1186-1295`
- `server/routes.ts:1893-2400`
- `server/services/openai.ts`
- `client/src/pages/strategy.tsx`
- `client/src/pages/dashboard.tsx`
