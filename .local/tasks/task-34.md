---
title: Business Memory System
---
# Business Memory System

## What & Why

Every week currently starts with a blank context. The AI knows the user's brand DNA but has no memory of decisions made, strategic pivots taken, lessons learned, or moments that shaped the business. This means AI-generated tasks, campaigns, and strategies are always generic — never grounded in the real history of this founder's journey.

The Memory System gives Naya a chronological, queryable record of the user's key business decisions and learning moments, automatically feeding this context into every AI call.

## Done looks like

- A `businessMemory` table stores timestamped memory entries (type: `decision | lesson | pivot | milestone | observation`).
- From the Quick Capture inbox, any entry classified as "decision" or "lesson" has an "Add to Naya's memory" action that stores it as a memory entry.
- A simple "Memory" timeline view is accessible from the Strategy page or Settings, displaying memories chronologically with their type and content.
- All AI generation calls (task generation, weekly briefing, campaign planning, strategy recommendations) receive the user's 10 most recent memory entries as additional context in the system prompt.
- Memory entries can be manually added, edited, or archived from the Memory view.

## Out of scope

- Automated extraction of memories from completed tasks (future, requires NLP classification).
- Sharing memories across team members (Naya is currently solo-founder focused).
- Memory search / semantic retrieval (use chronological list for now).

## Tasks

1. **`businessMemory` schema** — Add a `businessMemory` table to `shared/schema.ts` with fields: `id`, `userId`, `type` (decision | lesson | pivot | milestone | observation), `content` (text), `sourceEntryId` (optional FK to quickCaptureEntries), `createdAt`. Add insert/select types. Run `db:push`.

2. **Memory CRUD endpoints** — Create `GET /api/memory` (list user's memories, most recent first), `POST /api/memory` (create entry), `PATCH /api/memory/:id` (edit content/type), `DELETE /api/memory/:id` (archive). Add to storage interface.

3. **Quick Capture "Add to memory" action** — In the Quick Capture inbox on the Dashboard, for entries with `classifiedType` of "decision" or "lesson" (or unclassified), add an "Add to memory" button that calls `POST /api/memory` with the entry content. Show a subtle confirmation on success.

4. **Inject memory into AI system prompts** — Create a shared helper `getMemoryContext(userId)` that fetches the 10 most recent memory entries and formats them as a concise system-prompt block. Call this helper inside every AI generation function in `server/services/openai.ts` and append the block to the system prompt. Make it gracefully no-op if the user has zero memories.

5. **Memory timeline UI** — Add a "Memory" tab or section to the Strategy page (or a linked modal from Settings) showing entries as a simple chronological timeline. Each entry displays its type badge, date, and content. Include a manual "New memory" form for direct entry.

## Relevant files

- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `server/services/openai.ts`
- `client/src/pages/dashboard.tsx`
- `client/src/pages/strategy.tsx`