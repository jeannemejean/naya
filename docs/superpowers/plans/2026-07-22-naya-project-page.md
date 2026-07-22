# Page projet + tâches contextualisées — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. UI tasks SHOULD apply frontend-design craft within the tokens/structure defined here.

**Goal:** Une page projet `/projects/:id` (résumé factuel + « point Naya » à la demande + saisie note/stade), et surtout faire remonter le contexte projet (statut, stade, jalons) à la génération de tâches pour qu'elle soit enfin pertinente.

**Architecture:** Frontend = nouvelle route Wouter + `client/src/pages/project/ProjectPage.tsx` (réutilise `GET /api/projects/:id` qui renvoie déjà `{project, goals, strategyProfile}`, `MilestoneRoadmap`, les tokens JMD). Backend = 1 endpoint d'écriture du stade (`current_stage` existe déjà en base), 1 endpoint « point Naya » (`callClaudeWithContext`), et le recâblage de la génération de tâches sur `buildNayaContext`. **Aucune migration.**

**Tech Stack:** React + TS + Vite + Wouter + TanStack Query (query key = URL, cookies) + shadcn/ui + Tailwind (`naya-*`) + lucide-react ; Express + Drizzle ; Anthropic Claude via `server/services/claude.ts` ; Vitest.

## Global Constraints

- Réponses à Jeanne en français ; **code/identifiants en anglais**.
- Appels IA : passer par `callClaudeWithContext({ userId, projectId, userMessage, model?, max_tokens?, temperature?, additionalSystemContext? })` (injecte `buildNayaContext`) ou `callClaude` selon le cas ; toujours `userId` (imputation coût). Respecter le **plafond de coût IA** : vérifier `isAiBlocked(userId)` (`server/services/usage.ts`) avant un appel déclenché par l'utilisateur → renvoyer **429 `ai_monthly_limit_reached`** (message SANS montant, cf. règle produit).
- **Aucune migration de schéma** : `project_strategy_profiles.current_stage` (`shared/schema.ts:104`, enum `ideation|early|growth|mature`) et `projects.status_note` existent déjà. Ne rien ajouter en base.
- Data client : `useQuery({ queryKey: ['/api/...'] })` (clé = URL) ; mutations via `apiRequest(method, url, data)` de `@/lib/queryClient` + `queryClient.invalidateQueries`.
- Routing : Wouter, route dans `client/src/App.tsx` (branche authentifiée `isAuthenticated && hasAccess`), forme render-prop `<Route path="/projects/:id">{(p) => <ProjectPage id={Number(p.id)} .../>}</Route>`.
- Naviguer vers la page NE DOIT PAS casser le « projet actif » : continuer à appeler `setActiveProjectId(id)` (contexte `useProject()`) en plus de la navigation.
- Patte JMD : tokens `naya-*`, `bg-primary`/`text-primary-foreground` pour les boutons sombres, **jamais `.text-white`**. lucide-react.
- Tests : Vitest (`npm test`), sortie pristine ; `npx tsc --noEmit` clean ; `npm run build` OK. Commits fréquents.
- On travaille sur la branche `feat/project-page` (déjà créée).

---

## File Structure

- `server/routes.ts` — **Modify** : `PATCH /api/projects/:id/strategy-profile` (écriture `currentStage`) ; `POST /api/projects/:id/situation` (point Naya).
- `server/storage.ts` — **Modify** : `updateProjectStrategyProfileFields(projectId, patch)` (upsert partiel, ne pas écraser les autres champs).
- `server/services/goal-tasks.ts` — **Modify** : router `generateTasksForGoal` via `callClaudeWithContext`.
- `server/services/auto-planner.ts` — **Modify** : enrichir la struct `projectContext` (statusNote + résumé jalons).
- `server/services/project-summary.ts` — **Create** : helper pur `summarizeMilestones(milestones)` (compteurs faits/en cours/à venir) + `buildSituationPrompt(...)`. Testé.
- `client/src/App.tsx` — **Modify** : route `/projects/:id`.
- `client/src/pages/project/ProjectPage.tsx` — **Create** : la page (shell + sections).
- `client/src/pages/project/ProjectSummaryBar.tsx` — **Create** : bandeau factuel + bouton « point Naya ».
- `client/src/pages/project/ProjectContextEditor.tsx` — **Create** : note libre + sélecteur de stade.
- `client/src/pages/project/useProjectPage.ts` — **Create** : hooks (project, milestones, situation, save stage/note).
- `client/src/components/sidebar.tsx`, `client/src/pages/dashboard.tsx` — **Modify** : clic projet → navigation `/projects/:id`.
- Réutilisés tels quels : `MilestoneRoadmap` (`client/src/pages/projects.tsx:561-657`).

---

## Task 1: Backend — écriture du stade du projet

**Files:** Modify `server/storage.ts`, `server/routes.ts`. Test: `server/services/project-stage.test.ts`.

**Interfaces produced:**
- `storage.updateProjectStrategyProfileFields(projectId: number, patch: Partial<InsertProjectStrategyProfile>): Promise<ProjectStrategyProfile>` — upsert qui ne met à jour QUE les champs fournis.
- `PATCH /api/projects/:id/strategy-profile` body `{ currentStage }` → 200 `{ strategyProfile }`, 404 si pas le projet de l'user, 400 si stade invalide.
- Pure `isValidStage(s: string): boolean` (enum `ideation|early|growth|mature`) dans `server/services/project-summary.ts` (créé Task 4) — OU inline ; ici on teste la validation.

- [ ] **Step 1: Test de validation (échec)**

`server/services/project-stage.test.ts` :
```typescript
import { describe, it, expect } from "vitest";
import { isValidStage } from "./project-summary";
describe("isValidStage", () => {
  it("accepte les 4 stades", () => {
    for (const s of ["ideation","early","growth","mature"]) expect(isValidStage(s)).toBe(true);
  });
  it("rejette le reste", () => {
    expect(isValidStage("croissance")).toBe(false);
    expect(isValidStage("")).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer → échec** — `npm test -- project-stage` → FAIL (module absent). (Le fichier `project-summary.ts` est créé ici avec `isValidStage`, le reste des helpers en Task 4.)

- [ ] **Step 3: Créer `server/services/project-summary.ts` avec `isValidStage`**
```typescript
export const PROJECT_STAGES = ["ideation", "early", "growth", "mature"] as const;
export function isValidStage(s: string): boolean {
  return (PROJECT_STAGES as readonly string[]).includes(s);
}
```

- [ ] **Step 4: Storage — upsert partiel**

Dans `server/storage.ts` (interface + classe), à côté de `upsertProjectStrategyProfile` (~L644) :
```typescript
  async updateProjectStrategyProfileFields(projectId: number, patch: Partial<InsertProjectStrategyProfile>): Promise<ProjectStrategyProfile> {
    const existing = await this.getProjectStrategyProfile(projectId);
    if (existing) {
      const [updated] = await db.update(projectStrategyProfiles)
        .set({ ...patch, updatedAt: new Date() } as any)
        .where(eq(projectStrategyProfiles.projectId, projectId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(projectStrategyProfiles)
      .values({ projectId, ...patch } as any).returning();
    return created;
  }
```
> Vérifier que `projectStrategyProfiles` a `updatedAt` ; sinon retirer ce champ du `.set`.

- [ ] **Step 5: Route**

Dans `server/routes.ts` (près de `PATCH /api/projects/:id`, ~L1750) :
```typescript
  app.patch('/api/projects/:id/strategy-profile', isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(Number(req.params.id), req.userId);
    if (!project) return res.status(404).json({ message: 'not_found' });
    const { currentStage } = req.body || {};
    if (currentStage !== undefined && !isValidStage(currentStage)) return res.status(400).json({ message: 'invalid_stage' });
    const patch: any = {};
    if (currentStage !== undefined) patch.currentStage = currentStage;
    const strategyProfile = await storage.updateProjectStrategyProfileFields(project.id, patch);
    res.json({ strategyProfile });
  });
```
Importer `isValidStage`. Vérifier la vraie signature de `storage.getProject(id, userId)` (elle est utilisée dans le PATCH voisin — reprendre la même forme).

- [ ] **Step 6: Lancer → succès** — `npm test -- project-stage` PASS ; `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**
```bash
git add server/services/project-summary.ts server/services/project-stage.test.ts server/storage.ts server/routes.ts
git commit -m "feat(project): écriture du stade projet (current_stage) + upsert partiel"
```

---

## Task 2: Backend — « Demander un point à Naya »

**Files:** Modify `server/routes.ts`, `server/services/project-summary.ts`. Test: extend `project-summary` test.

**Interfaces produced:**
- Pure `buildSituationPrompt(projectName: string): string` (le userMessage/focus envoyé à `callClaudeWithContext`).
- `POST /api/projects/:id/situation` → `{ text }` (429 si `isAiBlocked`).

- [ ] **Step 1: Helper pur + test**

Dans `server/services/project-summary.ts` :
```typescript
export function buildSituationPrompt(projectName: string): string {
  return `Fais un POINT DE SITUATION court et concret sur le projet « ${projectName} », à partir de tout ce que tu sais (stade, statut noté par l'utilisateur, jalons faits/à venir, objectif). Deux parties, sans blabla :
1) Où en est ce projet, en 2-3 phrases (ce qui avance, ce qui traîne).
2) Les 2-3 PROCHAINES priorités concrètes.
Ton direct et utile. Pas de tiret long. Pas de liste à puces interminable.`;
}
```
Test (append) : `expect(buildSituationPrompt("Encore Merci")).toContain("Encore Merci")` et `.toContain("priorités")`.

- [ ] **Step 2: Route**

Dans `server/routes.ts` :
```typescript
  app.post('/api/projects/:id/situation', isAuthenticated, async (req: any, res) => {
    const project = await storage.getProject(Number(req.params.id), req.userId);
    if (!project) return res.status(404).json({ message: 'not_found' });
    if (await isAiBlocked(req.userId)) return res.status(429).json({ message: 'ai_monthly_limit_reached' });
    const text = await callClaudeWithContext({
      userId: req.userId, projectId: project.id,
      userMessage: buildSituationPrompt(project.name), max_tokens: 700,
    });
    res.json({ text });
  });
```
Importer `callClaudeWithContext` (`./services/claude`), `buildSituationPrompt`, `isAiBlocked` (`./services/usage` — vérifier le nom exact de la fonction de blocage, cf. `usage.ts`).

- [ ] **Step 3: Vérif** — `npm test -- project-summary` PASS ; `tsc` clean. (Pas de test d'appel IA réel.)

- [ ] **Step 4: Commit**
```bash
git add server/services/project-summary.ts server/services/project-summary.test.ts server/routes.ts
git commit -m "feat(project): endpoint point de situation Naya (contexte complet, plafond IA respecté)"
```

---

## Task 3: Backend — génération de tâches contextualisée (le correctif clé)

**Files:** Modify `server/services/goal-tasks.ts`.

**Interfaces:** `generateTasksForGoal` inchangée en signature/sortie ; seul l'appel IA change de `callClaude` → `callClaudeWithContext` (contexte projet injecté).

- [ ] **Step 1: Repérer projectId + l'appel**

Lire `server/services/goal-tasks.ts` en entier. `generateTasksForGoal` charge le goal (donc `goal.projectId`). L'appel IA est `callClaude({ model, userId, messages:[{role:'user',content: prompt}], ... })` (~L125).

- [ ] **Step 2: Remplacer l'appel**

Remplacer :
```typescript
  const raw = await callClaude({ model: CLAUDE_MODELS.smart, userId, messages: [{ role: "user", content: prompt }], max_tokens: ... , temperature: ... });
```
par :
```typescript
  const raw = await callClaudeWithContext({
    userId, projectId: goal.projectId ?? null,
    userMessage: prompt, model: CLAUDE_MODELS.smart, max_tokens: /* même valeur */, temperature: /* idem */,
  });
```
Ajuster l'import (`callClaudeWithContext` depuis `./claude`). GARDER le prompt existant tel quel (le contexte s'ajoute en amont via le system) ET le parsing de `raw` inchangé. Le `prompt` construit à la main peut conserver ses infos business (redondance bénigne) OU être allégé — ne pas alléger dans ce task pour limiter le risque ; juste ajouter le contexte.

- [ ] **Step 3: Vérif** — `npx tsc --noEmit` clean ; `npm test` vert (les tests existants de goal-tasks, s'il y en a, doivent passer ; sinon vérifier qu'aucun n'est cassé).

- [ ] **Step 4: Commit**
```bash
git add server/services/goal-tasks.ts
git commit -m "fix(tasks): la génération de tâches par objectif reçoit le contexte projet (statut, stade, jalons)"
```

---

## Task 4: Backend — résumé jalons (pur) + enrichissement du planning quotidien

**Files:** Modify `server/services/project-summary.ts` (+ test), `server/services/auto-planner.ts`.

**Interfaces produced:** `summarizeMilestones(milestones: {status:string}[]): { done:number; inProgress:number; upcoming:number }` (pur, testé) — utilisé côté client (via un endpoint ou recomputé) et pour enrichir le planner.

- [ ] **Step 1: Helper pur + test**
```typescript
export function summarizeMilestones(milestones: { status: string }[]): { done: number; inProgress: number; upcoming: number } {
  let done = 0, inProgress = 0, upcoming = 0;
  for (const m of milestones) {
    if (m.status === "completed") done++;
    else if (m.status === "active" || m.status === "unlocked") inProgress++;
    else if (m.status === "locked") upcoming++;
  }
  return { done, inProgress, upcoming };
}
```
Test : un tableau mixte → compteurs attendus ; `skipped` ignoré.

- [ ] **Step 2: Enrichir la struct `projectContext` du daily planner**

Dans `server/services/auto-planner.ts` (~L349-357), ajouter au `projectContext` : `statusNote: project.statusNote ?? null` et un `milestonesSummary` (via `summarizeMilestones` sur les jalons du projet si déjà chargés, sinon les charger). Ne toucher à RIEN d'autre dans le planner (placement des créneaux inchangé). Si les jalons ne sont pas déjà disponibles dans ce chemin, préférer n'ajouter que `statusNote` (déjà sur `project`) et noter que le résumé jalons est optionnel.

- [ ] **Step 3: Vérif + commit**
`npm test -- project-summary` PASS ; `tsc` clean ; `npm test` vert.
```bash
git add server/services/project-summary.ts server/services/project-summary.test.ts server/services/auto-planner.ts
git commit -m "feat(project): résumé jalons pur + statut projet injecté au planning quotidien"
```

---

## Task 5: Frontend — route, page projet (shell) + navigation par défaut

**Files:** Create `client/src/pages/project/ProjectPage.tsx`, `client/src/pages/project/useProjectPage.ts` ; Modify `client/src/App.tsx`, `client/src/components/sidebar.tsx`, `client/src/pages/dashboard.tsx`.

**Interfaces produced:**
- `useProjectPage.ts` : `useProjectDetail(id)` → GET `/api/projects/:id` (renvoie `{...project, goals, strategyProfile}`), `useProjectMilestones(id)` → GET `/api/projects/:id/milestones`, `useSaveStatusNote(id)` (PATCH `/api/projects/:id {statusNote}`), `useSaveStage(id)` (PATCH `/api/projects/:id/strategy-profile {currentStage}`), `useSituation(id)` (POST `/api/projects/:id/situation`).
- `ProjectPage.tsx` (default) props `{ id: number; onSearchClick?: () => void }`.
- Route `/projects/:id`.

- [ ] **Step 1: Hooks** — écrire `useProjectPage.ts` (thin wrappers, patterns du repo).

- [ ] **Step 2: Shell de page** — `ProjectPage.tsx` : shell (`flex h-screen bg-background` + `<Sidebar onSearchClick/>` + colonne + en-tête `bg-white border-b border-border px-6 py-4` avec nom du projet + badge client + retour `<Link href="/">`). `Skeleton` en chargement ; message si projet introuvable. Sections (placeholders pour Tasks 6-7) : Résumé, Contexte (note+stade), Feuille de route.

- [ ] **Step 3: Route** — dans `App.tsx` : `const ProjectPage = lazy(() => import("@/pages/project/ProjectPage"));` + `<Route path="/projects/:id">{(p) => <ProjectPage id={Number(p.id)} onSearchClick={openSearch} />}</Route>` (avant le catch-all, dans la branche authentifiée). ⚠️ Placer cette route AVANT `/projects` n'est pas nécessaire (Wouter matche le path complet), mais s'assurer que `/projects` (liste) et `/projects/:id` coexistent.

- [ ] **Step 4: Navigation par défaut**
- `sidebar.tsx` (~L224-244) : le clic sur un item projet doit `setActiveProjectId(project.id)` **ET** naviguer via `useLocation()`/`navigate('/projects/'+project.id)` (ou `<Link>`).
- `dashboard.tsx` : rendre `ActiveProjectBand` cliquable → même navigation (garder le `StatusNotePopover` cliquable sans déclencher la navigation : `stopPropagation`).

- [ ] **Step 5: Vérif + commit** — `tsc` clean, `build` OK ; cliquer un projet ouvre `/projects/:id` (sections placeholder). 
```bash
git add client/src/pages/project/ client/src/App.tsx client/src/components/sidebar.tsx client/src/pages/dashboard.tsx
git commit -m "feat(project-page): route /projects/:id + page (shell) + clic projet = destination par défaut"
```

---

## Task 6: Frontend — bandeau résumé factuel + « point Naya »

**Files:** Create `client/src/pages/project/ProjectSummaryBar.tsx` ; wire into `ProjectPage`.

- [ ] **Step 1: Bandeau factuel** — `ProjectSummaryBar({ project, goals, strategyProfile, milestones })` : tuiles/lignes — **Stade** (label FR depuis `currentStage`), **Objectif actif** (top goal actif) + barre de progression (`currentValue/targetValue` si numériques, sinon statut), **Jalons** faits/en cours/à venir (`summarizeMilestones` recalculé côté client OU compté depuis `milestones`), **Activité récente** (nb de tâches complétées cette semaine — via un fetch de tâches existant, ex. `/api/tasks/range` ou `/api/tasks` filtré ; si trop coûteux, afficher « — » et noter). Tokens JMD, `Card`/`Progress` shadcn.
- [ ] **Step 2: Bouton « ✦ Demander un point à Naya »** — `useSituation(id)` (POST) ; spinner pendant l'appel ; afficher le `text` renvoyé dans un encart ; bouton régénérer ; gérer 429 (`ai_monthly_limit_reached`) par un message « limite d'utilisation de l'IA atteinte ce mois-ci » (SANS montant). Bouton `bg-primary text-primary-foreground`.
- [ ] **Step 3: Vérif + commit** — `tsc`/`build` OK. `feat(project-page): résumé factuel + point de situation Naya à la demande`.

---

## Task 7: Frontend — note + stade, feuille de route, accès rapides

**Files:** Create `client/src/pages/project/ProjectContextEditor.tsx` ; wire `MilestoneRoadmap` + quick links into `ProjectPage`.

- [ ] **Step 1: Éditeur de contexte** — `ProjectContextEditor({ project, strategyProfile })` : un `Textarea` « Où en est ce projet ? (dis tout à Naya) » lié à `statusNote` (save via `useSaveStatusNote`, sur bouton ou onBlur) avec le texte d'aide (« Naya connaît déjà ce que tu fais dans l'app… note ce qu'elle ne peut pas deviner »), + un `Select` **Stade** (Idéation/Lancement/Croissance/Mature ↔ `ideation/early/growth/mature`) lié à `currentStage` (save via `useSaveStage`, instantané). Toasts succès/erreur.
- [ ] **Step 2: Feuille de route** — insérer `MilestoneRoadmap` (import depuis `@/pages/projects` si exporté ; sinon extraire le composant dans un fichier partagé `client/src/pages/project/MilestoneRoadmap.tsx` et l'importer aux 2 endroits — préférer l'extraction propre si non exporté). Titre « Feuille de route (ce qui est fait / à faire) ».
- [ ] **Step 3: Accès rapides** — liens/boutons vers le détail existant : Tâches, Objectifs, ADN de marque (ouvrir le Sheet `/projects` sur le bon onglet, ou naviguer). Ne pas reconstruire ces panneaux.
- [ ] **Step 4: Vérif + commit** — `tsc`/`build`/`test` OK ; la page est complète et fonctionnelle. `feat(project-page): saisie note + stade, feuille de route, accès rapides`.

---

## Self-Review

**Spec coverage (spec §2-§6) :** §2 page+navigation → Task 5. §3 résumé factuel + point Naya → Task 6 (front) + Task 2 (endpoint). §4 note+stade → Task 7 (front) + Task 1 (endpoint stade). §5 feuille de route → Task 7. §6 correctif tâches → Task 3 (goal-tasks) + Task 4 (daily planner). Aucune migration (spec §8) ✅.

**Placeholder scan :** points « vérifier la signature/le nom » (getProject, isAiBlocked, updatedAt sur strategy profile, MilestoneRoadmap exporté ou à extraire, source des tâches pour l'activité récente) = vérifications au code, pas des trous ; code fourni partout.

**Type consistency :** `isValidStage`/`summarizeMilestones`/`buildSituationPrompt` (Task 1/2/4, `project-summary.ts`) réutilisés par les routes et le front ; `callClaudeWithContext` signature réelle respectée (Task 2/3) ; hooks (Task 5) alignés sur les endpoints (Task 1/2 + existants).

**Sécurité/coût :** endpoints avec ownership (`getProject(id, userId)`), point Naya gated `isAiBlocked` → 429 sans montant. Aucun envoi/effet externe. Aucune migration.
