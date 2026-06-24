---
title: Auto-rebalance schedule on every schedule-affecting mutation
---
---
title: Auto-rebalance schedule on every schedule-affecting mutation
---
# Auto-rebalance schedule on every schedule-affecting mutation

## What & Why

Currently, users must click a "Rebalance week" button to reorganize their schedule after things like completing tasks, marking a day off, or launching a campaign. The schedule should reorganize itself automatically after any action that affects it.

The fix is entirely client-side: create a shared `useAutoRebalance` hook that silently fires `POST /api/tasks/rebalance-week` (debounced) after each relevant mutation, then invalidates the tasks cache so the planning view refreshes. No backend changes needed.

## Done looks like

- Completing a task, deleting a task, marking a day as "off" or "half-day", changing energy level, or launching/pausing/resuming a campaign all cause the week's schedule to silently reorganize within ~1 second — without the user pressing any button.
- A subtle "Schedule updated" toast appears after the background rebalance completes.
- Rapid successive mutations (e.g., completing 3 tasks in quick succession) coalesce into a single rebalance call via debouncing.
- If the rebalance call fails, it fails silently — the user is not blocked and the button still exists as a fallback.

## Tasks

### 1. Create `client/src/hooks/use-auto-rebalance.ts`

A shared hook that:
- Derives `weekStart` (ISO Monday of the current week) and `clientTime` (HH:mm from `new Date()`) internally — no arguments needed from callers.
- Uses a module-level debounce timer (not component-level) so calls from multiple components coalesce.
- Calls `POST /api/tasks/rebalance-week` with `{ weekStart, clientToday, clientTime }`.
- On success: calls `queryClient.invalidateQueries({ queryKey: ['/api/tasks'] })`.
- On success: shows a brief, low-prominence toast ("Schedule updated").
- On failure: silent (no toast, no error).
- Exports a single function: `const { triggerAutoRebalance } = useAutoRebalance()`.

Use `apiRequest` from `@/lib/queryClient` for the fetch, and `useQueryClient` + `useToast` inside the hook.

### 2. Wire into `client/src/pages/planning.tsx`

In `toggleMutation.onSuccess` (line ~208): call `triggerAutoRebalance()` after the existing cache invalidations.

### 3. Wire into `client/src/components/todays-tasks.tsx`

- In `toggleTaskMutation.onSuccess` (line ~272): call `triggerAutoRebalance()`.
- In `deleteFeedbackMutation.onSuccess` (line ~212): call `triggerAutoRebalance()`.

### 4. Wire into `client/src/components/time-grid.tsx`

In `availMutation.onSuccess` (line ~389): call `triggerAutoRebalance()` after invalidating `['/api/availability']`.

### 5. Wire into `client/src/pages/campaigns.tsx`

In `launchMutation.onSuccess` (line ~636), `pauseMutation.onSuccess` (line ~692), `resumeMutation.onSuccess` (line ~710), `redeployMutation.onSuccess` (line ~718): call `triggerAutoRebalance()`.

### 6. Wire into `client/src/pages/dashboard.tsx`

In `updateMutation.onSuccess` (line ~941, energy level change): call `triggerAutoRebalance()`.

## Out of scope

- Any backend changes.
- AI task regeneration (monthly/weekly/daily generation).
- Adding or removing tasks.
- Changing the existing "Rebalance week" button — it stays as a manual fallback.

## Relevant files

- `client/src/hooks/use-auto-rebalance.ts` (new)
- `client/src/pages/planning.tsx`
- `client/src/components/todays-tasks.tsx`
- `client/src/components/time-grid.tsx`
- `client/src/pages/campaigns.tsx`
- `client/src/pages/dashboard.tsx`