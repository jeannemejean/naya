---
title: Campaign pause / resume system with AI note rewriting
---
# Campaign Pause / Resume System

  ## What & Why
  Currently, "pausing" a campaign just flips the status field. Future tasks remain on
  the user's calendar, there's no note mechanism, and there's no way to resume.

  This adds a proper pause/resume flow:
  - **Pause**: saves an optional AI instruction note, deletes all incomplete future
    campaign tasks (clean slate), flips status to `paused`
  - **Resume**: optionally rewrites `generatedTasks` via GPT-4o using the saved note,
    then re-launches the campaign (re-schedules tasks from today)
  - **UI**: replaces the 1-click pause button with a card-style dialog (note textarea,
    confirm/cancel) and a resume card (shows saved note, optional new instruction)

  ## Done looks like
  - Pausing removes future tasks + stores note + updates status
  - Resuming with a note calls GPT-4o to modify the task list, then re-runs launch
  - Resuming without a note skips AI call and re-launches immediately
  - Toast shows count of tasks removed on pause / tasks created on resume
  - Paused campaigns show a resume card in the detail panel, not an active button
  - DB schema has `pause_note TEXT` column, migrated

  ## Files
  1. `shared/schema.ts` — add `pauseNote: text("pause_note")` to campaigns table, run db:push
  2. `server/storage.ts` — add `deleteCampaignFutureTasks(campaignId, fromDate)` to interface + implementation using drizzle `delete` with `eq(tasks.campaignId)`, `eq(tasks.completed, false)`, `gte(tasks.scheduledDate, fromDate)`
  3. `server/routes.ts` — add POST `/api/campaigns/:id/pause` and POST `/api/campaigns/:id/resume` before `createServer(app)`
  4. `client/src/pages/campaigns.tsx` — add `pauseNote` field to Campaign interface, add 3 state vars, add `pauseMutation`/`resumeMutation`, replace existing active-status button block with full pause-dialog + paused-card UI; import Rocket icon (already partially imported)

  ## Deviations from spec (none expected)
  - Spec uses `new Date().toISOString().slice(0, 10)` for today — keep as is
    (campaign tasks are stored in local date strings, so this is fine for deleting
    future tasks from today onward; note: could drift for users in UTC-behind timezones
    but acceptable for now)
  - The resume flow sets status to `active` then re-calls the launch endpoint; the
    launch route guards with `status === 'active'` check so the status must be set
    first — the spec already handles this correctly