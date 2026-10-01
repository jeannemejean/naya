# Saisie manuelle de posts par marque — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coller un texte libre contenant plusieurs posts et obtenir une entrée par post dans le calendrier éditorial de la marque, sans qu'aucun champ ni aucune date ne soit inventé en silence.

**Architecture :** un endpoint `POST /api/content/import` appelle un service en deux fichiers — des fonctions pures dans `parse.ts` (prompt, lecture de la sortie du modèle, validation des dates, mesure de couverture, relevé des champs comblés) et l'orchestration dans `import.ts` (appel modèle, déduplication, écriture transactionnelle). La détection de collision entre marques liées gagne une variante « lot » dans le service existant. Côté client, un onglet dans le dialogue du calendrier éditorial, et un reçu affiché en place.

**Tech Stack :** Express, Drizzle ORM (PostgreSQL/Neon), React + react-query v5, shadcn/ui, vitest.

**Spec :** `docs/superpowers/specs/2026-10-01-naya-saisie-manuelle-design.md`

## Global Constraints

- **Aucun test n'exécute de requête réelle.** `DATABASE_URL` dans `.env` pointe vers une base Neon réelle. `../../db` est moqué dans tout test qui touche un module le consommant. Motif de référence, à lire avant d'écrire le premier test : `server/services/brand-links/collision.test.ts` (en-tête documenté, mock thenable qui capture `from`/`where`/`orderBy`/`limit`).
- **`../claude` est moqué** sur le motif de `server/services/sequence-message.test.ts` : seul `callClaude` / `callClaudeDetailed` est remplacé, `CLAUDE_MODELS` reste réel.
- **Aucune migration appliquée par `drizzle-kit push`.** Ce chantier n'ajoute aucune colonne ; s'il s'avérait en falloir une, la procédure est `npx drizzle-kit generate` → relire le SQL à la main → `npm run db:migrate`, en dev seulement.
- **Rien n'est poussé.** `git push` déploie en production. Aucun push, à aucune étape.
- **Français partout** : noms de fonctions et de variables des nouveaux services, commentaires, messages d'interface, messages de commit.
- **Zéro erreur TypeScript.** `npx tsc --noEmit` doit rendre 0. Le dépôt est à zéro, il y reste.
- `MAX_CARACTERES = 40000` pour le texte collé. `MAX_CONTENUS_COMPARES = 12` (constante existante) et `PLAFOND_POSTS_LOT = 12` pour la collision en lot. `LIMITE_CONTENUS_PAGE = 200` pour le chargement de la page.
- **Aucun compteur, aucun rappel, aucune série.** Le reçu est un constat ponctuel.
- **`TOAST_LIMIT = 1`** (`client/src/hooks/use-toast.ts:8`) : un second `toast()` écrase le premier. Le reçu ne passe pas par un toast.
- Les requêtes react-query ajoutées portent `throwOnError: false` et toute mutation porte un `onError` — le `throwOnError` global de `client/src/lib/queryClient.ts:72` fait remonter les erreurs à l'`ErrorBoundary` racine et blanchit l'application.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/services/content-import/parse.ts` (créer) | Prompt d'extraction, lecture de la sortie du modèle, validation des dates, mesure de couverture, relevé des champs comblés. **Tout est pur.** |
| `server/services/content-import/parse.test.ts` (créer) | Tests des fonctions pures. Aucun mock nécessaire. |
| `server/services/content-import/import.ts` (créer) | Orchestration : plateforme majoritaire, appel modèle, déduplication, écriture transactionnelle. |
| `server/services/content-import/import.test.ts` (créer) | `../../db` et `../claude` moqués. |
| `server/services/brand-links/collision.ts` (modifier) | Extraction de deux fonctions partagées + `detecterCollisionLot` + `parseVerdictLot`. |
| `server/services/brand-links/collision.test.ts` (modifier) | Tests du lot ajoutés. **Les tests existants ne sont pas modifiés** — c'est la preuve que l'extraction n'a rien cassé. |
| `server/routes.ts` (modifier) | `POST /api/content/import`, et la limite explicite sur `GET /api/content`. |
| `shared/schema.ts` (modifier) | Le commentaire de `content.deducedFields` élargi. Aucun changement de colonne, aucune migration. |
| `client/src/components/content/import-calendrier.tsx` (créer) | Le dialogue, le champ de collage, le reçu. |
| `client/src/pages/content-calendar.tsx` (modifier) | Le déclencheur du dialogue, et la limite explicite de chargement. |

---

### Task 1 : les fonctions pures de l'extraction

**Files:**
- Create: `server/services/content-import/parse.ts`
- Test: `server/services/content-import/parse.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit : `MAX_CARACTERES`, `PLATEFORME_PAR_DEFAUT`, `PostExtrait`, `PROMPT_EXTRACTION`, `construireMessageExtraction`, `parsePostsExtraits`, `resoudreDate`, `mesurerCouverture`, `comblerChamps`, `ChampsCombles`, `plateformeMajoritaire`.

**Pourquoi ce découpage :** tout ce qui juge est pur et testable sans base ni modèle. L'orchestration (Task 2) ne contient aucune décision.

**Le point de conception à ne pas inverser :** le modèle rend `null` pour ce qu'il ne sait pas et ne déclare JAMAIS ses propres déductions. C'est `comblerChamps` qui constate les `null`, comble, et rend la liste des champs comblés. Un modèle qui s'auto-évalue rapporte une opinion ; un serveur qui compare ce qu'il a reçu à ce qu'il écrit énonce un fait.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
import { describe, it, expect } from "vitest";
import {
  PROMPT_EXTRACTION, construireMessageExtraction, parsePostsExtraits,
  resoudreDate, mesurerCouverture, comblerChamps, MAX_CARACTERES,
  plateformeMajoritaire, PLATEFORME_PAR_DEFAUT,
} from "./parse";

describe("parsePostsExtraits", () => {
  it("lit un tableau de posts entouré de bavardage", () => {
    const raw = `Voici ce que j'ai trouvé :
[{"titre":"A","corps":"corps a","plateforme":"linkedin","type":null,"pilier":null,"objectif":null,"date":"2026-10-06"}]
Fin.`;
    const posts = parsePostsExtraits(raw);
    expect(posts).toHaveLength(1);
    expect(posts![0].titre).toBe("A");
    expect(posts![0].plateforme).toBe("linkedin");
    expect(posts![0].type).toBeNull();
  });

  it("écarte un post sans titre ou sans corps, et garde les autres", () => {
    const raw = `[{"titre":"A","corps":"a"},{"titre":"","corps":"b"},{"titre":"C"},{"titre":"D","corps":"d"}]`;
    const posts = parsePostsExtraits(raw);
    expect(posts!.map((p) => p.titre)).toEqual(["A", "D"]);
  });

  it("rend null sur un JSON illisible", () => {
    expect(parsePostsExtraits(`[{"titre":`)).toBeNull();
  });

  it("rend null quand la réponse n'est pas un tableau", () => {
    expect(parsePostsExtraits(`{"titre":"A","corps":"a"}`)).toBeNull();
  });

  it("rend null sur une réponse vide", () => {
    expect(parsePostsExtraits("")).toBeNull();
  });

  it("rend un tableau vide quand le modèle n'a rien trouvé", () => {
    expect(parsePostsExtraits("[]")).toEqual([]);
  });
});

describe("resoudreDate", () => {
  const aujourdhui = new Date("2026-10-01T00:00:00");

  it("accepte une date ISO réelle", () => {
    const d = resoudreDate("2026-10-06", aujourdhui);
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(6);
  });

  it("rend null sur null — l'absence de date reste une absence", () => {
    expect(resoudreDate(null, aujourdhui)).toBeNull();
  });

  it("rend null sur une expression non résolue par le modèle", () => {
    expect(resoudreDate("semaine du 12", aujourdhui)).toBeNull();
    expect(resoudreDate("lundi 6", aujourdhui)).toBeNull();
  });

  it("rend null sur un jour qui n'existe pas", () => {
    expect(resoudreDate("2026-02-30", aujourdhui)).toBeNull();
    expect(resoudreDate("2026-13-01", aujourdhui)).toBeNull();
  });

  it("vérifie un vrai calendrier, années bissextiles comprises", () => {
    // 2028 est bissextile, 2027 ne l'est pas. Ce couple prouve que le garde consulte un
    // calendrier réel et ne se contente pas de borner les composants.
    expect(resoudreDate("2028-02-29", new Date("2027-06-01T00:00:00"))).toBeInstanceOf(Date);
    expect(resoudreDate("2027-02-29", new Date("2027-01-01T00:00:00"))).toBeNull();
  });

  it("rend null sur une date hors des bornes plausibles", () => {
    expect(resoudreDate("1970-01-01", aujourdhui)).toBeNull();
    expect(resoudreDate("2199-01-01", aujourdhui)).toBeNull();
  });

  it("accepte une date un peu dans le passé, qu'on peut légitimement vouloir", () => {
    expect(resoudreDate("2026-09-15", aujourdhui)).toBeInstanceOf(Date);
  });
});

describe("mesurerCouverture", () => {
  it("rend le rapport entre le texte extrait et le texte collé", () => {
    const posts = [
      { titre: "ab", corps: "cdef", plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "a".repeat(12))).toBeCloseTo(0.5, 5);
  });

  it("rend 0 sur un texte vide, sans division par zéro", () => {
    expect(mesurerCouverture([], "")).toBe(0);
  });

  it("peut dépasser 1 quand le modèle a réécrit au lieu d'extraire", () => {
    const posts = [
      { titre: "x".repeat(50), corps: "y".repeat(50), plateforme: null, type: null, pilier: null, objectif: null, date: null },
    ];
    expect(mesurerCouverture(posts, "z".repeat(10))).toBeGreaterThan(1);
  });
});

describe("comblerChamps", () => {
  const nu = { titre: "T", corps: "C", plateforme: null, type: null, pilier: null, objectif: null, date: null };

  it("comble la plateforme et le type, et les déclare", () => {
    const r = comblerChamps(nu, "instagram");
    expect(r.valeurs.platform).toBe("instagram");
    expect(r.valeurs.contentType).toBe("post");
    expect(r.deduits).toEqual(expect.arrayContaining(["platform", "contentType"]));
  });

  it("laisse le pilier et l'objectif VIDES sans les déclarer déduits", () => {
    const r = comblerChamps(nu, "instagram");
    expect(r.valeurs.pillar).toBe("");
    expect(r.valeurs.goal).toBe("");
    expect(r.deduits).not.toContain("pillar");
    expect(r.deduits).not.toContain("goal");
  });

  it("ne déclare rien quand le texte a tout dit", () => {
    const r = comblerChamps(
      { titre: "T", corps: "C", plateforme: "linkedin", type: "carousel", pilier: "coulisses", objectif: "engagement", date: null },
      "instagram",
    );
    expect(r.deduits).toEqual([]);
    expect(r.valeurs.platform).toBe("linkedin");
    expect(r.valeurs.pillar).toBe("coulisses");
  });
});

describe("le prompt", () => {
  it("ordonne d'extraire et non de réécrire", () => {
    expect(PROMPT_EXTRACTION.toLowerCase()).toContain("extrai");
    expect(PROMPT_EXTRACTION).toMatch(/ne réécris pas|sans réécrire|pas de réécriture/i);
  });

  it("exige null plutôt qu'une valeur devinée", () => {
    expect(PROMPT_EXTRACTION).toContain("null");
  });

  it("injecte la date du jour dans le message", () => {
    const msg = construireMessageExtraction("mon calendrier", new Date("2026-10-01T00:00:00"));
    expect(msg).toContain("2026-10-01");
    expect(msg).toContain("mon calendrier");
  });
});

describe("plateformeMajoritaire", () => {
  it("rend la plateforme la plus fréquente", () => {
    expect(plateformeMajoritaire(["instagram", "linkedin", "instagram"])).toBe("instagram");
  });

  it("départage une égalité par ordre alphabétique, donc de façon déterministe", () => {
    // Sans départage stable, deux imports identiques combleraient différemment.
    expect(plateformeMajoritaire(["tiktok", "instagram"])).toBe("instagram");
    expect(plateformeMajoritaire(["instagram", "tiktok"])).toBe("instagram");
  });

  it("rend linkedin quand la marque n'a aucun contenu", () => {
    expect(plateformeMajoritaire([])).toBe(PLATEFORME_PAR_DEFAUT);
    expect(PLATEFORME_PAR_DEFAUT).toBe("linkedin");
  });

  it("ignore les valeurs vides sans les compter comme une plateforme", () => {
    expect(plateformeMajoritaire(["", "", "tiktok"])).toBe("tiktok");
  });
});

describe("la limite de taille", () => {
  it("vaut 40 000 caractères", () => {
    expect(MAX_CARACTERES).toBe(40000);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run server/services/content-import/parse.test.ts`
Attendu : ÉCHEC — `Cannot find module './parse'`.

- [ ] **Step 3 : écrire `parse.ts`**

```ts
// Découpage d'un texte libre — typiquement un calendrier de contenu écrit ailleurs — en
// posts du calendrier éditorial.
//
// TOUT CE FICHIER EST PUR : aucun accès base, aucun appel modèle. Ce qui juge est ici
// et se teste sans infrastructure ; l'orchestration est dans `import.ts` et ne décide
// rien.

/** Longueur maximale d'un texte collé. Au-delà, l'import refuse en nommant la limite. */
export const MAX_CARACTERES = 40000;

/** Bornes de plausibilité d'une date rendue par le modèle, en jours autour d'aujourd'hui. */
const JOURS_PASSE_TOLERES = 365;
const JOURS_FUTUR_TOLERES = 730;

/** Longueur maximale d'un titre conservé, alignée sur `brand-links/collision.ts`. */
const LONGUEUR_MAX_TITRE = 200;

/**
 * Un post tel que le MODÈLE le rend. Chaque champ optionnel vaut `null` quand le texte
 * ne le dit pas — le modèle ne devine pas et ne déclare pas ses déductions.
 */
export interface PostExtrait {
  titre: string;
  corps: string;
  plateforme: string | null;
  type: string | null;
  pilier: string | null;
  objectif: string | null;
  date: string | null;
}

export const PROMPT_EXTRACTION = `Tu reçois un texte écrit par une créatrice de contenu : le plus souvent un calendrier de contenu, une liste d'idées de posts, ou un mélange des deux.

Ta tâche : EXTRAIRE les posts qu'il contient. Tu n'écris rien de nouveau, tu ne réécris pas, tu ne reformules pas. Le corps de chaque post est le texte de la créatrice, recopié.

Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{"titre": "...", "corps": "...", "plateforme": null, "type": null, "pilier": null, "objectif": null, "date": null}]

Pour chaque champ autre que "titre" et "corps" : si le texte ne le dit pas, mets null. N'invente JAMAIS une valeur plausible — null est la bonne réponse quand tu ne sais pas, et elle est attendue.

- "plateforme" : seulement si le texte la nomme (linkedin, instagram, tiktok, facebook, youtube, newsletter...).
- "type" : seulement si le texte le nomme (post, carousel, reel, story, article, video...).
- "pilier" : le thème éditorial, seulement si le texte l'identifie comme tel.
- "objectif" : seulement si le texte le dit.
- "date" : au format AAAA-MM-JJ, et SEULEMENT si le texte désigne un jour précis que tu peux résoudre sans ambiguïté. « Semaine du 12 » ne désigne pas un jour : mets null. Un jour sans mois ni année que rien ne permet de situer : null.

Si le texte ne contient aucun post identifiable, réponds [].`;

/** Le message utilisateur : le texte collé, ancré par la date du jour. */
export function construireMessageExtraction(texte: string, aujourdhui: Date): string {
  const jour = aujourdhui.toISOString().slice(0, 10);
  return `Nous sommes le ${jour}. Les dates que tu résous se rapportent à cette date.\n\nTEXTE À DÉCOUPER\n${texte}`;
}

/**
 * Lit la sortie du modèle. Pure. Tolère du bavardage autour du tableau JSON, et écarte
 * les entrées sans titre ou sans corps — un post sans corps n'est pas un post.
 *
 * `null` (réponse illisible) et `[]` (le modèle n'a rien trouvé) sont DEUX réponses
 * différentes : la première est une panne, la seconde est un résultat.
 */
export function parsePostsExtraits(raw: string): PostExtrait[] | null {
  if (!raw) return null;
  const debut = raw.indexOf("[");
  const fin = raw.lastIndexOf("]");
  if (debut === -1 || fin <= debut) return null;
  let brut: unknown;
  try { brut = JSON.parse(raw.slice(debut, fin + 1)); } catch { return null; }
  if (!Array.isArray(brut)) return null;

  const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const posts: PostExtrait[] = [];
  for (const item of brut) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const titre = texte(o.titre);
    const corps = texte(o.corps);
    if (!titre || !corps) continue;
    posts.push({
      titre: titre.slice(0, LONGUEUR_MAX_TITRE),
      corps,
      plateforme: texte(o.plateforme),
      type: texte(o.type),
      pilier: texte(o.pilier),
      objectif: texte(o.objectif),
      date: texte(o.date),
    });
  }
  return posts;
}

/**
 * Valide la date rendue par le modèle. C'est LUI qui résout (il a la date du jour) ;
 * c'est NOUS qui vérifions — un modèle qui se trompe sur une date doit produire une
 * absence de date, jamais une date fausse.
 *
 * Trois filtres : la forme, l'existence réelle du jour (2026-02-30 n'existe pas), et la
 * plausibilité (un 1970 ou un 2199 est une hallucination, pas une intention).
 */
export function resoudreDate(brut: string | null, aujourdhui: Date): Date | null {
  if (!brut || !/^\d{4}-\d{2}-\d{2}$/.test(brut)) return null;
  const [annee, mois, jour] = brut.split("-").map(Number);
  const d = new Date(annee, mois - 1, jour);
  // Un mois ou un jour hors bornes se « reporte » silencieusement en JavaScript
  // (2026-02-30 devient le 2 mars) : on recompare les composants OBTENUS à ceux reçus
  // pour rejeter ce report au lieu de l'accepter comme une date valide.
  //
  // La comparaison se fait sur les composants LOCAUX, jamais via `toISOString()` :
  // vérifié, à Paris (UTC+2) `new Date("2026-10-06T00:00:00").toISOString()` rend
  // "2026-10-05" — un garde écrit sur l'ISO rejetterait TOUTES les dates valides du
  // fuseau. Le minuit local est aussi ce que veut `scheduledFor`, et c'est le motif
  // déjà utilisé dans `server/routes.ts` pour les dates de campagne.
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) return null;
  const minimum = aujourdhui.getTime() - JOURS_PASSE_TOLERES * 86400000;
  const maximum = aujourdhui.getTime() + JOURS_FUTUR_TOLERES * 86400000;
  if (d.getTime() < minimum || d.getTime() > maximum) return null;
  return d;
}

/**
 * Rapport entre la longueur du texte extrait et celle du texte collé.
 *
 * C'est la contrepartie de l'absence de validation : un découpage qui rate quatre posts
 * sur dix-huit ne produit AUCUNE erreur, seulement un résultat appauvri. Cette mesure
 * est la seule chose qui le rend visible.
 *
 * Peut dépasser 1 : cela signifie que le modèle a réécrit au lieu d'extraire, ce que
 * l'appelant journalise.
 */
export function mesurerCouverture(posts: PostExtrait[], texte: string): number {
  const longueur = texte.length;
  if (longueur === 0) return 0;
  const extrait = posts.reduce((n, p) => n + p.titre.length + p.corps.length, 0);
  return extrait / longueur;
}

/** Plateforme retenue quand la marque n'a aucun contenu, ou en cas d'égalité. */
export const PLATEFORME_PAR_DEFAUT = "linkedin";

/**
 * La plateforme la plus fréquente d'une liste. Pure.
 *
 * Le départage d'une égalité se fait par ordre alphabétique, donc de façon
 * DÉTERMINISTE : sans lui, deux imports du même texte sur la même marque pourraient
 * combler la plateforme différemment selon l'ordre physique des lignes rendues par
 * Postgres.
 *
 * Calculée ici, en pur, plutôt que par un `GROUP BY` : ce dépôt n'utilise `groupBy`
 * nulle part, et le mock de base de référence ne le capture pas — l'introduire pour
 * une seule requête obligerait à étendre l'échafaudage de test de tout le dépôt.
 */
export function plateformeMajoritaire(plateformes: string[]): string {
  const comptes = new Map<string, number>();
  for (const p of plateformes) {
    if (!p) continue;
    comptes.set(p, (comptes.get(p) ?? 0) + 1);
  }
  if (comptes.size === 0) return PLATEFORME_PAR_DEFAUT;
  return [...comptes.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];
}

export interface ChampsCombles {
  valeurs: { platform: string; contentType: string; pillar: string; goal: string };
  /** Les champs que LE SERVEUR a comblés, pour `content.deducedFields`. */
  deduits: string[];
}

/**
 * Comble les champs obligatoires que le texte ne donnait pas, et rend la liste de ceux
 * qu'il a fallu combler.
 *
 * Le pilier et l'objectif restent VIDES et n'entrent PAS dans `deduits` : une chaîne
 * vide n'est pas une déduction, c'est une absence assumée. Vérifié dans l'interface :
 * un pilier vide ne s'affiche pas (`content-calendar.tsx:900`) et n'empêche pas
 * l'enregistrement — la seule exigence de non-vide porte sur le bouton de génération
 * assistée (`:758`).
 */
export function comblerChamps(post: PostExtrait, plateformeParDefaut: string): ChampsCombles {
  const deduits: string[] = [];
  let platform = post.plateforme;
  if (!platform) { platform = plateformeParDefaut; deduits.push("platform"); }
  let contentType = post.type;
  if (!contentType) { contentType = "post"; deduits.push("contentType"); }
  return {
    valeurs: { platform, contentType, pillar: post.pilier ?? "", goal: post.objectif ?? "" },
    deduits,
  };
}
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run server/services/content-import/parse.test.ts`
Attendu : tous verts.

- [ ] **Step 5 : vérifier la mutation d'un test au moins**

Retirer la ligne de comparaison des composants (`if (d.getFullYear() !== annee || …) return null;`) et relancer. Attendu : le test « rend null sur un jour qui n'existe pas » échoue, et lui seul. Remettre la ligne, relancer, puis `git diff` doit être vide avant le commit.

- [ ] **Step 6 : commit**

```bash
git add server/services/content-import/parse.ts server/services/content-import/parse.test.ts
git commit -m "feat(import): fonctions pures du découpage d'un texte collé en posts"
```

---

### Task 2 : l'orchestration de l'import

**Files:**
- Create: `server/services/content-import/import.ts`
- Test: `server/services/content-import/import.test.ts`
- Modify: `shared/schema.ts` — le commentaire de `content.deducedFields`

**Interfaces:**
- Consomme : tout l'export de `./parse` ; `normalizeTitle` de `../reading/url` ; `callClaudeDetailed`, `CLAUDE_MODELS` de `../claude` ; `db` de `../../db`.
- Produit :

```ts
export interface ResultatImport {
  posts: Array<{ id: number; title: string; scheduledFor: Date | null }>;
  ignores: number;
  couverture: number;      // rapport brut, non borné
  tronque: boolean;        // la réponse du modèle a été coupée par max_tokens
}
export async function importerTexte(input: {
  userId: string; projectId: number; texte: string;
}): Promise<ResultatImport>
```

**Trois décisions à ne pas improviser :**

1. **`taskKind: "strategic_reasoning"`**, pas `"extraction"`. `extraction` est routé vers Haiku (`server/services/ai/types.ts:8`) ; le modèle explicite est honoré mais le `taskKind` choisit le PROVIDER. Passer `extraction` avec `CLAUDE_MODELS.smart` est une contradiction qui fonctionne jusqu'au jour où le routage change.
2. **`callClaudeDetailed`**, pas `callClaude` : une réponse coupée par `max_tokens` produit sinon une couverture basse et inexpliquée. `stopReason` fait de la troncature un fait qu'on peut dire.
3. **La déduplication se fait sur le titre normalisé**, à l'intérieur du lot ET contre les titres déjà présents dans cette marque. `normalizeTitle` existe déjà (`server/services/reading/url.ts:43`), écrit pour la revue du matin — la réutiliser plutôt que d'en écrire une seconde.

- [ ] **Step 1 : écrire les tests qui échouent**

Reprendre l'en-tête de mock de `server/services/brand-links/collision.test.ts` (chaîne thenable qui capture `from`/`where`/`orderBy`/`limit`, et `vi.mock("../claude")` qui ne remplace que l'appel). Cas à couvrir, chacun affirmant précisément :

1. Un texte produisant deux posts écrit deux lignes, avec le `projectId` reçu, `status: "draft"` et `contentStatus: "idea"`.
2. Un post dont le modèle n'a pas donné la plateforme reçoit la plateforme majoritaire de la marque, et `deducedFields` contient `"platform"`.
3. Un post dont le modèle a tout donné a `deducedFields` égal à `[]` — pas `null`.
4. Un post sans date est écrit avec `scheduledFor` à `null`.
5. Un titre déjà présent dans la marque n'est PAS écrit, et `ignores` vaut 1.
6. Deux posts du même titre dans le même lot n'écrivent qu'une ligne, et `ignores` vaut 1.
7. Une réponse de modèle illisible (`parsePostsExtraits` rend `null`) n'écrit RIEN et lève — l'appelant transforme en 502 ; un import qui n'a rien compris ne doit pas se présenter comme un import réussi à zéro post.
8. `[]` (le modèle n'a trouvé aucun post) n'écrit rien, ne lève PAS, et rend `posts: []` — c'est un résultat, pas une panne. **La distinction entre ce cas et le précédent est le cœur du test.**
9. `stopReason` indiquant une troncature met `tronque` à `true` sans empêcher l'écriture des posts obtenus.
10. L'écriture passe par `db.transaction` : le mock doit le constater.
11. Une marque sans aucun contenu existant donne `linkedin` comme plateforme par défaut.

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run server/services/content-import/import.test.ts`

- [ ] **Step 3 : écrire `import.ts`**

```ts
import { db } from "../../db";
import { and, desc, eq } from "drizzle-orm";
import { content } from "@shared/schema";
import { callClaudeDetailed, CLAUDE_MODELS } from "../claude";
import { normalizeTitle } from "../reading/url";
import {
  PROMPT_EXTRACTION, construireMessageExtraction, parsePostsExtraits,
  resoudreDate, mesurerCouverture, comblerChamps, plateformeMajoritaire,
} from "./parse";

/** Plafond de la réponse du modèle. Large : un calendrier trimestriel extrait fait du volume. */
const MAX_TOKENS_EXTRACTION = 16000;

/**
 * Nombre de contenus récents consultés pour établir la plateforme majoritaire de la
 * marque. La majorité RÉCENTE est plus juste qu'une majorité historique : elle reflète
 * où la marque publie aujourd'hui, pas où elle publiait il y a deux ans.
 */
const CONTENUS_CONSULTES_PLATEFORME = 200;

/** Au-delà de ce rapport, le modèle a réécrit au lieu d'extraire — on le journalise. */
const SEUIL_REECRITURE = 1.2;

/** Levée quand le modèle a répondu quelque chose d'illisible. L'endpoint la traduit en 502. */
export class ReponseIllisible extends Error {
  constructor() { super("le modèle n'a pas rendu de tableau de posts lisible"); }
}

export interface ResultatImport {
  posts: Array<{ id: number; title: string; scheduledFor: Date | null }>;
  /** Posts écartés parce que leur titre existait déjà dans cette marque, ou en double dans le lot. */
  ignores: number;
  /** Rapport brut, NON borné : peut dépasser 1. L'endpoint le borne pour l'affichage. */
  couverture: number;
  /** La réponse du modèle a été coupée (`max_tokens` ou `length` selon le provider). */
  tronque: boolean;
}

export async function importerTexte(input: {
  userId: string; projectId: number; texte: string;
}): Promise<ResultatImport> {
  const aujourdhui = new Date();

  // `taskKind: "strategic_reasoning"` et NON "extraction" : "extraction" est routé vers
  // Haiku (server/services/ai/types.ts), et c'est le taskKind qui choisit le PROVIDER —
  // le modèle explicite n'est honoré qu'à l'intérieur de ce provider. Les deux doivent
  // désigner le même palier, sinon la contradiction passe inaperçue jusqu'au jour où le
  // routage change.
  const { text: raw, stopReason } = await callClaudeDetailed({
    model: CLAUDE_MODELS.smart,
    taskKind: "strategic_reasoning",
    system: PROMPT_EXTRACTION,
    max_tokens: MAX_TOKENS_EXTRACTION,
    userId: input.userId,
    projectId: input.projectId,
    messages: [{ role: "user", content: construireMessageExtraction(input.texte, aujourdhui) }],
  });

  const extraits = parsePostsExtraits(raw);
  // `null` et `[]` sont DEUX réponses différentes, et la distinction est le point : une
  // réponse illisible est une panne, qu'on fait remonter ; un tableau vide est un
  // résultat, qu'on rend tel quel. Confondre les deux ferait passer une panne pour
  // « aucun post trouvé » — un import qui n'a rien compris se présenterait comme un
  // import réussi à zéro post, et rien ne le dirait.
  if (extraits === null) throw new ReponseIllisible();

  // DEUX valeurs, pas une : `assertNotTruncated` (server/services/claude.ts:137)
  // reconnaît "max_tokens" ET "length" — les providers ne nomment pas la troncature de
  // la même façon. Ne tester que la première laisserait `tronque` à faux sous l'autre
  // provider, avec une couverture basse et aucune explication dans le reçu.
  //
  // On ne réutilise pas `assertNotTruncated` ici parce qu'elle LÈVE : une réponse
  // tronquée doit livrer les posts qu'elle a produits, en le disant, pas tout perdre.
  const tronque = stopReason === "max_tokens" || stopReason === "length";
  const couverture = mesurerCouverture(extraits, input.texte);

  // Plateformes récentes de la marque, pour combler les posts dont le texte ne la dit
  // pas. Un `select` ordinaire plus un calcul pur, pas un GROUP BY (voir
  // `plateformeMajoritaire`).
  const recents = await db
    .select({ platform: content.platform })
    .from(content)
    .where(and(eq(content.userId, input.userId), eq(content.projectId, input.projectId)))
    .orderBy(desc(content.createdAt))
    .limit(CONTENUS_CONSULTES_PLATEFORME);
  const parDefaut = plateformeMajoritaire(recents.map((r) => r.platform));

  // Titres déjà présents dans cette marque. La déduplication porte sur le titre
  // NORMALISÉ (accents, casse, ponctuation) : `normalizeTitle` existe déjà, écrite pour
  // la revue du matin.
  const existants = await db
    .select({ title: content.title })
    .from(content)
    .where(and(eq(content.userId, input.userId), eq(content.projectId, input.projectId)));
  const vus = new Set(existants.map((e) => normalizeTitle(e.title)));

  const aEcrire: Array<typeof content.$inferInsert> = [];
  let ignores = 0;
  for (const post of extraits) {
    const cle = normalizeTitle(post.titre);
    // Le `vus.add` dans la même passe dédoublonne AUSSI à l'intérieur du lot : deux
    // posts homonymes dans le texte collé n'écrivent qu'une ligne.
    if (vus.has(cle)) { ignores += 1; continue; }
    vus.add(cle);
    const { valeurs, deduits } = comblerChamps(post, parDefaut);
    aEcrire.push({
      userId: input.userId,
      projectId: input.projectId,
      title: post.titre,
      body: post.corps,
      platform: valeurs.platform,
      contentType: valeurs.contentType,
      pillar: valeurs.pillar,
      goal: valeurs.goal,
      status: "draft",
      contentStatus: "idea",
      scheduledFor: resoudreDate(post.date, aujourdhui),
      // `[]` et non `null` : le contenu est bien passé par un relevé de déductions, et
      // ce relevé est vide. `null` signifierait « question sans objet » (voir le
      // commentaire de la colonne dans shared/schema.ts).
      deducedFields: deduits,
    });
  }

  // Une seule transaction pour tout le lot : un échec au dixième post ne laisse pas les
  // neuf premiers dans le calendrier. L'utilisatrice recolle ; elle ne nettoie pas.
  const posts = aEcrire.length === 0 ? [] : await db.transaction(async (tx) => {
    const lignes = await tx.insert(content).values(aEcrire).returning({
      id: content.id, title: content.title, scheduledFor: content.scheduledFor,
    });
    return lignes;
  });

  console.info(
    `[Import] projet ${input.projectId} : ${posts.length} post(s) écrit(s), ` +
    `${ignores} ignoré(s), couverture ${couverture.toFixed(2)}` +
    (tronque ? ", RÉPONSE TRONQUÉE" : "") +
    (couverture > SEUIL_REECRITURE ? ", le modèle a probablement réécrit au lieu d'extraire" : ""),
  );

  return { posts, ignores, couverture, tronque };
}
```

**Le type d'insertion.** `Array<typeof content.$inferInsert>` plutôt qu'un `Record<string, unknown>[]` suivi d'un `as any` : le motif `$inferInsert` est déjà utilisé dans `shared/schema.ts:685`. Si ce typage ne compile pas proprement sur ce lot de champs, garder un cast MAIS avec un commentaire disant lequel des champs le compilateur refuse — un cast sans explication est une dette muette.

**Deux pièges à ne pas introduire en écrivant les tests :**
- Le mock de `./db` doit accepter `transaction` en plus de la chaîne de `select`. Le motif de `collision.test.ts` ne couvre que `select` : l'étendre, en gardant l'existant intact.
- `vi.spyOn(console, "info")` sans `mockRestore()` dans un `afterEach` fait fuir l'historique des appels d'un test à l'autre et produit des échecs trompeurs. Ce défaut a déjà coûté du temps dans ce dépôt.

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

- [ ] **Step 5 : élargir le commentaire de `deducedFields`**

Dans `shared/schema.ts`, le commentaire de `content.deducedFields` décrit la colonne comme propre au routage depuis une tâche. Elle sert désormais aussi à l'import d'un texte collé. Reformuler l'ouverture en « champs que Naya a déduits au lieu de les recevoir de l'utilisatrice, quelle que soit l'origine du contenu », conserver les trois états documentés mot pour mot, et ajouter l'import à la liste des origines. **Ne pas réécrire l'explication existante** — elle est juste, elle s'élargit.

Aucune migration : le commentaire n'est pas du SQL.

- [ ] **Step 6 : commit**

```bash
git add server/services/content-import/ shared/schema.ts
git commit -m "feat(import): orchestration du découpage, déduplication par titre, écriture transactionnelle"
```

---

### Task 3 : la collision en lot

**Files:**
- Modify: `server/services/brand-links/collision.ts`
- Modify: `server/services/brand-links/collision.test.ts` (ajouts seulement)

**Interfaces:**
- Consomme : `FENETRE_JOURS`, `MAX_CONTENUS_COMPARES`, `LONGUEUR_MAX_TITRE` (existants).
- Produit :

```ts
export const PLAFOND_POSTS_LOT = 12;
export const PROMPT_COLLISION_LOT: string;
export interface CollisionLot { nouveauId: number; contenuId: number; marque: string; scheduledFor: Date | null; pourquoi: string; }
export function parseVerdictLot(raw: string, idsNouveaux: Set<number>, idsVoisins: Set<number>): Array<{ nouveauId: number; contenuId: number; pourquoi: string }>;
export async function detecterCollisionLot(input: {
  userId: string; projectId: number;
  posts: Array<{ id: number; titre: string; corps: string; quand: Date }>;
}): Promise<CollisionLot[]>;
```

**L'extraction, et sa preuve.** Sortir de `detecterCollision` deux fonctions internes, utilisées par les deux chemins :

```ts
async function liensAvecRecoupement(userId: string, projectId: number): Promise<number[]>
async function voisinsProgrammes(userId: string, autresIds: number[], debut: Date, fin: Date): Promise<Array<{ id: number; title: string; body: string | null; projectId: number | null; scheduledFor: Date | null }>>
```

**Les tests existants de `detecterCollision` ne sont PAS modifiés.** C'est la seule preuve acceptable que l'extraction n'a rien changé à son comportement. S'il faut en toucher un, c'est que l'extraction a changé quelque chose — s'arrêter et le signaler.

**Le prompt du lot, et pourquoi il ressemble à celui-ci et pas à un autre.** Les posts du lot sont déjà écrits quand la détection s'exécute : ils ont de VRAIS identifiants. Pas d'index à faire correspondre — les deux côtés portent des identifiants réels, sous deux étiquettes distinctes pour qu'aucune confusion ne soit possible :

```
NOUVEAUX CONTENUS
Nouveau contenu : 412
Titre : ...
<corps tronqué à 400>

DÉJÀ PROGRAMMÉ SUR LA MARQUE LIÉE
Déjà programmé : 207
Titre : ...
<corps tronqué à 400>
```

Et la sortie attendue, dans la forme EXACTE que `parseVerdictLot` accepte :

```json
{"collisions": [{"nouveauId": 412, "contenuId": 207, "pourquoi": "<une phrase, en français>"}]}
```

Reprendre mot pour mot la consigne de `PROMPT_COLLISION` sur les entiers nus (« C'est un NOMBRE ENTIER NU — 1, jamais "1", jamais [1] »), et réutiliser `extraireEntier` pour la tolérance. **La raison est documentée dans le fichier** : la forme `[1] Titre` a été reproduite telle quelle par le modèle en usage réel, et le parseur la rejetait.

`parseVerdictLot` applique le **double filtre** : la tolérance de ponctuation à la lecture, puis la vérification que chaque identifiant interprété existe réellement dans l'ensemble correspondant. Un couple dont l'un des deux identifiants est inventé est écarté. C'est cette seconde vérification qui rend la première tolérance sûre.

- [ ] **Step 1 : écrire les tests qui échouent**

Cas à couvrir :
1. `parseVerdictLot` lit un tableau de collisions et rend les couples valides.
2. Un couple dont `nouveauId` n'est pas dans l'ensemble des nouveaux est écarté.
3. Un couple dont `contenuId` n'est pas dans l'ensemble des voisins est écarté.
4. `"nouveauId": "[412]"` est accepté — la tolérance de ponctuation fonctionne.
5. `{"collisions": []}` rend `[]`. Un JSON illisible rend `[]`.
6. `detecterCollisionLot` rend `[]` **sans interroger la table `content`** quand aucun lien à audiences recoupées n'existe — l'absence de lien est une interdiction de rapprocher deux marques, y compris pour les comparer. Le mock doit constater quelles tables ont été interrogées.
7. La fenêtre couvre l'amplitude du lot : la clause `WHERE` rendue par `PgDialect` est vérifiée aux bornes.
8. Au-delà de `PLAFOND_POSTS_LOT`, les posts envoyés au modèle sont bornés et **le journal dit combien ont été écartés** — un nombre réel, pas un nombre inventé.
9. Une panne de base ou du modèle rend `[]` et journalise, sans lever.
10. Les tests existants de `detecterCollision` passent sans modification.

- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : extraire les deux fonctions partagées, écrire `detecterCollisionLot` et `parseVerdictLot`**
- [ ] **Step 4 : lancer toute la suite du fichier**

Run: `npx vitest run server/services/brand-links/`
Attendu : les nouveaux tests passent ET les anciens passent sans avoir été touchés. Vérifier avec `git diff` que la partie existante du fichier de test est intacte.

- [ ] **Step 5 : commit**

```bash
git add server/services/brand-links/
git commit -m "feat(liens): détection de collision pour un lot de contenus, en un seul appel"
```

---

### Task 4 : l'endpoint

**Files:**
- Modify: `server/routes.ts` — ajouter `POST /api/content/import` près de `POST /api/content/reception/import` (ligne 6843), pour que les deux imports se lisent ensemble.

**Interfaces:**
- Consomme : `importerTexte` de `./services/content-import/import`, `MAX_CARACTERES` de `./services/content-import/parse`, `detecterCollisionLot` de `./services/brand-links/collision`, `isAiBlocked` de `./services/usage`.

**Contrat :**

```
POST /api/content/import
corps : { projectId: number, text: string }

400  projectId invalide | text vide | text > MAX_CARACTERES (message nommant la limite ET la longueur reçue)
404  projet inexistant ou non possédé  ← jamais 403 : motif du dépôt, ne pas révéler l'existence
429  isAiBlocked
502  le modèle a répondu quelque chose d'illisible
200  { posts, ignores, couverture, tronque, collisions }
```

`couverture` est un entier de 0 à 100, borné à 100 côté serveur. Le rapport brut reste dans le journal.

**La détection de collision s'exécute avant la réponse**, dans un `try`/`catch` LOCAL : les posts sont déjà écrits et commités, donc une exception ici ne doit jamais produire un 500 après une écriture réussie. C'est exactement le motif retenu sur `POST /api/content` dans le chantier précédent.

- [ ] **Step 1 : écrire les tests**

Dans le fichier de tests de routes correspondant, sur le motif existant (`storage`, `auth` et `./db` moqués) :
1. `projectId` non possédé → 404.
2. `text` vide → 400.
3. `text` de `MAX_CARACTERES + 1` → 400, et le message contient la limite et la longueur reçue.
4. `isAiBlocked` vrai → 429, et `importerTexte` n'est jamais appelée.
5. Cas nominal → 200, et `couverture` est un entier entre 0 et 100.
6. Une couverture brute de 1,4 est rendue comme 100, pas 140.
7. `detecterCollisionLot` qui lève → la réponse reste 200 avec `collisions: []`. **C'est le test qui compte le plus** : une écriture réussie ne doit jamais se présenter comme un échec.
8. `importerTexte` qui lève sur une réponse illisible → 502, et aucun post rendu.

- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : écrire l'endpoint**
- [ ] **Step 4 : lancer, vérifier le vert**
- [ ] **Step 5 : commit**

```bash
git add server/routes.ts
git commit -m "feat(import): POST /api/content/import, collision du lot absorbée localement"
```

---

### Task 5 : le plafond de chargement cesse d'être silencieux

**Files:**
- Modify: `server/routes.ts` — `GET /api/content` (ligne 6595)
- Modify: `client/src/pages/content-calendar.tsx` — la requête (ligne 214)

**Pourquoi cette tâche existe :** `getContent` rend 50 lignes au maximum, les plus récemment créées, et la page n'envoie aucune limite. Coller 20 posts dans une marque qui en compte 40 fait disparaître de la vue 20 posts anciens, **dont des contenus programmés pour les semaines à venir**. Ils restent en base ; la page ne les montre plus ; rien ne le dit. C'est la seule façon dont cette fonctionnalité peut faire perdre du travail déjà fait.

- [ ] **Step 1 : écrire les tests**

1. `GET /api/content?limit=200` rend jusqu'à 200 lignes.
2. `limit` non numérique, nul, négatif ou au-delà du maximum accepté → 400. Le plafond serveur est explicite, il n'est pas deviné depuis l'entrée.
3. Un test de rendu de la page : quand la requête rend exactement `LIMITE_CONTENUS_PAGE` éléments, la ligne d'avertissement est présente ; à `LIMITE_CONTENUS_PAGE - 1`, elle est absente.

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : mettre en œuvre**

Serveur : valider `limit`, plafond dur à 200, 400 au-delà. Client : `params.set('limit', String(LIMITE_CONTENUS_PAGE))`, et une ligne discrète au-dessus des onglets quand `content.length === LIMITE_CONTENUS_PAGE` — texte factuel, sans point d'exclamation, sans injonction : « 200 contenus affichés ; cette marque en a peut-être davantage. »

- [ ] **Step 4 : lancer, vérifier le vert**
- [ ] **Step 5 : commit**

```bash
git add server/routes.ts client/src/pages/content-calendar.tsx
git commit -m "fix(calendrier): le plafond de 50 contenus devient 200 et s'annonce quand il mord"
```

---

### Task 6 : le dialogue de collage

**Files:**
- Create: `client/src/components/content/import-calendrier.tsx`
- Modify: `client/src/pages/content-calendar.tsx` — le déclencheur

**Interfaces:**
- Consomme : `POST /api/content/import` ; `tenterUneFois` de `@/lib/one-shot-guard` ; `Dialog`, `Textarea`, `Button` de shadcn ; `useToast` ; `useQueryClient`.
- Produit : `<ImportCalendrier projectId={number | null} />`

**Le reçu reste dans le dialogue.** `TOAST_LIMIT = 1` : un second toast écrase le premier, et le reçu porte quatre faits. Le dialogue affiche le reçu en place après succès, et l'utilisatrice le ferme. Le champ de collage est remplacé par le reçu — pas affiché à côté, pour qu'on ne puisse pas recoller par réflexe sur un texte déjà traité.

**Le reçu, mot pour mot :**

```
14 posts créés, couvrant environ 85 % de ton texte.
9 sont datés, 5 sont en réserve.
2 posts étaient déjà présents, ignorés.           ← seulement si > 0
2 recoupent du contenu déjà programmé sur Agence JMD.  ← seulement si > 0
Ton texte était trop long pour un seul passage : une partie n'a pas été lue.  ← seulement si tronqué
```

Aucune ligne à zéro : « 0 post ignoré » est du bruit. Aucun point d'exclamation, aucune félicitation, aucune injonction.

- [ ] **Step 1 : écrire les tests de rendu**

1. État vide : le bouton d'import est désactivé tant que le champ est vide.
2. Au-delà de `MAX_CARACTERES`, le bouton est désactivé et la longueur courante est affichée face à la limite — **avant** l'envoi, pour ne pas faire attendre un appel modèle pour un refus prévisible.
3. Après succès, le reçu remplace le champ et porte les lignes attendues.
4. Les lignes à zéro ne s'affichent pas.
5. Une erreur de l'import affiche un message et laisse le texte en place — **le texte collé n'est jamais perdu sur un échec.**
6. Un 400 pour texte trop long affiche le message du serveur, pas un « réessaie » générique : réessayer à l'identique ne peut pas marcher. (Motif corrigé hier dans `BrandLinksPanel.tsx`.)
7. Un double clic n'envoie qu'une requête (`tenterUneFois` plus `disabled` pendant l'attente).

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : écrire le composant**

Contraintes : `onError` sur la mutation (obligatoire, cf. Global Constraints) ; invalider `['/api/content', projectId]` au succès ; `tenterUneFois` avec une `useRef` pour le verrou.

- [ ] **Step 4 : brancher le déclencheur dans `content-calendar.tsx`**

Sur le motif des onglets « manuel » / « CSV » de l'import de réception (ligne 1452).

- [ ] **Step 5 : lancer la suite complète + `tsc` + build**

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Step 6 : commit**

```bash
git add client/src/components/content/import-calendrier.tsx client/src/pages/content-calendar.tsx
git commit -m "feat(import): dialogue de collage d'un calendrier et son reçu"
```

---

### Task 7 : vérification des deux couples prompt/parseur contre le vrai modèle

**Files:**
- Create: `scripts/verifier-import.ts` (script de vérification, non livré au produit)

**Pourquoi cette tâche existe, et pourquoi elle n'est pas optionnelle.** Dans le chantier précédent, un prompt qui présentait ses éléments sous la forme `[1] Titre` a fait répondre `"[1]"` à un parseur qui exigeait un entier. Une collision correctement détectée a été jetée en silence, avec 1524 tests verts — dont un test juste, qui affirmait que le parseur rejette un identifiant non numérique. Le prompt fabriquait exactement le format que son parseur refusait, et **aucun test unitaire ne peut trouver ça** : les deux moitiés étaient correctes séparément.

Ce chantier crée deux couples de ce type. Les deux passent par une exécution réelle.

- [ ] **Step 1 : écrire le script**

Deux vérifications, chacune imprimant la réponse BRUTE du modèle avant de la passer au parseur :

1. **Extraction.** Un texte de calendrier réaliste (au moins 8 posts, dont certains datés, certains non, une mention « semaine du … », au moins une plateforme nommée). Imprimer la réponse brute, puis le résultat de `parsePostsExtraits`, puis la couverture. Vérifier : le nombre de posts trouvés correspond au texte ; les `null` sont bien des `null` et non des chaînes `"null"` ; aucune date n'est posée sur « semaine du … ».
2. **Collision de lot.** Construire à la main la forme exacte du prompt avec deux faux lots d'identifiants, appeler le modèle, imprimer la réponse brute, puis le résultat de `parseVerdictLot`. Vérifier que les identifiants reviennent sous une forme que le parseur accepte.

Le script lit `DATABASE_URL` sans l'utiliser : il n'écrit RIEN en base. Il n'appelle que le modèle.

- [ ] **Step 2 : exécuter, lire les réponses brutes**

```bash
npx tsx scripts/verifier-import.ts
```

**Lire les sorties brutes avant de regarder les verdicts.** Si un parseur rejette quelque chose que le modèle a correctement trouvé, le défaut est dans le prompt, pas dans le parseur — et c'est exactement la conclusion qu'il a fallu trois heures pour atteindre la dernière fois.

- [ ] **Step 3 : corriger les deux côtés si nécessaire**

Toute correction d'un prompt se fait avec son parseur sous les yeux, et réciproquement. Relancer le script après chaque correction.

- [ ] **Step 4 : consigner le résultat**

Écrire dans le registre du chantier ce que le modèle a réellement répondu pour chacun des deux couples, et si une correction a été nécessaire. Si tout est passé du premier coup, l'écrire aussi : c'est une information.

- [ ] **Step 5 : commit**

```bash
git add scripts/verifier-import.ts
git commit -m "test(import): vérification des deux couples prompt/parseur contre le vrai modèle"
```

---

## Auto-revue du plan

**Couverture du spec.** Les treize critères d'acceptation : 1 → T2+T4 ; 2 → T1 (`resoudreDate`) + T2 ; 3 → T1 ; 4 → T1 (`comblerChamps`) ; 5 → T1+T2 ; 6 → T4+T6 ; 7 → T2 ; 8 → T4+T6 ; 9 → T2 (transaction) ; 10 → T3+T4 ; 11 → T3 ; 12 → T5 ; 13 → Global Constraints et chaque tâche.

**Décisions du spec.** 1 → T2 ; 2 → T1+T2 ; 3 → T1 ; 4 → T1+T4+T6 ; 5 → T2 ; 6 → T2 ; 7 → T6 ; 8 → T3+T4 ; 9 → T7 ; 10 → T5.

**Conflits entre tâches.** T3 et T4 touchent tous deux `collision.ts` / `routes.ts` mais à des endroits disjoints, et dans cet ordre. T4 et T5 modifient tous deux `routes.ts` : T4 ajoute un endpoint près de la ligne 6843, T5 modifie `GET /api/content` à la ligne 6595 — disjoints, mais **T5 après T4** pour éviter un décalage de lignes à relire. T5 et T6 modifient tous deux `content-calendar.tsx` : T5 la requête (ligne 214), T6 le déclencheur de dialogue — disjoints.

**Dépendance d'interface.** T3 a besoin des identifiants rendus par T2 (`.returning()`), T4 a besoin de T2 et T3, T6 a besoin du contrat de T4. Ordre d'exécution : 1 → 2 → 3 → 4 → 5 → 6 → 7.

**Un écart au standard de rédaction, assumé.** Les tâches 2, 3, 4, 5 et 6 donnent leurs cas de test en liste nommée plutôt qu'en code exécutable. Motif : l'échafaudage de ces tests (mock thenable de `./db`, mock partiel de `../claude`, rendu SQL par `PgDialect`) existe déjà et est documenté en en-tête de `server/services/brand-links/collision.test.ts`, que chaque tâche désigne explicitement ; le prescrire à l'aveugle produirait du code à réécrire. Chaque cas nomme précisément ce qu'il doit affirmer, et la revue de tâche vérifie que les tests écrits échouent quand on annule ce qu'ils protègent. La tâche 1, qui n'a aucun échafaudage, donne son code de test en entier.
