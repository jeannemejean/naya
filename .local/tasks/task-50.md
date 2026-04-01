---
title: Onboarding & auth UX fixes
---
# Onboarding & Auth UX Fixes

## What & Why

Eight UX and bug issues in the authentication and onboarding flow create a broken first-run experience: a jarring flash of the dashboard before redirect, non-advancing questionnaire steps, a blank page 3, lowercased keywords, undersized question labels, an unnecessary consent screen on repeat logins, and developer-facing copy.

## Done looks like

- A new user who logs in never sees the Dashboard for even a split second before being sent to onboarding — a clean loading spinner appears instead, then the questionnaire starts immediately.
- Clicking "Let's begin" on the welcome screen advances to step 2 reliably.
- Step 3 (friction/avoidance checkboxes) renders its content correctly.
- Typing a keyword with capitals (e.g. "LinkedIn") preserves the casing.
- Questionnaire question labels are visually larger and more distinct from the answer text; all step titles use `text-2xl`.
- Users who have previously authenticated do not see a consent screen again when logging in.
- The loading message during dashboard initialisation reads "Chargement…" / "Préparation de ton espace…" rather than "Loading Naya...".

## Out of scope

- Landing page feature card copy (already translated correctly via i18n keys).
- `fr.ts` translation additions (all required keys already exist).
- Any changes to the database schema or API routes.

## Tasks

1. **Dashboard loading guard** — Add `if (!brandDna) return null` immediately after the `isLoading || brandDnaLoading` guard block, and change the loading spinner text from "Loading Naya..." to "Chargement…".

2. **Onboarding step-1 consolidation** — Merge the separate `{step === 1}` Card and `{step > 1}` Card into a single `<Card>` that renders step-specific content inside one `<CardContent>`, so step transitions work without remounting the wrapper.

3. **Keyword chip capitalisation** — Remove `.toLowerCase()` from the `addKeyword` function inside `KeywordChipInput`, and update the regex to preserve user capitalisation.

4. **Question label sizing** — Update `FieldLabel` className from `text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5` to `text-base font-semibold text-slate-900 dark:text-white mb-2 mt-1`. Replace all 11 occurrences of `text-xl font-bold` on step `<h2>` elements with `text-2xl font-bold`.

5. **Auth scope / consent screen** — In `server/replitAuth.ts`, change the strategy scope from `"openid email profile offline_access"` to `"openid profile"`, and change the `/api/login` handler's prompt from `"login consent"` to `"login"` and its scope array from `["openid","email","profile","offline_access"]` to `["openid","profile"]`.

## Relevant files

- `client/src/pages/dashboard.tsx:1055-1066`
- `client/src/pages/onboarding.tsx:234-242,257-264,457-479,482-560`
- `server/replitAuth.ts:93,104-109`