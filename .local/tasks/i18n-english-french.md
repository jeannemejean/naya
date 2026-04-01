## Add English / French language toggle across all of Naya

### What & Why
Add a language switch (EN / FR) so the user can toggle the entire Naya UI between English and French. Language preference is persisted in localStorage and survives page refreshes.

### Approach
- Install `react-i18next` + `i18next`
- Create `client/src/lib/i18n.ts` — i18next initialisation
- Create `client/src/locales/en.ts` and `client/src/locales/fr.ts` — full translation dictionaries
- Add `<LanguageToggle />` button to the sidebar footer (EN | FR)
- Replace every hardcoded UI string in pages and non-UI components with `t('key')` calls
- AI-generated content (daily brief, strategy, tasks) stays in the user's chosen language by passing `language` to relevant API prompts

### Scope — files to translate
**Pages (13):**
- landing.tsx, dashboard.tsx, onboarding.tsx, strategy.tsx
- content-calendar.tsx, planning.tsx, campaigns.tsx, outreach.tsx
- analytics.tsx, projects.tsx, reading-hub.tsx, settings.tsx, not-found.tsx

**Key components (non-UI):**
- sidebar.tsx, todays-tasks.tsx, ai-suggestions.tsx, quick-stats.tsx
- schedule-preview.tsx, task-workspace.tsx, time-grid.tsx
- global-search.tsx, quick-actions.tsx, daily-focus-banner.tsx
- task-feedback-modal.tsx, weekly-progress.tsx

### Done looks like
- Language toggle (EN | FR) visible in sidebar
- Clicking it instantly switches all UI labels, buttons, headings, placeholders, and navigation items
- Onboarding flow fully translated
- Language choice persists across refresh
- AI-generated content language matches the selected language (pass `language` param to daily-brief and strategy prompts)

### Technical notes
- Use `useTranslation` hook from `react-i18next` in each component
- Initialise i18next in `client/src/lib/i18n.ts`, import it in `client/src/main.tsx`
- Wrap `<App />` in `<Suspense>` for lazy translation loading
- Keep translation keys consistent with the English text as key names (e.g. `t('sidebar.dashboard')`)
- French translations should match Naya's tone — direct, human, professional (not overly formal "vous" where "tu" fits the brand voice)
