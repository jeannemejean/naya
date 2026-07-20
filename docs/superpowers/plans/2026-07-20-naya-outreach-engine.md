# Moteur Outreach (backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doter la prospection Naya d'un moteur de séquences multicanal conditionnel (email + LinkedIn, branches), avec génération de messages sur-mesure par prospect au dernier moment et un endpoint d'aperçu.

**Architecture:** Un plan de séquence partagé par campagne (étapes : canal, délai, intention, condition) est conçu par l'IA. À l'exécution, un moteur pur (`sequence-engine.ts`) décide l'étape à envoyer selon les signaux du prospect (ouverture/clic/bounce/réponse/acceptation d'invitation). Le texte de chaque étape est généré sur-mesure au moment de l'envoi (ou de l'aperçu), jamais un template. Le worker d'envoi existant est réécrit autour de ce moteur. Un poller Unipile met à jour l'acceptation des invitations LinkedIn.

**Tech Stack:** TypeScript, Express, Drizzle ORM + PostgreSQL (Neon), Vitest, Anthropic Claude (`CLAUDE_MODELS.smart` = `claude-sonnet-4-6`, `CLAUDE_MODELS.fast` = `claude-haiku-4-5-20251001`), SendGrid, Unipile.

## Global Constraints

- Réponses à Jeanne en français ; **code et identifiants en anglais**.
- Appels IA : passer par `callClaude`/`callClaudeDetailed` de `server/services/claude.ts` avec `userId` (imputation coût via `usage.ts`). Modèles : `CLAUDE_MODELS.smart` pour la rédaction, `CLAUDE_MODELS.fast` pour le structurel léger.
- **Kill-switch d'envoi** : rien ne part réellement tant que `PROSPECTION_SENDING_ENABLED !== "true"`. Ne jamais contourner. Aucun test ne déclenche d'envoi réel.
- **Migrations additives uniquement** (colonnes nullable / `DEFAULT`), appliquées via `npx drizzle-kit generate` → relecture du SQL → `migrate`, sur la branche **dev** (`br-divine-base-anmsv1nj`) PUIS la **prod** (`dawn-waterfall-68860472`, branche `production`). **Jamais** `db:push` sur prod.
- Le corps des messages ne contient **jamais** de tiret long (—) : réutiliser `sanitizeMessage`/`enforceLinkedInLimit` de `prospection-pipeline.ts`. LinkedIn ≤ 200 caractères.
- Signature d'un message = **prénom du fondateur** (`resolveFounderName`), jamais « Naya » ni le nom d'agence.
- Tests : `npm test` (Vitest, `vitest run`). Fichiers `*.test.ts` à côté du code.
- Commits fréquents, un par étape verte.

---

## File Structure

- `shared/schema.ts` — **Modify** : champs `intention`, `condition` sur `campaignSequenceSteps` ; `linkedinConnectedAt` sur `leads` ; nouvelle table `leadStepMessages`.
- `server/services/sequence-signals.ts` — **Create** : type `LeadSignals`, fonction pure `deriveSignals(...)`.
- `server/services/sequence-engine.ts` — **Create** : `evaluateCondition`, `decideNextStep` (purs).
- `server/services/sequence-plan.ts` — **Create** : `generateSequencePlan` (IA : canaux + conditions + intentions + rationale).
- `server/services/sequence-message.ts` — **Create** : `generateStepMessage` (bespoke par étape) + cache via `leadStepMessages`.
- `server/services/linkedin-sync.ts` — **Create** : `syncLinkedInConnections` (poller Unipile → `leads.linkedinConnectedAt`).
- `server/services/prospection-sender.ts` — **Modify** : réécriture du worker autour du moteur.
- `server/storage.ts` — **Modify** : `getLeadSignals`, `getLeadStepMessage`, `upsertLeadStepMessage`, `saveSequencePlan`, `setLeadLinkedinConnected`, `getCampaignStepAnalytics`.
- `server/routes.ts` — **Modify** : `POST /generate-sequence` (nouveau générateur), `GET /:id/preview`, extension `GET /:id/analytics`.
- Tests : `sequence-signals.test.ts`, `sequence-engine.test.ts`, `sequence-plan.test.ts`, `prospection-sender.test.ts` (étendu).

---

## Task 1: Schéma & migration additive

**Files:**
- Modify: `shared/schema.ts:1364-1377` (`campaignSequenceSteps`), table `leads`, ajout table `leadStepMessages`
- Create: migration Drizzle générée sous `migrations/`

**Interfaces:**
- Produces : colonnes `campaignSequenceSteps.intention` (text, nullable), `campaignSequenceSteps.condition` (text, default `'always'`) ; `leads.linkedinConnectedAt` (timestamp, nullable) ; table `leadStepMessages { id, leadId, stepId, subject, body, edited, generatedAt }`. Types Drizzle `LeadStepMessage`/`InsertLeadStepMessage`.

- [ ] **Step 1: Ajouter les champs au schéma**

Dans `shared/schema.ts`, dans `campaignSequenceSteps` (après `bodyTemplate`, ligne ~1373) :

```typescript
  // Angle/objectif de l'étape (remplace l'usage de bodyTemplate pour l'IA). Le texte réel
  // est généré sur-mesure par prospect (voir leadStepMessages). bodyTemplate reste nullable
  // pour rétrocompat mais n'est plus alimenté par le générateur.
  intention: text("intention"),
  // Condition d'exécution (gate) évaluée par le moteur : always | if_opened | if_not_opened
  // | if_clicked | if_invite_accepted | if_invite_not_accepted.
  condition: text("condition").notNull().default("always"),
```

Rendre `bodyTemplate` nullable : remplacer `bodyTemplate: text("body_template").notNull()` par `bodyTemplate: text("body_template")`.

Dans la table `leads`, ajouter (près de `enrichedAt`) :

```typescript
  linkedinConnectedAt: timestamp("linkedin_connected_at"), // invitation LinkedIn acceptée (poller Unipile)
```

Ajouter la table (après `leadSequenceState`, ~ligne 1394) :

```typescript
// Message sur-mesure généré pour un couple (lead, étape). Réutilisé par l'aperçu ET l'envoi.
export const leadStepMessages = pgTable("lead_step_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id),
  stepId: integer("step_id").notNull().references(() => campaignSequenceSteps.id),
  subject: text("subject"),          // email uniquement
  body: text("body").notNull(),
  edited: boolean("edited").notNull().default(false), // true si Jeanne a édité à la main
  generatedAt: timestamp("generated_at").defaultNow(),
}, (t) => ({
  uniqLeadStep: uniqueIndex("lead_step_messages_lead_step_uq").on(t.leadId, t.stepId),
}));

export type LeadStepMessage = typeof leadStepMessages.$inferSelect;
export type InsertLeadStepMessage = typeof leadStepMessages.$inferInsert;
```

Vérifier que `uniqueIndex` est importé depuis `drizzle-orm/pg-core` en tête de fichier (l'ajouter à l'import s'il manque).

- [ ] **Step 2: Générer la migration**

Run: `npx drizzle-kit generate`
Expected: un nouveau fichier SQL sous `migrations/` contenant `ALTER TABLE "campaign_sequence_steps" ADD COLUMN "intention"`, `ADD COLUMN "condition" ... DEFAULT 'always'`, `ALTER TABLE "leads" ADD COLUMN "linkedin_connected_at"`, `CREATE TABLE "lead_step_messages"`. **Relire le SQL** : uniquement des ajouts (aucun `DROP`, aucun `NOT NULL` sans default sur données existantes).

- [ ] **Step 3: Appliquer sur dev puis prod**

Appliquer le SQL relu via le MCP Neon `run_sql` (une instruction par appel, DDL idempotente `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`) d'abord sur la branche dev `br-divine-base-anmsv1nj`, puis sur la prod (branche `production` de `dawn-waterfall-68860472`). Vérifier ensuite : `SELECT column_name FROM information_schema.columns WHERE table_name='campaign_sequence_steps' AND column_name IN ('intention','condition');` doit renvoyer 2 lignes sur chaque branche.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(outreach): schéma étapes conditionnelles + messages sur-mesure par étape"
```

---

## Task 2: Signaux du prospect (pur + storage)

**Files:**
- Create: `server/services/sequence-signals.ts`
- Test: `server/services/sequence-signals.test.ts`
- Modify: `server/storage.ts` (ajout `getLeadSignals`)

**Interfaces:**
- Produces : `type LeadSignals = { opened: boolean; clicked: boolean; bounced: boolean; replied: boolean; inviteAccepted: boolean }` ; `deriveSignals(messages: {platform:string; openedAt:Date|null; clickedAt:Date|null; bouncedAt:Date|null}[], lead: {linkedinConnectedAt:Date|null}, state: {repliedAt:Date|null; status:string}): LeadSignals` ; `storage.getLeadSignals(leadId: number): Promise<LeadSignals>`.

- [ ] **Step 1: Écrire le test qui échoue**

`server/services/sequence-signals.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { deriveSignals } from "./sequence-signals";

const d = new Date();
describe("deriveSignals", () => {
  it("aucun signal par défaut", () => {
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: null, status: "active" }))
      .toEqual({ opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false });
  });
  it("ouverture email détectée", () => {
    const s = deriveSignals(
      [{ platform: "email", openedAt: d, clickedAt: null, bouncedAt: null }],
      { linkedinConnectedAt: null }, { repliedAt: null, status: "active" });
    expect(s.opened).toBe(true);
  });
  it("clic implique ouverture; bounce détecté", () => {
    const s = deriveSignals(
      [{ platform: "email", openedAt: null, clickedAt: d, bouncedAt: null },
       { platform: "email", openedAt: null, clickedAt: null, bouncedAt: d }],
      { linkedinConnectedAt: null }, { repliedAt: null, status: "active" });
    expect(s.clicked).toBe(true);
    expect(s.opened).toBe(true);
    expect(s.bounced).toBe(true);
  });
  it("réponse via repliedAt ou status stopped_replied", () => {
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: d, status: "active" }).replied).toBe(true);
    expect(deriveSignals([], { linkedinConnectedAt: null }, { repliedAt: null, status: "stopped_replied" }).replied).toBe(true);
  });
  it("invitation acceptée via linkedinConnectedAt", () => {
    expect(deriveSignals([], { linkedinConnectedAt: d }, { repliedAt: null, status: "active" }).inviteAccepted).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `npm test -- sequence-signals`
Expected: FAIL (`deriveSignals` non défini).

- [ ] **Step 3: Implémenter**

`server/services/sequence-signals.ts` :

```typescript
export type LeadSignals = {
  opened: boolean; clicked: boolean; bounced: boolean; replied: boolean; inviteAccepted: boolean;
};

type MsgRow = { platform: string; openedAt: Date | null; clickedAt: Date | null; bouncedAt: Date | null };

export function deriveSignals(
  messages: MsgRow[],
  lead: { linkedinConnectedAt: Date | null },
  state: { repliedAt: Date | null; status: string },
): LeadSignals {
  const clicked = messages.some((m) => m.clickedAt != null);
  const opened = clicked || messages.some((m) => m.openedAt != null); // un clic implique une ouverture
  const bounced = messages.some((m) => m.bouncedAt != null);
  const replied = state.repliedAt != null || state.status === "stopped_replied";
  const inviteAccepted = lead.linkedinConnectedAt != null;
  return { opened, clicked, bounced, replied, inviteAccepted };
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `npm test -- sequence-signals`
Expected: PASS.

- [ ] **Step 5: Ajouter `getLeadSignals` au storage**

Dans `server/storage.ts`, ajouter la signature à l'interface (près de `getOutreachMessages`, ~ligne 289) :

```typescript
  getLeadSignals(leadId: number): Promise<LeadSignals>;
```

Et l'implémentation dans la classe (importer `deriveSignals, LeadSignals` depuis `./services/sequence-signals`) :

```typescript
  async getLeadSignals(leadId: number): Promise<LeadSignals> {
    const [msgs, leadRow, state] = await Promise.all([
      db.select().from(outreachMessages).where(eq(outreachMessages.leadId, leadId)),
      db.select().from(leads).where(eq(leads.id, leadId)).then((r) => r[0]),
      this.getLeadSequenceState(leadId),
    ]);
    return deriveSignals(
      msgs.map((m) => ({ platform: m.platform, openedAt: m.openedAt, clickedAt: m.clickedAt, bouncedAt: m.bouncedAt })),
      { linkedinConnectedAt: (leadRow as any)?.linkedinConnectedAt ?? null },
      { repliedAt: state?.repliedAt ?? null, status: state?.status ?? "active" },
    );
  }
```

- [ ] **Step 6: Commit**

```bash
git add server/services/sequence-signals.ts server/services/sequence-signals.test.ts server/storage.ts
git commit -m "feat(outreach): signaux de réception par prospect (ouverture/clic/bounce/réponse/invite)"
```

---

## Task 3: Moteur de décision d'étape (pur)

**Files:**
- Create: `server/services/sequence-engine.ts`
- Test: `server/services/sequence-engine.test.ts`

**Interfaces:**
- Consumes : `LeadSignals` (Task 2).
- Produces :
  - `type StepCondition = "always" | "if_opened" | "if_not_opened" | "if_clicked" | "if_invite_accepted" | "if_invite_not_accepted"`
  - `evaluateCondition(condition: string, signals: LeadSignals): boolean`
  - `type EngineStep = { delayDays: number; condition: string }`
  - `type Decision = { action: "send"; index: number; done: boolean } | { action: "skip"; index: number } | { action: "wait" } | { action: "done" }`
  - `decideNextStep(currentStep: number, steps: EngineStep[], signals: LeadSignals, daysSinceLastSend: number): Decision`

- [ ] **Step 1: Écrire le test qui échoue**

`server/services/sequence-engine.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { evaluateCondition, decideNextStep } from "./sequence-engine";
import type { LeadSignals } from "./sequence-signals";

const NONE: LeadSignals = { opened: false, clicked: false, bounced: false, replied: false, inviteAccepted: false };

describe("evaluateCondition", () => {
  it("always → toujours vrai", () => expect(evaluateCondition("always", NONE)).toBe(true));
  it("if_opened", () => {
    expect(evaluateCondition("if_opened", NONE)).toBe(false);
    expect(evaluateCondition("if_opened", { ...NONE, opened: true })).toBe(true);
  });
  it("if_not_opened", () => {
    expect(evaluateCondition("if_not_opened", NONE)).toBe(true);
    expect(evaluateCondition("if_not_opened", { ...NONE, opened: true })).toBe(false);
  });
  it("if_invite_accepted / not_accepted", () => {
    expect(evaluateCondition("if_invite_accepted", { ...NONE, inviteAccepted: true })).toBe(true);
    expect(evaluateCondition("if_invite_not_accepted", NONE)).toBe(true);
  });
});

describe("decideNextStep", () => {
  const steps = [
    { delayDays: 0, condition: "always" },
    { delayDays: 3, condition: "if_not_opened" },
    { delayDays: 3, condition: "if_opened" },
  ];
  it("séquence terminée", () => {
    expect(decideNextStep(3, steps, NONE, 10)).toEqual({ action: "done" });
  });
  it("attend si le délai n'est pas écoulé", () => {
    expect(decideNextStep(1, steps, NONE, 1)).toEqual({ action: "wait" });
  });
  it("envoie l'étape 0 (always) immédiatement", () => {
    expect(decideNextStep(0, steps, NONE, 0)).toEqual({ action: "send", index: 0, done: false });
  });
  it("condition vraie → send après délai", () => {
    expect(decideNextStep(1, steps, NONE, 3)).toEqual({ action: "send", index: 1, done: false });
  });
  it("condition fausse → skip", () => {
    // à l'étape 1, si l'email a été ouvert, l'étape if_not_opened est sautée
    expect(decideNextStep(1, steps, { ...NONE, opened: true }, 3)).toEqual({ action: "skip", index: 1 });
  });
  it("dernière étape marque done", () => {
    expect(decideNextStep(2, steps, { ...NONE, opened: true }, 3)).toEqual({ action: "send", index: 2, done: true });
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `npm test -- sequence-engine`
Expected: FAIL (fonctions non définies).

- [ ] **Step 3: Implémenter**

`server/services/sequence-engine.ts` :

```typescript
import type { LeadSignals } from "./sequence-signals";

export type StepCondition =
  | "always" | "if_opened" | "if_not_opened" | "if_clicked"
  | "if_invite_accepted" | "if_invite_not_accepted";

export function evaluateCondition(condition: string, s: LeadSignals): boolean {
  switch (condition) {
    case "if_opened": return s.opened;
    case "if_not_opened": return !s.opened;
    case "if_clicked": return s.clicked;
    case "if_invite_accepted": return s.inviteAccepted;
    case "if_invite_not_accepted": return !s.inviteAccepted;
    case "always":
    default: return true;
  }
}

export type EngineStep = { delayDays: number; condition: string };

export type Decision =
  | { action: "send"; index: number; done: boolean }
  | { action: "skip"; index: number }
  | { action: "wait" }
  | { action: "done" };

/**
 * Décide quoi faire de l'enrôlement, au moment où il est "dû".
 * `currentStep` = nb d'étapes déjà TRAITÉES (envoyées ou sautées) ; l'étape candidate est steps[currentStep].
 * `daysSinceLastSend` = jours écoulés depuis le dernier ENVOI réel (0 pour l'étape 0).
 * Le délai d'une étape court depuis le dernier envoi réel : un skip ne consomme pas de délai.
 */
export function decideNextStep(
  currentStep: number, steps: EngineStep[], signals: LeadSignals, daysSinceLastSend: number,
): Decision {
  if (currentStep >= steps.length) return { action: "done" };
  const step = steps[currentStep];
  if (daysSinceLastSend < (step.delayDays || 0)) return { action: "wait" };
  if (!evaluateCondition(step.condition, signals)) return { action: "skip", index: currentStep };
  return { action: "send", index: currentStep, done: currentStep + 1 >= steps.length };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `npm test -- sequence-engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/sequence-engine.ts server/services/sequence-engine.test.ts
git commit -m "feat(outreach): moteur pur de décision d'étape (conditions + skip/wait/send)"
```

---

## Task 4: Génération du plan de séquence par l'IA (canal intelligent)

**Files:**
- Create: `server/services/sequence-plan.ts`
- Test: `server/services/sequence-plan.test.ts`
- Modify: `server/services/prospection.ts` (déprécier `generateSequence`), `server/storage.ts` (`saveSequencePlan`), `server/routes.ts:6926` (`POST /generate-sequence`)

**Interfaces:**
- Consumes : `callClaudeDetailed`, `CLAUDE_MODELS` (`server/services/claude.ts`) ; `assertNotTruncated` (`claude.ts`).
- Produces :
  - `type PlanStep = { channel: "email" | "linkedin"; delayDays: number; intention: string; condition: StepCondition }`
  - `type SequencePlan = { rationale: string; steps: PlanStep[] }`
  - `generateSequencePlan(userId: string, campaignId: number): Promise<SequencePlan>`
  - `parseSequencePlan(raw: string): SequencePlan` (pur, testé)
  - `storage.saveSequencePlan(campaignId, userId, plan): Promise<void>`

- [ ] **Step 1: Écrire le test du parseur (échec)**

`server/services/sequence-plan.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { parseSequencePlan } from "./sequence-plan";

describe("parseSequencePlan", () => {
  it("parse un plan multicanal conditionnel", () => {
    const raw = `Voici le plan : {"rationale":"LinkedIn d'abord car cible active.","steps":[
      {"channel":"linkedin","delayDays":0,"intention":"Invitation d'ouverture","condition":"always"},
      {"channel":"email","delayDays":3,"intention":"Email de valeur","condition":"if_invite_not_accepted"},
      {"channel":"linkedin","delayDays":3,"intention":"Message de suivi","condition":"if_invite_accepted"}
    ]}`;
    const plan = parseSequencePlan(raw);
    expect(plan.rationale).toContain("LinkedIn");
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toEqual({ channel: "linkedin", delayDays: 0, intention: "Invitation d'ouverture", condition: "always" });
    expect(plan.steps[1].channel).toBe("email");
  });
  it("normalise canal/condition inconnus et borne à 6 étapes", () => {
    const raw = `{"rationale":"x","steps":[${Array.from({length:8},(_,i)=>`{"channel":"sms","delayDays":-2,"intention":"i${i}","condition":"maybe"}`).join(",")}]}`;
    const plan = parseSequencePlan(raw);
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0].channel).toBe("email");       // canal inconnu → email
    expect(plan.steps[0].delayDays).toBe(0);           // délai négatif → 0
    expect(plan.steps[0].condition).toBe("always");    // condition inconnue → always
  });
  it("JSON invalide → plan vide sûr", () => {
    expect(parseSequencePlan("pas du json")).toEqual({ rationale: "", steps: [] });
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `npm test -- sequence-plan`
Expected: FAIL.

- [ ] **Step 3: Implémenter le parseur + le générateur**

`server/services/sequence-plan.ts` :

```typescript
import { storage } from "../storage";
import { callClaudeDetailed, CLAUDE_MODELS, assertNotTruncated } from "./claude";
import type { StepCondition } from "./sequence-engine";

export type PlanStep = { channel: "email" | "linkedin"; delayDays: number; intention: string; condition: StepCondition };
export type SequencePlan = { rationale: string; steps: PlanStep[] };

const CHANNELS = new Set(["email", "linkedin"]);
const CONDITIONS = new Set(["always", "if_opened", "if_not_opened", "if_clicked", "if_invite_accepted", "if_invite_not_accepted"]);

export function parseSequencePlan(raw: string): SequencePlan {
  let obj: any;
  try { obj = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw); }
  catch { return { rationale: "", steps: [] }; }
  const steps: PlanStep[] = Array.isArray(obj?.steps) ? obj.steps.slice(0, 6).map((s: any) => ({
    channel: CHANNELS.has(s?.channel) ? s.channel : "email",
    delayDays: Math.max(0, Number.isFinite(Number(s?.delayDays)) ? Number(s.delayDays) : 0),
    intention: typeof s?.intention === "string" ? s.intention.trim() : "",
    condition: (CONDITIONS.has(s?.condition) ? s.condition : "always") as StepCondition,
  })).filter((s: PlanStep) => s.intention) : [];
  return { rationale: typeof obj?.rationale === "string" ? obj.rationale.trim() : "", steps };
}

export async function generateSequencePlan(userId: string, campaignId: number): Promise<SequencePlan> {
  const [brandDna, campaign] = await Promise.all([
    storage.getBrandDna(userId),
    storage.getProspectionCampaign(campaignId),
  ]);
  const ctx = [
    (brandDna as any)?.businessName ? `Entreprise: ${(brandDna as any).businessName}` : "",
    (brandDna as any)?.uniquePositioning ? `Positionnement: ${(brandDna as any).uniquePositioning}` : "",
    campaign?.targetSector ? `Cible: ${campaign.targetSector}` : "",
    (campaign as any)?.channel ? `Canal préféré déclaré: ${(campaign as any).channel}` : "",
    (campaign as any)?.messageAngle ? `Angle: ${(campaign as any).messageAngle}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `Tu conçois le PLAN d'une séquence de prospection multicanale (email + LinkedIn), pas les messages.
Contexte :
${ctx || "(contexte minimal)"}

Décide le meilleur enchaînement de 3 à 5 étapes. Best practices 2026 :
- Le multicanal (email + LinkedIn) surpasse un seul canal ; commence souvent par le canal où la cible est la plus active.
- Utilise des BRANCHES conditionnelles : conditions possibles = "always", "if_opened", "if_not_opened", "if_clicked", "if_invite_accepted", "if_invite_not_accepted".
- Exemple : invitation LinkedIn (always) → si NON acceptée, email de valeur (if_invite_not_accepted) → si acceptée, message LinkedIn (if_invite_accepted).
- delayDays = jours après l'étape précédente. intention = objectif court de l'étape (PAS le texte).

Réponds UNIQUEMENT avec ce JSON :
{"rationale":"1-2 phrases expliquant le choix de canaux","steps":[{"channel":"linkedin|email","delayDays":0,"intention":"...","condition":"always"}]}`;

  const { text, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart, userId,
    messages: [{ role: "user", content: prompt }], max_tokens: 1500, temperature: 0.6,
  });
  assertNotTruncated(stopReason);
  return parseSequencePlan(text);
}
```

> Note : vérifier la signature réelle de `callClaudeDetailed` dans `server/services/claude.ts` et adapter la déstructuration (`text`/`stopReason`) si les noms diffèrent.

- [ ] **Step 4: Lancer → succès**

Run: `npm test -- sequence-plan`
Expected: PASS (les 3 cas du parseur).

- [ ] **Step 5: Persister le plan (storage)**

Dans `server/storage.ts`, ajouter à l'interface + classe :

```typescript
  saveSequencePlan(campaignId: number, userId: string, plan: { steps: { channel: string; delayDays: number; intention: string; condition: string }[] }): Promise<void>;
```

```typescript
  async saveSequencePlan(campaignId: number, userId: string, plan: { steps: { channel: string; delayDays: number; intention: string; condition: string }[] }): Promise<void> {
    await db.delete(campaignSequenceSteps).where(eq(campaignSequenceSteps.campaignId, campaignId));
    if (plan.steps.length === 0) return;
    await db.insert(campaignSequenceSteps).values(plan.steps.map((s, i) => ({
      campaignId, userId, stepOrder: i + 1,
      channel: s.channel, delayDays: s.delayDays, intention: s.intention, condition: s.condition,
      bodyTemplate: null, subjectTemplate: null, isActive: true,
    })));
  }
```

- [ ] **Step 6: Brancher la route `POST /generate-sequence`**

Dans `server/routes.ts` (~ligne 6926), remplacer l'appel à `generateSequence` par :

```typescript
    const plan = await generateSequencePlan(userId, campaignId);
    await storage.saveSequencePlan(campaignId, userId, plan);
    res.json({ rationale: plan.rationale, steps: await storage.getSequenceSteps(campaignId) });
```

Ajouter l'import `import { generateSequencePlan } from "./services/sequence-plan";`. Dans `server/services/prospection.ts`, annoter `generateSequence` comme **déprécié** (commentaire `@deprecated remplacé par generateSequencePlan`) — ne pas le supprimer tout de suite (compat), mais il n'est plus appelé.

- [ ] **Step 7: Commit**

```bash
git add server/services/sequence-plan.ts server/services/sequence-plan.test.ts server/storage.ts server/routes.ts server/services/prospection.ts
git commit -m "feat(outreach): génération IA du plan de séquence (canal intelligent + branches + rationale)"
```

---

## Task 5: Génération bespoke du message d'une étape (+ cache)

**Files:**
- Create: `server/services/sequence-message.ts`
- Test: `server/services/sequence-message.test.ts`
- Modify: `server/storage.ts` (`getLeadStepMessage`, `upsertLeadStepMessage`)

**Interfaces:**
- Consumes : `sanitizeMessage`, `enforceLinkedInLimit`, `resolveFounderName` (déjà dans `prospection-pipeline.ts` — les exporter si nécessaire), `callClaude`, `CLAUDE_MODELS`, `parseJsonObject`.
- Produces :
  - `buildStepPrompt(args: { founderName: string; projectName: string; channel: string; intention: string; lead: any; audit: Record<string,string> }): string` (pur, testé)
  - `generateStepMessage(userId: string, opts: { lead: any; campaign: any; step: { id:number; channel:string; intention:string|null }; useCache?: boolean }): Promise<{ subject: string | null; body: string }>`
  - `storage.getLeadStepMessage(leadId, stepId)`, `storage.upsertLeadStepMessage(row)`

- [ ] **Step 1: Exporter les helpers réutilisés**

Dans `server/services/prospection-pipeline.ts`, exporter `sanitizeMessage`, `enforceLinkedInLimit`, `resolveFounderName` (ajouter `export` devant leur déclaration si elles sont locales). Vérifier qu'`parseJsonObject` est déjà exporté (sinon l'exporter).

- [ ] **Step 2: Écrire le test du prompt (échec)**

`server/services/sequence-message.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { buildStepPrompt } from "./sequence-message";

describe("buildStepPrompt", () => {
  const base = {
    founderName: "Jeanne", projectName: "Agence JMD",
    lead: { name: "Fred Renaud", role: "Cofondateur", company: "Petit Bivouac" },
    audit: { angle: "le nom crée une pause", observations: "marque outdoor grenobloise" },
  };
  it("LinkedIn : impose ≤200 caractères et la signature du prénom", () => {
    const p = buildStepPrompt({ ...base, channel: "linkedin", intention: "Invitation d'ouverture" });
    expect(p).toContain("200");
    expect(p).toContain("Jeanne");
    expect(p).toContain("Fred Renaud");
    expect(p).toContain("Invitation d'ouverture");
  });
  it("Email : demande un objet + un corps et rappelle l'intention", () => {
    const p = buildStepPrompt({ ...base, channel: "email", intention: "Email de valeur" });
    expect(p.toLowerCase()).toContain("objet");
    expect(p).toContain("Email de valeur");
  });
});
```

- [ ] **Step 3: Lancer → échec**

Run: `npm test -- sequence-message`
Expected: FAIL.

- [ ] **Step 4: Implémenter**

`server/services/sequence-message.ts` :

```typescript
import { storage } from "../storage";
import { callClaude, CLAUDE_MODELS } from "./claude";
import { sanitizeMessage, enforceLinkedInLimit, parseJsonObject } from "./prospection-pipeline";

export function buildStepPrompt(args: {
  founderName: string; projectName: string; channel: string; intention: string;
  lead: any; audit: Record<string, string>;
}): string {
  const isLi = args.channel === "linkedin";
  return `Tu es Naya. Rédige ${isLi ? "un message LinkedIn" : "un email"} de prospection sur-mesure.

PROSPECT : ${args.lead?.name || ""} — ${args.lead?.role || ""} @ ${args.lead?.company || ""}
INTENTION DE CETTE ÉTAPE : ${args.intention || "prise de contact"}
ANGLE (audit) : ${args.audit?.angle || ""}
ENJEUX : ${args.audit?.enjeux || args.audit?.observations || ""}

RÈGLES ABSOLUES :
- Ton humain, curieux, jamais commercial. JAMAIS de tiret long.
${isLi
  ? `- MESSAGE LINKEDIN : MAXIMUM 200 caractères strict. Un lien personnel + une question sincère. Signé : ${args.founderName}.`
  : `- EMAIL : 5 à 8 phrases. Observation d'ouverture, angle, question ouverte. Signé : ${args.founderName} — ${args.projectName}.`}

Réponds UNIQUEMENT avec ce JSON :
{${isLi ? '"body":"..."' : '"subject":"...","body":"..."'}}`;
}

export async function generateStepMessage(
  userId: string,
  opts: { lead: any; campaign: any; step: { id: number; channel: string; intention: string | null }; useCache?: boolean },
): Promise<{ subject: string | null; body: string }> {
  if (opts.useCache !== false) {
    const cached = await storage.getLeadStepMessage(opts.lead.id, opts.step.id);
    if (cached) return { subject: cached.subject ?? null, body: cached.body };
  }
  const founderName = opts.lead?.founderName || opts.campaign?.founderName || "";
  const projectName = opts.campaign?.name || "";
  const audit = safeAudit(opts.lead?.auditNotes);
  const prompt = buildStepPrompt({
    founderName, projectName, channel: opts.step.channel,
    intention: opts.step.intention || "", lead: opts.lead, audit,
  });
  const raw = await callClaude({ model: CLAUDE_MODELS.smart, userId, messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.6 });
  const p = parseJsonObject(raw);
  const body = opts.step.channel === "linkedin"
    ? enforceLinkedInLimit(typeof p.body === "string" ? p.body : "")
    : sanitizeMessage(typeof p.body === "string" ? p.body : "");
  const subject = opts.step.channel === "email" && typeof p.subject === "string" ? p.subject.trim() : null;
  await storage.upsertLeadStepMessage({ leadId: opts.lead.id, stepId: opts.step.id, subject, body, edited: false });
  return { subject, body };
}

function safeAudit(auditNotes: any): Record<string, string> {
  if (!auditNotes) return {};
  try { return typeof auditNotes === "string" ? JSON.parse(auditNotes) : auditNotes; } catch { return {}; }
}
```

> `founderName` : si non porté par `lead`/`campaign`, résoudre en amont via `resolveFounderName(user, dna)` au point d'appel (worker/route) et le passer dans `opts.campaign.founderName`.

- [ ] **Step 5: Lancer → succès**

Run: `npm test -- sequence-message`
Expected: PASS (les 2 cas du prompt).

- [ ] **Step 6: Cache storage**

Dans `server/storage.ts`, interface + classe (importer `leadStepMessages`, types) :

```typescript
  getLeadStepMessage(leadId: number, stepId: number): Promise<LeadStepMessage | undefined>;
  upsertLeadStepMessage(row: InsertLeadStepMessage): Promise<void>;
```

```typescript
  async getLeadStepMessage(leadId: number, stepId: number): Promise<LeadStepMessage | undefined> {
    const r = await db.select().from(leadStepMessages)
      .where(and(eq(leadStepMessages.leadId, leadId), eq(leadStepMessages.stepId, stepId)));
    return r[0];
  }
  async upsertLeadStepMessage(row: InsertLeadStepMessage): Promise<void> {
    await db.insert(leadStepMessages).values(row)
      .onConflictDoUpdate({ target: [leadStepMessages.leadId, leadStepMessages.stepId],
        set: { subject: row.subject ?? null, body: row.body!, edited: row.edited ?? false, generatedAt: new Date() } });
  }
```

- [ ] **Step 7: Commit**

```bash
git add server/services/sequence-message.ts server/services/sequence-message.test.ts server/services/prospection-pipeline.ts server/storage.ts
git commit -m "feat(outreach): génération sur-mesure du message par étape (+ cache lead_step_messages)"
```

---

## Task 6: Endpoint d'aperçu par prospect

**Files:**
- Modify: `server/routes.ts` (nouvelle route `GET /api/prospection/campaigns/:id/preview`)

**Interfaces:**
- Consumes : `storage.getSequenceSteps`, `storage.getLeads`, `generateStepMessage` (Task 5).
- Produces : `GET /api/prospection/campaigns/:id/preview?leadId=<n>` → `{ lead: {id,name,company}, steps: [{ stepOrder, channel, delayDays, intention, condition, subject, body }] }`.

- [ ] **Step 1: Ajouter la route**

Dans `server/routes.ts`, à côté des autres routes `/api/prospection/campaigns/:id/...` :

```typescript
  app.get("/api/prospection/campaigns/:id/preview", isAuthenticated, async (req: any, res) => {
    const userId = req.userId;
    const campaignId = Number(req.params.id);
    const leadId = Number(req.query.leadId);
    const campaign = await storage.getProspectionCampaign(campaignId);
    if (!campaign || (campaign as any).userId !== userId) return res.status(404).json({ message: "Campagne introuvable" });
    const steps = await storage.getSequenceSteps(campaignId);
    const lead = (await storage.getLeads(userId)).find((l) => l.id === leadId);
    if (!lead) return res.status(404).json({ message: "Prospect introuvable" });
    const rendered = [];
    for (const step of steps) {
      const msg = await generateStepMessage(userId, {
        lead, campaign, step: { id: step.id, channel: step.channel, intention: (step as any).intention ?? null }, useCache: true,
      });
      rendered.push({
        stepOrder: step.stepOrder, channel: step.channel, delayDays: step.delayDays,
        intention: (step as any).intention ?? null, condition: (step as any).condition ?? "always",
        subject: msg.subject, body: msg.body,
      });
    }
    res.json({ lead: { id: lead.id, name: lead.name, company: lead.company }, steps: rendered });
  });
```

Ajouter l'import `import { generateStepMessage } from "./services/sequence-message";`.

- [ ] **Step 2: Vérifier manuellement (dev, sans envoi)**

Démarrer `npm run dev` (branche dev, DB sûre), s'authentifier, appeler `GET /api/prospection/campaigns/5/preview?leadId=115`. Attendu : JSON avec `steps[].body` non vide (message sur-mesure pour Fred Renaud). Aucun envoi n'est déclenché (endpoint de lecture/génération seulement).

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat(outreach): endpoint d'aperçu de séquence rendu avec un vrai prospect"
```

---

## Task 7: Poller Unipile — acceptation d'invitation LinkedIn

**Files:**
- Create: `server/services/linkedin-sync.ts`
- Modify: `server/services/linkedin.ts` (helper de listing des relations si absent), `server/storage.ts` (`setLeadLinkedinConnected`, `getLeadsAwaitingInvite`), point de démarrage du scheduler (`server/index.ts` ou là où `scheduleProspectionSender` est appelé)

**Interfaces:**
- Consumes : Unipile (via `linkedin.ts`), `storage`.
- Produces : `syncLinkedInConnections(): Promise<number>` (nb de leads passés « connectés ») ; `storage.setLeadLinkedinConnected(leadId, at)` ; `storage.getLeadsAwaitingInvite(): Promise<{ id:number; userId:string; linkedinUrl:string|null }[]>` (leads enrôlés actifs, invitation envoyée, `linkedinConnectedAt IS NULL`).

- [ ] **Step 1: Helper de relations Unipile**

Dans `server/services/linkedin.ts`, ajouter (si absent) une fonction qui interroge Unipile pour savoir si un profil est en relation de 1er degré avec le compte de l'utilisateur :

```typescript
// Vrai si le profil (public_id résolu) est désormais une relation 1er degré du compte Unipile.
export async function isConnected(accountId: string, linkedinUrl: string): Promise<boolean> {
  const providerId = await resolveProviderId(accountId, linkedinUrl).catch(() => null);
  if (!providerId) return false;
  const dsn = process.env.UNIPILE_DSN, key = process.env.UNIPILE_API_KEY;
  const res = await fetch(`${dsn}/api/v1/users/${providerId}?account_id=${accountId}`, { headers: { "X-API-KEY": key! } });
  if (!res.ok) return false;
  const data: any = await res.json().catch(() => ({}));
  // Unipile expose le degré de réseau ; 1er degré = relation acceptée.
  return data?.network_distance === "FIRST_DEGREE" || data?.is_relationship === true;
}
```

> Vérifier le champ exact renvoyé par l'API Unipile pour le degré de réseau et ajuster la condition. `resolveProviderId` existe déjà dans ce fichier.

- [ ] **Step 2: Implémenter le poller**

`server/services/linkedin-sync.ts` :

```typescript
import { storage } from "../storage";
import { linkedinConfigured, isConnected } from "./linkedin";

export async function syncLinkedInConnections(): Promise<number> {
  if (!linkedinConfigured()) return 0;
  const waiting = await storage.getLeadsAwaitingInvite().catch(() => []);
  let updated = 0;
  for (const lead of waiting) {
    if (!lead.linkedinUrl) continue;
    const prefs = await storage.getUserPreferences(lead.userId);
    const accountId = (prefs as any)?.linkedinUnipileAccountId?.trim();
    if (!accountId) continue;
    try {
      if (await isConnected(accountId, lead.linkedinUrl)) {
        await storage.setLeadLinkedinConnected(lead.id, new Date());
        updated++;
      }
    } catch { /* on réessaiera au prochain tick */ }
  }
  return updated;
}

export function scheduleLinkedInSync(): void {
  setInterval(() => { syncLinkedInConnections().catch(() => {}); }, 15 * 60_000); // toutes les 15 min
}
```

- [ ] **Step 3: Storage**

Dans `server/storage.ts`, interface + classe :

```typescript
  setLeadLinkedinConnected(leadId: number, at: Date): Promise<void>;
  getLeadsAwaitingInvite(): Promise<{ id: number; userId: string; linkedinUrl: string | null }[]>;
```

```typescript
  async setLeadLinkedinConnected(leadId: number, at: Date): Promise<void> {
    await db.update(leads).set({ linkedinConnectedAt: at } as any).where(eq(leads.id, leadId));
  }
  async getLeadsAwaitingInvite(): Promise<{ id: number; userId: string; linkedinUrl: string | null }[]> {
    const rows = await db.select({ id: leads.id, userId: leads.userId, linkedinUrl: leads.linkedinUrl })
      .from(leads)
      .innerJoin(leadSequenceState, eq(leadSequenceState.leadId, leads.id))
      .where(and(eq(leadSequenceState.status, "active"), isNull((leads as any).linkedinConnectedAt)));
    return rows as any;
  }
```

Vérifier que `isNull` est importé depuis `drizzle-orm`.

- [ ] **Step 4: Démarrer le scheduler**

Là où `scheduleProspectionSender()` est appelé (chercher via `grep -n scheduleProspectionSender server/`), ajouter `scheduleLinkedInSync();` juste après, avec l'import correspondant.

- [ ] **Step 5: Commit**

```bash
git add server/services/linkedin-sync.ts server/services/linkedin.ts server/storage.ts server/index.ts
git commit -m "feat(outreach): poller Unipile d'acceptation d'invitation LinkedIn (signal de branche)"
```

---

## Task 8: Réécriture du worker d'envoi (conditionnel + bespoke)

**Files:**
- Modify: `server/services/prospection-sender.ts`
- Test: `server/services/prospection-sender.test.ts` (étendre l'existant)

**Interfaces:**
- Consumes : `decideNextStep` (Task 3), `storage.getLeadSignals` (Task 2), `generateStepMessage` (Task 5), `resolveFounderName`.
- Produces : `runProspectionSender` mis à jour ; conserve `withinSendingWindow`, `resolveSenderConfig`, `sendEmail`, les plafonds et le kill-switch **inchangés**.

- [ ] **Step 1: Test — règles de stop et sélection d'étape (échec)**

Étendre `server/services/prospection-sender.test.ts` (importer `decideNextStep` déjà couvert ; ici on teste l'intégration légère du calcul « jours depuis dernier envoi »). Ajouter une fonction pure exportée `daysBetween(a: Date, b: Date): number` et son test :

```typescript
import { daysBetween } from "./prospection-sender";
describe("daysBetween", () => {
  it("compte les jours pleins écoulés", () => {
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-04T09:00:00Z"))).toBe(3);
    expect(daysBetween(new Date("2026-07-01T09:00:00Z"), new Date("2026-07-01T20:00:00Z"))).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `npm test -- prospection-sender`
Expected: FAIL (`daysBetween` non défini).

- [ ] **Step 3: Réécrire la boucle**

Dans `server/services/prospection-sender.ts` :

1. Ajouter en tête les imports :

```typescript
import { decideNextStep } from "./sequence-engine";
import { generateStepMessage } from "./sequence-message";
import { resolveFounderName } from "./prospection-pipeline";
```

2. Ajouter le helper pur exporté :

```typescript
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
```

3. Remplacer, dans la boucle `for (const state of due)` (après la vérif de fenêtre d'envoi), le bloc `planNextStep` → génération template → envoi, par :

```typescript
        const steps = await storage.getSequenceSteps(state.campaignId);

        // Signaux du prospect → règles de stop globales AVANT toute décision.
        const signals = await storage.getLeadSignals(state.leadId);
        if (signals.bounced) { await storage.updateLeadSequenceState(state.leadId, { status: "bounced", nextRunAt: null }); continue; }
        if (signals.replied) { await storage.updateLeadSequenceState(state.leadId, { status: "stopped_replied", nextRunAt: null }); continue; }

        const lastSend = state.lastStepSentAt ? new Date(state.lastStepSentAt) : new Date(state.enrolledAt || Date.now());
        let daysSince = daysBetween(lastSend, new Date());

        // Sauter les étapes dont la condition est fausse, sans consommer de délai.
        let decision = decideNextStep(state.currentStep, steps.map((s) => ({ delayDays: s.delayDays, condition: (s as any).condition || "always" })), signals, daysSince);
        while (decision.action === "skip") {
          await storage.updateLeadSequenceState(state.leadId, { currentStep: decision.index + 1 });
          state.currentStep = decision.index + 1;
          decision = decideNextStep(state.currentStep, steps.map((s) => ({ delayDays: s.delayDays, condition: (s as any).condition || "always" })), signals, daysSince);
        }
        if (decision.action === "done") { await storage.updateLeadSequenceState(state.leadId, { status: "completed", nextRunAt: null }); continue; }
        if (decision.action === "wait") { continue; } // pas encore dû → nextRunAt inchangé

        const step = steps[decision.index];
        const lead = (await storage.getLeads(state.userId)).find((l) => l.id === state.leadId);
        if (!lead) { await storage.updateLeadSequenceState(state.leadId, { status: "failed", nextRunAt: null }); continue; }

        // Texte SUR-MESURE au dernier moment (cache réutilisé si déjà généré pour l'aperçu).
        const dna = await storage.getBrandDna(state.userId);
        const user = await storage.getUser(state.userId);
        const founderName = resolveFounderName(user, dna);
        const gen = await generateStepMessage(state.userId, {
          lead, campaign: { ...(await storage.getProspectionCampaign(state.campaignId)), founderName },
          step: { id: step.id, channel: step.channel, intention: (step as any).intention ?? null }, useCache: true,
        });
        const subject = gen.subject || "";
        const body = gen.body;
```

4. Le reste (branche `if (step.channel === "email")` … `else` LinkedIn, plafonds, `createOutreachMessage`) reste inchangé **sauf** : après un envoi réussi, planifier via la décision :

```typescript
        // Fin de traitement de l'étape envoyée : programmer la suite.
        const after = decideNextStep(decision.index + 1, steps.map((s) => ({ delayDays: s.delayDays, condition: (s as any).condition || "always" })), signals, 0);
        const nextDelay = after.action === "send" ? 0 : after.action === "wait" ? (steps[decision.index + 1]?.delayDays || 1) : null;
        await storage.updateLeadSequenceState(state.leadId, {
          currentStep: decision.index + 1,
          lastStepSentAt: new Date(),
          status: decision.done ? "completed" : "active",
          nextRunAt: decision.done ? null : new Date(Date.now() + (nextDelay || 0) * 86_400_000),
        });
```

Supprimer l'ancien `planNextStep`/`renderTemplate` de la boucle (garder `planNextStep` exporté si d'autres tests le référencent, sinon le retirer).

> ⚠️ Ne modifier NI le kill-switch (`masterSendingEnabled`), NI `resolveSenderConfig`, NI `sendEmail`, NI les plafonds email/LinkedIn, NI la fenêtre d'envoi.

- [ ] **Step 4: Lancer les tests**

Run: `npm test -- prospection-sender`
Expected: PASS (`daysBetween` + tests existants `withinSendingWindow`).

- [ ] **Step 5: Vérif dry-run (sécurité)**

Sans `PROSPECTION_SENDING_ENABLED`, lancer `npm run dev` et confirmer dans les logs `[ProspectionSender] DRY-RUN` — **aucun envoi**, aucune écriture. C'est la garantie anti-incident.

- [ ] **Step 6: Commit**

```bash
git add server/services/prospection-sender.ts server/services/prospection-sender.test.ts
git commit -m "feat(outreach): worker d'envoi conditionnel + message sur-mesure au dernier moment"
```

---

## Task 9: Analytics par étape et par canal

**Files:**
- Modify: `server/storage.ts` (`getCampaignStepAnalytics`), `server/routes.ts` (extension `GET /:id/analytics`)

**Interfaces:**
- Produces : `storage.getCampaignStepAnalytics(campaignId): Promise<{ byStep: { stepOrder:number; channel:string; sent:number; opened:number; clicked:number; bounced:number }[]; byChannel: { channel:string; sent:number; replied:number }[] }>` ; l'endpoint `GET /api/prospection/campaigns/:id/analytics` renvoie ce détail en plus des totaux existants.

- [ ] **Step 1: Implémenter l'agrégat storage**

Dans `server/storage.ts`, dériver depuis `outreach_messages` (via `messageType = step_N…` et `platform`) les compteurs par étape et par canal. Interface + classe :

```typescript
  getCampaignStepAnalytics(campaignId: number): Promise<{
    byStep: { stepOrder: number; channel: string; sent: number; opened: number; clicked: number; bounced: number }[];
    byChannel: { channel: string; sent: number; replied: number }[];
  }>;
```

Implémentation : récupérer les leads de la campagne (`prospectionCampaignId = campaignId`), joindre leurs `outreach_messages`, compter par `messageType` préfixé `step_` (extraire le numéro d'étape) et par `platform`. `replied` par canal = nb de `leadSequenceState.status = 'stopped_replied'` pour les leads de la campagne, attribué au dernier canal envoyé.

- [ ] **Step 2: Étendre la route**

Dans `server/routes.ts`, route `GET /api/prospection/campaigns/:id/analytics` : ajouter `const detail = await storage.getCampaignStepAnalytics(campaignId);` et fusionner dans la réponse (`{ ...totaux, byStep: detail.byStep, byChannel: detail.byChannel }`).

- [ ] **Step 3: Vérif dev**

`GET /api/prospection/campaigns/5/analytics` → la réponse contient `byStep` et `byChannel`.

- [ ] **Step 4: Commit**

```bash
git add server/storage.ts server/routes.ts
git commit -m "feat(outreach): analytics de séquence par étape et par canal"
```

---

## Self-Review

**Spec coverage (spec §1-§12) :**
- §4 plan visuel : données prêtes (`intention`, `condition`) — l'UI est le Plan 2. ✅ (backend)
- §5 aperçu par prospect : Task 6 (endpoint) + Task 5 (bespoke). ✅
- §6.1 canal intelligent : Task 4. ✅ ; §6.2 bespoke au dernier moment + cache : Task 5 + Task 8. ✅ ; §6.3 conditions sur étapes : Task 1 + Task 3. ✅ ; §6.4 signaux : Task 2 (+ Task 7 pour l'acceptation). ✅ ; §6.5 worker : Task 8. ✅
- §8 analytics : Task 9. ✅
- §9 dépendances : open-tracking déjà activé à l'envoi (`sendEmail` pose `open_tracking.enable:true`) — reste à confirmer la **livraison des events webhook** côté SendGrid (action ops, hors code) ; poller Unipile : Task 7 ; coût IA borné par cache + génération au dernier moment : Task 5/8. ✅
- §10 hors périmètre respecté (pas de graphe arbitraire, pas d'A/B, canaux limités à email+LinkedIn). ✅

**Placeholder scan :** deux points explicitement signalés à vérifier au moment de coder (signature exacte de `callClaudeDetailed` en Task 4 ; champ Unipile de degré de réseau en Task 7) — ce sont des vérifications, pas des trous ; code fourni dans tous les cas.

**Type consistency :** `LeadSignals` (Task 2) consommé par `evaluateCondition`/`decideNextStep` (Task 3) et le worker (Task 8) ✅ ; `StepCondition` défini en Task 3, réutilisé en Task 4 ✅ ; `PlanStep`/`SequencePlan` (Task 4) alignés avec `saveSequencePlan` ✅ ; `generateStepMessage` (Task 5) appelé identiquement en Task 6 et Task 8 (même forme `opts`) ✅.

**Sécurité :** kill-switch et garde-fous d'envoi jamais modifiés ; aucun test ne déclenche d'envoi ; migrations additives dev→prod. ✅
