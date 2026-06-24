## Migrate OpenAI → Claude (Anthropic) — Naya Main Project

### Objective
Replace all OpenAI API calls with Anthropic Claude. Keep identical business logic — only the HTTP client, model names, and response parsing change.

The companion app (separate Replit project) is out of scope here.

---

### Step 1 — Install SDK & secret

```bash
npm install @anthropic-ai/sdk
```

Add `ANTHROPIC_API_KEY` secret in Replit Secrets (value from console.anthropic.com).

---

### Step 2 — Create `server/services/claude.ts`

New file with:
- `anthropic` client singleton
- `CLAUDE_MODELS = { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-4-6" }`
- `NAYA_VOICE` system prompt constant (same voice as NAYA_SYSTEM_VOICE in naya-voice.ts)
- `callClaude(options)` — async, returns `string`. Separates system messages from chat messages automatically. Replaces all non-streaming `openai.chat.completions.create` calls.
- `streamClaude(options)` — writes SSE to Express `Response`, fires `data: [DONE]` on completion. Replaces streaming calls (none in current codebase, but good to have).

---

### Step 3 — Migrate `server/services/openai.ts` (11 calls)

At lines: 250, 499, 556, 619, 642, 688, 811, 903, 945, 1184, 1311

**Before each:**
```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  max_tokens: N,
});
const text = response.choices[0].message.content ?? "";
```

**After:**
```typescript
const text = await callClaude({
  model: CLAUDE_MODELS.fast,
  messages: [...],
  max_tokens: N,
});
```

For JSON-parsing calls:
```typescript
const raw = await callClaude({ model: CLAUDE_MODELS.fast, messages: [...], max_tokens: N });
// then JSON.parse(raw || "{}") or JSON.parse(raw || "[]")
```

Remove the `import OpenAI from "openai"` and `const openai = new OpenAI(...)` at the top.
Add `import { callClaude, CLAUDE_MODELS, NAYA_VOICE } from "./claude";`

Model selection by task:
- Structured JSON, classification, daily brief, task generation → `CLAUDE_MODELS.fast` (Haiku)
- Brand DNA analysis, strategic recommendations, weekly briefing → `CLAUDE_MODELS.smart` (Sonnet)

---

### Step 4 — Migrate 3 inline OpenAI calls in `server/routes.ts`

**Call 1 (~line 571):**
```typescript
// Remove: const OpenAI = (await import('openai')).default; ...
// Replace with:
const { callClaude, CLAUDE_MODELS } = await import('./services/claude.js');
const text = await callClaude({ model: CLAUDE_MODELS.fast, messages: [...], max_tokens: N });
```

**Call 2 (~line 1403 — daily brief):**
```typescript
// Remove: const briefOpenai = new OpenAI(...); const response = await briefOpenai...
// Replace with (using top-level import):
const summary = await callClaude({
  model: CLAUDE_MODELS.fast,
  messages: [...],
  max_tokens: 200,
}) || fallback;
```

**Call 3 (~line 6054):**
Same as Call 1 pattern.

Also update the top-level import in routes.ts:
```typescript
// Remove: import OpenAI from "openai";
// Add (if not already present from openai.ts re-export):
import { callClaude, streamClaude, CLAUDE_MODELS, NAYA_VOICE } from "./services/claude.js";
```

---

### Step 5 — Migrate `server/services/article-analysis.ts`

Replace dynamic `import('openai')` + `openai.chat.completions.create` with `callClaude`.

---

### Step 6 — Migrate `server/services/milestone-intelligence.ts`

Same pattern — replace top-level OpenAI import + `openai.chat.completions.create` with `callClaude`.

---

### Step 7 — Files that only import types (no API calls — no change needed)

- `server/services/task-pre-generation.ts` — imports `BrandDnaInput` type from openai.ts only
- `server/services/fallback-tasks.ts` — imports `BrandDnaInput` type from openai.ts only
- `server/services/naya-intelligence.ts` — imports `BrandDnaInput` type from openai.ts only

These import a **type** only — `BrandDnaInput` is defined in `openai.ts`. That type export must be kept in `openai.ts` (or moved to `shared/schema.ts`). No API call changes needed.

---

### Model mapping

| Task | Old | New |
|------|-----|-----|
| JSON generation, classification | gpt-4o | claude-haiku-4-5-20251001 (fast) |
| Daily brief, task suggestions | gpt-4o | claude-haiku-4-5-20251001 (fast) |
| Brand DNA, strategy analysis, weekly briefing | gpt-4o | claude-sonnet-4-6 (smart) |

---

### Done looks like
- `npm run build` passes (no TypeScript errors in migrated files)
- App starts and daily brief generates without error
- Weekly intelligence briefing generates
- Task generation works
- `OPENAI_API_KEY` is no longer called (can be kept in secrets but unused)
- `ANTHROPIC_API_KEY` is set in Replit Secrets
