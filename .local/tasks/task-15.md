---
title: Enriched Brand DNA
---
# Enriched Brand DNA

## What & Why
Naya's strategic intelligence is only as good as its understanding of the business. The current Brand DNA captures basic signals (business type, audience, tone, platform) but is missing the dimensions needed for real communication strategy: concrete offers, precise differentiated positioning, editorial direction, and active business priorities. This adds those fields to the schema, exposes them in onboarding (2 new steps) and settings (5-tab Brand DNA section), and generates a strategic intelligence summary that becomes the foundation for all future AI generation.

## Done looks like
- Onboarding has 11 steps (was 9): two new steps between "Voice & Platform" and "Goals" — one for offers/pricing/client journey, one for voice keywords / positioning / differentiation
- Settings page Brand DNA section is organized into 5 tabs: Identity, Offers & Market, Content & Platforms, Active Priorities, and Naya Intelligence
- The Intelligence tab shows an AI-generated strategic summary with a "Refresh analysis" button
- The summary is auto-generated on first onboarding completion if core fields are populated
- All new fields are editable in settings and saved to brand_dna via PATCH /api/brand-dna

## Out of scope
- Changing any tasks, planning, or milestone routes
- Changing the onboarding submission route handler (`/api/onboarding` POST)
- Using the intelligence summary in AI generation immediately (that's a separate future task)

## Tasks

1. **Schema** — Add the new fields to the `brand_dna` table in `shared/schema.ts`: offers, priceRange, clientJourney, brandVoiceKeywords (text array), brandVoiceAntiKeywords (text array), editorialTerritory, competitorLandscape, visualIdentityNotes, contentPillarsDetailed (jsonb), referenceBrands (text array), activeBusinessPriority, currentBusinessStage, revenueTarget, keyMilestones (jsonb), teamStructure, operationalConstraints, geographicFocus, languageStrategy, nayaIntelligenceSummary, lastStrategyRefreshAt (timestamp). Update `insertBrandDnaSchema` and `BrandDna` type. Run `npm run db:push`.

2. **Intelligence endpoint** — Add `POST /api/brand-dna/refresh-intelligence` to `server/routes.ts`. Loads the user's complete Brand DNA, calls OpenAI with the strategic advisor prompt from the spec (200–300 word synthesis covering: core position, 3 communication angles, 2–3 content formats, main growth lever, one blind spot), saves result to `nayaIntelligenceSummary` and `lastStrategyRefreshAt` via the existing `PATCH /api/brand-dna` route logic, and returns the summary. Also call this automatically within the onboarding flow when it detects businessType + offers + uniquePositioning + platformPriority are all non-empty (fire-and-forget, don't block the onboarding response).

3. **Onboarding steps 6B and 6C** — In `client/src/pages/onboarding.tsx`, set `TOTAL_STEPS = 11`. Insert two new steps between current step 6 (Voice & Platform) and current step 7 (Goals) — renumbering existing steps 7–9 to 9–11:
   - Step 7: "💎 What You Sell" — textarea for offers description, price range select, optional client journey textarea
   - Step 8: "🎯 What Makes You Different" — chip input for brandVoiceKeywords (max 6), chip input for brandVoiceAntiKeywords (max 4), editorialTerritory textarea, competitor landscape textarea (optional)
   Wire these fields into the existing onboarding form state and include them in the final submission payload.

4. **Settings Brand DNA tabs** — In `client/src/pages/settings.tsx`, replace the current flat Brand DNA section with a 5-tab layout using shadcn `Tabs`:
   - **Identity**: businessName, website, LinkedIn, Instagram, businessType, businessModel, currentBusinessStage, editorialTerritory (textarea), brandVoiceKeywords (editable chips max 6), brandVoiceAntiKeywords (editable chips max 4), visualIdentityNotes (textarea), referenceBrands (chips max 5)
   - **Offers & Market**: offers (textarea), priceRange (select), targetAudience (existing select), corePainPoint (existing select), audienceAspiration (existing select), clientJourney (textarea), competitorLandscape (textarea)
   - **Content & Platforms**: platformPriority (select), currentPresence (select), contentBandwidth (select), contentPillarsDetailed (up to 5 pillars: name + description + formats multi-select + frequency), communicationStyle (select)
   - **Active Priorities**: activeBusinessPriority (textarea), revenueTarget (text), teamStructure (select), operationalConstraints (textarea), geographicFocus (select), keyMilestones (up to 5: title + target date + status select)
   - **Naya Intelligence**: read-only nayaIntelligenceSummary display, "Refresh analysis" button calling POST /api/brand-dna/refresh-intelligence, lastStrategyRefreshAt timestamp display
   All tabs save via the existing PATCH /api/brand-dna endpoint (each tab has its own save button).

## Relevant files
- `shared/schema.ts:260-312`
- `client/src/pages/onboarding.tsx`
- `client/src/pages/settings.tsx`
- `server/routes.ts`
- `server/services/openai.ts`