---
title: Campaign Engine
---
# Campaign Engine

## What & Why
Add a new /campaigns page that lets users define a campaign objective and have Naya generate a complete strategic plan (name, core message, 5–8 executable tasks) linked to a selected project. Users can review the generated plan before launching it, at which point the tasks are injected into the Planning page. This closes the gap between high-level goals and daily execution.

## Done looks like
- `/campaigns` route exists; "Campaigns" appears in the sidebar between Strategy and Content Calendar with the Rocket icon
- Selecting a project filters the campaign list to that project only
- "New campaign" flow shows a right-panel form: objective textarea, duration selector (1 week / 2 weeks / 1 month), optional context field
- Clicking "Generate campaign plan →" calls the AI and shows: campaign name (inline-editable), core message card, target audience, strategic insights bullets, and a task list with type/energy/duration/priority badges — without saving yet
- "Launch campaign" persists tasks to the Planning page (linked by campaignId), marks the campaign active; toast confirms "Campaign launched — X tasks added to your plan"
- "Discard" deletes the draft campaign, resets to empty state
- Active/completed campaign detail is read-only with "Mark complete" and "Pause" buttons
- Task list on active campaign detail shows live completion status (strikethrough + green check for done)
- Switching projects resets the campaign list correctly

## Out of scope
- Email/notification triggers on campaign launch
- Campaign performance analytics beyond task completion status
- Bulk campaign operations

## Tasks

1. **Schema — add campaigns table and campaignId to tasks** — Add `campaigns` pgTable to `shared/schema.ts` (fields: id, userId, projectId, name, objective, coreMessage, targetAudience, duration, status, tasksGenerated, generatedTasks jsonb, insights jsonb, createdAt, updatedAt). Add nullable `campaignId integer` column to the existing `tasks` table referencing campaigns.id. Add `campaignRelations` and update `projectRelations` to include `campaigns: many(campaigns)`. Export insert schema, Campaign type, InsertCampaign type. Run `npm run db:push`.

2. **Storage — campaign CRUD and campaignId task filter** — Add `getCampaigns(userId, projectId?)`, `getCampaign(id, userId)`, `createCampaign`, `updateCampaign(id, userId, data)`, `deleteCampaign(id, userId)` to the IStorage interface and DatabaseStorage implementation. Update `getTasks` and `IStorage.getTasks` to accept an optional `campaignId` parameter and filter by it when present.

3. **OpenAI — generateCampaign function** — Add `generateCampaign(request: CampaignGenerationRequest)` to `server/services/openai.ts`. The function accepts `{ objective, duration, brandDna, weekContext? }`, sends a structured JSON-only prompt to GPT-4o, and returns `GeneratedCampaign` (name, coreMessage, targetAudience, insights[], tasks[]). Wrap `JSON.parse` in try/catch with a descriptive fallback error.

4. **Server routes — campaign endpoints** — In `server/routes.ts` add: `GET /api/campaigns` (with optional ?projectId= using Number.isFinite validation), `POST /api/campaigns`, `PATCH /api/campaigns/:id` (ownership check via getCampaign), `DELETE /api/campaigns/:id` (ownership check), `POST /api/campaigns/generate` (loads Brand DNA via getBrandDnaForProject when projectId present, calls generateCampaign, saves draft campaign with generatedTasks, returns campaign id + generated data), `POST /api/campaigns/:id/launch` (inserts each generatedTasks entry into tasks table with campaignId, scheduledDate=today, source='campaign'; sets tasksGenerated=true, status='active'; returns campaign + tasksCreated count). Update `GET /api/tasks` to pass campaignId filter when ?campaignId= is provided.

5. **Frontend — campaigns.tsx page + routing + sidebar** — Create `client/src/pages/campaigns.tsx` with: project pill selector (same pattern as Strategy/Content Calendar), two-panel layout (left 40% campaign list, right 60% detail), CampaignCard component (name, status badge, objective 1-line clamp, task count, date), and four right-panel states: Empty (Rocket icon + subtitle + "Start a new campaign →"), Creation form (objective textarea, duration selector, optional context, generate button with loading state), Generated preview (editable name, core message card in indigo, target audience row, insights bullets, task cards with type/energy/duration/priority badges, each with inline title edit; "Launch campaign" primary button + "Discard" ghost button), and Active/completed read-only detail (status badge, Mark complete / Pause buttons, task list with live completion status queried via ?campaignId=). Register route `/campaigns` in `client/src/App.tsx`. Add "Campaigns" nav item with Rocket icon to `client/src/components/sidebar.tsx` between Strategy and Content Calendar.

## Relevant files
- `shared/schema.ts`
- `server/storage.ts`
- `server/services/openai.ts`
- `server/routes.ts`
- `client/src/pages/strategy.tsx`
- `client/src/pages/content-calendar.tsx`
- `client/src/App.tsx`
- `client/src/components/sidebar.tsx`