# Les liens entre marques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naya apprend quelles marques de l'utilisatrice sont liées et comment, s'en sert pour articuler les campagnes entre elles, et l'alerte quand deux marques dont les audiences se recoupent s'apprêtent à servir le même angle la même semaine.

**Architecture:** Une table `project_links` orientée, déclarée à la main, dont le sens et le recoupement d'audiences sont structurés et dont les rôles sont du texte libre. L'absence de ligne est une interdiction de rapprocher deux marques. Deux colonnes sur `campaigns` portent la décision ponctuelle d'articulation. À la génération, une étape zéro propose l'articulation et son choix injecte un bloc **borné** dans le prompt. Au placement d'un contenu, un appel modèle rapide juge le recouvrement d'angle avec la marque liée et alerte sans bloquer.

**Tech Stack:** TypeScript, Express, Drizzle ORM + PostgreSQL (Neon), vitest, React + react-query + shadcn/ui, Claude via `server/services/claude.ts`.

**Spec:** `docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md` — à lire en entier avant la première tâche. C'est l'autorité ; ce plan n'en est que l'argument.

## Global Constraints

- **L'absence de lien est une interdiction, pas un silence.** Sans lien déclaré, Naya ne mentionne jamais une marque dans le travail d'une autre et ne s'appuie sur rien de l'autre. À écrire dans les commentaires du schéma **et** dans les prompts.
- **Aucun partage d'identité entre marques liées** : l'ADN de marque, la mémoire et les observations de réception de la marque liée n'entrent **jamais** dans un prompte. Connaître la relation n'est pas partager la matière.
- **Naya propose, l'utilisatrice tranche.** L'articulation n'est jamais imposée, et le choix est persisté pour que la question ne revienne pas.
- **L'alerte de collision ne bloque jamais** la programmation, et ne s'affiche **que** s'il y a recouvrement. Pas de message « aucun conflit détecté ».
- **L'anti-collision ne s'exécute qu'au placement**, jamais à la génération. Décision de Jeanne, contre la recommandation initiale.
- **Sans lien déclaré, la génération est strictement identique à aujourd'hui** : aucune étape zéro, aucun champ ajouté au prompt.
- **`weekContext` n'est pas modifié.** L'articulation passe par un champ dédié.
- **Aucun compteur, aucune relance, aucune formulation de reproche** dans les textes ajoutés.
- **Périmètre utilisateur** : chaque endpoint filtre sur l'utilisateur courant ; une ressource d'autrui est **introuvable** (404), jamais interdite (403) — un 403 confirmerait son existence.
- Code, commentaires et textes d'interface en français.
- **Vérification :** `npx vitest run` (1444 tests verts au départ), `npx tsc --noEmit` à **zéro** erreur, `npm run build` vert.
- **Migrations :** `npx drizzle-kit generate`, relecture du SQL à la main, `npm run db:migrate` sur dev. **Jamais `db:push`.** La dernière migration est `0016_sturdy_smasher.sql`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `shared/schema.ts` (modifié) | table `project_links`, deux colonnes sur `campaigns`, import `AnyPgColumn` |
| `server/services/brand-links/links.ts` | validation d'un lien et formatage du bloc d'articulation pour le prompt. **Pur.** |
| `server/services/brand-links/articulation.ts` | lecture des liens et des campagnes liées d'une marque |
| `server/services/brand-links/collision.ts` | fenêtre de comparaison, appel modèle, lecture de la sortie |
| `server/services/brand-links/*.test.ts` | tests colocalisés |
| `server/routes.ts` (modifié) | 4 endpoints de liens, `GET /api/campaigns/articulation`, branchement de l'alerte |
| `server/services/openai.ts` (modifié) | `articulation` dans `CampaignGenerationRequest` et dans les deux prompts |
| `client/src/pages/project/BrandLinksPanel.tsx` | l'écran de déclaration |
| `client/src/pages/project/ProjectPage.tsx` (modifié) | montage du panneau |
| `client/src/pages/campaigns.tsx` (modifié) | l'étape zéro et l'affichage de l'alerte |

---

### Task 1 : le schéma et la migration

**Files:**
- Modify: `shared/schema.ts`
- Create: `migrations/0017_*.sql` (généré)

**Interfaces:**
- Consumes: rien.
- Produces: `projectLinks` (table), `ProjectLink = typeof projectLinks.$inferSelect`, et les colonnes `campaigns.articuleAvecCampaignId` / `campaigns.articulationIndependante`. Consommés par toutes les tâches suivantes, client compris.

- [ ] **Step 1: Ajouter `AnyPgColumn` aux imports**

En tête de `shared/schema.ts`, la liste importée de `drizzle-orm/pg-core` **ne contient pas** `AnyPgColumn` (vérifié le 30/09). Ajoute-le :

```typescript
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  boolean,
  integer,
  unique,
  uniqueIndex,
  doublePrecision,
  vector,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Ajouter la table `project_links`**

À la suite de la définition de `projects` dans `shared/schema.ts` :

```typescript
// ════════════════════════════════════════════════════════════════════════════════
// LES LIENS ENTRE MARQUES.
// Voir docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Un lien ORIENTÉ entre deux marques : `from` nourrit `to`.
 *
 * L'ABSENCE de ligne est une INTERDICTION, pas un vide. Sans lien déclaré, Naya ne
 * rapproche jamais deux marques — elle ne mentionne pas l'une dans le travail de
 * l'autre et ne s'appuie sur rien de l'autre, même quand le rapprochement lui paraît
 * évident. C'est la règle que l'utilisatrice a posée deux fois : certaines de ses
 * marques n'ont aucun rapport, et ça compte autant que celles qui en ont.
 *
 * Le sens et le recoupement d'audiences sont STRUCTURÉS parce qu'ils font agir le
 * code. Les rôles et la nature sont du TEXTE LIBRE, dans les mots de l'utilisatrice :
 * ce projet dérive ses critères du contexte de chaque utilisateur, il n'universalise
 * pas une taxonomie de types de liens.
 */
export const projectLinks = pgTable("project_links", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromProjectId: integer("from_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  toProjectId: integer("to_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  roleAmont: text("role_amont"),   // ce que fait la marque qui nourrit
  roleAval: text("role_aval"),     // ce que fait la marque nourrie
  nature: text("nature"),          // pourquoi elles sont liées, et les interdits
  // Conditionne l'alerte de collision : sans recoupement, pas de contrôle.
  audiencesRecoupent: boolean("audiences_recoupent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  sensIdx: uniqueIndex("project_link_sens_idx").on(t.userId, t.fromProjectId, t.toProjectId),
  versIdx: index("project_link_vers_idx").on(t.userId, t.toProjectId),
}));

export type ProjectLink = typeof projectLinks.$inferSelect;
```

- [ ] **Step 3: Ajouter les deux colonnes d'articulation à `campaigns`**

Dans la définition de `campaigns`, juste après `linkedProspectionCampaignId` :

```typescript
  // L'articulation ponctuelle avec la campagne d'une marque liée.
  //
  // Les DEUX colonnes sont nécessaires : sans le booléen, on ne distingue pas
  // « pas encore décidé » de « décidé que non », et Naya reposerait la question
  // sur une campagne que l'utilisatrice a voulue isolée.
  //
  // `campaigns` se référence elle-même : Drizzle exige alors une annotation de
  // retour explicite, sinon TypeScript échoue sur une inférence circulaire.
  articuleAvecCampaignId: integer("articule_avec_campaign_id")
    .references((): AnyPgColumn => campaigns.id, { onDelete: "set null" }),
  articulationIndependante: boolean("articulation_independante").notNull().default(false),
```

- [ ] **Step 4: Vérifier la compilation avant de générer la migration**

Run: `npx tsc --noEmit`
Expected: **zéro erreur.** Si tu vois une erreur d'inférence circulaire sur `campaigns`, c'est que l'annotation `(): AnyPgColumn =>` manque ou que l'import n'a pas été ajouté — corrige-la là, ne contourne pas avec `any`.

- [ ] **Step 5: Générer la migration**

Run: `npx drizzle-kit generate`
Expected: un fichier `migrations/0017_*.sql`.

- [ ] **Step 6: Relire le SQL à la main**

Run: `cat migrations/0017_*.sql`

Vérifier ligne par ligne : un `CREATE TABLE project_links`, deux `ALTER TABLE campaigns ADD COLUMN`, les clés étrangères (`cascade` vers `users` et `projects`, `set null` vers `campaigns`), l'index unique `project_link_sens_idx` et l'index `project_link_vers_idx`. **Aucun `DROP`, aucun `ALTER … TYPE`, aucune autre table touchée.** Si un `DROP` apparaît, **arrête-toi** et remonte-le : ce serait le signe d'une dérive entre le schéma et la base, et l'appliquer pourrait détruire des données.

- [ ] **Step 7: Appliquer sur dev et vérifier**

Run: `npm run db:migrate && npx tsc --noEmit && npm run build`
Expected: migration appliquée, zéro erreur de types, build vert.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(marques): le schema des liens entre marques et de l'articulation"
```

---

### Task 2 : la validation d'un lien et le bloc d'articulation

C'est la seule tâche entièrement pure du plan, et elle porte deux règles que rien d'autre ne fera respecter : un lien ne relie jamais une marque à elle-même, et le bloc injecté dans le prompt ne contient jamais l'identité de la marque liée.

**Files:**
- Create: `server/services/brand-links/links.ts`
- Create: `server/services/brand-links/links.test.ts`

**Interfaces:**
- Consumes: `ProjectLink` (Task 1).
- Produces:
  - `interface CampagneLiee { id: number; marque: string; name: string; objective: string; coreMessage: string | null; angles: string[] }`
  - `interface Articulation { lien: Pick<ProjectLink, "roleAmont" | "roleAval" | "nature">; sens: "nourrit" | "estNourriePar"; campagne: CampagneLiee }`
  - `valideLien(input: { fromProjectId: number; toProjectId: number }): { ok: true } | { ok: false; raison: string }`
  - `anglesDepuisPhases(phases: unknown): string[]`
  - `formaterArticulation(a: Articulation): string`

- [ ] **Step 1: Écrire les tests**

Créer `server/services/brand-links/links.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { valideLien, anglesDepuisPhases, formaterArticulation } from "./links";

describe("valideLien", () => {
  it("accepte un lien entre deux marques distinctes", () => {
    expect(valideLien({ fromProjectId: 1, toProjectId: 2 })).toEqual({ ok: true });
  });

  it("refuse qu'une marque se lie à elle-même", () => {
    const r = valideLien({ fromProjectId: 3, toProjectId: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/elle-même/i);
  });
});

describe("anglesDepuisPhases — lire un jsonb écrit par le modèle", () => {
  it("extrait les angles de phases bien formées", () => {
    const phases = [
      { name: "Amorce", angle: "montrer les coulisses" },
      { name: "Preuve", angle: "chiffres clients" },
    ];
    expect(anglesDepuisPhases(phases)).toEqual(["montrer les coulisses", "chiffres clients"]);
  });

  it("tolère un objectif ou une description à la place de l'angle", () => {
    expect(anglesDepuisPhases([{ name: "P1", objective: "asseoir la crédibilité" }])).toEqual([
      "asseoir la crédibilité",
    ]);
  });

  it("rend une liste vide sur du jsonb inattendu, sans jeter", () => {
    expect(anglesDepuisPhases(null)).toEqual([]);
    expect(anglesDepuisPhases("pas un tableau")).toEqual([]);
    expect(anglesDepuisPhases([{ name: "sans angle" }])).toEqual([]);
    expect(anglesDepuisPhases([42, null])).toEqual([]);
  });

  it("écarte les angles vides ou blancs", () => {
    expect(anglesDepuisPhases([{ angle: "   " }, { angle: "vrai angle" }])).toEqual(["vrai angle"]);
  });
});

describe("formaterArticulation — ce qui entre dans le prompt, et ce qui n'y entre JAMAIS", () => {
  const a = {
    lien: {
      roleAmont: "j'incarne, c'est moi qu'on suit",
      roleAval: "l'agence vend la méthode",
      nature: "Je suis le visage de JMD ; l'agence ne parle jamais à ma place.",
    },
    sens: "estNourriePar" as const,
    campagne: {
      id: 12,
      marque: "Jeanne Méjean",
      name: "Septembre — la méthode",
      objective: "asseoir l'autorité",
      coreMessage: "on ne vend pas une méthode, on la pratique",
      angles: ["montrer les coulisses", "chiffres clients"],
    },
  };

  it("contient le nom de la marque liée, sa campagne, son message et ses angles", () => {
    const t = formaterArticulation(a);
    expect(t).toContain("Jeanne Méjean");
    expect(t).toContain("Septembre — la méthode");
    expect(t).toContain("on ne vend pas une méthode, on la pratique");
    expect(t).toContain("montrer les coulisses");
  });

  it("contient les rôles et la nature du lien, dans les mots de l'utilisatrice", () => {
    const t = formaterArticulation(a);
    expect(t).toContain("j'incarne, c'est moi qu'on suit");
    expect(t).toContain("l'agence ne parle jamais à ma place");
  });

  it("porte la consigne d'écho et l'interdiction de parler à la place de l'autre marque", () => {
    const t = formaterArticulation(a);
    expect(t).toMatch(/écho/i);
    expect(t).toMatch(/jamais.*place de/i);
  });

  it("ne contient AUCUN champ d'identité de la marque liée — c'est la garantie centrale", () => {
    // Le type CampagneLiee ne porte volontairement ni ADN, ni mémoire, ni ton de voix.
    // Ce test vérifie que formaterArticulation ne peut rien inventer à partir de ce
    // qu'on lui donne : il n'a accès qu'aux champs de campagne et aux textes du lien.
    const t = formaterArticulation(a);
    expect(t).not.toMatch(/ADN|brand ?dna|mémoire|voix de marque|ton de voix/i);
  });

  it("reste lisible quand les champs libres sont vides", () => {
    const t = formaterArticulation({
      ...a,
      lien: { roleAmont: null, roleAval: null, nature: null },
      campagne: { ...a.campagne, coreMessage: null, angles: [] },
    });
    expect(t).toContain("Jeanne Méjean");
    expect(t).not.toContain("null");
    expect(t).not.toContain("undefined");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run server/services/brand-links/`
Expected: FAIL — le module `./links` n'existe pas.

- [ ] **Step 3: Implémenter**

Créer `server/services/brand-links/links.ts` :

```typescript
import type { ProjectLink } from "@shared/schema";

/** Une campagne de la marque liée, réduite à ce qui peut entrer dans un prompt. */
export interface CampagneLiee {
  id: number;
  marque: string;
  name: string;
  objective: string;
  coreMessage: string | null;
  angles: string[];
}

/**
 * Le contexte d'articulation. Volontairement PAUVRE : il ne porte ni ADN, ni mémoire,
 * ni ton de voix de la marque liée. Connaître la relation n'est pas partager la matière.
 */
export interface Articulation {
  lien: Pick<ProjectLink, "roleAmont" | "roleAval" | "nature">;
  sens: "nourrit" | "estNourriePar";
  campagne: CampagneLiee;
}

/** Un lien ne relie jamais une marque à elle-même. Pur. */
export function valideLien(input: { fromProjectId: number; toProjectId: number }):
  | { ok: true }
  | { ok: false; raison: string } {
  if (input.fromProjectId === input.toProjectId) {
    return { ok: false, raison: "Une marque ne peut pas être liée à elle-même." };
  }
  return { ok: true };
}

/**
 * Les angles d'une campagne, lus dans son `phases` jsonb — écrit par le modèle, donc
 * de forme incertaine. On lit `angle`, à défaut `objective`, à défaut `description`.
 * Toute forme inattendue rend une liste vide plutôt que de jeter. Pur.
 */
export function anglesDepuisPhases(phases: unknown): string[] {
  if (!Array.isArray(phases)) return [];
  const out: string[] = [];
  for (const p of phases) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const brut = [o.angle, o.objective, o.description].find((v) => typeof v === "string" && v.trim());
    if (typeof brut === "string") out.push(brut.trim());
  }
  return out;
}

/**
 * Le bloc injecté dans le prompt de génération. Il dit la relation et la campagne
 * liée, et RIEN de l'identité de l'autre marque. La dernière consigne est un
 * garde-fou produit : une marque ne parle jamais à la place d'une autre.
 */
export function formaterArticulation(a: Articulation): string {
  const { lien, sens, campagne } = a;
  const relation =
    sens === "nourrit"
      ? `La marque pour laquelle tu travailles NOURRIT « ${campagne.marque} ».`
      : `La marque pour laquelle tu travailles EST NOURRIE par « ${campagne.marque} ».`;

  const lignes: string[] = [
    "ARTICULATION AVEC UNE MARQUE LIÉE",
    relation,
  ];
  if (lien.roleAmont) lignes.push(`Rôle de la marque qui nourrit : ${lien.roleAmont}`);
  if (lien.roleAval) lignes.push(`Rôle de la marque nourrie : ${lien.roleAval}`);
  if (lien.nature) lignes.push(`Nature du lien : ${lien.nature}`);

  lignes.push(
    "",
    `Campagne en cours sur « ${campagne.marque} » : ${campagne.name}`,
    `Son objectif : ${campagne.objective}`,
  );
  if (campagne.coreMessage) lignes.push(`Son message central : ${campagne.coreMessage}`);
  if (campagne.angles.length) lignes.push(`Ses angles par phase : ${campagne.angles.join(" · ")}`);

  lignes.push(
    "",
    "Construis en ÉCHO, pas en répétition : la campagne que tu produis doit se tenir",
    "seule tout en renvoyant à celle-ci. Tu ne reprends pas ses angles, tu leur réponds.",
    "Tu ne parles JAMAIS à la place de l'autre marque et tu n'imites pas sa voix.",
  );

  return lignes.join("\n");
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/brand-links/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/brand-links/links.ts server/services/brand-links/links.test.ts
git commit -m "feat(marques): la validation d'un lien et le bloc d'articulation, purs"
```

---

### Task 3 : les endpoints de déclaration des liens

**Files:**
- Modify: `server/routes.ts` — nouveau bloc à placer **juste après** l'endpoint `POST /api/projects/:id/milestone-chain` (vers la ligne 3089), pour que les endpoints de projet restent groupés
- Create: `server/routes.brand-links.test.ts`

**Interfaces:**
- Consumes: `projectLinks`, `ProjectLink` (Task 1) ; `valideLien` (Task 2) ; `storage.getProject(id, userId)`, `isAuthenticated`, `req.userId` (motifs existants).
- Produces, consommés par la Task 8 :
  - `GET /api/projects/:id/links` → `{ sortants: ProjectLink[], entrants: ProjectLink[] }`
  - `POST /api/projects/:id/links` `{ toProjectId, roleAmont?, roleAval?, nature?, audiencesRecoupent? }` → `{ link }`
  - `PATCH /api/project-links/:id` `{ roleAmont?, roleAval?, nature?, audiencesRecoupent? }` → `{ link }`
  - `DELETE /api/project-links/:id` → `{ ok: true }`

- [ ] **Step 1: Écrire les endpoints**

Ajouter le bloc. Les imports (`projectLinks` depuis `@shared/schema`, `valideLien` depuis `./services/brand-links/links`) vont en tête de fichier ; vérifie la présence de `db`, `and`, `eq`, `or`, `desc` avant de les ajouter.

```typescript
  // ── Les liens entre marques ─────────────────────────────────────────────────
  // Spec : docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md
  //
  // Rappel de la règle centrale : l'ABSENCE de lien est une interdiction. Ces
  // endpoints ne créent donc jamais de lien implicite, et supprimer un lien ne
  // touche aucune campagne existante.

  app.get('/api/projects/:id/links', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.params.id, 10);
      if (isNaN(projectId)) return res.status(400).json({ message: "Identifiant de projet invalide" });
      // Une marque d'autrui est INTROUVABLE, pas interdite : un 403 confirmerait son existence.
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      const [sortants, entrants] = await Promise.all([
        db.select().from(projectLinks)
          .where(and(eq(projectLinks.userId, userId), eq(projectLinks.fromProjectId, projectId)))
          .orderBy(desc(projectLinks.createdAt)),
        db.select().from(projectLinks)
          .where(and(eq(projectLinks.userId, userId), eq(projectLinks.toProjectId, projectId)))
          .orderBy(desc(projectLinks.createdAt)),
      ]);
      res.json({ sortants, entrants });
    } catch (error) {
      console.error('[Liens] GET /api/projects/:id/links:', error);
      res.status(500).json({ message: "Failed to fetch brand links" });
    }
  });

  app.post('/api/projects/:id/links', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const fromProjectId = parseInt(req.params.id, 10);
      const toProjectId = parseInt(req.body?.toProjectId, 10);
      if (isNaN(fromProjectId) || isNaN(toProjectId)) {
        return res.status(400).json({ message: "Identifiants de projet invalides" });
      }

      const validation = valideLien({ fromProjectId, toProjectId });
      if (!validation.ok) return res.status(400).json({ message: validation.raison });

      // LES DEUX marques doivent appartenir à l'utilisateur. Sans ce double contrôle,
      // l'endpoint devient un oracle d'énumération des identifiants de projet.
      const [depuis, vers] = await Promise.all([
        storage.getProject(fromProjectId, userId),
        storage.getProject(toProjectId, userId),
      ]);
      if (!depuis || !vers) return res.status(404).json({ message: "Projet introuvable" });

      const [link] = await db.insert(projectLinks).values({
        userId,
        fromProjectId,
        toProjectId,
        roleAmont: typeof req.body?.roleAmont === 'string' ? req.body.roleAmont.trim() || null : null,
        roleAval: typeof req.body?.roleAval === 'string' ? req.body.roleAval.trim() || null : null,
        nature: typeof req.body?.nature === 'string' ? req.body.nature.trim() || null : null,
        audiencesRecoupent: req.body?.audiencesRecoupent === true,
      }).returning();

      res.json({ link });
    } catch (error: any) {
      // L'index unique (userId, fromProjectId, toProjectId) refuse un lien déjà déclaré.
      if (error?.code === '23505') {
        return res.status(409).json({ message: "Ce lien existe déjà dans ce sens" });
      }
      console.error('[Liens] POST /api/projects/:id/links:', error);
      res.status(500).json({ message: "Failed to create brand link" });
    }
  });

  app.patch('/api/project-links/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Identifiant invalide" });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const champ of ['roleAmont', 'roleAval', 'nature'] as const) {
        if (typeof req.body?.[champ] === 'string') patch[champ] = req.body[champ].trim() || null;
      }
      if (typeof req.body?.audiencesRecoupent === 'boolean') {
        patch.audiencesRecoupent = req.body.audiencesRecoupent;
      }
      if (Object.keys(patch).length === 1) return res.status(400).json({ message: "Rien à modifier" });

      const [link] = await db.update(projectLinks).set(patch)
        .where(and(eq(projectLinks.id, id), eq(projectLinks.userId, req.userId)))
        .returning();
      if (!link) return res.status(404).json({ message: "Lien introuvable" });
      res.json({ link });
    } catch (error) {
      console.error('[Liens] PATCH /api/project-links/:id:', error);
      res.status(500).json({ message: "Failed to update brand link" });
    }
  });

  app.delete('/api/project-links/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Identifiant invalide" });
      // Supprimer un lien ne touche AUCUNE campagne : les articulations déjà décidées
      // restent telles quelles, l'utilisatrice les a validées à leur création.
      const [supprime] = await db.delete(projectLinks)
        .where(and(eq(projectLinks.id, id), eq(projectLinks.userId, req.userId)))
        .returning({ id: projectLinks.id });
      if (!supprime) return res.status(404).json({ message: "Lien introuvable" });
      res.json({ ok: true });
    } catch (error) {
      console.error('[Liens] DELETE /api/project-links/:id:', error);
      res.status(500).json({ message: "Failed to delete brand link" });
    }
  });
```

- [ ] **Step 2: Écrire les tests d'intégration**

Créer `server/routes.brand-links.test.ts`. **Reprends exactement le motif de `server/routes.reading.test.ts`** : il mocke `./db`, `./storage` et `./auth` pour ne jamais toucher la vraie base, capture les clauses `where` et les rend en SQL avec `PgDialect` hors connexion. Lis ce fichier d'abord, ne réinvente pas l'échafaudage.

Les cas à couvrir, chacun devant échouer si on annule ce qu'il protège :

```typescript
// 1. GET rend deux listes distinctes, et chaque requête filtre sur l'utilisateur.
//    Vérifie dans le SQL rendu que l'une porte "from_project_id" et l'autre
//    "to_project_id" — c'est ce qui distingue sortants et entrants.
// 2. POST refuse fromProjectId === toProjectId avec un 400, SANS toucher la base
//    (assert que db.insert n'a pas été appelé).
// 3. POST vérifie l'appartenance des DEUX projets : si le second n'appartient pas
//    à l'utilisateur, 404, et db.insert n'est pas appelé.
// 4. POST rend 404 (et non 403) pour un projet d'autrui, avec le MÊME corps de
//    réponse que pour un projet inexistant — les deux cas doivent être
//    indiscernables, sinon l'oracle d'énumération est rouvert.
// 5. PATCH filtre sur (id, userId) : le SQL rendu contient les deux colonnes.
// 6. DELETE filtre sur (id, userId), et rend 404 si rien n'est supprimé.
// 7. Un identifiant non numérique rend 400, pas 500.
```

- [ ] **Step 3: Lancer les tests**

Run: `npx vitest run server/routes.brand-links.test.ts`
Expected: PASS.

- [ ] **Step 4: Vérifier l'ensemble**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert, **zéro** erreur de types, 1444 tests existants inchangés.

- [ ] **Step 5: Commit**

```bash
git add server/routes.ts server/routes.brand-links.test.ts
git commit -m "feat(marques): les endpoints de declaration des liens, filtres par utilisateur"
```

---

### Task 4 : lire l'articulation disponible

**Files:**
- Create: `server/services/brand-links/articulation.ts`
- Create: `server/services/brand-links/articulation.test.ts`
- Modify: `server/routes.ts` — un endpoint à ajouter juste avant `app.get('/api/campaigns'` (vers la ligne 9554)

**Interfaces:**
- Consumes: `projectLinks`, `campaigns`, `projects` (`@shared/schema`) ; `db` ; `Articulation`, `CampagneLiee`, `anglesDepuisPhases` (Task 2).
- Produces:
  - `STATUTS_ARTICULABLES = ["draft", "active", "running"] as const`
  - `articulationsDisponibles(userId: string, projectId: number): Promise<Articulation[]>`
  - `GET /api/campaigns/articulation?projectId=N` → `{ articulations: Articulation[] }`

- [ ] **Step 1: Écrire le test**

Créer `server/services/brand-links/articulation.test.ts`. Mocke `../../db` sur le motif de `server/routes.reading.test.ts`. Les cas :

```typescript
// 1. Aucun lien pour ce projet → liste vide, et AUCUNE requête de campagnes n'est
//    lancée. C'est la garantie « sans lien, la génération est identique à aujourd'hui » :
//    si on interrogeait les campagnes quand même, on paierait une requête pour rien
//    et on ouvrirait la porte à une fuite de matière.
// 2. Un lien sortant → le sens rendu est "nourrit" ; un lien entrant → "estNourriePar".
// 3. Les campagnes de statut "completed" sont exclues ; draft, active et running
//    entrent. Vérifie-le sur le SQL rendu ou sur le filtre appliqué.
// 4. Les angles viennent de anglesDepuisPhases, et un phases illisible donne [].
// 5. L'objet rendu ne porte AUCUN champ d'ADN ni de mémoire : compare les clés de
//    `campagne` à la liste exacte attendue (id, marque, name, objective, coreMessage,
//    angles). Un champ de plus ferait échouer ce test — c'est voulu, c'est la
//    garantie centrale du spec.
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/brand-links/articulation.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter le service**

Créer `server/services/brand-links/articulation.ts` :

```typescript
import { db } from "../../db";
import { and, eq, inArray, or } from "drizzle-orm";
import { projectLinks, campaigns, projects } from "@shared/schema";
import { anglesDepuisPhases, type Articulation } from "./links";

/** Les statuts de campagne qu'on propose d'articuler. `completed` est exclu. */
export const STATUTS_ARTICULABLES = ["draft", "active", "running"] as const;

/**
 * Les articulations proposables pour une marque : pour chacun de ses liens, les
 * campagnes vivantes de la marque liée, réduites à ce qui peut entrer dans un prompt.
 *
 * Quand la marque n'a AUCUN lien, on rend une liste vide sans interroger les
 * campagnes. C'est ce qui garantit qu'une marque sans lien produit exactement la
 * même génération qu'avant ce chantier.
 */
export async function articulationsDisponibles(userId: string, projectId: number): Promise<Articulation[]> {
  const liens = await db
    .select()
    .from(projectLinks)
    .where(and(
      eq(projectLinks.userId, userId),
      or(eq(projectLinks.fromProjectId, projectId), eq(projectLinks.toProjectId, projectId)),
    ));

  if (liens.length === 0) return [];

  const out: Articulation[] = [];
  for (const lien of liens) {
    const sortant = lien.fromProjectId === projectId;
    const autreId = sortant ? lien.toProjectId : lien.fromProjectId;

    const [autre] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, autreId));
    if (!autre) continue; // marque supprimée entre-temps : on saute, sans bruit

    const vivantes = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.userId, userId),
        eq(campaigns.projectId, autreId),
        inArray(campaigns.status, [...STATUTS_ARTICULABLES]),
      ));

    for (const c of vivantes) {
      out.push({
        lien: { roleAmont: lien.roleAmont, roleAval: lien.roleAval, nature: lien.nature },
        sens: sortant ? "nourrit" : "estNourriePar",
        campagne: {
          id: c.id,
          marque: autre.name,
          name: c.name,
          objective: c.objective,
          coreMessage: c.coreMessage,
          angles: anglesDepuisPhases(c.phases),
        },
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Ajouter l'endpoint**

Dans `server/routes.ts`, juste avant `app.get('/api/campaigns'` :

```typescript
  // Étape zéro de la génération : ce avec quoi cette campagne pourrait s'articuler.
  // Réponse vide = aucun lien déclaré → l'interface n'affiche rien et la génération
  // suit son cours inchangé.
  app.get('/api/campaigns/articulation', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId;
      const projectId = parseInt(req.query?.projectId as string, 10);
      if (isNaN(projectId)) return res.status(400).json({ message: "projectId requis" });
      const project = await storage.getProject(projectId, userId);
      if (!project) return res.status(404).json({ message: "Projet introuvable" });

      const articulations = await articulationsDisponibles(userId, projectId);
      res.json({ articulations });
    } catch (error) {
      console.error('[Liens] GET /api/campaigns/articulation:', error);
      res.status(500).json({ message: "Failed to fetch articulation options" });
    }
  });
```

Imports en tête : `import { articulationsDisponibles } from "./services/brand-links/articulation";` et, pour le type de retour de `resolveArticulation` écrit à la tâche 5, `import type { Articulation } from "./services/brand-links/links";`

- [ ] **Step 5: Lancer et vérifier**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add server/services/brand-links/articulation.ts server/services/brand-links/articulation.test.ts server/routes.ts
git commit -m "feat(marques): lire les articulations proposables d'une marque"
```

---

### Task 5 : l'articulation dans la génération

**Files:**
- Modify: `server/services/openai.ts:1087` (`CampaignGenerationRequest`) et `:1191` (`generateCampaignStrategy`), plus `generateCampaignContent`
- Modify: `server/routes.ts:9691`, `:9717`, `:9739` (les trois étapes de génération)

**Interfaces:**
- Consumes: `Articulation`, `formaterArticulation` (Task 2) ; `articulationsDisponibles` (Task 4).
- Produces: `CampaignGenerationRequest.articulation?: Articulation` ; les trois endpoints acceptent `articulationCampaignId?: number` et `articulationIndependante?: boolean` dans le corps.

- [ ] **Step 1: La règle de sécurité à respecter absolument**

**Le client n'envoie JAMAIS le bloc d'articulation, seulement l'identifiant de la campagne choisie.** Le serveur relit lui-même l'articulation via `articulationsDisponibles` et vérifie que l'identifiant reçu figure bien dans la liste des articulations proposables pour cette marque.

Sans ce contrôle, n'importe quel appelant authentifié pourrait injecter du texte arbitraire dans le prompt de génération, ou faire lire une campagne d'une marque non liée — ce qui contournerait la règle centrale du spec (l'absence de lien est une interdiction). Écris un commentaire disant cela à l'endroit du contrôle.

- [ ] **Step 2: Étendre le type de requête**

Dans `server/services/openai.ts`, ajouter à `CampaignGenerationRequest` (vers la ligne 1087) :

```typescript
  /**
   * L'articulation avec la campagne d'une marque liée, résolue CÔTÉ SERVEUR.
   * Volontairement pauvre : ni ADN, ni mémoire, ni ton de voix de l'autre marque.
   * Absente quand la marque n'a pas de lien, ou quand la campagne est voulue isolée.
   */
  articulation?: Articulation;
```

Import : `import type { Articulation } from "./brand-links/links";`

- [ ] **Step 3: Injecter dans les deux prompts**

Dans `generateCampaignStrategy` (`server/services/openai.ts:1191`), le prompt contient déjà cette ligne :

```typescript
${request.weekContext ? `- Context: ${request.weekContext}` : ''}
```

Ajoute **en dessous**, comme un bloc séparé — et surtout **pas** en concaténant dans `weekContext`, qui décrit la semaine de l'utilisatrice et dont le sens serait brouillé :

```typescript
${request.articulation ? `\n${formaterArticulation(request.articulation)}\n` : ''}
```

Fais la même chose dans `generateCampaignContent`. Import : `import { formaterArticulation } from "./brand-links/links";`

- [ ] **Step 4: Résoudre et vérifier l'articulation dans les trois endpoints**

Dans `server/routes.ts`, ajoute cette fonction locale à côté de `resolveCampaignCtx` (vers la ligne 9674) :

```typescript
  /**
   * Résout l'articulation demandée par le client. Le client n'envoie qu'un
   * identifiant de campagne : on relit l'articulation nous-mêmes et on vérifie
   * qu'elle figure bien parmi celles proposables pour cette marque.
   *
   * Sans ce contrôle, un appelant authentifié pourrait faire injecter dans le
   * prompt la campagne d'une marque NON liée — ce qui contournerait la règle
   * centrale : l'absence de lien est une interdiction, pas un silence.
   */
  async function resolveArticulation(
    userId: string, projectId: number | undefined, campaignIdRaw: any,
  ): Promise<{ articulation?: Articulation } | { error: string; status: number }> {
    if (!campaignIdRaw || !projectId) return {};
    const cid = Number(campaignIdRaw);
    if (!Number.isFinite(cid)) return { error: "articulationCampaignId invalide", status: 400 };
    const proposables = await articulationsDisponibles(userId, projectId);
    const trouvee = proposables.find((a) => a.campagne.id === cid);
    if (!trouvee) return { error: "Cette campagne n'est pas articulable avec cette marque", status: 400 };
    return { articulation: trouvee };
  }
```

Puis dans chacune des trois étapes, après `resolveCampaignCtx` :

```typescript
      const art = await resolveArticulation(userId, ctx.pid, req.body?.articulationCampaignId);
      if ('error' in art) return res.status(art.status).json({ message: art.error });
```

et passer `articulation: art.articulation` à `generateCampaignStrategy` / `generateCampaignContent`.

- [ ] **Step 5: Persister le choix à la création de la campagne**

Dans l'étape 3 (`POST /api/campaigns/generate/tasks`, vers la ligne 9739), au moment où la campagne est créée, ajouter aux valeurs insérées :

```typescript
        articuleAvecCampaignId: art.articulation ? art.articulation.campagne.id : null,
        // Le booléen n'est vrai que si l'utilisatrice a explicitement choisi l'isolement.
        // Il distingue « décidé que non » de « pas encore décidé » (les deux sont sinon
        // un articuleAvecCampaignId nul), pour que Naya ne repose pas la question.
        articulationIndependante: req.body?.articulationIndependante === true,
```

- [ ] **Step 6: Écrire les tests**

Ajoute à `server/routes.brand-links.test.ts` :

```typescript
// 1. Sans articulationCampaignId, la requête de génération ne porte PAS de champ
//    `articulation` — la génération est identique à avant ce chantier.
// 2. Avec un articulationCampaignId qui n'est pas dans les articulations proposables,
//    l'endpoint rend 400 et generateCampaignStrategy n'est PAS appelée.
// 3. Avec un identifiant valide, `articulation` est passée au générateur, et le bloc
//    assemblé contient le nom de la marque liée.
// 4. Le prompt assemblé ne contient AUCUN champ d'ADN de la marque liée — inspecte
//    la chaîne passée au modèle. C'est le critère d'acceptation central du spec.
// 5. `weekContext` reçu du client arrive INCHANGÉ dans la requête de génération :
//    l'articulation ne s'y mélange pas.
```

- [ ] **Step 7: Vérifier**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add server/services/openai.ts server/routes.ts server/routes.brand-links.test.ts
git commit -m "feat(marques): l'articulation entre dans la generation, resolue cote serveur"
```

---

### Task 6 : la détection de collision

**Files:**
- Create: `server/services/brand-links/collision.ts`
- Create: `server/services/brand-links/collision.test.ts`

**Interfaces:**
- Consumes: `projectLinks`, `content` (`@shared/schema`) ; `db` ; `callClaude`, `CLAUDE_MODELS` (`server/services/claude.ts`).
- Produces:
  - `FENETRE_JOURS = 7`, `MAX_CONTENUS_COMPARES = 12`
  - `interface Collision { contenuId: number; marque: string; scheduledFor: Date | null; pourquoi: string }`
  - `parseVerdict(raw: string): { contenuId: number; pourquoi: string } | null` (pure)
  - `detecterCollision(input: { userId: string; projectId: number; titre: string; corps: string; quand: Date; contenuId?: number }): Promise<Collision | null>`

- [ ] **Step 1: Écrire les tests de la partie pure**

Créer `server/services/brand-links/collision.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { parseVerdict } from "./collision";

describe("parseVerdict — lire le jugement du modèle sans lui faire confiance", () => {
  it("lit un verdict de collision", () => {
    expect(parseVerdict('{"collision":true,"contenuId":42,"pourquoi":"les deux annoncent la méthode"}'))
      .toEqual({ contenuId: 42, pourquoi: "les deux annoncent la méthode" });
  });

  it("rend null quand le modèle dit qu'il n'y a pas de collision", () => {
    expect(parseVerdict('{"collision":false}')).toBeNull();
  });

  it("tolère le bavardage et les balises autour du JSON", () => {
    expect(parseVerdict('Voici :\n```json\n{"collision":true,"contenuId":7,"pourquoi":"r"}\n```'))
      .toEqual({ contenuId: 7, pourquoi: "r" });
  });

  it("rend null sur une sortie illisible, sans jeter", () => {
    expect(parseVerdict("je ne sais pas")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  it("rend null si collision est vraie mais l'identifiant absent ou non numérique — une alerte sans cible ne sert à rien", () => {
    expect(parseVerdict('{"collision":true,"pourquoi":"r"}')).toBeNull();
    expect(parseVerdict('{"collision":true,"contenuId":"quarante-deux","pourquoi":"r"}')).toBeNull();
  });

  it("accepte un verdict sans explication, en rendant une raison vide plutôt que rien", () => {
    expect(parseVerdict('{"collision":true,"contenuId":9}')).toEqual({ contenuId: 9, pourquoi: "" });
  });
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run server/services/brand-links/collision.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Créer `server/services/brand-links/collision.ts` :

```typescript
import { db } from "../../db";
import { and, eq, gte, lte, or, inArray } from "drizzle-orm";
import { projectLinks, content, projects } from "@shared/schema";
import { callClaude, CLAUDE_MODELS } from "../claude";

/** Fenêtre de comparaison autour de la date de programmation. */
export const FENETRE_JOURS = 7;
/** Plafond de contenus envoyés au jugement, pour borner le prompt. */
export const MAX_CONTENUS_COMPARES = 12;

export interface Collision {
  contenuId: number;
  marque: string;
  scheduledFor: Date | null;
  pourquoi: string;
}

export const PROMPT_COLLISION = `Deux marques de la même personne partagent une partie de leur audience.

On te donne un contenu qui va être programmé, et des contenus déjà programmés sur la
marque liée dans les jours qui l'entourent. Tu réponds à UNE seule question : l'un de
ces contenus sert-il le MÊME ANGLE que celui qu'on programme ?

Le même angle, ce n'est pas le même sujet : deux posts peuvent parler du même thème en
disant des choses différentes, et ce n'est pas une collision. C'est une collision quand
un abonné qui voit les deux aurait l'impression de lire deux fois la même chose.

Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"collision": false}
ou
{"collision": true, "contenuId": <identifiant>, "pourquoi": "<une phrase, en français>"}`;

/** Lit le verdict du modèle. Pure, tolérante. Une alerte sans cible est jetée. */
export function parseVerdict(raw: string): { contenuId: number; pourquoi: string } | null {
  if (!raw) return null;
  const debut = raw.indexOf("{");
  const fin = raw.lastIndexOf("}");
  if (debut === -1 || fin <= debut) return null;
  let o: any;
  try { o = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  if (o?.collision !== true) return null;
  if (typeof o.contenuId !== "number" || !Number.isFinite(o.contenuId)) return null;
  return { contenuId: o.contenuId, pourquoi: typeof o.pourquoi === "string" ? o.pourquoi : "" };
}

/**
 * Cherche une collision d'angle entre le contenu qu'on programme et ce qui est déjà
 * programmé sur les marques liées dont l'audience se recoupe.
 *
 * Ne s'exécute QUE s'il existe un lien avec `audiencesRecoupent`. Sans lien, on rend
 * null sans interroger quoi que ce soit : l'absence de lien est une interdiction de
 * rapprocher deux marques, y compris pour les comparer.
 *
 * Best-effort de bout en bout : tout échec rend null et journalise. Cette fonction ne
 * doit JAMAIS faire échouer la programmation d'un contenu.
 */
export async function detecterCollision(input: {
  userId: string;
  projectId: number;
  titre: string;
  corps: string;
  quand: Date;
  contenuId?: number;
}): Promise<Collision | null> {
  try {
    const liens = await db.select().from(projectLinks).where(and(
      eq(projectLinks.userId, input.userId),
      eq(projectLinks.audiencesRecoupent, true),
      or(eq(projectLinks.fromProjectId, input.projectId), eq(projectLinks.toProjectId, input.projectId)),
    ));
    if (liens.length === 0) return null;

    const autresIds = liens.map((l) => (l.fromProjectId === input.projectId ? l.toProjectId : l.fromProjectId));

    const debut = new Date(input.quand.getTime() - FENETRE_JOURS * 24 * 3600 * 1000);
    const finFenetre = new Date(input.quand.getTime() + FENETRE_JOURS * 24 * 3600 * 1000);

    const voisins = await db
      .select({
        id: content.id, title: content.title, body: content.body,
        projectId: content.projectId, scheduledFor: content.scheduledFor,
      })
      .from(content)
      .where(and(
        eq(content.userId, input.userId),
        // `content.projectId` est NULLABLE (vérifié dans le schéma) : `inArray` écarte
        // déjà les lignes nulles, mais on ne s'appuie pas sur ce détail de drizzle —
        // `autresIds` ne contient que des identifiants réels, donc un contenu sans
        // marque ne peut pas entrer dans la comparaison.
        inArray(content.projectId, autresIds),
        gte(content.scheduledFor, debut),
        lte(content.scheduledFor, finFenetre),
      ))
      .limit(MAX_CONTENUS_COMPARES);

    if (voisins.length === 0) return null;

    const liste = voisins
      .map((v) => `[${v.id}] ${v.title}\n${String(v.body ?? "").slice(0, 400)}`)
      .join("\n\n");

    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      taskKind: "classification",
      system: PROMPT_COLLISION,
      max_tokens: 400,
      userId: input.userId,
      projectId: input.projectId,
      messages: [{
        role: "user",
        content: `CONTENU QU'ON PROGRAMME\n${input.titre}\n${input.corps.slice(0, 800)}\n\nDÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE\n${liste}`,
      }],
    });

    const verdict = parseVerdict(raw);
    if (!verdict) return null;

    const cible = voisins.find((v) => v.id === verdict.contenuId);
    // Le modèle a pu inventer un identifiant : sans cible réelle, pas d'alerte.
    if (!cible) return null;

    const [marque] = await db.select({ name: projects.name }).from(projects)
      .where(eq(projects.id, cible.projectId as number));

    return {
      contenuId: cible.id,
      marque: marque?.name ?? "une marque liée",
      scheduledFor: cible.scheduledFor,
      pourquoi: verdict.pourquoi,
    };
  } catch (err: any) {
    console.error(`[Liens] détection de collision échouée pour le projet ${input.projectId}:`, err?.message);
    return null;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run server/services/brand-links/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/brand-links/collision.ts server/services/brand-links/collision.test.ts
git commit -m "feat(marques): la detection de collision d'angle entre marques liees"
```

---

### Task 7 : brancher l'alerte sur la programmation

**Files:**
- Modify: `server/routes.ts:6514` (`POST /api/content`) et `:6577` (le PATCH)
- Modify: `server/routes.brand-links.test.ts`

**Interfaces:**
- Consumes: `detecterCollision` (Task 6).
- Produces: les deux endpoints rendent un champ `collision: Collision | null` **en plus** de leur réponse actuelle, sans rien en retirer.

- [ ] **Step 1: Brancher, sans jamais bloquer**

Dans les deux endpoints, **après** que le contenu a été écrit avec succès, et seulement si `scheduledFor` et `projectId` sont présents :

```typescript
      // Alerte de collision : informative, jamais bloquante. Elle s'exécute APRÈS
      // l'écriture, pour qu'un échec de jugement ne puisse pas empêcher la
      // programmation. `detecterCollision` avale ses propres erreurs et rend null.
      let collision = null;
      if (ligne.scheduledFor && ligne.projectId) {
        collision = await detecterCollision({
          userId,
          projectId: ligne.projectId,
          titre: ligne.title,
          corps: String(ligne.body ?? ''),
          quand: new Date(ligne.scheduledFor),
          contenuId: ligne.id,
        });
      }
      res.json({ ...ligne, collision });
```

Adapte les noms de variables à ce que chaque endpoint utilise réellement — lis-les avant d'écrire. **Ne change pas la forme existante de la réponse** : on ajoute une clé, on n'en retire ni n'en renomme aucune, sinon le calendrier éditorial existant casse.

Import en tête : `import { detecterCollision } from "./services/brand-links/collision";`

- [ ] **Step 2: Écrire les tests**

Ajoute à `server/routes.brand-links.test.ts` :

```typescript
// 1. Un contenu programmé sur une marque SANS lien : la réponse porte collision: null
//    et aucun appel modèle n'est fait.
// 2. Un contenu SANS scheduledFor : pas de détection, collision: null.
// 3. Un lien existe mais audiencesRecoupent est faux : pas de détection.
// 4. Quand detecterCollision rend une collision, elle apparaît dans la réponse ET
//    le contenu est bien créé — la programmation n'est pas bloquée.
// 5. Quand detecterCollision lève (simule un rejet), le contenu est QUAND MÊME créé
//    et la réponse reste exploitable. C'est la garantie la plus importante de la tâche.
// 6. La réponse conserve toutes ses clés d'origine.
```

- [ ] **Step 3: Vérifier**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert, et les tests existants du calendrier éditorial inchangés.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts server/routes.brand-links.test.ts
git commit -m "feat(marques): l'alerte de collision au placement, informative et non bloquante"
```

---

### Task 8 : l'écran de déclaration des liens

> **Une note de méthode, qui vaut aussi pour la tâche 9.** Contrairement aux tâches serveur, ces deux tâches **spécifient un comportement et des textes exacts** plutôt que de prescrire le JSX ligne à ligne. C'est délibéré : les conventions visuelles de ce dépôt se lisent dans les fichiers voisins mieux que dans un plan, et du JSX écrit à l'aveugle produirait du code à réécrire. Lis `ConversionsPanel.tsx` en entier avant de commencer, et suis-le. Les garanties listées ci-dessous, en revanche, ne sont pas négociables : elles ont chacune une raison nommée.

**Files:**
- Create: `client/src/pages/project/BrandLinksPanel.tsx`
- Modify: `client/src/pages/project/ProjectPage.tsx` (import + montage, vers la ligne 92 où `ConversionsPanel` est monté)
- Modify: `client/src/locales/jsx-baseline.json`

**Interfaces:**
- Consumes: les quatre endpoints de la Task 3 ; le type `ProjectLink` de `@shared/schema` ; `GET /api/projects` (rend un tableau nu — vérifié `server/routes.ts:1789`).
- Produces: `<BrandLinksPanel projectId={number} />`.

- [ ] **Step 1: Écrire le composant**

Créer `client/src/pages/project/BrandLinksPanel.tsx`. Reprends les conventions des panneaux voisins (`ConversionsPanel.tsx`, 201 lignes, à lire d'abord) : `react-query`, `fetchJson`, les composants de `@/components/ui/*`, des `data-testid`.

Ce que le panneau montre :

- deux listes, **les liens partant de cette marque** et **ceux arrivant vers elle**. Un lien se lit dans les deux sens même s'il n'en porte qu'un, et l'utilisatrice doit voir qu'une autre marque la nourrit sans avoir à aller sur l'autre page ;
- pour chaque lien : le nom de l'autre marque, le sens sous forme lisible (« Jeanne Méjean nourrit cette marque »), les trois textes s'ils sont remplis, et l'état du recoupement d'audiences ;
- modifier les trois textes et le recoupement sur place ; supprimer le lien avec une confirmation sobre ;
- un formulaire d'ajout : choisir l'autre marque parmi les projets de l'utilisatrice (en excluant **celle-ci**, puisqu'une marque ne se lie pas à elle-même), choisir le sens, remplir les trois textes, cocher le recoupement.

Trois exigences de forme, qui viennent des garde-fous du projet :

- **aucun compteur, aucun badge de nombre, aucune formulation de reproche.** Pas de « 0 lien déclaré » ; quand il n'y a aucun lien, une phrase simple suffit — par exemple « Aucun lien déclaré. Naya traite cette marque comme indépendante des autres. » Cette phrase est utile : elle dit à l'utilisatrice ce que l'absence de lien **signifie**, ce qui est précisément la règle centrale du spec ;
- **`throwOnError: false` sur chaque `useQuery` du panneau**, avec un commentaire expliquant l'écart à la convention globale. `client/src/lib/queryClient.ts:72` impose `throwOnError: (error) => !is401(error)` à toute l'application, et l'unique `ErrorBoundary` est au sommet du routeur (`client/src/App.tsx:150-153`) : sans cette neutralisation, une panne de l'endpoint des liens ferait basculer **toute l'application** sur l'écran d'erreur plein écran. Le même défaut a déjà été trouvé et corrigé sur un autre chantier de ce dépôt ;
- **un `onError` sur chaque mutation**, avec un `toast` sobre. Une déclaration de lien perdue en silence est une déclaration que l'utilisatrice croira faite.

- [ ] **Step 2: Monter le panneau**

Dans `client/src/pages/project/ProjectPage.tsx`, à côté de `<ConversionsPanel projectId={id} />` :

```tsx
import BrandLinksPanel from "./BrandLinksPanel";
```

```tsx
              <BrandLinksPanel projectId={id} />
```

Ne réorganise rien d'autre dans ce fichier.

- [ ] **Step 3: Mettre le cliquet i18n à jour**

Run: `npx vitest run client/src/locales/jsx-guard.test.ts`
Expected: le test signale les textes en dur du nouveau fichier. Ajoute la ligne à `client/src/locales/jsx-baseline.json` avec **le compte exact que le test annonce** — jamais une valeur arrondie au-dessus. C'est le fonctionnement prévu du cliquet, pas un contournement.

- [ ] **Step 4: Vérifier**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/project/BrandLinksPanel.tsx client/src/pages/project/ProjectPage.tsx client/src/locales/jsx-baseline.json
git commit -m "feat(marques): le panneau de declaration des liens sur la page projet"
```

---

### Task 9 : l'étape zéro et l'alerte dans le calendrier

**Files:**
- Modify: `client/src/pages/campaigns.tsx:650-670` (la mutation de génération) et l'écran de création
- Modify: `client/src/locales/jsx-baseline.json`

**Interfaces:**
- Consumes: `GET /api/campaigns/articulation` (Task 4) ; les trois endpoints de génération qui acceptent désormais `articulationCampaignId` et `articulationIndependante` (Task 5) ; le champ `collision` des réponses de contenu (Task 7).
- Produces: rien de réutilisable.

- [ ] **Step 1: Interroger les articulations avant de générer**

Dans `client/src/pages/campaigns.tsx`, ajouter une requête sur `GET /api/campaigns/articulation?projectId=...`, activée seulement quand une marque est sélectionnée, avec `throwOnError: false` et le commentaire d'usage.

**Si la réponse est vide, l'écran n'affiche rien de nouveau** et la génération part exactement comme aujourd'hui. C'est un critère d'acceptation du spec : une marque sans lien ne voit aucune différence.

- [ ] **Step 2: Proposer, sans imposer**

Quand la liste n'est pas vide, afficher avant le bouton de génération un bloc sobre qui nomme le lien et la campagne liée — par exemple « Cette marque est liée à Jeanne Méjean, dont la campagne *Septembre — la méthode* porte l'angle *montrer les coulisses*. » — et deux choix : articuler avec cette campagne, ou faire une campagne indépendante.

Aucune option n'est présélectionnée. Naya propose, l'utilisatrice tranche : présélectionner reviendrait à imposer par défaut.

- [ ] **Step 3: Transmettre le choix aux trois étapes**

La mutation construit aujourd'hui son objet de base ainsi (ligne ~654) :

```typescript
const base = { objective, duration, projectId: selectedProjectId, weekContext: weekContext || undefined };
```

Ajoute les deux champs, **sans toucher à `weekContext`** :

```typescript
const base = {
  objective, duration, projectId: selectedProjectId,
  weekContext: weekContext || undefined,
  // On n'envoie QUE l'identifiant : le serveur relit l'articulation et vérifie
  // qu'elle est bien proposable pour cette marque. Envoyer le bloc lui-même
  // permettrait d'injecter du texte arbitraire dans le prompt.
  articulationCampaignId: articulationChoisie?.campagne.id,
  articulationIndependante: choixIndependante === true,
};
```

L'objet `base` est déjà passé aux trois étapes : les deux champs suivent tout seuls.

- [ ] **Step 4: Afficher l'alerte de collision**

Là où un contenu est programmé depuis le calendrier éditorial, lire le champ `collision` de la réponse. S'il est non nul, afficher une ligne sobre nommant la marque, le contenu qui recoupe, sa date et la raison donnée.

Trois exigences :

- **elle ne bloque rien** : le contenu est déjà écrit quand l'alerte s'affiche ;
- **elle ne s'affiche que s'il y a collision.** Aucun message « aucun conflit détecté » : ce serait du bruit, et le produit interdit ce genre de bavardage ;
- **elle n'est pas un reproche.** Elle décrit un fait et laisse l'utilisatrice décider. Pas de « attention ! », pas de point d'exclamation.

- [ ] **Step 5: Vérifier à l'écran**

Run: `npm run dev`

Avec deux marques liées et une campagne vivante sur l'une : l'étape zéro apparaît et nomme la bonne campagne ; choisir « indépendante » génère sans articulation. Avec une marque **sans** lien : rien ne change par rapport à avant.

Si l'environnement ne permet pas d'ouvrir un navigateur, dis-le dans ton rapport plutôt que de le passer sous silence : cette tâche est la seule dont le rendu ne peut pas être prouvé par un test.

- [ ] **Step 6: Vérifier et commiter**

Run: `npx vitest run && npx tsc --noEmit && npm run build` — et mets `jsx-baseline.json` à jour avec les comptes exacts.

```bash
git add client/src/pages/campaigns.tsx client/src/locales/jsx-baseline.json
git commit -m "feat(marques): l'etape zero d'articulation et l'alerte de collision a l'ecran"
```

---

### Task 10 : la vérification de bout en bout

**Files:** aucun fichier créé. Cette tâche produit un constat, et corrige ce qu'elle trouve.

- [ ] **Step 1: La suite complète**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tout vert, **zéro** erreur de types, les 1444 tests d'origine inchangés.

- [ ] **Step 2: Reprendre les critères d'acceptation du spec un par un**

Ouvre `docs/superpowers/specs/2026-09-30-naya-liens-entre-marques-design.md`, section « Critères d'acceptation », et coche chaque ligne en **nommant le test ou la vérification** qui la prouve. Pour toute ligne sans preuve, écris le test manquant avant de continuer.

- [ ] **Step 3: Les trois vérifications que les tests ne couvrent pas**

1. **Aucune fuite d'identité entre marques.** `grep -rn "brandDna\|getBrandDna\|retrieveMemories" server/services/brand-links/` → **aucun résultat**. Si un de ces appels apparaît un jour dans ce dossier, c'est que la garantie centrale du spec est tombée.
2. **Aucun compteur ni reproche dans les textes ajoutés.** `grep -rniE "attention|à faire|en retard|conflit détecté|[0-9]+ lien" client/src/pages/project/BrandLinksPanel.tsx` → relis chaque correspondance et juge-la.
3. **`weekContext` intact.** `git diff` sur `server/services/openai.ts` ne doit montrer aucune modification de la construction de `weekContext` — seulement l'ajout d'un bloc séparé.

- [ ] **Step 4: Un parcours complet, à la main, sur la base de dev**

Déclare un lien entre deux marques réelles, avec le recoupement d'audiences coché. Lance une génération de campagne sur la marque nourrie : l'étape zéro doit proposer la campagne de l'autre marque. Articule, et vérifie dans les journaux serveur que le prompt contient le bloc d'articulation **et** qu'il ne contient pas l'ADN de l'autre marque.

Puis programme un contenu dont l'angle recoupe volontairement un contenu déjà programmé sur la marque liée, et vérifie que l'alerte se déclenche et nomme le bon contenu. Programme ensuite un contenu sans rapport : aucune alerte ne doit apparaître.

- [ ] **Step 5: Le cas de la marque sans lien**

Le plus important, et le plus facile à oublier : sur une marque **sans aucun lien déclaré**, vérifie que la génération de campagne est **identique** à ce qu'elle était avant ce chantier — aucune étape zéro affichée, aucun champ ajouté au prompt, aucune requête supplémentaire. C'est la garantie qui protège les utilisateurs qui n'utiliseront jamais cette fonctionnalité.

- [ ] **Step 6: Commit du journal de vérification**

```bash
git add -A
git commit -m "test(marques): la verification de bout en bout des liens entre marques"
```

---

## Ce que ce plan ne fait pas

Rappel, pour qu'aucune tâche ne dérive :

- aucun partage d'ADN, de mémoire ou d'observations entre marques liées ;
- aucune génération jumelée — une campagne reste attachée à une seule marque ;
- aucune contrainte anti-collision à la génération : le contrôle est au placement, et seulement là ;
- aucune détection automatique des liens — c'est l'utilisatrice qui les déclare ;
- aucune modification de `weekContext` ;
- aucune application de migration en production : c'est une décision manuelle, prise séparément, sauvegarde Neon faite.
