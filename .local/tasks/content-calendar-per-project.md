# Content Calendar — Per-Project Pipeline

## What & Why
The Content Calendar currently shows all content from all projects mixed together, and AI generation uses the global Brand DNA record regardless of which project is active. This task makes every part of the page project-scoped — queries, generation, and the view itself — and adds a Kanban pipeline (Idea → Draft → Ready → Published) as the new default tab.

## Done looks like
- Page header shows "Content Calendar — [Project Name]" and has a project selector (same pill pattern as Strategy page)
- Pipeline tab (default) shows a 4-column Kanban: Idea / Draft / Ready / Published, showing only content from the selected project
- Each card can be moved left/right between columns via arrow buttons; moving to Published also sets `status = published`
- Calendar, Accounts, and Media tabs are unchanged except Calendar filters to the selected project
- Creating content links it to the selected project
- AI generation in the modal uses the selected project's Brand DNA
- "From strategy" panel in the modal shows this week's strategy recommendations for the selected project; clicking one pre-fills the title
- Switching projects empties/refills all views with zero cross-contamination
- `contentStatus` column added to DB and reflects Kanban position

## Out of scope
- Changing the social account connect/disconnect flows
- Changing the drag-and-drop calendar mechanics beyond projectId filtering
- Changing the media library
- Filtering content by projectId in routes other than GET /api/content and POST /api/content/generate

## Tasks
1. **Schema + DB migration** — Add `contentStatus text default "idea"` column to the `content` table in `shared/schema.ts`. Run `npm run db:push` to push the change.

2. **Storage layer** — Update `getContent(userId, limit?, projectId?)` to accept an optional `projectId` and filter results when provided. Update the `IStorage` interface accordingly. No changes to other storage methods needed.

3. **Server routes** — In `GET /api/content`, read an optional `?projectId=` query param (validate it with `Number.isFinite` if provided, return 400 on bad value) and pass it to `getContent`. In `POST /api/content/generate`, when `projectId` is in the body, call `getBrandDnaForProject(userId, projectId)` instead of the global `getBrandDna(userId)`; fall back to global only when no `projectId` is supplied. Add `PATCH /api/content/:id` support for `contentStatus` field (it already exists — just confirm `contentStatus` is included in the update path).

4. **Frontend — project selector and query wiring** — Add `selectedProjectId` state (defaults to primary project), a pill-based project selector in the header, dynamic title `Content Calendar — [Project Name]`, and update the main content query key to `['/api/content', selectedProjectId]` so it refetches on project switch.

5. **Frontend — Pipeline (Kanban) tab** — Add "Pipeline" as the default tab with 4 columns (Idea, Draft, Ready, Published). Build a compact `ContentCard` component showing platform color dot, title (1-line clamp), pillar badge, and scheduled date. Hover reveals ← / → buttons that fire `PATCH /api/content/:id` with the next `contentStatus` value; advancing to Published also sets `status = "published"` and `publishedAt`. Only the Idea column shows an "Add idea" button. Each column header shows the count of its cards.

6. **Frontend — modal additions** — In the create/edit modal, add a `contentStatus` selector at the top (default "idea"). Add a collapsible "From strategy" section that queries `GET /api/strategy/report?week=X&projectId=selectedProjectId`; if a report exists, list its recommendations as clickable items that pre-fill the title field. Ensure `generateContentMutation` always passes `projectId: selectedProjectId`.

7. **Frontend — Calendar tab filtering** — Pass `?projectId=selectedProjectId` on the Calendar tab's content query so only the selected project's scheduled content appears on the calendar.

## Relevant files
- `shared/schema.ts:412-435`
- `server/storage.ts:196-201,657-695`
- `server/routes.ts:3442-3525`
- `client/src/pages/content-calendar.tsx`
