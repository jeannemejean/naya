---
title: Global no-past-date scheduling rule
---
# Global No-Past-Date Scheduling Rule

## What & Why
Tasks generated or rescheduled by any planning layer (monthly, weekly, daily, replan) must never land before today's local date. The bug is systemic: the server uses UTC (`toISOString().split('T')[0]`), which gives a date that is already yesterday for users in UTC+ timezones late at night. The fix is to accept the client's local date as `clientToday` and enforce it as a hard lower bound at every scheduling point in `server/routes.ts`.

## Done looks like
- A `clampToFloor(date: string, floor: string): string` helper exists in `server/routes.ts` that returns `date` if `date >= floor`, else returns `floor`
- All scheduling operations in the following routes use it:
  - `generate-monthly`: every task's `scheduledDate` is clamped before save
  - `generate-weekly`: every rescheduled task date and every new task date is clamped before save
  - `generate-daily`: `todayStr` and `deferTarget` are computed from `clientToday` if provided, else fall back to UTC today — no past dates can be stored
  - `replan` (`/api/tasks/replan` and `/api/tasks/replan/apply`): any date-assignment uses clamped dates
- `clientToday` is read from `req.body.clientToday` in each route and validated (must match `YYYY-MM-DD` regex; falls back to UTC today if absent or malformed)
- No task is ever saved with a `scheduledDate` or `dueDate` that is before `clientToday` (or UTC today as fallback)
- The realism engine's `deferTarget` for the monthly route is also clamped: if the computed "next month 1st" deferTarget would be in the past, it is advanced to the floor date + 1 day

## Implementation steps

### 1. Add helper and clientToday extraction (routes.ts)
At the top of the generate-monthly, generate-weekly, generate-daily, and replan handler bodies, add:
```ts
const rawClientToday = typeof req.body.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.clientToday)
  ? req.body.clientToday
  : new Date().toISOString().split('T')[0];
```
Define the clamp helper once near the top of `registerRoutes` (or as a module-level function):
```ts
function clampToFloor(date: string, floor: string): string {
  return date >= floor ? date : floor;
}
```

### 2. generate-monthly (line ~1580-1602)
Before saving each task:
```ts
const safeDate = clampToFloor(taskData.scheduledDate || monthStart, rawClientToday);
// use safeDate for scheduledDate and dueDate
```
Also clamp `deferTarget` (computed as next month 1st):
```ts
const deferTarget = clampToFloor(deferDate.toISOString().split('T')[0], rawClientToday);
```

### 3. generate-weekly (line ~1688-1722)
For reschedule operations:
```ts
const safeNewDate = clampToFloor(r.newDate, rawClientToday);
await storage.updateTask(r.taskId, { scheduledDate: safeNewDate, dueDate: new Date(safeNewDate) });
```
For new tasks:
```ts
const safeDate = clampToFloor(taskData.scheduledDate || weekStart, rawClientToday);
```

### 4. generate-daily (line ~1815-1995)
Replace:
```ts
const todayStr = today.toISOString().split('T')[0];
```
With:
```ts
const todayStr = rawClientToday;
```
The deferTarget (today + 1) is derived from todayStr, so it is automatically correct.

### 5. replan routes (line ~2200-2324)
In `/api/tasks/replan`, use `rawClientToday` as the floor when building the date range:
```ts
const today = rawClientToday;
```
In `/api/tasks/replan/apply`, clamp any dates on incoming task objects before creating them.

## Relevant files
- `server/routes.ts` (all changes in this one file)

## Out of scope
- Changing the AI prompts (date floor prompting was handled in Task #2)
- Adding timezone detection (client sends its local date string, that's sufficient)
- Retroactively fixing existing past-dated tasks already in the database
