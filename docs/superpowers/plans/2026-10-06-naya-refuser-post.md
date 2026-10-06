# Refuser un post — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuser un post du calendrier, expliquer pourquoi (préférence de la marque), le supprimer et, au choix, le remplacer par un post généré jamais publié seul.

**Architecture:** Même découpage que `server/services/refus/` (refus de tâche) : `server/services/refus-post/{pur,remplacement,service,deps}.ts`, route mince, composant `RefusPostModal`.

**Tech Stack:** Express, Drizzle, TypeScript, Vitest, React + TanStack Query + react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-06-naya-refuser-post-design.md`

## Global Constraints

- Raisons (exactement) : `wrong_tone`, `wrong_angle`, `not_for_brand`, `too_many`, `inaccurate`, `other` ; libellés FR : « pas le bon ton », « mauvais angle », « pas pour cette marque », « trop de posts », « inexact », « autre ». Autre valeur → 400 `invalid_reason`.
- Post publié (`contenuEstPublie` de `server/services/campaign-reject/rejeter.ts`) ou `postStatus` ∈ {`uploading`,`processing`,`posting`} → 409 `already_published`, **aucune écriture**.
- Souvenir : `memory_entries` `fil: "cap"`, `entryType: "préférence"`, `projectId` du post (null accepté), `salience: 0.8`, embedding best-effort ; écrit si explication non vide OU raison ≠ `other`. Texte `Post refusé (<réseau>, <pilier>) « <titre ≤80> » — <raison lisible>` + ` : <explication ≤1500>` si présente.
- Remplacement : `autoPost: false` **toujours**, `postStatus: "pending"`, `status: "draft"`, `contentStatus: "idea"` ; reprend `userId, projectId, campaignId, socialAccountId, platform, contentType, pillar, goal, intent, scheduledFor, postFormat` ; `title` ≤ 200, `body` ≤ 5000.
- `remplacer` absent → `true` ; non booléen → 400 `invalid_replace`.
- Le post refusé est supprimé dès que le refus est valide (même si génération ou création échouent).
- Jamais de levée après la lecture/contrôles ; étapes best-effort journalisées `[refus-post] …`.
- UI via `t()` (FR + EN), gardes i18n vertes. Tests avec `DATABASE_URL=postgresql://test:test@127.0.0.1:1/test`, `npx tsc --noEmit` à zéro, `npx vite build` OK. Commits en français + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Jamais de push**, aucune vraie base.

## Review Focus

- **Post de campagne sans `projectId`** : souvenir avec projectId null, remplacement sans projet. → test service.
- **Post en cours de publication (`processing`)** : refus impossible, rien d'écrit. → test service.
- **Case « remplacer » décochée** : aucun appel IA. → test service.
- **Explication vide + raison `other`** : aucun souvenir (rien à apprendre). → test pur + service.
- **Échec de requête côté client** : la fenêtre garde raison, explication et case. → Task 4.

---

### Task 1 : Pur + génération

**Files:** Create `server/services/refus-post/pur.ts` (+ test), `server/services/refus-post/remplacement.ts` (+ test).

**Produces:**
```ts
export const RAISONS_REFUS_POST = ["wrong_tone","wrong_angle","not_for_brand","too_many","inaccurate","other"] as const;
export type RaisonRefusPost = typeof RAISONS_REFUS_POST[number];
export function estRaisonRefusPost(x: unknown): x is RaisonRefusPost;
export function libelleRaisonPost(r: RaisonRefusPost): string;
export function texteSouvenirPost(p: { platform?: string|null; pillar?: string|null; title?: string|null }, r: RaisonRefusPost, explication?: string|null): string | null;
export function estPublieOuEnCours(c: { publishedAt?: unknown; postStatus?: string|null; contentStatus?: string|null }): boolean;
export interface PostRemplacement { title: string; body: string }
export function validerPostRemplacement(brut: unknown): PostRemplacement | null;
export async function genererPostRemplacement(input: { userId: string; post: { projectId?: number|null; platform?: string|null; contentType?: string|null; pillar?: string|null; goal?: string|null; title?: string|null; body?: string|null }; raison: RaisonRefusPost; explication?: string|null }): Promise<PostRemplacement | null>; // in remplacement.ts, never throws
```
- `estPublieOuEnCours` réutilise `contenuEstPublie` + `postStatus` en cours.
- Génération : `callClaudeWithContext` (`server/services/claude.ts`, `CLAUDE_MODELS.fast`, `projectId` du post, `max_tokens` ~1500) ; préférences via `preferencesDeLaMarque(userId, projectId)` + `formaterPreferences` (`server/services/campaign-reject/preferences.ts` ; si `projectId` null → aucune) ; clôtures ``` retirées localement ; `validerPostRemplacement` ; garde de langue `imposerLangueDuCompte([{ title, description: body }], userId)` puis recopie ; aucune consigne de langue en dur (`server/language-guard.test.ts`).
- [ ] Tests (TDD) des fonctions pures et de la génération (mocks `../claude`, `../garde-langue`, `../campaign-reject/preferences`) ; commit(s).

### Task 2 : Service + deps réelles

**Files:** Create `server/services/refus-post/service.ts` (+ test), `server/services/refus-post/deps.ts`.

**Produces:** `refuserPost(deps, { userId, contentId, raison, explication, remplacer }) → { statut: "introuvable" } | { statut: "deja_publie" } | { statut: "refuse"; remplacement: Record<string, unknown> | null; raison?: "generation_failed" }`.
Deps : `lirePost(id)`, `ecrireSouvenir({ userId, projectId, texte })`, `generer(...)`, `creerPost(row)`, `supprimerPost(id)`. Réel : `storage.getContentById`/équivalent (grep), insert `memoryEntries` comme `campaign-reject/rejeter.ts` (fil `cap`), `genererPostRemplacement`, `storage.createContent`, `storage.deleteContent`.
- [ ] Tests (fakes) couvrant spec + Review Focus ; commit.

### Task 3 : Route

**Files:** Modify `server/routes.ts`. Create `server/routes.refus-post.test.ts`.
- [ ] `POST /api/content/:id/refuser` : 400 `invalid_content_id` / `invalid_reason` / `invalid_free_text` / `invalid_replace` ; 404 ; 409 `already_published` ; 200 `{ refuse: true, remplacement, raison? }` ; 500 `refus_failed`. Explication trimée, vide → null. Tests de route (harnais `server/routes.task-lock.test.ts`, mock du service). Commit.

### Task 4 : Interface

**Files:** Create `client/src/components/refus-post-modal.tsx`, `client/src/hooks/useRefuserPost.ts`, `client/src/lib/refus-post-api.ts`. Modify `client/src/pages/content-calendar.tsx` (`ContentCard`), `client/src/locales/fr.ts`, `en.ts` (section `refusPost`).
- [ ] Modal (raisons, explication, case remplacer cochée par défaut, libellés d'attente), état conservé en cas d'échec, remis à zéro à la fermeture ; bouton « Refuser » sur `ContentCard` masqué si publié/en cours ; toasts ; invalidations `/api/content*` et `/api/campaigns*`.
- [ ] Clés FR/EN : `refuse` (« Refuser » / « Decline »), `title` (« Refuser ce post » / « Decline this post »), raisons (6), `explainLabel` (« Explique à Naya pourquoi » / « Tell Naya why »), `explainPlaceholder` (« Ex. : trop institutionnel, je parle plus directement à mes clientes. » / « e.g. too corporate, I talk more directly to my clients. »), `replace` (« Remplace-le par un autre post » / « Replace it with another post »), `confirm` (« Refuser » / « Decline »), `confirmReplace` (« Refuser et remplacer » / « Decline and replace »), `pending` (« Naya rédige un autre post… » / « Naya is writing another post… »), `refused` (« Post refusé. » / « Post declined. »), `replacedBy` (« Remplacé par « {{title}} » » / « Replaced by “{{title}}” »), `noReplacement` (« Post refusé. Naya n'a pas pu en proposer un autre pour l'instant. » / « Post declined. Naya couldn't suggest another one right now. »), `alreadyPublished` (« Ce post est déjà publié. » / « This post is already published. »), `failed` (« Le refus a échoué. Réessaie. » / « Declining failed. Try again. »).
- [ ] tsc, gardes i18n, suite, build ; commit.
