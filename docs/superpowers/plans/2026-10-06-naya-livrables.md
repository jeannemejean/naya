# Livrables de tâche (étape 1) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans l'espace de travail d'une tâche, déposer texte, photos/vidéos (avec description), fichiers et liens, rangés automatiquement (médiathèque, mémoire de Naya, projet), et demander le livrable au moment de cocher une tâche de production.

**Architecture:** Règles pures partagées (`shared/livrables.ts`) ; un service serveur à dépendances injectées (`server/services/livrables/service.ts`) qui crée/modifie/supprime et range, testé avec des fakes ; des routes minces dans un module dédié (`server/routes-livrables.ts`) ; côté client une section dans `TaskWorkspace`, un hook d'interception du cochage, et un panneau dans `ProjectPage`. Fichiers dans un bucket R2 privé distinct, médias dans le bucket public existant.

**Tech Stack:** Express, Drizzle ORM (PostgreSQL Neon), React + TanStack Query + wouter, react-i18next, Cloudflare R2 via `@aws-sdk/client-s3`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-naya-livrables-design.md`

## Global Constraints

- Limites : **25 Mo par photo ou fichier, 200 Mo par vidéo**, vérifiées côté client avant envoi **et** côté serveur à la création de l'URL (taille déclarée).
- Fichiers acceptés : PDF, Word, Excel, PowerPoint, texte, CSV. Médias : `image/*`, `video/*`.
- **Aucun fichier n'est jamais rangé dans le bucket public.** Sans `R2_PRIVATE_BUCKET`, le bouton Fichier est désactivé (« bientôt disponible ») et la route renvoie 503 `private_storage_not_configured`.
- Un livrable d'un autre compte → **404**, partout.
- Un lien seul (sans note) ne crée **aucun** souvenir.
- Modifier = anciens souvenirs `supersededAt = now()` puis nouveau dépôt. Jamais de `DELETE` sur `memory_entries`.
- Supprimer un média : ligne `media_library` + objet R2 supprimés **sauf** si un `content` le référence (`mediaIds` contient l'id ou `mediaUrl` = l'URL).
- Migration : `npx drizzle-kit generate`, relue à la main, **montrée à Jeanne**, appliquée par `npm run db:migrate` après sauvegarde Neon. **Jamais `db:push`.** Aucun test contre la base de prod.
- Aucun texte en dur dans le JSX des fichiers nouveaux (`client/src/locales/jsx-guard.test.ts`) : tout passe par `t('livrables.…')`, clés présentes dans `fr.ts` **et** `en.ts`.
- `npx tsc --noEmit` reste à zéro erreur ; `npm test` reste vert après chaque tâche.
- Messages de commit en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Ne pas pousser** : un push sur `main` déploie en prod ; le déploiement est la Task 11, après accord de Jeanne.

## Review Focus

- **Tâche supprimée après dépôt** : le livrable doit rester visible dans le projet (FK `ON DELETE SET NULL`), pas disparaître ni faire planter la liste (`taskId` null, `taskTitle` conservé). → test dans Task 5.
- **Description vide sur une photo** : la photo est rangée en médiathèque, mais aucun souvenir vide n'est écrit. → test dans Task 1 (`planDeRangement`).
- **Modifier un livrable sans changer son texte** (ex. re-sauvegarde) : ne doit pas périmer puis recréer les souvenirs pour rien. → test dans Task 5.
- **Cocher une tâche déjà terminée** (décocher) : ne doit jamais ouvrir le dépôt. → test dans Task 1 (`decisionAuCochage`).
- **Titre de tâche en majuscules ou précédé d'un emoji/puce** (« 📸 Photographier… », « - Rédige… ») : doit être repéré comme production. → test dans Task 1.

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `shared/livrables.ts` (créer) | Règles pures : repérage, décision au cochage, limites, types acceptés, validation de lien, plan de rangement, titre mémoire |
| `shared/livrables.test.ts` (créer) | Tests des règles |
| `shared/schema.ts` (modifier) | Table `livrables`, `media_library.project_id`, schémas d'insertion, types |
| `migrations/0018_*.sql` (généré) | Migration |
| `server/services/account-reset-plan.ts` + `server/storage.ts` → `resetUserOnboardingState` (modifier) | `livrables` supprimés au reset, avant `media_library` |
| `server/services/memory/deposer-dossier.ts` (modifier) | Rend aussi les `ids` créés ; ajoute `perimerSouvenirs` |
| `server/services/r2-storage.ts` (modifier) | Bucket privé : upload/lecture/suppression présignés |
| `server/services/livrables/service.ts` (créer) | Créer / modifier / supprimer / rattraper, dépendances injectées |
| `server/services/livrables/service.test.ts` (créer) | Tests avec fakes |
| `server/services/livrables/deps.ts` (créer) | Implémentation réelle des dépendances (Drizzle, R2, mémoire) |
| `server/routes-livrables.ts` (créer) | Routes HTTP |
| `server/routes.ts` (modifier) | Appel de `registerLivrablesRoutes(app)` |
| `client/src/lib/livrables-api.ts` (créer) | Types client, upload direct R2 |
| `client/src/components/livrables/LivrablesSection.tsx` (créer) | Section « Ce que tu as produit » |
| `client/src/components/livrables/LivrableCarte.tsx` (créer) | Un livrable déposé (affichage / édition / suppression) |
| `client/src/components/task-workspace.tsx` (modifier) | Insère la section ; props `focusLivrables`, `onFaitHorsNaya` |
| `client/src/hooks/useCocherAvecLivrable.ts` (créer) | Interception du cochage |
| `client/src/pages/planning.tsx`, `client/src/components/todays-tasks.tsx` (modifier) | Utilisent le hook |
| `client/src/pages/project/LivrablesPanel.tsx` (créer) + `ProjectPage.tsx` (modifier) | Section « Livrables » du projet |
| `client/src/locales/fr.ts`, `en.ts` (modifier) | Clés `livrables.*` |

**Écart assumé avec la spec :** `ProjectPage` n'a pas d'onglets mais des `<section>` empilées ; « l'onglet Livrables » devient donc une **section** « Livrables », au même niveau que Conversions et Liens entre marques. Et la table reçoit une colonne `taskTitle` (instantané du titre) : sans elle, un livrable dont la tâche a été supprimée ne peut plus construire son titre mémoire au rattrapage ni s'afficher avec sa tâche d'origine.

---

### Task 1 : Règles pures partagées

**Files:**
- Create: `shared/livrables.ts`
- Test: `shared/livrables.test.ts`

**Interfaces:**
- Produces:
  - `type LivrableKind = "texte" | "media" | "fichier" | "lien"`
  - `estTacheDeProduction(titre: string): boolean`
  - `decisionAuCochage(input: { titre: string; dejaTerminee: boolean; nbLivrables: number }): "cocher" | "demander"`
  - `limiteOctets(kind: "media" | "fichier", mimeType: string): number`
  - `typeAccepte(kind: "media" | "fichier", mimeType: string): boolean`
  - `lienValide(url: string): boolean`
  - `planDeRangement(input: { kind: LivrableKind; content: string | null | undefined }): { mediatheque: boolean; memoire: string | null }`
  - `titreMemoire(taskTitle: string | null | undefined): string`

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// shared/livrables.test.ts
import { describe, it, expect } from "vitest";
import {
  estTacheDeProduction, decisionAuCochage, limiteOctets, typeAccepte,
  lienValide, planDeRangement, titreMemoire,
} from "./livrables";

describe("estTacheDeProduction", () => {
  it.each([
    "Photographier 3 détails de ton environnement créatif + annoter chacun avec une observation",
    "Rédiger ton pitch",
    "Rédige ton pitch en 3 phrases",
    "Liste 10 prospects idéaux",
    "📸 Photographier ton bureau",
    "- Filmer une story coulisses",
    "CRÉER le visuel de lancement",
  ])("repère « %s »", (titre) => {
    expect(estTacheDeProduction(titre)).toBe(true);
  });

  it.each(["Appeler Marie", "Réunion client", "Ostéopathes Mr Darcy", "", "Relancer le devis Dupont"])(
    "ne repère pas « %s »",
    (titre) => expect(estTacheDeProduction(titre)).toBe(false),
  );
});

describe("decisionAuCochage", () => {
  const prod = "Photographier 3 détails";
  it("demande le livrable pour une tâche de production sans dépôt", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: false, nbLivrables: 0 })).toBe("demander");
  });
  it("coche directement si un livrable existe déjà", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: false, nbLivrables: 1 })).toBe("cocher");
  });
  it("ne demande jamais au décochage", () => {
    expect(decisionAuCochage({ titre: prod, dejaTerminee: true, nbLivrables: 0 })).toBe("cocher");
  });
  it("coche directement une tâche qui n'est pas de production", () => {
    expect(decisionAuCochage({ titre: "Appeler Marie", dejaTerminee: false, nbLivrables: 0 })).toBe("cocher");
  });
});

describe("limites et types", () => {
  const Mo = 1024 * 1024;
  it("25 Mo photo, 200 Mo vidéo, 25 Mo fichier", () => {
    expect(limiteOctets("media", "image/jpeg")).toBe(25 * Mo);
    expect(limiteOctets("media", "video/mp4")).toBe(200 * Mo);
    expect(limiteOctets("fichier", "application/pdf")).toBe(25 * Mo);
  });
  it("médias : image et vidéo seulement", () => {
    expect(typeAccepte("media", "image/png")).toBe(true);
    expect(typeAccepte("media", "video/quicktime")).toBe(true);
    expect(typeAccepte("media", "application/pdf")).toBe(false);
  });
  it("fichiers : PDF, Word, Excel, PowerPoint, texte, CSV", () => {
    for (const m of [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
    ]) expect(typeAccepte("fichier", m)).toBe(true);
    expect(typeAccepte("fichier", "image/png")).toBe(false);
    expect(typeAccepte("fichier", "application/x-msdownload")).toBe(false);
  });
});

describe("lienValide", () => {
  it("accepte http et https", () => {
    expect(lienValide("https://www.linkedin.com/in/jeanne")).toBe(true);
    expect(lienValide("http://exemple.fr/a?b=c")).toBe(true);
  });
  it("refuse le reste", () => {
    for (const u of ["", "exemple.fr", "javascript:alert(1)", "ftp://x.fr", "https://"]) {
      expect(lienValide(u)).toBe(false);
    }
  });
});

describe("planDeRangement", () => {
  it("photo décrite → médiathèque + mémoire", () => {
    expect(planDeRangement({ kind: "media", content: "Lumière du matin sur l'atelier" }))
      .toEqual({ mediatheque: true, memoire: "Lumière du matin sur l'atelier" });
  });
  it("photo sans description → médiathèque, aucun souvenir vide", () => {
    expect(planDeRangement({ kind: "media", content: "   " })).toEqual({ mediatheque: true, memoire: null });
  });
  it("texte → mémoire seulement", () => {
    expect(planDeRangement({ kind: "texte", content: "Mon pitch" })).toEqual({ mediatheque: false, memoire: "Mon pitch" });
  });
  it("lien sans note → rien en mémoire", () => {
    expect(planDeRangement({ kind: "lien", content: null })).toEqual({ mediatheque: false, memoire: null });
  });
  it("fichier → jamais en médiathèque", () => {
    expect(planDeRangement({ kind: "fichier", content: "Devis signé" })).toEqual({ mediatheque: false, memoire: "Devis signé" });
  });
});

describe("titreMemoire", () => {
  it("dit de quelle tâche vient le souvenir", () => {
    expect(titreMemoire("Photographier 3 détails")).toBe("Livrable — Photographier 3 détails");
  });
  it("a un repli sans tâche", () => {
    expect(titreMemoire(null)).toBe("Livrable déposé");
    expect(titreMemoire("  ")).toBe("Livrable déposé");
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run shared/livrables.test.ts`
Expected : FAIL, « Failed to resolve import "./livrables" ».

- [ ] **Step 3 : implémenter**

```ts
// shared/livrables.ts
// Règles des livrables de tâche — importées par le serveur ET le client.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md

export type LivrableKind = "texte" | "media" | "fichier" | "lien";

// Étape 1 seulement : à l'étape 2, le générateur déclarera le livrable attendu.
const VERBES_PRODUCTION = [
  "photographi", "filme", "enregistr", "rédig", "écri", "list", "crée", "créer",
  "conçoi", "concevoir", "prépar", "dessin", "monte", "capture", "note", "documente",
  "compile", "collect", "rassembl",
];

/** Vrai si le titre commence par un verbe de production (infinitif ou impératif tutoyé). */
export function estTacheDeProduction(titre: string): boolean {
  const premierMot = (titre ?? "")
    .toLowerCase()
    .replace(/^[^a-zà-ÿœæ]+/i, "")
    .split(/[^a-zà-ÿœæ]+/i)[0] ?? "";
  if (!premierMot) return false;
  return VERBES_PRODUCTION.some((v) => premierMot.startsWith(v));
}

export function decisionAuCochage(input: {
  titre: string;
  dejaTerminee: boolean;
  nbLivrables: number;
}): "cocher" | "demander" {
  if (input.dejaTerminee) return "cocher";
  if (input.nbLivrables > 0) return "cocher";
  return estTacheDeProduction(input.titre) ? "demander" : "cocher";
}

const Mo = 1024 * 1024;

export function limiteOctets(kind: "media" | "fichier", mimeType: string): number {
  if (kind === "media" && mimeType.startsWith("video/")) return 200 * Mo;
  return 25 * Mo;
}

const TYPES_FICHIER = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

/** Extensions proposées au sélecteur de fichiers (attribut `accept`). */
export const ACCEPT_FICHIER = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

export function typeAccepte(kind: "media" | "fichier", mimeType: string): boolean {
  if (kind === "media") return /^(image|video)\//.test(mimeType);
  return TYPES_FICHIER.has(mimeType);
}

export function lienValide(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function planDeRangement(input: {
  kind: LivrableKind;
  content: string | null | undefined;
}): { mediatheque: boolean; memoire: string | null } {
  const texte = (input.content ?? "").trim();
  return {
    mediatheque: input.kind === "media",
    memoire: texte ? texte : null,
  };
}

export function titreMemoire(taskTitle: string | null | undefined): string {
  const t = (taskTitle ?? "").trim();
  return t ? `Livrable — ${t}` : "Livrable déposé";
}
```

- [ ] **Step 4 : vérifier le succès**

Run : `npx vitest run shared/livrables.test.ts`
Expected : PASS. Si « https:// » passe `lienValide`, c'est que `new URL("https://")` lève : vérifier que le cas est bien couvert par le `catch`.

- [ ] **Step 5 : commit**

```bash
git add shared/livrables.ts shared/livrables.test.ts
git commit -m "feat(livrables): règles pures — repérage, cochage, limites, rangement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 : Schéma, migration, reset

**Files:**
- Modify: `shared/schema.ts` (après `mediaLibrary` ; schémas d'insertion près de `insertMediaLibrarySchema` ; types près de `type MediaLibrary`)
- Generate: `migrations/0018_*.sql`
- Modify: `server/services/account-reset-plan.ts`, `server/storage.ts` → `resetUserOnboardingState`
- Test: `server/services/account-reset-plan.test.ts` (existant)

**Interfaces:**
- Produces : `livrables` (table Drizzle), `insertLivrableSchema`, `type Livrable`, `type InsertLivrable`, `mediaLibrary.projectId`.

- [ ] **Step 1 : ajouter `projectId` à `mediaLibrary`**

Dans `shared/schema.ts`, `export const mediaLibrary = pgTable("media_library", {`, après `folder` :

```ts
  // Livrables (6 oct. 2026) : une photo déposée sur une tâche reste reconnaissable par projet.
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
```

- [ ] **Step 2 : ajouter la table `livrables`** juste après la déclaration de `mediaLibrary`

```ts
// Livrables de tâche — ce que l'utilisatrice produit quand Naya le lui demande.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
export const livrables = pgTable("livrables", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  // SET NULL : un livrable survit à sa tâche et reste rangé dans le projet.
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  // Instantané du titre : la tâche peut disparaître, le souvenir doit encore dire d'où il vient.
  taskTitle: text("task_title"),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // texte | media | fichier | lien
  content: text("content"),
  url: text("url"), // URL du lien, URL publique du média, ou clé privée du fichier
  mediaId: integer("media_id").references(() => mediaLibrary.id, { onDelete: "set null" }),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  size: integer("size"),
  memoryEntryIds: jsonb("memory_entry_ids").$type<number[]>().default([]),
  memoirePending: boolean("memoire_pending").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

Si `tasks` est déclaré **après** `mediaLibrary` dans le fichier, la référence fléchée `() => tasks.id` reste valide (évaluée paresseusement) ; ne pas déplacer de tables.

- [ ] **Step 3 : schéma d'insertion et types** (près de `insertMediaLibrarySchema`, puis près de `type MediaLibrary`)

```ts
export const insertLivrableSchema = createInsertSchema(livrables).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
```

```ts
export type InsertLivrable = z.infer<typeof insertLivrableSchema>;
export type Livrable = typeof livrables.$inferSelect;
```

- [ ] **Step 4 : lancer le test du plan de reset pour le voir échouer**

Run : `npx vitest run server/services/account-reset-plan.test.ts`
Expected : FAIL sur « ne laisse AUCUNE référence FK non couverte », avec une ligne `livrables.user_id → users`.

- [ ] **Step 5 : couvrir `livrables` dans le reset**

`server/services/account-reset-plan.ts`, dans `ACCOUNT_RESET_PLAN`, **juste avant** l'entrée `{ table: "media_library", … }` :

```ts
  { table: "livrables", mode: "delete", note: "⚠️ les objets R2 (médias et fichiers privés) ne sont pas supprimés" },
```

`server/storage.ts`, dans `resetUserOnboardingState`, **juste avant** `await tx.delete(mediaLibrary)…` :

```ts
      await tx.delete(livrables).where(eq(livrables.userId, userId));                   // task_id/project_id/media_id
```

et ajouter `livrables` à la liste d'imports depuis `@shared/schema` en tête de `server/storage.ts`.

- [ ] **Step 6 : vérifier**

Run : `npx vitest run server/services/account-reset-plan.test.ts && npx tsc --noEmit`
Expected : PASS, zéro erreur de types.

- [ ] **Step 7 : générer la migration (sans l'appliquer)**

Run : `npx drizzle-kit generate`
Puis : `cat migrations/0018_*.sql`
Expected : exactement un `CREATE TABLE "livrables"`, un `ALTER TABLE "media_library" ADD COLUMN "project_id"`, et les `ADD CONSTRAINT … FOREIGN KEY` correspondants (`ON DELETE set null` pour task/project/media). **Aucun `DROP`, aucun autre `ALTER`.** S'il y en a d'autres : arrêter et signaler ; ne pas appliquer.

- [ ] **Step 8 : commit**

```bash
git add shared/schema.ts migrations/ server/services/account-reset-plan.ts server/storage.ts
git commit -m "feat(livrables): table livrables, projet sur la médiathèque, couverts par le reset

Migration générée, NON appliquée (voir Task 11).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 : Mémoire — rendre les ids, périmer

**Files:**
- Modify: `server/services/memory/deposer-dossier.ts`

**Interfaces:**
- Produces :
  - `deposerDossier(input) : Promise<{ morceaux: number; vectorises: number; ids: number[] }>` (champ `ids` ajouté ; l'appelant existant `POST` dans `server/routes.ts` qui lit `r.morceaux` reste compatible)
  - `perimerSouvenirs(userId: string, ids: number[]): Promise<void>`

- [ ] **Step 1 : modifier l'insertion pour récupérer l'id**

Dans `deposerDossier`, déclarer `const ids: number[] = [];` à côté de `let vectorises = 0;`, et remplacer `await db.insert(memoryEntries).values({ … } as any);` par :

```ts
      const [ecrit] = await db.insert(memoryEntries).values({
        // … mêmes champs qu'avant, inchangés …
      } as any).returning({ id: memoryEntries.id });
      if (ecrit) ids.push(ecrit.id);
```

et le retour final par `return { morceaux: morceaux.length, vectorises, ids };`. Mettre à jour `ResultatDepot` :

```ts
export interface ResultatDepot {
  morceaux: number;
  vectorises: number;
  /** Ids des souvenirs effectivement écrits — pour pouvoir les périmer ensuite. */
  ids: number[];
}
```

Le `return { morceaux: 0, vectorises: 0 }` du début devient `return { morceaux: 0, vectorises: 0, ids: [] };`.

- [ ] **Step 2 : ajouter `perimerSouvenirs`** à la fin du fichier (ajouter `and`, `eq`, `inArray`, `isNull` à l'import `drizzle-orm`)

```ts
/**
 * Marque des souvenirs comme périmés (bi-temporel : invalidés, jamais supprimés).
 * Filtré par utilisateur : on ne périme jamais la mémoire d'un autre compte.
 */
export async function perimerSouvenirs(userId: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(memoryEntries)
    .set({ supersededAt: new Date() } as any)
    .where(and(
      eq(memoryEntries.userId, userId),
      inArray(memoryEntries.id, ids),
      isNull(memoryEntries.supersededAt),
    ));
}
```

- [ ] **Step 3 : vérifier**

Run : `npx tsc --noEmit && npm test`
Expected : zéro erreur, suite verte.

- [ ] **Step 4 : commit**

```bash
git add server/services/memory/deposer-dossier.ts
git commit -m "feat(memoire): deposerDossier rend les ids écrits ; perimerSouvenirs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 : Bucket R2 privé

**Files:**
- Modify: `server/services/r2-storage.ts`

**Interfaces:**
- Produces :
  - `privateStorageConfigured(): boolean`
  - `createPrivateUploadUrl(opts: { userId: string; filename: string; contentType: string }): Promise<{ uploadUrl: string; key: string }>`
  - `createPrivateDownloadUrl(key: string, fileName: string): Promise<string>` (5 min)
  - `deletePrivateObject(key: string): Promise<void>`

- [ ] **Step 1 : implémenter** (ajouter `GetObjectCommand` à l'import `@aws-sdk/client-s3` ; mettre à jour le commentaire d'en-tête « Env requis » avec `R2_PRIVATE_BUCKET (facultatif)`)

```ts
// Bucket PRIVÉ (livrables de type fichier) : aucun domaine public. Lecture uniquement par
// URL présignée courte, après vérification de propriété côté route. Sans ce bucket, les
// fichiers sont refusés plutôt que rangés dans le bucket public.
const PRIVATE_BUCKET = process.env.R2_PRIVATE_BUCKET || "";

export function privateStorageConfigured(): boolean {
  return !!client && !!PRIVATE_BUCKET;
}

export async function createPrivateUploadUrl(opts: {
  userId: string;
  filename: string;
  contentType: string;
}): Promise<{ uploadUrl: string; key: string }> {
  if (!client || !PRIVATE_BUCKET) throw new Error("private_storage_not_configured");
  const ext = safeExt(opts.filename);
  const key = `livrables/${opts.userId}/${randomUUID()}${ext ? "." + ext : ""}`;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key, ContentType: opts.contentType }),
    { expiresIn: 3600 },
  );
  return { uploadUrl, key };
}

export async function createPrivateDownloadUrl(key: string, fileName: string): Promise<string> {
  if (!client || !PRIVATE_BUCKET) throw new Error("private_storage_not_configured");
  const nom = fileName.replace(/["\r\n]/g, "");
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: PRIVATE_BUCKET,
      Key: key,
      ResponseContentDisposition: `inline; filename="${nom}"`,
    }),
    { expiresIn: 300 }, // 5 min
  );
}

export async function deletePrivateObject(key: string): Promise<void> {
  if (!client || !PRIVATE_BUCKET) return;
  await client.send(new DeleteObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }));
}
```

- [ ] **Step 2 : vérifier**

Run : `npx tsc --noEmit`
Expected : zéro erreur. (Pas de test unitaire : ce module ne fait que signer des requêtes S3 ; il est couvert par la vérification manuelle de la Task 11.)

- [ ] **Step 3 : commit**

```bash
git add server/services/r2-storage.ts
git commit -m "feat(r2): bucket privé pour les fichiers livrables (upload/lecture présignés)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 : Service livrables

**Files:**
- Create: `server/services/livrables/service.ts`
- Test: `server/services/livrables/service.test.ts`

**Interfaces:**
- Consumes : `planDeRangement`, `titreMemoire`, `LivrableKind` (Task 1) ; `Livrable`, `InsertLivrable`, `InsertMediaLibrary` (Task 2).
- Produces :

```ts
export interface LivrablesDeps {
  inserer(row: InsertLivrable): Promise<Livrable>;
  maj(id: number, userId: string, patch: Partial<InsertLivrable>): Promise<Livrable | null>;
  lire(id: number, userId: string): Promise<Livrable | undefined>;
  supprimer(id: number, userId: string): Promise<boolean>;
  creerMedia(row: InsertMediaLibrary): Promise<{ id: number }>;
  majMediaAlt(mediaId: number, userId: string, alt: string | null): Promise<void>;
  supprimerMedia(mediaId: number, userId: string): Promise<void>;
  mediaReferenceParUnContenu(userId: string, mediaId: number, url: string | null): Promise<boolean>;
  deposerMemoire(input: { userId: string; projectId: number | null; titre: string; contenu: string }): Promise<{ morceaux: number; ids: number[] }>;
  perimerMemoire(userId: string, ids: number[]): Promise<void>;
  supprimerObjetPublic(url: string): Promise<void>;
  supprimerObjetPrive(key: string): Promise<void>;
}

export interface NouveauLivrable {
  userId: string;
  taskId: number | null;
  taskTitle: string | null;
  projectId: number | null;
  kind: LivrableKind;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

export function creerLivrable(deps: LivrablesDeps, input: NouveauLivrable): Promise<Livrable>;
export function modifierLivrable(deps: LivrablesDeps, id: number, userId: string, content: string | null): Promise<Livrable | null>;
export function supprimerLivrable(deps: LivrablesDeps, id: number, userId: string): Promise<boolean>;
export function rattraperMemoire(deps: LivrablesDeps, liste: Livrable[]): Promise<void>;
```

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
// server/services/livrables/service.test.ts
import { describe, it, expect, vi } from "vitest";
import type { Livrable } from "@shared/schema";
import {
  creerLivrable, modifierLivrable, supprimerLivrable, rattraperMemoire,
  type LivrablesDeps,
} from "./service";

function fakeDeps(over: Partial<LivrablesDeps> = {}) {
  const rows = new Map<number, Livrable>();
  let nextId = 1;
  let nextMem = 100;
  const deps: LivrablesDeps = {
    inserer: vi.fn(async (row) => {
      const l = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...row } as Livrable;
      rows.set(l.id, l);
      return l;
    }),
    maj: vi.fn(async (id, userId, patch) => {
      const l = rows.get(id);
      if (!l || l.userId !== userId) return null;
      const n = { ...l, ...patch } as Livrable;
      rows.set(id, n);
      return n;
    }),
    lire: vi.fn(async (id, userId) => {
      const l = rows.get(id);
      return l && l.userId === userId ? l : undefined;
    }),
    supprimer: vi.fn(async (id, userId) => {
      const l = rows.get(id);
      if (!l || l.userId !== userId) return false;
      rows.delete(id);
      return true;
    }),
    creerMedia: vi.fn(async () => ({ id: 42 })),
    majMediaAlt: vi.fn(async () => {}),
    supprimerMedia: vi.fn(async () => {}),
    mediaReferenceParUnContenu: vi.fn(async () => false),
    deposerMemoire: vi.fn(async () => ({ morceaux: 1, ids: [nextMem++] })),
    perimerMemoire: vi.fn(async () => {}),
    supprimerObjetPublic: vi.fn(async () => {}),
    supprimerObjetPrive: vi.fn(async () => {}),
    ...over,
  };
  return { deps, rows };
}

const base = { userId: "u1", taskId: 7, taskTitle: "Photographier 3 détails", projectId: 3 };

describe("creerLivrable", () => {
  it("photo décrite → médiathèque (alt, projet, dossier livrables) + mémoire", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, {
      ...base, kind: "media", content: "Lumière du matin",
      url: "https://media.x/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1000,
    });
    expect(deps.creerMedia).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", url: "https://media.x/a.jpg", alt: "Lumière du matin", projectId: 3, folder: "livrables",
      mimeType: "image/jpeg", originalName: "a.jpg", size: 1000,
    }));
    expect(deps.deposerMemoire).toHaveBeenCalledWith({
      userId: "u1", projectId: 3, titre: "Livrable — Photographier 3 détails", contenu: "Lumière du matin",
    });
    expect(l.mediaId).toBe(42);
    expect(l.memoryEntryIds).toEqual([100]);
    expect(l.memoirePending).toBe(false);
  });

  it("lien sans note → ni médiathèque ni mémoire", async () => {
    const { deps } = fakeDeps();
    await creerLivrable(deps, { ...base, kind: "lien", url: "https://x.fr", content: null });
    expect(deps.creerMedia).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).not.toHaveBeenCalled();
  });

  it("fichier → jamais en médiathèque", async () => {
    const { deps } = fakeDeps();
    await creerLivrable(deps, { ...base, kind: "fichier", url: "livrables/u1/k.pdf", content: "Devis", fileName: "d.pdf", mimeType: "application/pdf", size: 10 });
    expect(deps.creerMedia).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).toHaveBeenCalled();
  });

  it("mémoire en échec → livrable créé quand même, en attente", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => { throw new Error("db down"); }) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    expect(l.memoirePending).toBe(true);
    expect(l.memoryEntryIds).toEqual([]);
  });

  it("mémoire sans aucun souvenir écrit → en attente", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => ({ morceaux: 1, ids: [] })) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    expect(l.memoirePending).toBe(true);
  });
});

describe("modifierLivrable", () => {
  it("périme les anciens souvenirs puis redépose", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    const m = await modifierLivrable(deps, l.id, "u1", "v2");
    expect(deps.perimerMemoire).toHaveBeenCalledWith("u1", [100]);
    expect(m?.content).toBe("v2");
    expect(m?.memoryEntryIds).toEqual([101]);
  });

  it("même texte → ne touche pas à la mémoire", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    await modifierLivrable(deps, l.id, "u1", "  v1 ");
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
    expect(deps.deposerMemoire).toHaveBeenCalledTimes(1);
  });

  it("met à jour l'alt du média", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "v1", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    await modifierLivrable(deps, l.id, "u1", "v2");
    expect(deps.majMediaAlt).toHaveBeenCalledWith(42, "u1", "v2");
  });

  it("livrable d'un autre compte → null, rien touché", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "v1" });
    expect(await modifierLivrable(deps, l.id, "intrus", "v2")).toBeNull();
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
  });
});

describe("supprimerLivrable", () => {
  it("périme les souvenirs, supprime média et objet s'ils ne servent à aucun contenu", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "x", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    expect(await supprimerLivrable(deps, l.id, "u1")).toBe(true);
    expect(deps.perimerMemoire).toHaveBeenCalledWith("u1", [100]);
    expect(deps.supprimerMedia).toHaveBeenCalledWith(42, "u1");
    expect(deps.supprimerObjetPublic).toHaveBeenCalledWith("https://m/a.jpg");
  });

  it("garde le média et l'objet s'ils sont utilisés par un post", async () => {
    const { deps } = fakeDeps({ mediaReferenceParUnContenu: vi.fn(async () => true) });
    const l = await creerLivrable(deps, { ...base, kind: "media", content: "x", url: "https://m/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", size: 1 });
    await supprimerLivrable(deps, l.id, "u1");
    expect(deps.supprimerMedia).not.toHaveBeenCalled();
    expect(deps.supprimerObjetPublic).not.toHaveBeenCalled();
  });

  it("fichier → objet privé supprimé", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "fichier", url: "livrables/u1/k.pdf", content: null, fileName: "d.pdf", mimeType: "application/pdf", size: 1 });
    await supprimerLivrable(deps, l.id, "u1");
    expect(deps.supprimerObjetPrive).toHaveBeenCalledWith("livrables/u1/k.pdf");
  });

  it("livrable d'un autre compte → false, rien supprimé", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "x" });
    expect(await supprimerLivrable(deps, l.id, "intrus")).toBe(false);
    expect(deps.perimerMemoire).not.toHaveBeenCalled();
  });
});

describe("rattraperMemoire", () => {
  it("redépose les livrables en attente, même si la tâche a disparu", async () => {
    const { deps } = fakeDeps({ deposerMemoire: vi.fn(async () => { throw new Error("down"); }) });
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "Mon pitch" });
    const orphelin = { ...l, taskId: null } as Livrable;
    deps.deposerMemoire = vi.fn(async () => ({ morceaux: 1, ids: [555] }));
    await rattraperMemoire(deps, [orphelin]);
    expect(deps.deposerMemoire).toHaveBeenCalledWith(expect.objectContaining({ titre: "Livrable — Photographier 3 détails" }));
    expect(deps.maj).toHaveBeenLastCalledWith(l.id, "u1", { memoryEntryIds: [555], memoirePending: false });
  });

  it("ignore les livrables qui ne sont pas en attente, et ne lève jamais", async () => {
    const { deps } = fakeDeps();
    const l = await creerLivrable(deps, { ...base, kind: "texte", content: "ok" });
    deps.deposerMemoire = vi.fn(async () => { throw new Error("down"); });
    await expect(rattraperMemoire(deps, [l, { ...l, id: 99, memoirePending: true } as Livrable])).resolves.toBeUndefined();
    expect(deps.deposerMemoire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run server/services/livrables/service.test.ts`
Expected : FAIL, « Failed to resolve import "./service" ».

- [ ] **Step 3 : implémenter**

```ts
// server/services/livrables/service.ts
// Créer, modifier, supprimer un livrable et le ranger là où il sert.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
//
// Dépendances injectées : toute la logique est testable sans base ni R2. L'implémentation
// réelle est dans ./deps.ts.

import type { InsertLivrable, InsertMediaLibrary, Livrable } from "@shared/schema";
import { planDeRangement, titreMemoire, type LivrableKind } from "@shared/livrables";

export interface LivrablesDeps {
  inserer(row: InsertLivrable): Promise<Livrable>;
  maj(id: number, userId: string, patch: Partial<InsertLivrable>): Promise<Livrable | null>;
  lire(id: number, userId: string): Promise<Livrable | undefined>;
  supprimer(id: number, userId: string): Promise<boolean>;
  creerMedia(row: InsertMediaLibrary): Promise<{ id: number }>;
  majMediaAlt(mediaId: number, userId: string, alt: string | null): Promise<void>;
  supprimerMedia(mediaId: number, userId: string): Promise<void>;
  mediaReferenceParUnContenu(userId: string, mediaId: number, url: string | null): Promise<boolean>;
  deposerMemoire(input: { userId: string; projectId: number | null; titre: string; contenu: string }): Promise<{ morceaux: number; ids: number[] }>;
  perimerMemoire(userId: string, ids: number[]): Promise<void>;
  supprimerObjetPublic(url: string): Promise<void>;
  supprimerObjetPrive(key: string): Promise<void>;
}

export interface NouveauLivrable {
  userId: string;
  taskId: number | null;
  taskTitle: string | null;
  projectId: number | null;
  kind: LivrableKind;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

/** Dépose en mémoire ; rend les ids et si un rattrapage est nécessaire. Ne lève jamais. */
async function deposer(
  deps: LivrablesDeps,
  args: { userId: string; projectId: number | null; taskTitle: string | null; texte: string | null },
): Promise<{ ids: number[]; pending: boolean }> {
  if (!args.texte) return { ids: [], pending: false };
  try {
    const r = await deps.deposerMemoire({
      userId: args.userId,
      projectId: args.projectId,
      titre: titreMemoire(args.taskTitle),
      contenu: args.texte,
    });
    return { ids: r.ids, pending: r.ids.length === 0 };
  } catch (e: any) {
    console.error("[Livrables] dépôt mémoire en échec — à rattraper:", e?.message ?? e);
    return { ids: [], pending: true };
  }
}

export async function creerLivrable(deps: LivrablesDeps, input: NouveauLivrable): Promise<Livrable> {
  const content = input.content?.trim() || null;
  const plan = planDeRangement({ kind: input.kind, content });

  let mediaId: number | null = null;
  if (plan.mediatheque && input.url) {
    const media = await deps.creerMedia({
      userId: input.userId,
      filename: input.fileName ?? "media",
      originalName: input.fileName ?? "media",
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.size ?? 0,
      url: input.url,
      alt: content,
      folder: "livrables",
      projectId: input.projectId,
    } as InsertMediaLibrary);
    mediaId = media.id;
  }

  const memoire = await deposer(deps, {
    userId: input.userId, projectId: input.projectId, taskTitle: input.taskTitle, texte: plan.memoire,
  });

  return deps.inserer({
    userId: input.userId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    kind: input.kind,
    content,
    url: input.url ?? null,
    mediaId,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    size: input.size ?? null,
    memoryEntryIds: memoire.ids,
    memoirePending: memoire.pending,
  });
}

export async function modifierLivrable(
  deps: LivrablesDeps,
  id: number,
  userId: string,
  contentBrut: string | null,
): Promise<Livrable | null> {
  const actuel = await deps.lire(id, userId);
  if (!actuel) return null;

  const content = contentBrut?.trim() || null;
  if (content === (actuel.content ?? null)) return actuel;

  await deps.perimerMemoire(userId, (actuel.memoryEntryIds as number[] | null) ?? []);
  if (actuel.mediaId) await deps.majMediaAlt(actuel.mediaId, userId, content);

  const plan = planDeRangement({ kind: actuel.kind as LivrableKind, content });
  const memoire = await deposer(deps, {
    userId, projectId: actuel.projectId, taskTitle: actuel.taskTitle, texte: plan.memoire,
  });

  return deps.maj(id, userId, {
    content,
    memoryEntryIds: memoire.ids,
    memoirePending: memoire.pending,
  });
}

export async function supprimerLivrable(deps: LivrablesDeps, id: number, userId: string): Promise<boolean> {
  const actuel = await deps.lire(id, userId);
  if (!actuel) return false;

  await deps.perimerMemoire(userId, (actuel.memoryEntryIds as number[] | null) ?? []);

  if (actuel.kind === "media" && actuel.mediaId) {
    const utilise = await deps.mediaReferenceParUnContenu(userId, actuel.mediaId, actuel.url);
    if (!utilise) {
      await deps.supprimerMedia(actuel.mediaId, userId);
      if (actuel.url) await deps.supprimerObjetPublic(actuel.url).catch(() => {});
    }
  }
  if (actuel.kind === "fichier" && actuel.url) {
    await deps.supprimerObjetPrive(actuel.url).catch(() => {});
  }

  return deps.supprimer(id, userId);
}

/** Redépose en mémoire les livrables en attente. Best-effort : ne lève jamais. */
export async function rattraperMemoire(deps: LivrablesDeps, liste: Livrable[]): Promise<void> {
  for (const l of liste) {
    if (!l.memoirePending) continue;
    const plan = planDeRangement({ kind: l.kind as LivrableKind, content: l.content });
    const memoire = await deposer(deps, {
      userId: l.userId, projectId: l.projectId, taskTitle: l.taskTitle, texte: plan.memoire,
    });
    if (memoire.pending) continue;
    try {
      await deps.maj(l.id, l.userId, { memoryEntryIds: memoire.ids, memoirePending: false });
    } catch (e: any) {
      console.error("[Livrables] rattrapage non enregistré:", e?.message ?? e);
    }
  }
}
```

- [ ] **Step 4 : vérifier le succès**

Run : `npx vitest run server/services/livrables/service.test.ts && npx tsc --noEmit`
Expected : PASS, zéro erreur.

- [ ] **Step 5 : commit**

```bash
git add server/services/livrables/
git commit -m "feat(livrables): service — créer, modifier, supprimer, rattraper la mémoire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 : Dépendances réelles et routes

**Files:**
- Create: `server/services/livrables/deps.ts`
- Create: `server/routes-livrables.ts`
- Modify: `server/routes.ts` (dans `registerRoutes`, avant le `return` final qui crée le serveur HTTP : `registerLivrablesRoutes(app);` + import)

**Interfaces:**
- Consumes : `LivrablesDeps`, `creerLivrable`, `modifierLivrable`, `supprimerLivrable`, `rattraperMemoire` (Task 5) ; R2 (Task 4) ; `deposerDossier`, `perimerSouvenirs` (Task 3) ; règles (Task 1).
- Produces : `export const livrablesDeps: LivrablesDeps` ; `export function registerLivrablesRoutes(app: Express): void` ; routes de la spec.

- [ ] **Step 1 : `deps.ts`**

```ts
// server/services/livrables/deps.ts — implémentation réelle (Drizzle, R2, mémoire).
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { content, livrables, mediaLibrary } from "@shared/schema";
import { deposerDossier, perimerSouvenirs } from "../memory/deposer-dossier";
import { deleteObject, deletePrivateObject, keyFromPublicUrl } from "../r2-storage";
import type { LivrablesDeps } from "./service";

export const livrablesDeps: LivrablesDeps = {
  async inserer(row) {
    const [l] = await db.insert(livrables).values(row as any).returning();
    return l;
  },
  async maj(id, userId, patch) {
    const [l] = await db.update(livrables)
      .set({ ...(patch as any), updatedAt: new Date() })
      .where(and(eq(livrables.id, id), eq(livrables.userId, userId)))
      .returning();
    return l ?? null;
  },
  async lire(id, userId) {
    const [l] = await db.select().from(livrables)
      .where(and(eq(livrables.id, id), eq(livrables.userId, userId)));
    return l;
  },
  async supprimer(id, userId) {
    const r = await db.delete(livrables).where(and(eq(livrables.id, id), eq(livrables.userId, userId)));
    return (r.rowCount ?? 0) > 0;
  },
  async creerMedia(row) {
    const [m] = await db.insert(mediaLibrary).values(row as any).returning({ id: mediaLibrary.id });
    return m;
  },
  async majMediaAlt(mediaId, userId, alt) {
    await db.update(mediaLibrary).set({ alt, updatedAt: new Date() } as any)
      .where(and(eq(mediaLibrary.id, mediaId), eq(mediaLibrary.userId, userId)));
  },
  async supprimerMedia(mediaId, userId) {
    await db.delete(mediaLibrary).where(and(eq(mediaLibrary.id, mediaId), eq(mediaLibrary.userId, userId)));
  },
  async mediaReferenceParUnContenu(userId, mediaId, url) {
    const conditions = [sql`${content.mediaIds} @> ${JSON.stringify([mediaId])}::jsonb`];
    if (url) conditions.push(eq(content.mediaUrl, url));
    const [r] = await db.select({ id: content.id }).from(content)
      .where(and(eq(content.userId, userId), or(...conditions)))
      .limit(1);
    return !!r;
  },
  async deposerMemoire(input) {
    const r = await deposerDossier(input);
    return { morceaux: r.morceaux, ids: r.ids };
  },
  perimerMemoire: perimerSouvenirs,
  async supprimerObjetPublic(url) {
    const key = keyFromPublicUrl(url);
    if (key) await deleteObject(key);
  },
  supprimerObjetPrive: deletePrivateObject,
};

/** Livrables d'une tâche ou d'un projet, récents d'abord, filtrés par propriétaire. */
export async function listerLivrables(userId: string, filtre: { taskId?: number; projectId?: number }) {
  const cond = filtre.taskId != null
    ? eq(livrables.taskId, filtre.taskId)
    : eq(livrables.projectId, filtre.projectId!);
  return db.select().from(livrables)
    .where(and(eq(livrables.userId, userId), cond))
    .orderBy(desc(livrables.createdAt));
}
```

Vérifier que `content` (table) a bien une colonne `userId` (`shared/schema.ts`, table `content`) ; si elle s'appelle autrement, adapter.

- [ ] **Step 2 : `routes-livrables.ts`**

```ts
// server/routes-livrables.ts — routes des livrables de tâche.
// Spec : docs/superpowers/specs/2026-10-06-naya-livrables-design.md
import type { Express } from "express";
import { isAuthenticated } from "./auth";
import { storage } from "./storage";
import { lienValide, limiteOctets, typeAccepte, type LivrableKind } from "@shared/livrables";
import {
  createUploadUrl, createPrivateUploadUrl, createPrivateDownloadUrl,
  privateStorageConfigured, r2Configured,
} from "./services/r2-storage";
import { creerLivrable, modifierLivrable, supprimerLivrable, rattraperMemoire } from "./services/livrables/service";
import { livrablesDeps, listerLivrables } from "./services/livrables/deps";

const KINDS: LivrableKind[] = ["texte", "media", "fichier", "lien"];

export function registerLivrablesRoutes(app: Express): void {
  app.get("/api/livrables/config", isAuthenticated, (_req, res) => {
    res.json({ fichiers: privateStorageConfigured(), medias: r2Configured() });
  });

  app.get("/api/tasks/:id/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const liste = await listerLivrables(req.userId, { taskId: Number(req.params.id) });
      rattraperMemoire(livrablesDeps, liste).catch(() => {}); // paresseux, sans bloquer
      res.json(liste);
    } catch (e: any) {
      console.error("[Livrables] liste tâche:", e?.message);
      res.status(500).json({ message: "livrables_read_failed" });
    }
  });

  app.get("/api/projects/:id/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const liste = await listerLivrables(req.userId, { projectId: Number(req.params.id) });
      rattraperMemoire(livrablesDeps, liste).catch(() => {});
      res.json(liste);
    } catch (e: any) {
      console.error("[Livrables] liste projet:", e?.message);
      res.status(500).json({ message: "livrables_read_failed" });
    }
  });

  app.post("/api/livrables/upload-url", isAuthenticated, async (req: any, res) => {
    try {
      const { kind, filename, contentType, size } = req.body ?? {};
      if ((kind !== "media" && kind !== "fichier") || !filename || !contentType) {
        return res.status(400).json({ message: "kind_filename_contentType_required" });
      }
      if (!typeAccepte(kind, contentType)) return res.status(400).json({ message: "unsupported_content_type" });
      if (!Number.isFinite(Number(size)) || Number(size) <= 0 || Number(size) > limiteOctets(kind, contentType)) {
        return res.status(400).json({ message: "file_too_large" });
      }
      if (kind === "fichier") {
        if (!privateStorageConfigured()) return res.status(503).json({ message: "private_storage_not_configured" });
        const out = await createPrivateUploadUrl({ userId: req.userId, filename, contentType });
        return res.json({ uploadUrl: out.uploadUrl, url: out.key });
      }
      if (!r2Configured()) return res.status(503).json({ message: "storage_not_configured" });
      const out = await createUploadUrl({ userId: req.userId, filename, contentType });
      res.json({ uploadUrl: out.uploadUrl, url: out.publicUrl });
    } catch (e: any) {
      console.error("[Livrables] upload-url:", e?.message);
      res.status(500).json({ message: "upload_url_failed" });
    }
  });

  app.post("/api/livrables", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const { taskId, kind, content, url, fileName, mimeType, size } = req.body ?? {};
      if (!KINDS.includes(kind)) return res.status(400).json({ message: "invalid_kind" });
      if (kind === "lien" && !(typeof url === "string" && lienValide(url))) {
        return res.status(400).json({ message: "invalid_url" });
      }
      if (kind === "texte" && !(typeof content === "string" && content.trim())) {
        return res.status(400).json({ message: "content_required" });
      }
      if ((kind === "media" || kind === "fichier") && !(typeof url === "string" && url)) {
        return res.status(400).json({ message: "url_required" });
      }
      if (kind === "fichier" && !url.startsWith(`livrables/${userId}/`)) {
        return res.status(400).json({ message: "invalid_url" }); // jamais la clé d'un autre compte
      }

      const task = taskId != null ? await storage.getTask(Number(taskId), userId) : undefined;
      if (taskId != null && !task) return res.status(404).json({ message: "task_not_found" });

      // Tâche sans projet → marque active (validé le 6 oct. 2026).
      let projectId: number | null = (task as any)?.projectId ?? null;
      if (projectId == null) {
        const prefs = await storage.getUserPreferences(userId);
        projectId = (prefs as any)?.activeProjectId ?? null;
      }

      const l = await creerLivrable(livrablesDeps, {
        userId,
        taskId: task ? task.id : null,
        taskTitle: task ? task.title : null,
        projectId,
        kind,
        content: typeof content === "string" ? content : null,
        url: typeof url === "string" ? url : null,
        fileName: typeof fileName === "string" ? fileName : null,
        mimeType: typeof mimeType === "string" ? mimeType : null,
        size: Number.isFinite(Number(size)) ? Number(size) : null,
      });
      res.status(201).json(l);
    } catch (e: any) {
      console.error("[Livrables] création:", e?.message);
      res.status(500).json({ message: "livrable_create_failed" });
    }
  });

  app.patch("/api/livrables/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { content } = req.body ?? {};
      const l = await modifierLivrable(livrablesDeps, Number(req.params.id), req.userId,
        typeof content === "string" ? content : null);
      if (!l) return res.status(404).json({ message: "not_found" });
      res.json(l);
    } catch (e: any) {
      console.error("[Livrables] modification:", e?.message);
      res.status(500).json({ message: "livrable_update_failed" });
    }
  });

  app.delete("/api/livrables/:id", isAuthenticated, async (req: any, res) => {
    try {
      const ok = await supprimerLivrable(livrablesDeps, Number(req.params.id), req.userId);
      if (!ok) return res.status(404).json({ message: "not_found" });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Livrables] suppression:", e?.message);
      res.status(500).json({ message: "livrable_delete_failed" });
    }
  });

  app.get("/api/livrables/:id/fichier", isAuthenticated, async (req: any, res) => {
    try {
      const l = await livrablesDeps.lire(Number(req.params.id), req.userId);
      if (!l || l.kind !== "fichier" || !l.url) return res.status(404).json({ message: "not_found" });
      const lien = await createPrivateDownloadUrl(l.url, l.fileName ?? "fichier");
      res.redirect(302, lien);
    } catch (e: any) {
      console.error("[Livrables] lecture fichier:", e?.message);
      res.status(500).json({ message: "file_read_failed" });
    }
  });
}
```

Avant d'écrire, vérifier dans `server/storage.ts` la signature exacte de lecture d'une tâche filtrée par utilisateur (`getTask(id, userId)` ou équivalent : `grep -n "async getTask" server/storage.ts`) et d'où vient `isAuthenticated` dans `server/routes.ts` (`grep -n "isAuthenticated" server/routes.ts | head -2`) ; adapter les deux imports en conséquence.

- [ ] **Step 3 : enregistrer les routes**

Dans `server/routes.ts` : `import { registerLivrablesRoutes } from "./routes-livrables";` près des autres imports, et `registerLivrablesRoutes(app);` dans `registerRoutes`, à côté des autres déclarations `app.*` (n'importe où avant la création du serveur HTTP).

- [ ] **Step 4 : vérifier**

Run : `npx tsc --noEmit && npm test`
Expected : zéro erreur, suite verte.

- [ ] **Step 5 : commit**

```bash
git add server/services/livrables/deps.ts server/routes-livrables.ts server/routes.ts
git commit -m "feat(livrables): routes et dépendances réelles (Drizzle, R2, mémoire)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 : Client — API et upload

**Files:**
- Create: `client/src/lib/livrables-api.ts`

**Interfaces:**
- Consumes : `limiteOctets`, `typeAccepte`, `LivrableKind` (Task 1) ; routes (Task 6).
- Produces :
  - `type LivrableClient` (= forme JSON de `Livrable`)
  - `televerser(kind: "media" | "fichier", file: File): Promise<{ url: string }>` — lève `Error("file_too_large" | "unsupported_content_type" | "private_storage_not_configured" | "upload_failed")`
  - `creerLivrableApi(body): Promise<LivrableClient>`, `modifierLivrableApi(id, content)`, `supprimerLivrableApi(id)`
  - clés de requête : `cleLivrablesTache(taskId) = ["/api/tasks", taskId, "livrables"]`, `cleLivrablesProjet(projectId) = ["/api/projects", projectId, "livrables"]`

- [ ] **Step 1 : implémenter**

```ts
// client/src/lib/livrables-api.ts
import { apiRequest } from "@/lib/queryClient";
import { limiteOctets, typeAccepte, type LivrableKind } from "@shared/livrables";
import type { Livrable } from "@shared/schema";

export type LivrableClient = Omit<Livrable, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export const cleLivrablesTache = (taskId: number) => [`/api/tasks/${taskId}/livrables`] as const;
export const cleLivrablesProjet = (projectId: number) => [`/api/projects/${projectId}/livrables`] as const;

/** Upload direct vers R2 via URL présignée. Vérifie taille et type AVANT d'envoyer. */
export async function televerser(kind: "media" | "fichier", file: File): Promise<{ url: string }> {
  const contentType = file.type || "application/octet-stream";
  if (!typeAccepte(kind, contentType)) throw new Error("unsupported_content_type");
  if (file.size > limiteOctets(kind, contentType)) throw new Error("file_too_large");

  const res = await fetch("/api/livrables/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ kind, filename: file.name, contentType, size: file.size }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "upload_failed");
  }
  const { uploadUrl, url } = await res.json();
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (!put.ok) throw new Error("upload_failed");
  return { url };
}

export async function creerLivrableApi(body: {
  taskId: number;
  kind: LivrableKind;
  content?: string | null;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
}): Promise<LivrableClient> {
  return (await apiRequest("POST", "/api/livrables", body)).json();
}

export async function modifierLivrableApi(id: number, content: string | null): Promise<LivrableClient> {
  return (await apiRequest("PATCH", `/api/livrables/${id}`, { content })).json();
}

export async function supprimerLivrableApi(id: number): Promise<void> {
  await apiRequest("DELETE", `/api/livrables/${id}`);
}
```

La clé de requête est la **chaîne d'URL seule** : la `queryFn` par défaut (`client/src/lib/queryClient.ts` → `getQueryFn`) fait `fetch(queryKey[0])`. Une clé en plusieurs segments casserait ce fetch.

- [ ] **Step 2 : vérifier**

Run : `npx tsc --noEmit`
Expected : zéro erreur.

- [ ] **Step 3 : commit**

```bash
git add client/src/lib/livrables-api.ts
git commit -m "feat(livrables): client — API et upload direct R2 avec contrôles avant envoi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 : Section « Ce que tu as produit » dans la tâche

**Files:**
- Create: `client/src/components/livrables/LivrablesSection.tsx`
- Create: `client/src/components/livrables/LivrableCarte.tsx`
- Modify: `client/src/components/task-workspace.tsx`
- Modify: `client/src/locales/fr.ts`, `client/src/locales/en.ts`
- Test: `client/src/locales/keys-exist.test.ts`, `jsx-guard.test.ts` (existants)

**Interfaces:**
- Consumes : Task 7.
- Produces :
  - `<LivrablesSection taskId={number} taskTitle={string} focus={boolean} onFaitHorsNaya?={() => void} />`
  - `TaskWorkspaceProps` gagne `focusLivrables?: boolean` et `onFaitHorsNaya?: () => void`.

- [ ] **Step 1 : clés de traduction**

Dans `client/src/locales/fr.ts`, ajouter une section de premier niveau (à côté de `taskWorkspace`) :

```ts
 livrables: {
 title: "Ce que tu as produit",
 addText: "Texte",
 addMedia: "Photo/vidéo",
 addFile: "Fichier",
 addLink: "Lien",
 description: "Description",
 descriptionPlaceholder: "Ce que tu observes, ce que ça dit de ton univers…",
 note: "Note (facultatif)",
 textPlaceholder: "Écris ici ce que la tâche te demandait…",
 linkPlaceholder: "https://…",
 save: "Déposer",
 saving: "Dépôt…",
 retry: "Réessayer",
 remove: "Supprimer",
 open: "Ouvrir",
 edit: "Modifier",
 empty: "Rien de déposé pour l'instant.",
 fileSoon: "Bientôt disponible",
 askTitle: "Tu l'as fait ? Dépose-le ici.",
 askBody: "Ce que tu déposes sert à tes posts et aide Naya à mieux te connaître.",
 doneOutside: "Fait hors Naya",
 fromTask: "Tâche : {{title}}",
 projectTitle: "Livrables",
 projectEmpty: "Aucun livrable déposé pour ce projet.",
 err_file_too_large: "Fichier trop lourd (25 Mo max, 200 Mo pour une vidéo).",
 err_unsupported_content_type: "Ce type de fichier n'est pas accepté.",
 err_private_storage_not_configured: "Le dépôt de fichiers n'est pas encore activé.",
 err_invalid_url: "Ce lien n'est pas valide (il doit commencer par http:// ou https://).",
 err_upload_failed: "L'envoi a échoué. Ta description est gardée, réessaie.",
 err_generic: "Le dépôt a échoué. Réessaie.",
 },
```

Dans `client/src/locales/en.ts`, la même section avec les mêmes clés :

```ts
 livrables: {
 title: "What you produced",
 addText: "Text",
 addMedia: "Photo/video",
 addFile: "File",
 addLink: "Link",
 description: "Description",
 descriptionPlaceholder: "What you notice, what it says about your world…",
 note: "Note (optional)",
 textPlaceholder: "Write here what the task asked for…",
 linkPlaceholder: "https://…",
 save: "Submit",
 saving: "Submitting…",
 retry: "Retry",
 remove: "Remove",
 open: "Open",
 edit: "Edit",
 empty: "Nothing submitted yet.",
 fileSoon: "Coming soon",
 askTitle: "Done? Drop it here.",
 askBody: "What you submit feeds your posts and helps Naya know you better.",
 doneOutside: "Done outside Naya",
 fromTask: "Task: {{title}}",
 projectTitle: "Deliverables",
 projectEmpty: "No deliverables for this project yet.",
 err_file_too_large: "File too large (25 MB max, 200 MB for a video).",
 err_unsupported_content_type: "This file type isn't accepted.",
 err_private_storage_not_configured: "File uploads aren't enabled yet.",
 err_invalid_url: "This link isn't valid (it must start with http:// or https://).",
 err_upload_failed: "Upload failed. Your description is kept, try again.",
 err_generic: "Submission failed. Try again.",
 },
```

- [ ] **Step 2 : `LivrableCarte.tsx`** (un livrable déposé)

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Link2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LivrableClient } from "@/lib/livrables-api";

export function LivrableCarte({
  livrable, onModifier, onSupprimer, enCours,
}: {
  livrable: LivrableClient;
  onModifier: (content: string | null) => void;
  onSupprimer: () => void;
  enCours: boolean;
}) {
  const { t } = useTranslation();
  const [edition, setEdition] = useState(false);
  const [texte, setTexte] = useState(livrable.content ?? "");

  return (
    <div className="rounded-md border border-naya-olive-10 bg-white p-3 space-y-2">
      <div className="flex items-start gap-3">
        {livrable.kind === "media" && livrable.url && (
          livrable.mimeType?.startsWith("video/")
            ? <video src={livrable.url} className="h-16 w-16 rounded object-cover" muted />
            : <img src={livrable.url} alt={livrable.content ?? ""} className="h-16 w-16 rounded object-cover" />
        )}
        {livrable.kind === "fichier" && <FileText className="h-5 w-5 text-naya-olive-55 mt-0.5" />}
        {livrable.kind === "lien" && <Link2 className="h-5 w-5 text-naya-olive-55 mt-0.5" />}
        <div className="flex-1 min-w-0 text-sm">
          {livrable.kind === "fichier" && (
            <a href={`/api/livrables/${livrable.id}/fichier`} target="_blank" rel="noreferrer" className="underline break-all">
              {livrable.fileName ?? t("livrables.open")}
            </a>
          )}
          {livrable.kind === "lien" && livrable.url && (
            <a href={livrable.url} target="_blank" rel="noreferrer" className="underline break-all">{livrable.url}</a>
          )}
          {!edition && livrable.content && <p className="whitespace-pre-wrap text-foreground">{livrable.content}</p>}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label={t("livrables.edit")} onClick={() => setEdition(true)} disabled={enCours}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t("livrables.remove")} onClick={onSupprimer} disabled={enCours}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {edition && (
        <div className="space-y-2">
          <Textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} />
          <Button size="sm" disabled={enCours} onClick={() => { onModifier(texte.trim() || null); setEdition(false); }}>
            {t("livrables.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3 : `LivrablesSection.tsx`**

```tsx
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPT_FICHIER, lienValide } from "@shared/livrables";
import {
  cleLivrablesTache, creerLivrableApi, modifierLivrableApi, supprimerLivrableApi, televerser,
  type LivrableClient,
} from "@/lib/livrables-api";
import { LivrableCarte } from "./LivrableCarte";

type Brouillon =
  | { id: string; kind: "media" | "fichier"; file: File; apercu: string | null; content: string; erreur: string | null; envoi: boolean }
  | { id: string; kind: "texte" | "lien"; url: string; content: string; erreur: string | null; envoi: boolean };

export default function LivrablesSection({
  taskId, focus, onFaitHorsNaya,
}: {
  taskId: number;
  focus: boolean;
  onFaitHorsNaya?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const media = useRef<HTMLInputElement>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const [brouillons, setBrouillons] = useState<Brouillon[]>([]);

  const { data: livrables = [] } = useQuery<LivrableClient[]>({ queryKey: cleLivrablesTache(taskId) });
  const { data: config } = useQuery<{ fichiers: boolean; medias: boolean }>({ queryKey: ["/api/livrables/config"] });

  const invalider = () => qc.invalidateQueries({ queryKey: cleLivrablesTache(taskId) });
  const maj = (id: string, patch: Partial<Brouillon>) =>
    setBrouillons((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Brouillon) : b)));
  const nouvelId = () => Math.random().toString(36).slice(2);

  const ajouterFichiers = (kind: "media" | "fichier", files: FileList | null) => {
    if (!files) return;
    const nouveaux: Brouillon[] = Array.from(files).map((file) => ({
      id: nouvelId(), kind, file, content: "", erreur: null, envoi: false,
      apercu: kind === "media" && file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setBrouillons((bs) => [...bs, ...nouveaux]);
  };

  const deposer = async (b: Brouillon) => {
    maj(b.id, { envoi: true, erreur: null });
    try {
      if (b.kind === "media" || b.kind === "fichier") {
        const { url } = await televerser(b.kind, b.file);
        await creerLivrableApi({
          taskId, kind: b.kind, url, content: b.content || null,
          fileName: b.file.name, mimeType: b.file.type, size: b.file.size,
        });
        if (b.apercu) URL.revokeObjectURL(b.apercu);
      } else {
        if (b.kind === "lien" && !lienValide(b.url)) throw new Error("invalid_url");
        await creerLivrableApi({ taskId, kind: b.kind, url: b.kind === "lien" ? b.url : null, content: b.content || null });
      }
      setBrouillons((bs) => bs.filter((x) => x.id !== b.id));
      invalider();
    } catch (e: any) {
      const cle = `livrables.err_${e?.message}`;
      const msg = t(cle) === cle ? t("livrables.err_generic") : t(cle);
      maj(b.id, { envoi: false, erreur: msg });
    }
  };

  const modifier = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string | null }) => modifierLivrableApi(id, content),
    onSuccess: invalider,
  });
  const supprimer = useMutation({
    mutationFn: (id: number) => supprimerLivrableApi(id),
    onSuccess: invalider,
  });

  return (
    <section className={`space-y-3 rounded-lg p-3 ${focus ? "ring-2 ring-naya-sulphur/60 bg-naya-sulphur/5" : ""}`}>
      <h3 className="text-sm font-semibold text-foreground">{t("livrables.title")}</h3>

      {focus && livrables.length === 0 && (
        <div className="text-sm space-y-2">
          <p className="font-medium">{t("livrables.askTitle")}</p>
          <p className="text-muted-foreground">{t("livrables.askBody")}</p>
          {onFaitHorsNaya && (
            <Button size="sm" variant="outline" onClick={onFaitHorsNaya}>{t("livrables.doneOutside")}</Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() =>
          setBrouillons((bs) => [...bs, { id: nouvelId(), kind: "texte", url: "", content: "", erreur: null, envoi: false }])}>
          {t("livrables.addText")}
        </Button>
        <Button size="sm" variant="outline" disabled={config ? !config.medias : false} onClick={() => media.current?.click()}>
          {t("livrables.addMedia")}
        </Button>
        <Button size="sm" variant="outline" disabled={!config?.fichiers} title={config?.fichiers ? undefined : t("livrables.fileSoon")}
          onClick={() => fichier.current?.click()}>
          {t("livrables.addFile")}{config && !config.fichiers ? ` · ${t("livrables.fileSoon")}` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() =>
          setBrouillons((bs) => [...bs, { id: nouvelId(), kind: "lien", url: "", content: "", erreur: null, envoi: false }])}>
          {t("livrables.addLink")}
        </Button>
        <input ref={media} type="file" accept="image/*,video/*" multiple hidden
          onChange={(e) => { ajouterFichiers("media", e.target.files); e.target.value = ""; }} />
        <input ref={fichier} type="file" accept={ACCEPT_FICHIER} multiple hidden
          onChange={(e) => { ajouterFichiers("fichier", e.target.files); e.target.value = ""; }} />
      </div>

      {brouillons.map((b) => (
        <div key={b.id} className="rounded-md border border-dashed border-naya-olive-18 p-3 space-y-2">
          {b.kind === "media" && b.apercu && <img src={b.apercu} alt="" className="h-24 rounded object-cover" />}
          {(b.kind === "media" || b.kind === "fichier") && <p className="text-xs text-muted-foreground break-all">{b.file.name}</p>}
          {b.kind === "lien" && (
            <Input placeholder={t("livrables.linkPlaceholder")} value={b.url} onChange={(e) => maj(b.id, { url: e.target.value })} />
          )}
          <Textarea
            rows={b.kind === "texte" ? 5 : 2}
            placeholder={b.kind === "texte" ? t("livrables.textPlaceholder") : b.kind === "media" ? t("livrables.descriptionPlaceholder") : t("livrables.note")}
            value={b.content}
            onChange={(e) => maj(b.id, { content: e.target.value })}
          />
          {b.erreur && <p className="text-xs text-naya-mauve">{b.erreur}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={b.envoi} onClick={() => deposer(b)}>
              {b.envoi ? t("livrables.saving") : b.erreur ? t("livrables.retry") : t("livrables.save")}
            </Button>
            <Button size="sm" variant="ghost" disabled={b.envoi} onClick={() => setBrouillons((bs) => bs.filter((x) => x.id !== b.id))}>
              {t("livrables.remove")}
            </Button>
          </div>
        </div>
      ))}

      {livrables.length === 0 && brouillons.length === 0 && !focus && (
        <p className="text-xs text-muted-foreground">{t("livrables.empty")}</p>
      )}
      {livrables.map((l) => (
        <LivrableCarte key={l.id} livrable={l} enCours={modifier.isPending || supprimer.isPending}
          onModifier={(content) => modifier.mutate({ id: l.id, content })}
          onSupprimer={() => supprimer.mutate(l.id)} />
      ))}
    </section>
  );
}
```

Vérifier que `Input`, `Textarea`, `Button` existent bien sous `client/src/components/ui/` (ils sont utilisés par `task-workspace.tsx`) et que la classe `text-naya-mauve` existe (utilisée dans `brand-dna-editor.tsx`).

- [ ] **Step 4 : brancher dans `TaskWorkspace`**

Dans `client/src/components/task-workspace.tsx` :
- `interface TaskWorkspaceProps` : ajouter `focusLivrables?: boolean;` et `onFaitHorsNaya?: () => void;`.
- Signature : `export default function TaskWorkspace({ task, project, open, onClose, onDeleted, focusLivrables = false, onFaitHorsNaya }: TaskWorkspaceProps)`.
- Import : `import LivrablesSection from "@/components/livrables/LivrablesSection";`.
- Dans le corps scrollable, **juste après** le bloc qui contient le `<Textarea` principal (et ses boutons d'enregistrement), ajouter :

```tsx
 {task && (
 <LivrablesSection taskId={task.id} focus={focusLivrables} onFaitHorsNaya={onFaitHorsNaya} />
 )}
```

Si `focusLivrables` est vrai, faire défiler jusqu'à la section à l'ouverture : donner `id="livrables-section"` au wrapper et, dans un `useEffect([open, focusLivrables])`, `document.getElementById("livrables-section")?.scrollIntoView({ block: "start" })`.

- [ ] **Step 5 : vérifier**

Run : `npx tsc --noEmit && npx vitest run client/src/locales`
Expected : zéro erreur ; `keys-exist`, `locales` et `jsx-guard` verts. Si `jsx-guard` signale un texte en dur dans un fichier **nouveau**, le passer par `t()` (ne jamais l'ajouter à la référence). Si `task-workspace.tsx` passe **sous** sa référence, mettre à jour `jsx-baseline.json` avec la commande indiquée en tête de `jsx-guard.test.ts`.

- [ ] **Step 6 : commit**

```bash
git add client/src/components/livrables/ client/src/components/task-workspace.tsx client/src/locales/
git commit -m "feat(livrables): section « Ce que tu as produit » dans la tâche

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 : Demander le livrable au cochage

**Files:**
- Create: `client/src/hooks/useCocherAvecLivrable.ts`
- Modify: `client/src/pages/planning.tsx` (mutation `toggleMutation`, `setWorkspaceTask`, rendu `<TaskWorkspace`)
- Modify: `client/src/components/todays-tasks.tsx` (`toggleTaskMutation`, ouverture de `<TaskWorkspace`)

**Interfaces:**
- Consumes : `decisionAuCochage` (Task 1) ; `cleLivrablesTache` (Task 7) ; props `focusLivrables`, `onFaitHorsNaya` (Task 8).
- Produces : `useCocherAvecLivrable(options: { cocher: (taskId: number) => void; ouvrirDepot: (task: TacheMin) => void }): (task: TacheMin) => Promise<void>` avec `type TacheMin = { id: number; title: string; completed: boolean }`.

- [ ] **Step 1 : le hook**

```ts
// client/src/hooks/useCocherAvecLivrable.ts
// Cocher une tâche de production sans livrable ouvre le dépôt au lieu de cocher.
// « Naya demande, sans bloquer » : la sortie « Fait hors Naya » coche quand même.
import { useQueryClient } from "@tanstack/react-query";
import { decisionAuCochage } from "@shared/livrables";
import { cleLivrablesTache, type LivrableClient } from "@/lib/livrables-api";

export type TacheMin = { id: number; title: string; completed: boolean };

export function useCocherAvecLivrable(options: {
  cocher: (taskId: number) => void;
  ouvrirDepot: (task: TacheMin) => void;
}) {
  const qc = useQueryClient();
  return async (task: TacheMin) => {
    let nbLivrables = 0;
    if (!task.completed) {
      try {
        const liste = await qc.fetchQuery<LivrableClient[]>({ queryKey: cleLivrablesTache(task.id), staleTime: 0 });
        nbLivrables = liste?.length ?? 0;
      } catch {
        // Lecture impossible : on ne bloque jamais le cochage.
        options.cocher(task.id);
        return;
      }
    }
    const decision = decisionAuCochage({ titre: task.title, dejaTerminee: task.completed, nbLivrables });
    if (decision === "demander") options.ouvrirDepot(task);
    else options.cocher(task.id);
  };
}
```

- [ ] **Step 2 : `planning.tsx`**

- Ajouter un état `const [focusLivrables, setFocusLivrables] = useState(false);`.
- Créer le gestionnaire :

```ts
  const cocherAvecLivrable = useCocherAvecLivrable({
    cocher: (id) => toggleMutation.mutate(id),
    ouvrirDepot: (task) => { setFocusLivrables(true); setWorkspaceTask(task as any); },
  });
```

- Remplacer chaque `toggleMutation.mutate(task.id)` passé à un `onCheckedChange` par `cocherAvecLivrable(task)`, et chaque `onToggle={(taskId) => toggleMutation.mutate(taskId)}` par un `onToggle` qui retrouve la tâche puis appelle `cocherAvecLivrable(task)` (si le composant enfant ne transmet que l'id, retrouver la tâche dans la liste déjà chargée de la page ; si elle est introuvable, garder `toggleMutation.mutate(taskId)`).
- Partout où l'on ouvre le workspace par un **clic simple** (`onClick={() => setWorkspaceTask(task)}`), remettre `setFocusLivrables(false)` avant.
- Sur `<TaskWorkspace … />` : ajouter

```tsx
            focusLivrables={focusLivrables}
            onFaitHorsNaya={() => {
              if (workspaceTask) toggleMutation.mutate(workspaceTask.id);
              setFocusLivrables(false);
              setWorkspaceTask(null);
            }}
```

et dans son `onClose`, ajouter `setFocusLivrables(false)`.

- [ ] **Step 3 : `todays-tasks.tsx`** — mêmes changements autour de `toggleTaskMutation` et de l'état qui ouvre `<TaskWorkspace` (ligne d'ouverture repérée par `grep -n "TaskWorkspace" client/src/components/todays-tasks.tsx`).

- [ ] **Step 4 : vérifier**

Run : `npx tsc --noEmit && npm test`
Expected : zéro erreur, suite verte. La logique de décision est couverte par `decisionAuCochage` (Task 1) ; le hook ne fait que la brancher.

- [ ] **Step 5 : commit**

```bash
git add client/src/hooks/useCocherAvecLivrable.ts client/src/pages/planning.tsx client/src/components/todays-tasks.tsx
git commit -m "feat(livrables): cocher une tâche de production ouvre le dépôt (sans bloquer)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10 : Section « Livrables » du projet

**Files:**
- Create: `client/src/pages/project/LivrablesPanel.tsx`
- Modify: `client/src/pages/project/ProjectPage.tsx` (nouvelle `<section>` après `BrandLinksPanel`)

**Interfaces:**
- Consumes : `cleLivrablesProjet`, `LivrableClient` (Task 7) ; clés `livrables.projectTitle`, `projectEmpty`, `fromTask`, `open` (Task 8).

- [ ] **Step 1 : le panneau**

```tsx
// client/src/pages/project/LivrablesPanel.tsx
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, Link2 } from "lucide-react";
import { cleLivrablesProjet, type LivrableClient } from "@/lib/livrables-api";

export default function LivrablesPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { data: livrables = [] } = useQuery<LivrableClient[]>({ queryKey: cleLivrablesProjet(projectId) });

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-2">{t("livrables.projectTitle")}</h2>
      {livrables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("livrables.projectEmpty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {livrables.map((l) => (
            <li key={l.id} className="rounded-md border border-border bg-white p-3 flex gap-3">
              {l.kind === "media" && l.url && !l.mimeType?.startsWith("video/") && (
                <img src={l.url} alt={l.content ?? ""} className="h-14 w-14 rounded object-cover" />
              )}
              {l.kind === "fichier" && <FileText className="h-5 w-5 text-naya-olive-55" />}
              {l.kind === "lien" && <Link2 className="h-5 w-5 text-naya-olive-55" />}
              <div className="min-w-0 text-sm">
                {l.kind === "fichier" && (
                  <a href={`/api/livrables/${l.id}/fichier`} target="_blank" rel="noreferrer" className="underline break-all">
                    {l.fileName ?? t("livrables.open")}
                  </a>
                )}
                {l.kind === "lien" && l.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="underline break-all">{l.url}</a>
                )}
                {l.content && <p className="line-clamp-3 whitespace-pre-wrap">{l.content}</p>}
                {l.taskTitle && (
                  <p className="text-xs text-muted-foreground mt-1">{t("livrables.fromTask", { title: l.taskTitle })}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : l'insérer** dans `ProjectPage.tsx`, après la section `BrandLinksPanel` :

```tsx
            <section>
              <LivrablesPanel projectId={id} />
            </section>
```

avec `import LivrablesPanel from "./LivrablesPanel";`. Vérifier que `id` est bien un `number` à cet endroit (il est déjà passé à `ConversionsPanel`).

- [ ] **Step 3 : vérifier**

Run : `npx tsc --noEmit && npm test`
Expected : zéro erreur, suite verte (dont `jsx-guard`).

- [ ] **Step 4 : commit**

```bash
git add client/src/pages/project/LivrablesPanel.tsx client/src/pages/project/ProjectPage.tsx
git commit -m "feat(livrables): section Livrables sur la page projet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11 : Migration en prod, déploiement, vérification (avec Jeanne)

**Aucune étape de cette tâche ne s'exécute sans l'accord explicite de Jeanne dans le chat.**

- [ ] **Step 1 : montrer la migration**

Afficher `migrations/0018_*.sql` en entier à Jeanne. Attendre son accord.

- [ ] **Step 2 : sauvegarde Neon**

Jeanne crée une branche de sauvegarde Neon (console Neon → Branches → Create branch depuis `main`), ou autorise explicitement à le faire. Noter le nom de la branche.

- [ ] **Step 3 : appliquer**

Run (avec la `DATABASE_URL` de prod, après accord) : `npm run db:migrate`
Expected : la migration 0018 s'applique, aucune autre. Montrer la sortie à Jeanne.

- [ ] **Step 4 : déployer**

Après accord : `git push origin main`. Attendre le déploiement Railway (`railway deployment list` → `SUCCESS`), puis `curl -s https://www.hellonaya.app/api/health`.

- [ ] **Step 5 : vérification par Jeanne**

Sur sa tâche « Photographier 3 détails… » : cocher → le dépôt s'ouvre ; déposer 3 photos avec description ; vérifier qu'elles apparaissent dans la tâche, dans la médiathèque (calendrier de contenu → médias) et dans la section Livrables du projet ; « Fait hors Naya » sur une autre tâche de production coche sans dépôt ; « Appeler … » se coche directement. Le bouton Fichier affiche « Bientôt disponible ».

- [ ] **Step 6 : bucket privé (guidé)**

Guider Jeanne : Cloudflare → R2 → Create bucket (ex. `naya-livrables-prive`), **sans** domaine public ni accès public ; puis Railway → service naya → Variables → `R2_PRIVATE_BUCKET=naya-livrables-prive`. Après redéploiement, vérifier qu'un PDF se dépose et s'ouvre via le lien temporaire, et que l'URL de la page n'est pas une URL publique R2.
