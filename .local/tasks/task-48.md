---
title: Fix Claude JSON parsing (poor AI output)
---
# Fix Claude JSON Parsing & Token Limits

## What & Why

After the OpenAI → Claude migration, all AI-generated content silently falls back to the static Naya Intelligence engine instead of using Claude. The root cause is that Claude sometimes wraps JSON responses in markdown code fences (` ```json ... ``` `), which causes `JSON.parse()` to throw a SyntaxError. The catch blocks then fall back to generic, low-quality static output. Additionally, some `max_tokens` limits are too low for Claude's longer reasoning chains.

This fix is surgical — JSON parsing layer only, no logic or UX changes.

## Done looks like

- "Generate my plan" on the Planning page produces tasks specific to the user's business, brand voice, and active goals — not generic boilerplate
- Creating a new campaign generates fully structured output (phases, messaging framework, content plan, KPIs)
- No `"OpenAI unavailable"` or `"Failed to parse campaign JSON"` errors in the server console
- Weekly briefing and monthly plan generation produce complete, rich responses

## Out of scope

- Changes to AI prompts or business logic
- UI changes
- Campaign generation fix (that is blocked by Anthropic billing — separate issue)

## Tasks

1. **Add `stripMarkdownJSON` helper** — Add a utility function at the top of `server/services/openai.ts` (after imports) that strips markdown code fences from Claude responses before passing to `JSON.parse`.

2. **Replace all `JSON.parse(raw || '{}')` calls** — Update all ~10 occurrences across `generateDailyTasks`, `generateContent`, `generateStrategyInsights`, `generateOutreachMessage`, `generateActivationPrompt`, `generateMonthlyPlan`, `generateWeeklyRefinement`, `analyzeContentPerformance`, `generateCampaign`, `generateWeeklyBriefing` to use `JSON.parse(stripMarkdownJSON(raw))` instead.

3. **Increase `max_tokens` for long-output functions** — Raise `generateDailyTasks` from 4000→8000, `generateCampaign` from 4000→8000, `generateWeeklyBriefing` from 1500→3000 to accommodate Claude's longer reasoning chains.

4. **Fix fallback log message in routes.ts** — Change `"OpenAI unavailable, using Naya Intelligence:"` to `"Claude AI error (check JSON parsing or API key):"` so errors are easier to distinguish in production.

## Relevant files

- `server/services/openai.ts:240-260,490-510,545-565,610-630,640-660,800-820,895-910,935-950,1180-1200,1300-1315`
- `server/routes.ts:2601,4509`