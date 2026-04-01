# Agency Project Type, Client Layer & Color Consistency

## What & Why
Three related gaps that affect how non-planning parts of the app look and behave: (1) "Agency" is not a selectable project type so the already-built Clients tab never appears for agency-style projects, (2) project colors in task cards and project labels are derived from array position so they shift whenever projects are reordered, and (3) the same color instability exists in the today's tasks view and the projects list.

## Done looks like
- "Agency" appears in the project type dropdown when creating or editing a project
- A project set to type "Agency" shows the Clients tab in the project detail panel — the Add Client form, client list, client cards with lifecycle badges, and per-client task expansion all work
- Existing projects can be edited to change their type to "Agency"
- Project colors in task cards, project labels, and any grouped headers are stable across refreshes and after adding/removing projects (derived from project ID, not array position)

## Out of scope
- Building new client functionality beyond what is already implemented in ClientsTab
- Adding color picker / custom colors per project (future work)
- Changing the color palette itself

## Tasks
1. **Add Agency project type** — Add `"Agency": "🏢"` to the `PROJECT_TYPE_ICONS` map so it appears in the creation and edit dropdowns. Update the schema comment to include "Agency" in the valid type list. Confirm the existing Clients tab visibility condition (`.includes("agency") || .includes("client")`) already covers it — no further logic change needed.

2. **Fix color stability in todays-tasks and projects** — Update any `getProjectColor` or equivalent helper in `client/src/components/todays-tasks.tsx` and `client/src/pages/projects.tsx` to use `projectId % palette.length` instead of array `findIndex`. Ensure the color palette constant is defined once and imported/shared rather than duplicated, or that each file uses the identical palette so colors are visually consistent across views.

## Relevant files
- `client/src/pages/projects.tsx:38-50`
- `client/src/pages/projects.tsx:832,919`
- `client/src/components/todays-tasks.tsx`
- `shared/schema.ts:49`
