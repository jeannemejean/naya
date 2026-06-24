# Server: Multi-Project Generation & Energy Enforcement

## What & Why
Fix two backend bugs that undermine trust in the generation system: (1) only 2 out of 4 projects receive tasks because a hard total cap causes the loop to silently break after 2 projects, and (2) the AI prompt for daily task generation treats `taskEnergyType` as optional, so many tasks arrive without an energy type and the UI cannot render intelligence signals.

## Done looks like
- In All Projects mode, every valid project is processed and either receives tasks OR the response includes an explicit `skippedProjects` array explaining why (e.g. "no brand DNA", "AI error — will retry next time")
- After generating daily tasks, every task has a non-null `taskEnergyType` (deep_work / creative / admin / social / logistics / execution)
- The UI's energy badges render on newly generated tasks immediately without requiring a re-generation
- Generating for 4 projects does not silently produce tasks for only 2

## Out of scope
- Changing task generation AI model or prompt structure beyond the energy type enforcement
- Adding retry logic for failed per-project generation (log and report, no silent skip)

## Tasks
1. **Fix proportional project allocation** — Remove the blunt `TOTAL_TASKS_MAX = 10` early-break. Replace with per-project proportional allocation: each project gets `Math.min(TASKS_PER_PROJECT_MAX, Math.ceil(totalBudget / projectCount))` tasks where `totalBudget = Math.max(10, projectCount * 3)`. Run every project through the generation loop regardless. Collect any project that produces 0 tasks into a `skippedProjects` array with a reason string. Include `skippedProjects` in the API response alongside `tasks` and `realismReport`.

2. **Enforce taskEnergyType in AI prompt** — In `generateDailyTasks`, add an explicit instruction to the JSON schema section of the system prompt: "Every task MUST include `taskEnergyType` set to exactly one of: deep_work, creative, admin, social, logistics, execution. Leaving it null or omitting it is not allowed." Add the same enforcement comment to `generateMonthlyPlan` and `generateWeeklyRefinement`.

## Relevant files
- `server/routes.ts:1732-2020`
- `server/services/openai.ts`
