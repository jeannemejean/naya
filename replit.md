# Naya - AI Operating System for Independent Builders

## Overview

Naya is an AI-powered operating system designed for entrepreneurs to manage multiple concurrent projects. It understands each project's purpose and revenue intent, tracks active goals, identifies the user's operating archetype, and uses this context to adapt AI-generated tasks, content, and recommendations based on the user's current operational mode (e.g., revenue, visibility, exploration). Its core capabilities include multi-project management, persona intelligence, a dashboard operational cockpit, an AI-powered task planner, and a comprehensive Brand DNA configuration.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with shadcn/ui components
- **State Management**: React Query
- **Routing**: Wouter
- **Build Tool**: Vite

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Replit Auth with OpenID Connect
- **Session Management**: Express sessions with PostgreSQL storage
- **AI Provider**: Anthropic Claude via `server/services/claude.ts` — `callClaude()` for non-streaming, `streamClaude()` for SSE. Models: `claude-haiku-4-5-20251001` (fast/structured), `claude-sonnet-4-6` (smart/strategic).
- **AI Context**: Server-side helper `fetchAIContext(userId, projectId?)` gathers project and persona context for all AI generation calls.

### UI/UX
- **Component Library**: shadcn/ui (Radix UI primitives)
- **Design System**: "new-york" style with neutral base colors
- **Responsive Design**: Mobile-first approach using Tailwind CSS
- **Time-Grid Calendar**: Renders a vertical pixel grid for planning with drag-and-drop task movement and resizing, day/week/month views, and day availability settings.

### Internationalization (i18n)
- **Library**: react-i18next / i18next
- **Languages**: English (default), French
- **Locale Files**: `client/src/locales/en.ts`, `client/src/locales/fr.ts`
- **i18n Config**: `client/src/lib/i18n.ts` — initializes i18next with localStorage persistence under key `naya_language`
- **Language Toggle**: EN | FR button in sidebar footer, toggles between English and French
- **Coverage**: All 13 pages and ~10 key components use `useTranslation()` hook with `t('key')` calls
- **French Style**: Uses "tu" (informal) consistent with Naya brand voice

### Core Features
- **Multi-Project System**: Supports multiple projects, each with distinct types, monetization intents, and success modes (revenue, visibility, consistency, exploration, learning, wellbeing).
- **Persona Intelligence System**: Detects user archetypes (Strategist, Builder, Creative Marketer, Analytical Thinker) and manages per-project target personas for strategic recommendations.
- **Dashboard Operational Cockpit**: Provides an overview of objectives, daily tasks, AI recommendations, and a persona card.
- **Task Planner**: Offers list and hour-by-hour planning modes with visual task representation.
- **AI Pipeline**: Project and persona-aware AI for generating content, daily tasks, outreach messages, and strategy insights, adapting based on project monetization intent, success mode, user archetype, and target persona.
- **Brand DNA Configuration**: A 7-section onboarding framework for defining business identity, audience, positioning, strategy, and goals, which also auto-detects user and target personas.
- **Task Intelligence System**: Incorporates time-aware tasks with attributes like `estimatedDuration`, `taskEnergyType`, `recommendedTimeOfDay`, and a realism engine for adaptive capacity planning. It uses personality-aware AI prompts and captures effectiveness signals from task feedback.
- **No-Past-Date Scheduling**: Ensures all generated tasks have a `scheduledDate` no earlier than the user's current local date.
- **Conditional Milestone Triggers**: Allows users to define conditions that, when met, unlock predefined tasks. These triggers can be parsed from natural language, checked against completed tasks, and used to inject tasks into the planning pipeline.
- **Campaign Engine**: Facilitates the creation and management of marketing campaigns, including phases, messaging frameworks, channel strategy, content plans, and KPIs. It supports AI-driven generation of campaign architecture and tasks, with temporal deployment and load-aware scheduling. Post-campaign reviews (1-5 star rating, what worked, what didn't, learnings) are stored on campaign records and automatically injected into future campaign generation prompts. Routes: PATCH `/api/campaigns/:id/review`.
- **Weekly Intelligence Briefing**: Auto-generates a weekly strategic briefing with insights into performance, risks, and recommended actions, which can be integrated into the planning process.
- **Business Memory System**: A chronological, queryable record of key business decisions, lessons, pivots, milestones, and observations. Memories are auto-injected into every AI generation call (daily tasks, strategy insights, weekly briefing, campaigns) as context. Users can create memories from the Strategy page or save them from QuickCapture entries classified as decisions/lessons. Table: `business_memory`. Routes: GET/POST/PATCH/DELETE `/api/memory`.
- **Founder State Regulation**: Energy level selector (high/medium/low/depleted) on the dashboard, calm non-gamified design with battery icons. Collapses to a compact bar after set for the day (with "Adjust" link). Energy state adapts task generation: caps daily tasks (high=8, medium=5, low/depleted=3), injects energy context into AI prompt for appropriate framing, biases task types toward admin/creative over deep_work for low/depleted. Grief/recovery emotional context triggers reduced urgency language and 1-2 anchor tasks. Also adapts `rebalance-week` daily cap. Stored in `userPreferences` fields: `currentEnergyLevel`, `currentEmotionalContext`, `energyUpdatedDate`. Routes: GET/PATCH `/api/user/energy`.
- **Smart Daily Brief**: Auto-generated daily brief card on dashboard mount. Contains greeting, top 3 priority tasks, carryovers from yesterday, strategic reminder (references upcoming campaign milestones), and energy-adapted advice. Stored in `userPreferences` (`dailyBriefDate`, `dailyBriefContent`, `dailyBriefDismissed`) — persists across page refreshes, regenerates daily. Dismissible per day. Routes: GET/POST `/api/tasks/daily-brief`, PATCH `/api/tasks/daily-brief/dismiss`.

### Shared Utilities
- **Server date utils**: `server/utils/dateUtils.ts` — `formatDate`, `addDays`, `addWeeks`, `getISOWeek`, `isWorkDay`, `campaignDateToStr`. Uses local date components (not `toISOString()`).
- **Client date utils**: `client/src/lib/dateUtils.ts` — `formatDisplayDate`, `getISOWeekNumber`, `isToday`, `isPast`.

### Data Management
- **ORM**: Drizzle with PostgreSQL dialect.
- **Schema**: Zod-based validation.
- **Migrations**: Drizzle Kit.
- **Pagination**: GET `/api/projects` accepts `?limit=N&offset=N` (default limit=50, max=200). Projects page shows "Show more" when results fill the limit.

## External Dependencies

- **Database**: Neon PostgreSQL serverless
- **Authentication**: Replit Auth service
- **AI Services**: Anthropic Claude API (Haiku for fast structured tasks, Sonnet for strategic/creative generation)
- **Session Storage**: PostgreSQL with connect-pg-simple