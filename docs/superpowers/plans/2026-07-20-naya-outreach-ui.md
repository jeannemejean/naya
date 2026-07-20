# Refonte UI Outreach — Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Implementers building visual components SHOULD invoke the `frontend-design` skill for craft, staying within the tokens/structure defined here.

**Goal:** Rendre la page Outreach visuelle et user-friendly (façon Lemlist) sur le moteur du Plan 1 : espace campagne à 4 sous-onglets, timeline de séquence visuelle, aperçu par vrai prospect, kanban et fiche repensés — en respectant la patte JMD.

**Architecture:** Décomposer le monolithe `client/src/pages/outreach.tsx` (1668 lignes) en un dossier `client/src/pages/outreach/`. Deux niveaux : un **accueil** (`/outreach` — onglets Campagnes / Pipeline) et un **espace de travail campagne** (`/outreach/campaigns/:id` — sous-onglets Séquence · Prospects · Aperçu · Résultats). Le texte des messages reste bespoke (moteur Plan 1) ; l'UI consomme les endpoints existants + 3 nouveaux (`/preview`, `/analytics` étendu, `/generate-sequence` renvoyant `{rationale, steps}`).

**Tech Stack:** React + TypeScript + Vite + Wouter (routing) + TanStack Query (query key = URL, `credentials:include`) + shadcn/ui + Tailwind (tokens `naya-*`) + lucide-react + react-i18next (partiel). Vitest pour les helpers purs.

## Global Constraints

- **Patte visuelle JMD** (tokens réels, `tailwind.config.ts`) : fonds crème `bg-background`/`bg-white`, texte `text-foreground`/`text-muted-foreground`, bordures `border-border`. Boutons sombres = `bg-primary` + `text-primary-foreground`. Radius par défaut. **Préférer les utilitaires `naya-*`** (`naya-olive` #2B2D1C, `naya-salvia` #7D8FA8, `naya-mauve` #9E7E87, ramps `naya-olive-10/06/18/35/55/70/90`) plutôt que des RGBA inline. **Ne JAMAIS remettre `.text-white` dans l'override non scopé d'index.css.**
- **Codage couleur des canaux (unique source de vérité, Task 1)** : LinkedIn → `naya-salvia` (#7D8FA8) + icône `Linkedin` ; Email → jaune soufre `#D4C97A` (`--chart-1`) + icône `Mail` ; bounce/alerte → `naya-mauve` (#9E7E87). Tous les composants importent ce helper — aucune couleur de canal codée en dur ailleurs.
- **Data** : GET via `useQuery({ queryKey: ['/api/...'] })` (la clé EST l'URL) ; mutations via `apiRequest(method, url, data)` de `@/lib/queryClient` puis `queryClient.invalidateQueries`. Auth = cookies (`credentials:include`, déjà géré). Réponses JSON de mutation via `.then(r => r.json())`.
- **Routing** : Wouter, routes déclarées dans `client/src/App.tsx` dans le `<Switch>` de la branche authentifiée (`isAuthenticated && hasAccess`). Forme render-prop : `<Route path="..."/>{(params) => <Comp .../> }</Route>`. Navigation via `<Link href>` / `useLocation()`.
- **Shell de page** : pas d'AppShell ; chaque page rend `<Sidebar onSearchClick={...} />` puis `<div className="flex-1 flex flex-col overflow-hidden">`. Reproduire le pattern de `outreach.tsx:221-247`.
- **i18n** : l'existant est partiel ; la majorité des chaînes sont en **français inline**. Les nouvelles chaînes peuvent rester en **français inline** (cohérent avec le fichier), pas d'obligation de passer par `t()`. Ne pas casser les `t('outreach.*')` déjà en place dans l'en-tête.
- **Icônes** : `lucide-react`, taille `w-4 h-4` (dense `w-3 h-3`), spinner `Loader2` + `animate-spin`.
- **Aucun changement backend** dans ce plan (le moteur est fait). Si un besoin d'endpoint apparaît, le signaler (NEEDS_CONTEXT), ne pas l'inventer.
- **Vérif** : `npx tsc --noEmit` clean + `npm run build` (Vite) réussi à chaque tâche qui touche des composants ; helpers purs testés en Vitest. Commits fréquents.
- Réponses à Jeanne en français ; code/identifiants en anglais.

---

## File Structure

Nouveau dossier `client/src/pages/outreach/` :
- `channels.ts` — **Create** : meta canal (id, label, icône lucide, classes de couleur JMD) + helper `channelMeta(channel)`. Pure, testé.
- `types.ts` — **Create** : types partagés UI (`SequenceStepDTO`, `PreviewResponse`, `StepAnalytics`, `CampaignDTO`, `Lead` réexporté).
- `useOutreach.ts` — **Create** : hooks react-query (`useCampaigns`, `useLeads`, `useProspectionStatus`, `useCampaign(id)`, `useSequence(id)`, `usePreview(id, leadId)`, `useAnalytics(id)`) + mutations (`useSaveSequence`, `useGenerateSequence`, `useLaunchCampaign`, `useUpdateLead`, …).
- `OutreachHome.tsx` — **Create** : page `/outreach` (shell + en-tête + accès bar + onglets Campagnes/Pipeline).
- `CampaignsGrid.tsx`, `CampaignCard.tsx` — **Create** : grille de cartes campagne.
- `PipelineBoard.tsx`, `LeadCard.tsx` — **Create** : kanban repensé (extraits/refondus depuis l'ancien).
- `CampaignWorkspace.tsx` — **Create** : page `/outreach/campaigns/:id` (shell + 4 sous-onglets).
- `SequenceTab.tsx`, `SequenceTimeline.tsx`, `SequenceStepCard.tsx` — **Create** : timeline visuelle + éditeur.
- `PreviewTab.tsx` — **Create** : aperçu deux volets.
- `ProspectsTab.tsx` — **Create** : prospects de la campagne (réutilise `LeadCard`).
- `ResultsTab.tsx` — **Create** : analytics par étape/canal.
- `LeadDetail.tsx`, `AuditView.tsx` — **Create** : fiche prospect (Sheet) + audit structuré.
- `dialogs/` — **Move** : `LeadFinderDialog`, `CampaignForm`, `AddLeadForm`, `ProspectionAccessBar` extraits de l'ancien fichier, quasi tels quels.
- `client/src/pages/outreach.tsx` — **Modify (final)** : devient un ré-export mince de `outreach/OutreachHome` (compat de l'import existant), l'ancien `SequenceEditorDialog` supprimé.
- `client/src/App.tsx` — **Modify** : ajouter la route `/outreach/campaigns/:id`.

---

## Task 1: Fondations — helper canaux, types, hooks, route

**Files:**
- Create: `client/src/pages/outreach/channels.ts`, `client/src/pages/outreach/channels.test.ts`, `client/src/pages/outreach/types.ts`, `client/src/pages/outreach/useOutreach.ts`
- Modify: `client/src/App.tsx` (nouvelle route + lazy import stub)
- Create (stub): `client/src/pages/outreach/CampaignWorkspace.tsx` (placeholder pour que la route compile)

**Interfaces produced:**
- `type ChannelId = "email" | "linkedin"`
- `channelMeta(channel: string): { id: ChannelId; label: string; Icon: LucideIcon; dot: string; chip: string; text: string }` — `dot`/`chip`/`text` = classes Tailwind (email → soufre, linkedin → salvia).
- `types.ts` : `SequenceStepDTO = { id:number; stepOrder:number; channel:string; delayDays:number; intention:string|null; condition:string; subjectTemplate:string|null; bodyTemplate:string|null }`; `PreviewStep = { stepOrder:number; channel:string; delayDays:number; intention:string|null; condition:string; subject:string|null; body:string|null; error:boolean }`; `PreviewResponse = { lead:{id:number;name:string;company:string}; steps:PreviewStep[] }`; `StepAnalytics = { byStep:{stepOrder:number;channel:string;sent:number;opened:number;clicked:number;bounced:number}[]; byChannel:{channel:string;sent:number;replied:number}[]; sent:number;opened:number;replied:number;bounced:number;openRate:number;replyRate:number;bounceRate:number }`; `CONDITION_LABELS: Record<string,string>` (FR : `always`→"toujours", `if_opened`→"si email ouvert", `if_not_opened`→"si email non ouvert", `if_clicked`→"si lien cliqué", `if_invite_accepted`→"si invitation acceptée", `if_invite_not_accepted`→"si invitation non acceptée").
- `useOutreach.ts` : the hooks listed in File Structure, thin wrappers over `useQuery`/`useMutation`. `useGenerateSequence` mutation returns `{ rationale:string; steps:SequenceStepDTO[] }` (⚠️ the server now returns this object shape, NOT a bare array — this is the shape the whole UI relies on).

- [ ] **Step 1: Write the failing test for `channelMeta`**

`client/src/pages/outreach/channels.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { channelMeta } from "./channels";
describe("channelMeta", () => {
  it("maps linkedin to salvia + Linkedin icon", () => {
    const m = channelMeta("linkedin");
    expect(m.id).toBe("linkedin");
    expect(m.label).toBe("LinkedIn");
    expect(m.dot).toContain("salvia");
    expect(m.Icon).toBeTypeOf("function");
  });
  it("maps email to sulphur", () => {
    const m = channelMeta("email");
    expect(m.id).toBe("email");
    expect(m.label).toBe("Email");
  });
  it("defaults unknown channel to email", () => {
    expect(channelMeta("sms").id).toBe("email");
  });
});
```

- [ ] **Step 2: Run it → FAIL**

Run: `npm test -- channels`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `channels.ts`**

```ts
import { Mail, Linkedin, type LucideIcon } from "lucide-react";

export type ChannelId = "email" | "linkedin";

type Meta = { id: ChannelId; label: string; Icon: LucideIcon; dot: string; chip: string; text: string };

const EMAIL: Meta = {
  id: "email", label: "Email", Icon: Mail,
  dot: "bg-[#D4C97A]", chip: "bg-[#D4C97A]/15 text-naya-olive border border-[#D4C97A]/40", text: "text-naya-olive",
};
const LINKEDIN: Meta = {
  id: "linkedin", label: "LinkedIn", Icon: Linkedin,
  dot: "bg-naya-salvia", chip: "bg-naya-salvia/15 text-naya-salvia border border-naya-salvia/40", text: "text-naya-salvia",
};

export function channelMeta(channel: string): Meta {
  return channel === "linkedin" ? LINKEDIN : EMAIL;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npm test -- channels`
Expected: PASS.

- [ ] **Step 5: Write `types.ts` and `useOutreach.ts`**

`types.ts`: the interfaces from "Interfaces produced" above (plus `CONDITION_LABELS`). `useOutreach.ts`: thin hooks. Example (match the codebase's real patterns):
```ts
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SequenceStepDTO, PreviewResponse, StepAnalytics } from "./types";

export const useCampaigns = () => useQuery<any[]>({ queryKey: ["/api/prospection/campaigns"] });
export const useCampaign = (id: number) =>
  useQuery<any>({ queryKey: ["/api/prospection/campaigns"], select: (all) => all.find((c: any) => c.id === id) });
export const useSequence = (id: number) =>
  useQuery<SequenceStepDTO[]>({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] });
export const usePreview = (id: number, leadId: number | null) =>
  useQuery<PreviewResponse>({ queryKey: [`/api/prospection/campaigns/${id}/preview?leadId=${leadId}`], enabled: leadId != null });
export const useAnalytics = (id: number) =>
  useQuery<StepAnalytics>({ queryKey: [`/api/prospection/campaigns/${id}/analytics`] });

export const useGenerateSequence = (id: number) => useMutation({
  mutationFn: () => apiRequest("POST", `/api/prospection/campaigns/${id}/generate-sequence`).then((r) => r.json()),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] }),
});
export const useSaveSequence = (id: number) => useMutation({
  mutationFn: (steps: Partial<SequenceStepDTO>[]) => apiRequest("PUT", `/api/prospection/campaigns/${id}/sequence`, { steps }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/prospection/campaigns/${id}/sequence`] }),
});
export const useLaunchCampaign = (id: number) => useMutation({
  mutationFn: () => apiRequest("POST", `/api/prospection/campaigns/${id}/launch`),
});
```
> Verify the exact PUT `/sequence` body the server expects (read `server/routes.ts` PUT handler ~line 6940) and match it (it sanitizes channel + re-numbers stepOrder). If the shape differs, adapt.

- [ ] **Step 6: Add the route + workspace stub**

`CampaignWorkspace.tsx` stub: a component `export default function CampaignWorkspace({ id }: { id: number }) { return <div>Campagne {id}</div>; }`.
In `client/src/App.tsx`: add `const CampaignWorkspace = lazy(() => import("@/pages/outreach/CampaignWorkspace"));` and, inside the authed `<Switch>`, BEFORE the catch-all, add:
```tsx
<Route path="/outreach/campaigns/:id">
  {(params) => <CampaignWorkspace id={Number(params.id)} />}
</Route>
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit` (clean) and `npm run build` (succeeds).
```bash
git add client/src/pages/outreach/ client/src/App.tsx
git commit -m "feat(outreach-ui): fondations — helper canaux, types, hooks, route workspace"
```

---

## Task 2: OutreachHome — shell + onglets Campagnes / Pipeline

**Files:**
- Create: `client/src/pages/outreach/OutreachHome.tsx`
- Move: `client/src/pages/outreach/dialogs/ProspectionAccessBar.tsx` (extrait de l'ancien `outreach.tsx:540-575`, inchangé)
- Modify (final step): keep old `outreach.tsx` working meanwhile

**Interfaces produced:** `OutreachHome` (default) — the `/outreach` page. Consumes `useCampaigns`, `useLeads`, `useProspectionStatus`.

- [ ] **Step 1: Build the shell**

Reproduce the page shell (`flex h-screen bg-background` + `<Sidebar onSearchClick={onSearchClick} />` + `flex-1 flex flex-col overflow-hidden` + a `bg-white border-b border-border px-6 py-4` header with `h1` `text-2xl font-bold` = "Prospection"). Render `<ProspectionAccessBar status={prospectionStatus} />` under the header. Props: `{ onSearchClick?: () => void }` (threaded to Sidebar, matching the old signature).

- [ ] **Step 2: Two entry tabs with shadcn Tabs**

Replace the hand-rolled buttons with the shadcn `Tabs` component (`@/components/ui/tabs`): `<Tabs defaultValue="campaigns">` with `TabsList` (`Campagnes`, `Pipeline`) and two `TabsContent`. `Campagnes` renders `<CampaignsGrid />` (Task 3), `Pipeline` renders `<PipelineBoard />` (Task 8). For THIS task, use placeholders (`<div>…</div>`) for those two children so the tab shell is testable independently; Tasks 3 and 8 fill them.

- [ ] **Step 3: Wire the page into routing (swap)**

Point `client/src/pages/outreach.tsx` to re-export the new home so the existing `/outreach` route keeps working:
```tsx
export { default } from "./outreach/OutreachHome";
```
Keep the OLD component code available temporarily only if needed for reference; the route now renders `OutreachHome`. (The old inline board/campaign code will be reused/migrated in Tasks 3 & 8 — copy what you need into the new components rather than importing from the deleted structure.)

- [ ] **Step 4: Verify + commit**

`npx tsc --noEmit` clean, `npm run build` ok. Manually confirm `/outreach` renders the header + access bar + two tabs (placeholders inside).
```bash
git add client/src/pages/outreach/ client/src/pages/outreach.tsx
git commit -m "feat(outreach-ui): accueil Outreach — shell + onglets Campagnes/Pipeline (shadcn Tabs)"
```

---

## Task 3: CampaignsGrid + CampaignCard

**Files:** Create `client/src/pages/outreach/CampaignsGrid.tsx`, `CampaignCard.tsx`; Move `dialogs/CampaignForm.tsx` (from old `outreach.tsx:1308-1421`).

**Interfaces produced:** `CampaignsGrid` (grid + "Nouvelle campagne" via CampaignForm dialog); `CampaignCard({ campaign, leadCount })` — a `Card` navigating to `/outreach/campaigns/:id` on click.

- [ ] **Step 1: CampaignCard**

Use shadcn `Card`. Show: campaign name (`font-semibold`), status badge, sector/offer meta (`text-sm text-muted-foreground`), **channel chips** (from `channelMeta`, derived from the campaign's sequence channels if available else `campaign.channel`), a **prospect count** (`leadCount`), and a small progress hint (e.g. `X prêts / Y prospects` using leads at `stage==='messages_ready'`). Whole card is a Wouter `<Link href={`/outreach/campaigns/${campaign.id}`}>`. Hover: `shadow-rest`/`hover:border-naya-olive-18`.

- [ ] **Step 2: CampaignsGrid**

Responsive grid (`grid gap-4 sm:grid-cols-2 xl:grid-cols-3`). Header row with a "Nouvelle campagne" button opening `CampaignForm` (reuse the moved dialog). Compute `leadCount` per campaign from `useLeads()` grouped by `prospectionCampaignId`. Empty state: a friendly card ("Crée ta première campagne").

- [ ] **Step 3: Wire into OutreachHome** (replace the Campagnes placeholder).

- [ ] **Step 4: Verify + commit**

`tsc` clean, `build` ok, `/outreach` Campagnes tab shows real cards, clicking one navigates to `/outreach/campaigns/:id` (the stub for now).
```bash
git add client/src/pages/outreach/
git commit -m "feat(outreach-ui): grille de cartes campagne + navigation vers l'espace campagne"
```

---

## Task 4: CampaignWorkspace — coquille + 4 sous-onglets

**Files:** Modify `client/src/pages/outreach/CampaignWorkspace.tsx` (replace stub).

**Interfaces produced:** `CampaignWorkspace({ id })` — shell (Sidebar + header with campaign name + back `<Link href="/outreach">`) and shadcn `Tabs` with 4 `TabsContent`: **Séquence** (`<SequenceTab campaignId={id}/>`), **Prospects** (`<ProspectsTab campaignId={id}/>`), **Aperçu** (`<PreviewTab campaignId={id}/>`), **Résultats** (`<ResultsTab campaignId={id}/>`). Placeholders for the four children in THIS task.

- [ ] **Step 1:** Build shell + header (campaign name via `useCampaign(id)`; loading `Skeleton`; if campaign missing → message + back link). Back link + a `CalendarDays`/`Users` summary line (channels, prospect count).
- [ ] **Step 2:** shadcn `Tabs defaultValue="sequence"` with the 4 tabs; children = placeholders.
- [ ] **Step 3:** Verify `tsc`/`build`; navigating to a campaign shows the 4 tabs. Commit `feat(outreach-ui): espace campagne à 4 sous-onglets (coquille)`.

---

## Task 5: SequenceTab + SequenceTimeline + SequenceStepCard (pièce maîtresse)

**Files:** Create `SequenceTab.tsx`, `SequenceTimeline.tsx`, `SequenceStepCard.tsx`.

**Interfaces produced:** `SequenceTab({ campaignId })`. Uses `useSequence`, `useGenerateSequence`, `useSaveSequence`.

- [ ] **Step 1: Rationale banner + "Repenser (IA)"**

Top band: a `Sparkles` icon + "Plan conçu par Naya" + the `rationale` text (from the last generate response, held in local state; if none, a muted hint). A `Repenser (IA)` button calling `useGenerateSequence` (spinner while pending; on success set rationale + the query refetches steps). ⚠️ Read `gen.rationale` and `gen.steps` from the object (NOT a bare array — the old code's `Array.isArray(gen)` assumption is wrong and must not be reproduced).

- [ ] **Step 2: SequenceTimeline (vertical rail)**

Render steps ordered by `stepOrder` as a vertical timeline: a left rail (`border-l-2 border-naya-olive-18`) with a channel **dot** (`channelMeta(step.channel).dot`) per node, and `SequenceStepCard` to the right. Between/below: an "Ajouter une étape" button (adds a default step). The timeline is the stable "plan view" — it shows **intention**, not message text.

- [ ] **Step 3: SequenceStepCard**

Per step: channel chip (`channelMeta`), a `Select` to change channel (email/linkedin), a numeric delay input (`J+{delayDays}`), an `intention` text input, a **condition** `Select` (options from `CONDITION_LABELS`) rendered as a small badge when not `always`, and remove/reorder controls (up/down buttons are enough — no DnD required here). Editing updates local draft state.

- [ ] **Step 4: Save**

A "Enregistrer" button (disabled when no changes) calling `useSaveSequence` with the edited steps; toast on success/error. Re-number `stepOrder` on save. On load, seed the draft from `useSequence`.

- [ ] **Step 5: Wire into CampaignWorkspace; verify + commit**

`tsc`/`build` clean; the Séquence tab shows the timeline, can generate via IA, edit channels/conditions/timing, and save.
```bash
git commit -m "feat(outreach-ui): timeline de séquence visuelle (canaux, intentions, branches) + génération IA"
```

---

## Task 6: PreviewTab — aperçu par vrai prospect (demande n°1)

**Files:** Create `PreviewTab.tsx`.

**Interfaces produced:** `PreviewTab({ campaignId })`. Uses `useLeads` (filtered to this campaign), `usePreview(campaignId, leadId)`, `useLaunchCampaign`.

- [ ] **Step 1: Two-pane layout**

Left pane: searchable list of this campaign's prospects (name, company, score badge), plus a "Prospect au hasard" button. Selecting a prospect sets `leadId`. Right pane: the rendered sequence for that prospect.

- [ ] **Step 2: Rendered sequence (right pane)**

For the selected lead, call `usePreview`. Render each `PreviewStep` in the timeline style: channel chip + `J+{delayDays}` + intention, then the **real message** — `subject` (email) in bold + `body`. If `step.error` (generation failed) show a muted "Message indisponible" + a "Régénérer" affordance. Loading → `Skeleton` rows (generation can take a few seconds). Per message: **Copier** (clipboard), and a **Régénérer**/**Éditer** affordance (Régénérer can re-fetch by invalidating the preview query key; Éditer can be a follow-up — a read-only + copy is the minimum for this task, note if you defer edit).

- [ ] **Step 3: "Lancer la campagne" CTA**

At the bottom, a prominent `bg-primary text-primary-foreground` button "Lancer la campagne" calling `useLaunchCampaign`, guarded by an `AlertDialog` confirm ("Naya enrôlera tous les prospects et commencera la séquence."). Toast on success. (Sending stays inert server-side until the kill-switch is on — that's expected; the button enrolls.)

- [ ] **Step 4: Verify + commit**

`tsc`/`build` clean; selecting a real prospect renders their bespoke messages. Commit `feat(outreach-ui): aperçu de séquence par vrai prospect (vrais messages) + lancer la campagne`.

---

## Task 7: ResultsTab — analytics par étape / canal

**Files:** Create `ResultsTab.tsx`.

**Interfaces produced:** `ResultsTab({ campaignId })`. Uses `useAnalytics`.

- [ ] **Step 1: Totals row**

A row of stat tiles (reuse the `Metric` style or shadcn `Card`): Envoyés / Ouvertures % / Réponses % / Bounces % from the flat totals. Empty state when `sent === 0` ("Pas encore de données — lance la campagne").

- [ ] **Step 2: By-step breakdown**

For each `byStep` entry (ordered), a row: step label (`Étape {stepOrder}`), channel chip, and small horizontal bars or counters for sent/opened/clicked/bounced. Use channel colors from `channelMeta`. Keep it readable (no chart lib needed; simple bars with `naya-*` fills).

- [ ] **Step 3: By-channel breakdown**

Two compact cards (Email / LinkedIn) with sent + replied per channel.

- [ ] **Step 4: Verify + commit** (`tsc`/`build`). Commit `feat(outreach-ui): onglet Résultats — analytics par étape et par canal`.

---

## Task 8: PipelineBoard + LeadCard (kanban repensé)

**Files:** Create `PipelineBoard.tsx`, `LeadCard.tsx` (refonte de l'ancien `outreach.tsx:286-417` board + `579-656` card). Move `dialogs/AddLeadForm.tsx`, `dialogs/LeadFinderDialog.tsx`.

**Interfaces produced:** `PipelineBoard` (global kanban across campaigns) + `LeadCard`. Preserve the existing drag-and-drop stage change (`PATCH /api/leads/:id`), search + campaign filter, bulk-select actions (move/archive) — this logic already exists in the old file; carry it over, don't rebuild from scratch.

- [ ] **Step 1: Board**

Keep the 10 `STAGES` columns and the native HTML5 drag-drop (`draggable`, `onDragStart/onDrop`) exactly as the old board did (copy the handlers). Columns styled with `naya-*` tokens. Keep the filter bar (search + campaign select) and the bulk-action bar (select, move-to-campaign, archive) from the old code.

- [ ] **Step 2: LeadCard redesign**

Card shows: avatar, name/company/role, **campaign color badge**, score badge, and NEW: a **channel icon + step progress** hint ("LinkedIn · étape 2/4") when the lead is enrolled — derive from the lead's sequence state if exposed; if that data isn't already on the lead payload, show what's available (channel from campaign) and note the limitation (do NOT add a backend endpoint — flag if richer data is needed). Keep the hover "Enrichir" action. Click opens `LeadDetail` (Task 9).

- [ ] **Step 3: Wire into OutreachHome Pipeline tab; verify + commit**

`tsc`/`build` clean; drag-drop still changes stage; filters + bulk actions work. Commit `feat(outreach-ui): kanban pipeline repensé (canal + progression d'étape) + actions groupées`.

---

## Task 9: LeadDetail + AuditView (fiche prospect repensée)

**Files:** Create `LeadDetail.tsx`, `AuditView.tsx` (refonte de l'ancien `outreach.tsx:672-909`).

**Interfaces produced:** `LeadDetail({ lead, open, onOpenChange })` — a shadcn `Sheet` with 3 tabs: **Profil · Audit · Séquence**. `AuditView({ auditNotes })` renders the structured audit.

- [ ] **Step 1: Profil tab** — social links, stage `Select` (PATCH), company/role/sector fields (reuse the old `InfoField`). Enrich button (reuse existing `POST /api/leads/:id/enrich`, keep the 403 handling from the old code).
- [ ] **Step 2: AuditView** — parse `auditNotes` (JSON string or object) and render each section with a humanized label (reuse the old `AUDIT_LABELS` map at `outreach.tsx:661-667`), the "angle" section always last/highlighted. Fallback to raw text if not JSON.
- [ ] **Step 3: Séquence tab** — show this lead's sequence steps + their status (use what's available; if per-lead step status isn't in the payload, show the campaign plan + a note). Keep the existing per-lead messages (linkedinMessage/emailMessage) copy affordance for continuity.
- [ ] **Step 4: Verify + commit** (`tsc`/`build`). Commit `feat(outreach-ui): fiche prospect repensée (Profil/Audit structuré/Séquence)`.

---

## Task 10: Nettoyage + cohérence visuelle

**Files:** Modify `client/src/pages/outreach.tsx` (thin re-export only), delete dead code (old `SequenceEditorDialog`, old inline board/card/detail now migrated). Sweep components for token consistency.

- [ ] **Step 1:** Confirm `outreach.tsx` is only `export { default } from "./outreach/OutreachHome";` and that no dead inline components remain referenced. Remove the old `SequenceEditorDialog` (replaced by the timeline).
- [ ] **Step 2: Consistency sweep** — across the new `outreach/` components, replace stray hardcoded RGBA/hex (e.g. `bg-[rgba(158,126,135,0.12)]`, `text-[#5c3d45]`) with the `naya-*` tokens; ensure every channel color goes through `channelMeta`; ensure dark buttons use `bg-primary text-primary-foreground` (no `.text-white`). Ensure headers/bands match the shell convention (`px-6`, `border-b border-border`, `bg-white`).
- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean, `npm run build` ok, full `npm test` green. Manually walk: `/outreach` → Campagnes → open a campaign → the 4 tabs → generate a sequence → preview a prospect → Pipeline drag. 
- [ ] **Step 4: Commit** `refactor(outreach-ui): retire l'ancien monolithe, cohérence des tokens JMD`.

---

## Self-Review

**Spec coverage (spec §3-§8):** §3 architecture 4 sous-onglets → Tasks 4-7. §4 timeline de séquence visuelle → Task 5. §5 aperçu par prospect → Task 6. §6 intelligence de canal (UI de surcharge + rationale + conditions) → Task 5. §7 kanban + fiche repensés → Tasks 8-9. §8 résultats → Task 7. Langage visuel JMD + canaux couleur → Task 1 (source unique) + Task 10 (sweep). Décomposition du monolithe → Tasks 2-10.

**Placeholder scan:** Visual JSX is intentionally described by responsibility + data contract + tokens rather than pixel-complete markup (UI craft is delegated to implementers using frontend-design within these constraints). All DATA contracts, endpoints, hook signatures, the channel helper, and the `{rationale, steps}` response-shape fix are concrete. No "TBD".

**Type consistency:** `channelMeta`/`ChannelId` (Task 1) used by Tasks 3,5,6,7,8. `SequenceStepDTO`/`PreviewResponse`/`StepAnalytics`/`CONDITION_LABELS` (Task 1) consumed by Tasks 5,6,7. `useGenerateSequence` returns `{rationale, steps}` everywhere (fixes the old bare-array bug). Route `/outreach/campaigns/:id` (Task 1) consumed by CampaignCard (Task 3) and CampaignWorkspace (Task 4).

**Known cross-cutting risks flagged for implementers:** (a) per-lead sequence *status* may not be in the current lead payload — Tasks 8/9 must show what's available and flag (not invent a backend endpoint); (b) verify the PUT `/sequence` body shape against the server handler; (c) do not reproduce the old `Array.isArray(gen)` assumption on generate.
