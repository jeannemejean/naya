# Fil 3 — LOT 3B : l'attribution multi-touch — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** créditer une conversion à la **fenêtre de contenus qui l'a précédée**, pondérée, jamais au dernier post — et reboucler ce crédit dans le score de réception de 3A.

**Architecture :** toute la règle de répartition vit dans deux fonctions **pures** (`selectContentsInWindow`, `attribute`), testables sans base. La fenêtre est **figée sur la ligne de conversion** au moment du calcul. Le recalcul est idempotent : rejouer remplace, n'ajoute jamais.

**Spec :** `docs/superpowers/specs/2026-08-31-naya-attribution-design.md`
**Décisions actées :** `NOTE-DECISION-ATTRIBUTION.md` §0 — **ne pas les rediscuter**
**Migrations :** `MIGRATIONS.md`

**Stack :** Express + Drizzle ORM + PostgreSQL Neon, React + Vite, vitest.

## Contraintes globales

- **LOT 3B UNIQUEMENT.** Ne crée **rien** de 3C : ni `arbitration_log`, ni `server/services/arbitration/`, ni politique de pondération entre fils, ni arbitre. Le point d'arrêt §5.0 du brief tient. Aucune « préparation ».
- **Jamais de last-touch.** Aucun chemin de code ne peut créditer 100 % à un seul contenu quand la fenêtre en contient plusieurs. L'interdit et sa raison sont écrits **en commentaire en tête** du fichier d'attribution.
- **La somme des poids d'une conversion vaut exactement 1.** Testé, en égalité stricte.
- **`attributionWindowDays` est FIGÉ sur la ligne de conversion** au calcul. Modifier la fenêtre d'une marque ne change **rien** aux attributions passées. C'est un test.
- **Une conversion sans contenu dans sa fenêtre est valide.** Elle existe, elle n'est créditée à personne. Aucun rattachement forcé.
- **Migrations : dev-local UNIQUEMENT.** La production n'a pas de table de suivi Drizzle ; tant que la baseline de `MIGRATIONS.md` §3 n'est pas posée, **rien ne part en prod**, et `db:push` sur la prod est **interdit**. Pas de migration au démarrage du serveur.
- **Ne jamais lancer `npm install`** : il élague des paquets et crée des dossiers `« * 2 »`. Aucune dépendance nouvelle n'est requise.
- **Ne pas `git push`.** Le lot se termine par une revue.
- i18n : toute chaîne visible dans `client/src/locales/fr.ts` **ET** `en.ts` ; `locales.test.ts` vérifie la parité.
- Vérification à chaque tâche : `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` tout vert.
- **Si une micro-décision n'est pas couverte, note ton hypothèse dans le message de commit.** Ne devine pas en silence.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/services/attribution/attribute.ts` | *(créé)* `selectContentsInWindow` + `attribute` — PURS |
| `server/services/attribution/attribute.test.ts` | *(créé)* invariants, bornes, anti-last-touch |
| `server/services/attribution/attribute-conversion.ts` | *(créé)* enveloppe DB idempotente |
| `shared/schema.ts` | *(modifié)* `brand_conversions`, `conversion_attributions` |
| `server/storage.ts` | *(modifié)* accès conversions et attributions |
| `server/services/project-fields.ts` | *(modifié)* `attributionWindowDays` dans la liste blanche |
| `server/routes.ts` | *(modifié)* déclaration et lecture des conversions |
| `client/src/pages/project/…` | *(modifié)* déclarer une conversion, régler la fenêtre |
| `server/scripts/recompute-reception-scores.ts` | *(créé)* recalcul idempotent du §4.3 |
| `client/src/locales/{fr,en}.ts` | *(modifiés)* nouvelles chaînes |

---

### Task 1 : la règle de répartition (la pièce maîtresse)

**Fichiers :** Créer `server/services/attribution/attribute.ts` et `attribute.test.ts`

**Interfaces produites :** `ConversionForAttribution`, `ContentCandidate`, `ContentInWindow`, `CreditLine`, `AttributionPolicy`, `selectContentsInWindow`, `attribute`, `LINEAR_UNIFORM` — consommés par les tâches 4 et 7.

TDD strict : tests d'abord, vus échouer, puis implémentation.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `server/services/attribution/attribute.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { selectContentsInWindow, attribute, type ContentCandidate } from "./attribute";

const JOUR = 86_400_000;
const CONV = new Date("2026-06-30T12:00:00.000Z");
const conversion = { id: 1, projectId: 7, convertedAt: CONV, attributionWindowDays: 30 };

const publie = (id: number, joursAvant: number, projectId = 7): ContentCandidate => ({
  id, projectId, publishedAt: new Date(CONV.getTime() - joursAvant * JOUR),
});

describe("selectContentsInWindow", () => {
  it("retient un contenu publié dans la fenêtre", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 10)]).map(c => c.id)).toEqual([1]);
  });

  // Décision actée n°3 : la borne basse est INCLUSIVE.
  it("retient un contenu publié exactement à J moins la fenêtre", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 30)]).map(c => c.id)).toEqual([1]);
  });

  it("exclut un contenu publié une milliseconde avant la borne basse", () => {
    const tropVieux: ContentCandidate = {
      id: 1, projectId: 7, publishedAt: new Date(CONV.getTime() - 30 * JOUR - 1),
    };
    expect(selectContentsInWindow(conversion, [tropVieux])).toEqual([]);
  });

  it("retient un contenu publié exactement à l'instant de la conversion (borne haute inclusive)", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 0)]).map(c => c.id)).toEqual([1]);
  });

  it("exclut un contenu publié après la conversion", () => {
    const apres: ContentCandidate = { id: 1, projectId: 7, publishedAt: new Date(CONV.getTime() + 1) };
    expect(selectContentsInWindow(conversion, [apres])).toEqual([]);
  });

  it("exclut un contenu non publié", () => {
    expect(selectContentsInWindow(conversion, [{ id: 1, projectId: 7, publishedAt: null }])).toEqual([]);
  });

  it("exclut un contenu d'une autre marque", () => {
    expect(selectContentsInWindow(conversion, [publie(1, 10, 99)])).toEqual([]);
  });

  it("ordonne de façon déterministe : par date de publication puis par id", () => {
    const a = publie(3, 10), b = publie(1, 10), c = publie(2, 5);
    expect(selectContentsInWindow(conversion, [a, b, c]).map(x => x.id)).toEqual([1, 3, 2]);
  });
});

describe("attribute — linéaire uniforme", () => {
  const somme = (lignes: { creditWeight: number }[]) =>
    lignes.reduce((s, l) => s + l.creditWeight, 0);

  it("une fenêtre vide ne crédite personne — et ce n'est pas une erreur", () => {
    expect(attribute(conversion, [])).toEqual([]);
  });

  it("un seul contenu reçoit tout le crédit", () => {
    const r = attribute(conversion, selectContentsInWindow(conversion, [publie(1, 5)]));
    expect(r).toEqual([{ contentId: 1, creditWeight: 1 }]);
  });

  // L'invariant central du brief.
  it.each([1, 2, 3, 5, 7])("la somme des poids vaut EXACTEMENT 1 sur %i contenus", (n) => {
    const contenus = Array.from({ length: n }, (_, i) => publie(i + 1, n - i));
    const r = attribute(conversion, selectContentsInWindow(conversion, contenus));
    expect(r).toHaveLength(n);
    expect(somme(r)).toBe(1);
  });

  it("les poids restent uniformes à 1e-9 près malgré l'absorption du résidu", () => {
    const contenus = Array.from({ length: 3 }, (_, i) => publie(i + 1, 3 - i));
    for (const l of attribute(conversion, selectContentsInWindow(conversion, contenus))) {
      expect(Math.abs(l.creditWeight - 1 / 3)).toBeLessThan(1e-9);
    }
  });

  // ANTI-LAST-TOUCH : le contenu le plus proche ne doit jamais rafler la mise.
  it("ne crédite jamais 100 % au contenu le plus récent quand la fenêtre en contient plusieurs", () => {
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    const r = attribute(conversion, selectContentsInWindow(conversion, contenus));
    const leplusRecent = r.find(l => l.contentId === 5)!;
    expect(leplusRecent.creditWeight).toBeLessThan(0.9);
    expect(r.every(l => l.creditWeight > 0)).toBe(true);
  });

  it("reproduit le cas chiffré de la note de décision : cinq contenus à 20 % chacun", () => {
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    for (const l of attribute(conversion, selectContentsInWindow(conversion, contenus))) {
      expect(Math.abs(l.creditWeight - 0.2)).toBeLessThan(1e-9);
    }
  });

  it("une fenêtre plus courte exclut les contenus anciens (cf. §5 de la note)", () => {
    const courte = { ...conversion, attributionWindowDays: 14 };
    const contenus = [publie(1, 28), publie(2, 21), publie(3, 14), publie(4, 6), publie(5, 2)];
    const r = attribute(courte, selectContentsInWindow(courte, contenus));
    expect(r.map(l => l.contentId)).toEqual([3, 4, 5]);
    expect(somme(r)).toBe(1);
  });
});
```

- [ ] **Étape 2 : lancer les tests pour les voir échouer**

Commande : `npx vitest run server/services/attribution/attribute.test.ts`
Attendu : ÉCHEC — le module `./attribute` n'existe pas.

- [ ] **Étape 3 : écrire les deux fonctions pures**

Créer `server/services/attribution/attribute.ts` :

```typescript
/**
 * RÉPARTITION DU CRÉDIT D'UNE CONVERSION — fonctions PURES.
 *
 * ═══ INTERDIT ABSOLU : PAS DE LAST-TOUCH ═══
 *
 * Une conversion n'est JAMAIS créditée au dernier contenu publié avant elle. Elle est
 * créditée à la FENÊTRE de contenus qui l'a précédée, répartie entre eux.
 *
 * La raison, et elle n'est pas esthétique : une conversion est un signal LENT de marque,
 * pas un applaudissement de post. Elle résulte du cumul de plusieurs contenus. Créditer le
 * dernier reviendrait à apprendre que « les posts d'offre convertissent » alors que le
 * travail a souvent été fait des semaines plus tôt par le contenu qui a fait découvrir la
 * marque. Naya en tirerait une leçon fausse, et cette leçon remonterait dans la génération
 * de contenu. On apprendrait faux, à grande échelle, sans jamais s'en apercevoir.
 *
 * Aucun chemin de ce fichier ne peut produire un poids de 1 sur un contenu quand la fenêtre
 * en contient plusieurs — c'est testé (« ne crédite jamais 100 % au contenu le plus récent »).
 */

export interface ConversionForAttribution {
  id: number;
  projectId: number;
  convertedAt: Date;
  /** FIGÉ sur la ligne de conversion au moment du calcul — jamais relu depuis le projet. */
  attributionWindowDays: number;
}

export interface ContentCandidate {
  id: number;
  projectId: number;
  publishedAt: Date | null;
}

export interface ContentInWindow {
  id: number;
  publishedAt: Date;
}

export interface CreditLine {
  contentId: number;
  creditWeight: number;
}

/**
 * DÉFAUT PROVISOIRE — décision Jeanne du 31 août 2026, pas une vérité.
 *
 * Linéaire uniforme : chaque contenu de la fenêtre reçoit `1/n`. Retenu contre la
 * décroissance exponentielle pour une raison d'asymétrie des erreurs : si le linéaire se
 * trompe, un contenu réellement décisif reçoit 20 % au lieu de 50 % — il reste visible ; si
 * l'exponentiel se trompe, il reçoit 6 % — il disparaît. Quand on ne peut rien calibrer, on
 * choisit le schéma dont l'échec est le moins destructeur.
 *
 * CONDITIONS DE BASCULE VERS L'EXPONENTIEL (à ne pas franchir sur une intuition) :
 *   - au moins 20 conversions attribuées, sur au moins 2 marques ;
 *   - ET un écart mesurable entre l'âge médian des contenus des fenêtres qui ont converti
 *     et celui des fenêtres qui n'ont pas converti.
 * Sinon, on ne bascule pas. Le changement est réversible sans migration : le poids est
 * stocké et le recalcul est idempotent.
 */
export const LINEAR_UNIFORM = "linear_uniform" as const;
export type AttributionPolicy = typeof LINEAR_UNIFORM;

const JOUR_MS = 86_400_000;

/**
 * Les contenus de la fenêtre d'une conversion.
 *
 * Bornes INCLUSIVES des deux côtés (décision actée n°3 pour la borne basse, symétrie pour
 * la haute). L'arithmétique est en millisecondes — `attributionWindowDays × 24 h`, pas des
 * jours calendaires : déterministe et insensible au fuseau, comme le reste du Fil 3.
 *
 * L'intention du contenu n'entre PAS dans la sélection : tout contenu publié de la marque
 * compte. C'est précisément ce qui permettra ensuite de mesurer quelle intention a porté
 * la conversion.
 */
export function selectContentsInWindow(
  conversion: ConversionForAttribution,
  candidates: ContentCandidate[],
): ContentInWindow[] {
  const fin = conversion.convertedAt.getTime();
  const debut = fin - conversion.attributionWindowDays * JOUR_MS;

  return candidates
    .filter((c) => {
      if (c.projectId !== conversion.projectId) return false;
      if (!c.publishedAt) return false;
      const t = c.publishedAt.getTime();
      return t >= debut && t <= fin;
    })
    .map((c) => ({ id: c.id, publishedAt: c.publishedAt as Date }))
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.id - b.id);
}

/**
 * Répartit le crédit d'une conversion sur les contenus de sa fenêtre.
 *
 * Une fenêtre vide renvoie `[]` : la conversion existe, elle n'est créditée à personne.
 * Ce n'est pas une erreur et il ne faut forcer aucun rattachement.
 *
 * La somme vaut EXACTEMENT 1 : `1/n` ne se somme pas à 1 en virgule flottante, donc les
 * n−1 premiers reçoivent `1/n` et le dernier absorbe le résidu. L'écart au `1/n` théorique
 * est de l'ordre de 1e-16.
 */
export function attribute(
  conversion: ConversionForAttribution,
  contentsInWindow: ContentInWindow[],
  policy: AttributionPolicy = LINEAR_UNIFORM,
): CreditLine[] {
  void policy; // un seul schéma aujourd'hui ; le paramètre existe pour la bascule documentée
  const n = contentsInWindow.length;
  if (n === 0) return [];

  const part = 1 / n;
  const lignes: CreditLine[] = [];
  let cumul = 0;

  for (let i = 0; i < n - 1; i++) {
    lignes.push({ contentId: contentsInWindow[i].id, creditWeight: part });
    cumul += part;
  }
  lignes.push({ contentId: contentsInWindow[n - 1].id, creditWeight: 1 - cumul });

  return lignes;
}
```

- [ ] **Étape 4 : vérifier**

```bash
npx vitest run server/services/attribution/attribute.test.ts
npx tsc --noEmit -p tsconfig.json
```
Attendu : tous les tests verts, `tsc` silencieux.

- [ ] **Étape 5 : commit**

```bash
git add server/services/attribution/
git commit -m "feat(attribution): la répartition du crédit — fenêtre inclusive et linéaire uniforme"
```

---

### Task 2 : le schéma et sa migration

**Fichiers :** Modifier `shared/schema.ts`. Générer `migrations/00XX_*.sql`.

- [ ] **Étape 1 : déclarer les deux tables**

Dans `shared/schema.ts`, après `contentReception` :

```typescript
/**
 * Conversion par marque — signal LENT (SCHEMA-TRIANGULATION.md §C.3).
 * Une conversion appartient à une MARQUE, jamais à un post.
 */
export const brandConversions = pgTable("brand_conversions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  convertedAt: timestamp("converted_at").notNull(),
  conversionType: text("conversion_type"),      // lead | vente | rdv ...
  value: doublePrecision("value"),
  /**
   * FIGÉE au moment du calcul, copiée depuis projects.attribution_window_days.
   * Ne JAMAIS relire la valeur du projet pour une conversion passée : changer la fenêtre
   * d'une marque ne doit rien changer à son historique d'attribution.
   */
  attributionWindowDays: integer("attribution_window_days"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type BrandConversion = typeof brandConversions.$inferSelect;
export type InsertBrandConversion = typeof brandConversions.$inferInsert;

/**
 * Crédit multi-touch. La somme des poids d'une conversion vaut exactement 1.
 * JAMAIS de last-touch — voir l'en-tête de server/services/attribution/attribute.ts.
 */
export const conversionAttributions = pgTable("conversion_attributions", {
  id: serial("id").primaryKey(),
  conversionId: integer("conversion_id").notNull()
    .references(() => brandConversions.id, { onDelete: "cascade" }),
  contentId: integer("content_id").notNull()
    .references(() => content.id, { onDelete: "cascade" }),
  creditWeight: doublePrecision("credit_weight").notNull(),
}, (t) => ({
  // Un contenu ne peut pas être crédité deux fois pour la même conversion.
  uniqueCredit: unique("conversion_attributions_unique_credit").on(t.conversionId, t.contentId),
}));
export type ConversionAttribution = typeof conversionAttributions.$inferSelect;
```

- [ ] **Étape 2 : générer et RELIRE la migration**

```bash
npx drizzle-kit generate
```

Puis **lis le SQL généré**. Il ne doit contenir **que** : `CREATE TABLE brand_conversions`, `CREATE TABLE conversion_attributions`, leurs clés étrangères, et la contrainte unique. **Aucun `DROP`, aucune modification de table existante, rien d'autre.** Si le fichier contient autre chose, **arrête-toi et signale-le** — cela signifierait une nouvelle dérive entre le schéma et la base.

- [ ] **Étape 3 : appliquer sur dev-local UNIQUEMENT**

Le `.env` pointe sur la branche Neon `dev-local`.

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"') node -e "
const pg=require('pg'), fs=require('fs');
const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(fs.readFileSync(process.argv[1],'utf8'))
 .then(()=>{console.log('migration appliquée');return p.end()})
 .catch(e=>{console.error('ERREUR:',e.message);process.exit(1)});
" migrations/<le_fichier_généré>.sql
```

**N'applique RIEN sur la production.** Elle n'a pas de table de suivi Drizzle (`MIGRATIONS.md` §1) et n'en recevra aucune tant que la baseline du §3 n'est pas posée. **`db:push` sur la prod est interdit.**

- [ ] **Étape 4 : vérifier** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`
- [ ] **Étape 5 : commit** — `git commit -m "feat(attribution): schéma des conversions et de leur crédit"`

---

### Task 3 : la fenêtre par marque, réglée et éditable

**Fichiers :** `server/services/project-fields.ts`, `client/src/pages/project/…` (ou la page projet existante), `client/src/locales/{fr,en}.ts`, plus une migration de données.

- [ ] **Étape 1 : ouvrir la liste blanche**

`server/services/project-fields.ts` expose `ALLOWED_PROJECT_PATCH_FIELDS`. Ajoutes-y `attributionWindowDays`. **Sans cet ajout, l'édition ne fera silencieusement rien** — vérifie qu'un test existant couvre la liste blanche et complète-le.

- [ ] **Étape 2 : écrire la migration de données, la relire, l'appliquer sur dev-local**

Décision actée n°2. Écris le SQL à la main dans `migrations/data/2026-08-31-fenetres-attribution.sql`, avec un en-tête en commentaire disant ce qu'il fait et pourquoi :

```sql
-- Fenêtres d'attribution par marque — décision Jeanne du 31 août 2026.
-- Cycle B2B long pour l'agence, cycle B2C court pour Encore Merci.
-- Les autres marques gardent le défaut de 30 j : la décision ne les nomme pas et deviner
-- un cycle commercial n'est pas notre rôle. La valeur est éditable dans les réglages.
UPDATE projects SET attribution_window_days = 60 WHERE name = 'Agence JMD';
UPDATE projects SET attribution_window_days = 14 WHERE name = 'Encore Merci';
```

Applique-la sur **dev-local uniquement**, puis vérifie :

```sql
SELECT id, name, attribution_window_days FROM projects ORDER BY id;
```
Attendu : Agence JMD 60, Encore Merci 14, les autres 30.

- [ ] **Étape 3 : rendre la fenêtre éditable**

Un champ numérique dans les réglages du projet, borné à 1–365, avec un libellé qui explique **ce que la fenêtre fait** : c'est la durée pendant laquelle un contenu publié peut être crédité d'une conversion. Précise que la modifier **ne change rien aux conversions déjà attribuées** — c'est vrai, et c'est rassurant.

Chaînes via i18n dans **fr.ts ET en.ts**.

- [ ] **Étape 4 : vérifier** — `npx vitest run client/src/locales/locales.test.ts`, `tsc`, suite complète, `npm run build`
- [ ] **Étape 5 : commit** — `git commit -m "feat(attribution): fenêtre réglée par marque et éditable"`

---

### Task 4 : le moteur d'attribution idempotent

**Fichiers :** Créer `server/services/attribution/attribute-conversion.ts`. Modifier `server/storage.ts`.

**Interfaces produites :** `attributeConversion(conversionId)` — consommée par les tâches 5 et 7.

- [ ] **Étape 1 : les accès storage**

Dans `server/storage.ts` (signatures aussi dans `IStorage`) : créer une conversion, la lire, lister les conversions d'un projet avec leurs crédits, lister les contenus candidats d'un projet, et **remplacer** les lignes d'attribution d'une conversion.

Le remplacement doit être **transactionnel** : supprimer les lignes de cette conversion puis insérer les nouvelles, dans la même transaction. C'est ce qui rend le rejeu idempotent.

- [ ] **Étape 2 : écrire le moteur**

`attributeConversion(conversionId)` :
1. charge la conversion — sa `attributionWindowDays` est celle **figée sur sa ligne**, jamais relue depuis le projet ;
2. charge les contenus candidats de la marque ;
3. `selectContentsInWindow` puis `attribute` — les deux fonctions pures de la tâche 1 ;
4. remplace les lignes d'attribution dans une transaction ;
5. renvoie les lignes écrites.

Une fenêtre vide écrit zéro ligne et **n'est pas une erreur**.

- [ ] **Étape 3 : tester ce qui est testable sans base**

La logique de décision est déjà couverte par la tâche 1. Ce qui reste à pinner ici et qui ne l'est pas ailleurs : **le gel de la fenêtre**. Écris un test qui vérifie que le moteur lit `attributionWindowDays` **sur la conversion** et jamais sur le projet — un storage simulé qui renvoie une fenêtre différente côté projet et côté conversion doit produire l'attribution de la fenêtre de la conversion.

Et un test d'**idempotence** : rejouer `attributeConversion` sur la même conversion laisse le même nombre de lignes, avec les mêmes poids.

- [ ] **Étape 4 : vérifier** — `tsc`, suite complète
- [ ] **Étape 5 : commit** — `git commit -m "feat(attribution): moteur idempotent, fenêtre figée sur la conversion"`

---

### Task 5 : les routes

**Fichiers :** `server/routes.ts`

- `POST /api/conversions` — `{ projectId, convertedAt, conversionType?, value? }`. Vérifie que le projet appartient à l'utilisateur. **Fige la fenêtre** en copiant `projects.attribution_window_days` (défaut 30 si nulle) sur la ligne créée, puis lance `attributeConversion`. Renvoie la conversion **et ses crédits**.
- `GET /api/conversions?projectId=` — les conversions d'une marque, avec leurs crédits.
- `POST /api/conversions/:id/reattribute` — relance l'attribution d'une conversion (idempotent).

Toutes derrière `isAuthenticated`, toutes vérifiant l'appartenance. Validation : `convertedAt` obligatoire et parsable, `value` numérique ou absente, `projectId` entier.

- [ ] **Étape 1 : écrire les routes** en suivant l'idiome du fichier (`req.userId`, try/catch, codes de statut)
- [ ] **Étape 2 : vérifier** — `tsc`, suite complète, `npm run build`
- [ ] **Étape 3 : commit** — `git commit -m "feat(attribution): déclaration et lecture des conversions"`

---

### Task 6 : l'écran

**Fichiers :** page projet côté client, `client/src/locales/{fr,en}.ts`

Depuis la page d'une marque : déclarer une conversion (type, valeur, date), et voir ce qu'elle a crédité.

**La restitution est en fractions de fenêtre.** Jamais « ce post a converti X » — le §5.3 du brief l'interdit explicitement. Formule ce que Naya a compris : quels contenus étaient dans la fenêtre, et quelle part chacun porte.

Une conversion **sans aucun contenu crédité** doit s'afficher comme un état normal et explicite — « aucun contenu publié dans la fenêtre » — pas comme une erreur ni comme un vide.

Chaînes via i18n dans **fr.ts ET en.ts**.

- [ ] **Étape 1 : clés i18n dans les deux locales** puis `npx vitest run client/src/locales/locales.test.ts`
- [ ] **Étape 2 : l'écran**
- [ ] **Étape 3 : vérifier** — `tsc`, suite complète, `npm run build`
- [ ] **Étape 4 : commit** — `git commit -m "feat(attribution): déclarer une conversion et voir ce qu'elle crédite"`

---

### Task 7 : le rebouclage vers 3A

**Fichiers :** `server/services/reception/ingest.ts`, `server/storage.ts`, créer `server/scripts/recompute-reception-scores.ts`

C'est le §4.3 du brief : « une fois 3B en place, `receivedVsIntentScore` reçoit son `conversionsInWindow` réel ».

- [ ] **Étape 1 : la valeur réelle**

Ajoute un accès storage qui renvoie, pour un contenu, la **somme de ses `creditWeight`** (hypothèse H1 de la spec : une somme de crédits fractionnaire, pas un compte entier — le §5.3 interdit « ce post a converti X »). Zéro crédit → `0`, qui est ici une **vraie mesure** : le contenu est bien dans des fenêtres, il n'a simplement rien capté. Aucun crédit et aucune conversion sur la marque → `0` également.

Dans `ingest.ts`, remplace `conversionsInWindow: null` par cette valeur, et **remplace le commentaire** qui expliquait le `null` par un qui explique la nouvelle sémantique.

- [ ] **Étape 2 : le script de recalcul**

`server/scripts/recompute-reception-scores.ts`, **idempotent** : pour chaque ligne `content_reception`, recalculer le score avec le `conversionsInWindow` réel et mettre à jour `receivedVsIntentScore`, `confidence`, `rationale`.

**Et (hypothèse H6 de la spec, ajout au §4.3) :** quand le score change matériellement — écart absolu > 0,05, ou passage de/vers `null` — périmer l'entrée `memory_entries` correspondante (`superseded_at`) et en écrire une nouvelle avec la phrase corrigée. Sans ça, 3A n'ayant écrit en mémoire qu'à l'insertion, les souvenirs d'avant 3B affirmeraient les anciens scores pour toujours, à la salience la plus haute du fil.

Le script se relance sans effet de bord : deuxième passage = zéro mise à jour.

- [ ] **Étape 3 : tester**

Test du recalcul : un contenu d'intention `conversion` crédité voit son score **bouger** par rapport au même contenu sans crédit. Test d'idempotence : relancer ne change plus rien.

- [ ] **Étape 4 : exécuter le script une fois sur dev-local** et rapporter combien de lignes ont bougé
- [ ] **Étape 5 : vérifier** — `tsc`, suite complète, `npm run build`
- [ ] **Étape 6 : commit** — `git commit -m "feat(attribution): le score de réception reçoit ses conversions réelles"`

---

### Task 8 : vérification des critères d'acceptation

- [ ] **Étape 1 : suite complète** — `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`. Tout vert, tests existants inchangés.

- [ ] **Étape 2 : schéma sur dev-local**

```bash
DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"') node -e "
const pg=require('pg');const p=new pg.Pool({connectionString:process.env.DATABASE_URL});
p.query(\`SELECT to_regclass('public.brand_conversions')::text AS conversions,
                to_regclass('public.conversion_attributions')::text AS credits,
                to_regclass('public.arbitration_log')::text AS ne_doit_pas_exister_3C,
                (SELECT count(*) FROM projects WHERE attribution_window_days = 60) AS fenetre_60,
                (SELECT count(*) FROM projects WHERE attribution_window_days = 14) AS fenetre_14\`)
 .then(r=>{console.log(JSON.stringify(r.rows[0],null,1));return p.end()});"
```
Attendu : les deux tables présentes, **`arbitration_log` à `null`**, une marque à 60 j, une à 14 j.

- [ ] **Étape 3 : aucun last-touch possible**

```bash
grep -rn "creditWeight" server/ --include="*.ts" | grep -v "\.test\." | grep -v "attribute.ts"
```
Aucun autre endroit ne doit fabriquer un poids. Le seul producteur est `attribute.ts`.

- [ ] **Étape 4 : la production n'a rien reçu** — confirme qu'aucune commande de ce lot n'a visé la base de production, et que `db:push` n'a jamais été lancé.

- [ ] **Étape 5 : rendre la main.** Ne pousse pas, ne merge pas.

---

## Notes pour l'implémenteur

- **Le point d'arrêt 3C est réel.** Ne crée ni `arbitration_log`, ni `server/services/arbitration/`, ni aucune politique de pondération entre fils — même « pour préparer ».
- **Ne rediscute pas les trois arbitrages.** Linéaire uniforme, fenêtre par marque, borne inclusive : c'est acté dans `NOTE-DECISION-ATTRIBUTION.md` §0. Implémente-les, ne les réévalue pas.
- **La production ne reçoit rien.** Pas de migration, pas de `db:push`, pas de script. Dev-local uniquement.
- **Tâches 3, 5, 6 : spécifiées par exigence, pas par code verbatim** — `server/routes.ts` et les pages clientes sont trop gros pour que le plan dicte chaque ligne sans figer des choix qui dépendent du contexte local. Lis les patterns voisins et suis-les. Les contraintes listées, elles, ne sont pas négociables.
- **Si une micro-décision manque, note ton hypothèse dans le commit.** Consigne explicite de la commanditaire.
