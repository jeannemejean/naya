# Fix Generate Plan Overlap Bug

## What & Why

After clicking "Generate my plan", tasks still overlap in the time grid until the user manually clicks "Rebalance week". The root cause is the "Add to existing" option in the confirmation dialog — it adds newly generated tasks alongside old ones that may already occupy the same time slots.

Two changes fix this completely:
1. Remove the "Add to existing" path and make the dialog a simple "Regenerate / Keep current" confirmation — since replacing is always the correct behavior.
2. Trigger an auto-rebalance after generation (with a 1.5-second delay to let query invalidation settle), so any remaining edge-case timing issues are cleaned up automatically without the user ever clicking "Rebalance week" manually.

## Done looks like

- The "Generate my plan" dialog no longer shows an "Add to existing" button — only "Regenerate plan" and "Keep current plan".
- After clicking "Regenerate plan", the planning view shows clean non-overlapping tasks immediately — no manual "Rebalance week" step required.
- If no existing generated tasks exist, generation fires immediately with no dialog (unchanged behavior).

## Out of scope

- Changes to the server-side generation endpoint.
- Any changes to the rebalance-week endpoint.
- Any other planning page behavior.

## Tasks

1. **Simplify the confirmation dialog** — Replace the three-button dialog ("Cancel / Add to existing / Replace") with a two-button dialog ("Keep current plan / Regenerate plan") that always calls `doGenerate(true)`. Update the description text to match.

2. **Auto-rebalance after generation** — In `generateDailyMutation.onSuccess`, add `setTimeout(() => triggerAutoRebalance(), 1500)` after the query invalidations so the schedule is automatically cleaned up after every generate run.

## Relevant files

- `client/src/pages/planning.tsx:882-906` — AlertDialog for replace/add
- `client/src/pages/planning.tsx:314-395` — generateDailyMutation and onSuccess
- `client/src/hooks/use-auto-rebalance.ts`
