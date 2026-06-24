---
title: Campaign Engine v2 — Full Campaign Architecture
---
# Campaign Engine v2 — Full Campaign Architecture

## What & Why
The current campaign engine generates a flat task list with no structure. A real digital communication campaign needs phases, messaging frameworks, channel strategies, content plans, and KPIs. This rebuilds the AI generation layer, schema, and frontend to reflect a professional campaign architecture — while preserving the existing UI shell (split panel, launch flow, task injection).

## Done looks like
- Creating any campaign now generates: phases (3–6 depending on duration), a messaging framework (core message, proof points, CTAs, tone keywords, things to avoid), channel strategy (platform, role, frequency, content formats), a per-phase content plan, and KPIs — in addition to tasks distributed across phases
- Duration selector shows all 8 options (1_week through 12_months) as a wrapping pill grid
- An amber warning appears when an incompatible objective+duration pair is detected (e.g. "authority building" + "1 week")
- The campaign detail panel (both "generated" and "detail" states) shows new collapsible sections: Phases, Messaging Framework, Channel Strategy, Content Plan, KPIs — tasks are grouped by phase with a phase label header
- All new DB columns are nullable and migration-safe (`npm run db:push`)
- A 6-month campaign produces visibly different phase architecture from a 1-month campaign

## Out of scope
- Editing phase/channel/content data from the UI (read-only display)
- The launch flow (task injection into Planning) — unchanged beyond adding `phase` field to injected tasks
- Any other pages, routes, or components

## Tasks

1. **Schema enrichment** — Add 9 new nullable columns to the `campaigns` table: `campaignType` (text), `phases` (jsonb), `messagingFramework` (jsonb), `channels` (jsonb), `contentPlan` (jsonb), `kpis` (jsonb), `startDate` (text), `endDate` (text), `audienceSegment` (text). Change `duration` default from `"1_week"` to `"3_months"`. Run `npm run db:push`.

2. **OpenAI service rebuild** — In `server/services/openai.ts`, add 5 new exported interfaces (`CampaignPhase`, `ChannelConfig`, `ContentPiece`, `MessagingFramework`, `CampaignKPI`), expand `GeneratedCampaign` to include all new fields, expand `CampaignGenerationRequest` to include all Brand DNA fields already captured in the DB (businessName, offers, priceRange, audienceAspiration, editorialTerritory, brandVoiceKeywords, brandVoiceAntiKeywords, activeBusinessPriority, revenueTarget). Replace the existing prompt and response structure with the full strategic campaign prompt from the spec. Add `getDurationGuidance(duration)` helper. Set `max_tokens: 4000` on the OpenAI call to handle the larger response.

3. **Route updates** — In `server/routes.ts`, update `/api/campaigns/generate` to: (a) pass all new Brand DNA fields when building `brandDnaInput`, (b) save all new generated fields (`campaignType`, `phases`, `messagingFramework`, `channels`, `contentPlan`, `kpis`, `audienceSegment`) to the campaign record via `storage.createCampaign`. Also update `/api/campaigns/:id/launch` so that when injecting tasks, the `phase` field from each task is preserved (or dropped — it doesn't affect task schema, but shouldn't cause a crash).

4. **Frontend — type interfaces + duration selector** — In `campaigns.tsx`: add `CampaignPhase`, `ChannelConfig`, `ContentPiece`, `MessagingFramework`, `CampaignKPI` interfaces; extend the `Campaign` interface with all new fields; replace the 3-option `DURATION_OPTIONS` array with 8 options (1_week through 12_months); render duration options as a wrapping pill grid (not a fixed-row flex). Add `ChevronUp` to lucide imports. Add the local `CollapsibleSection` component.

5. **Frontend — campaign detail panel** — In both the "generated" state and "detail" state of the right panel in `campaigns.tsx`, add new collapsible display sections after insights and before tasks: (a) Phases — phase cards with name, duration, objective, key actions list, success signal; (b) Messaging Framework — core message, proof points, CTAs, tone keywords, things to avoid; (c) Channel Strategy — 2-col grid of channel cards with platform, role badge, frequency, content formats; (d) Content Plan — grouped by phase, each piece shows week, platform, format, angle, copy directions; (e) KPIs — table rows grouped by phase. In the tasks section, group tasks by `task.phase` with a phase number label above each group. Add an amber duration warning line for incompatible objective+duration pairs (authority building with < 3 months, lead generation with < 2 months).

## Relevant files
- `shared/schema.ts:585-606`
- `server/services/openai.ts:900-987`
- `server/routes.ts:4954-5012`
- `client/src/pages/campaigns.tsx`