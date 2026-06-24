---
title: Unified planning UX — single "Generate my plan" action
---
# Unified Planning UX

## What & Why
Replace the three competing generation buttons ("Generate Month", "Refine Week", "Generate Today") in `planning.tsx` with a single primary action: **"Generate my plan"**. The layered logic already exists on the server — this is purely a UX simplification. Users should feel Naya is one intelligent system, not a set of separate planning engines. Add lightweight feedback prompts as a secondary interaction pattern.

## Done looks like
- The planning header shows exactly **one primary button**: "Generate my plan"
- Clicking it in day view calls generate-daily. In month view it calls generate-monthly first, then generate-daily. In week view it calls generate-daily for today only.
- The existing mutations (generateMonthly, generateWeekly, generateDaily) remain internally but are now driven by one entry point
- A single subtle secondary text link "Refine this week" (small, de-emphasized, not a full button) calls generateWeeklyMutation — visible in week/month views only
- The old "Generate Month", "Refine Week", and "Generate Today" buttons are completely removed from the header
- A lightweight "How did today go?" feedback prompt appears at the bottom of the day view when tasks exist — 3 small options: "On track", "Felt overloaded", "Tasks were wrong". Selection is stored in localStorage keyed to the date so it only shows once per day. After selection, show "Thanks — Naya noted that." then hide.
- All request bodies sent to generate-monthly, generate-weekly, generate-daily, and replan include `clientToday` (YYYY-MM-DD local date string using the existing `formatDate(new Date())` helper)

## Implementation steps

### 1. Replace header buttons (planning.tsx)
- Remove the 3 existing Button elements for generateMonthly, generateWeekly, generateDaily
- Add single `<Button>Generate my plan</Button>` that:
  - If `viewScope === 'month'`: runs generateMonthlyMutation, then generateDailyMutation sequentially
  - Otherwise: runs generateDailyMutation
  - Shows spinner while any mutation is pending
- Remove unused icon imports (CalendarDays, RotateCcw, Plus) if they become unused
- Below the primary button, add a subtle plain-text button "Refine this week" visible only when `viewScope === 'week' || viewScope === 'month'`, styled as `text-xs text-slate-400 hover:text-slate-600 underline` with no background/border

### 2. Send clientToday in all request bodies
In every mutation's mutationFn, derive:
```ts
const clientToday = formatDate(new Date());
```
Include it in the request body for generate-daily, generate-monthly, generate-weekly, and replan.

### 3. Add "How did today go?" feedback prompt
At the bottom of the day-view task list section:
- Render only when `viewScope === 'day'` AND `tasks.length > 0`
- Check `localStorage.getItem('naya_daily_feedback_' + formattedDate)` — skip if set
- Show 3 small outline buttons: "✅ On track", "😅 Felt overloaded", "🤔 Tasks were wrong"
- On click: set localStorage key, show "Thanks — Naya noted that." then hide after 2 seconds
- Use a local state variable `dailyFeedbackGiven` (initialized from localStorage) to track visibility

## Relevant files
- `client/src/pages/planning.tsx` (all changes)

## Out of scope
- Building a new DB table or server endpoint for daily feedback
- Changing the server-side planning layer logic
- A full smart orchestrator that auto-picks the layer
