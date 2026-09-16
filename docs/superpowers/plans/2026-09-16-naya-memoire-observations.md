# La mémoire des observations — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** ce que Naya a compris du rythme de l'utilisatrice cesse d'être perdu quand une notification n'est pas vue, et devient une connaissance qu'elle réutilise partout.

**Architecture :** une fonction **pure** extrait toutes les observations que les données permettent, structurées et non plus réduites à une phrase. Une seconde fonction **pure** décide, pour chacune, s'il faut écrire, ne rien faire, ou remplacer. Une enveloppe fine les branche sur `memory_entries`, la mémoire que Naya s'injecte déjà à chaque appel IA.

**Spec :** `docs/superpowers/specs/2026-09-16-naya-memoire-observations-design.md`

**Stack :** Express + Drizzle + PostgreSQL Neon, vitest. Serveur uniquement — `mobile/` n'est pas touché.

## Contraintes globales

- **AUCUNE MIGRATION.** La table `memory_entries` existe déjà en production. Si tu penses avoir besoin d'une colonne, **arrête-toi et signale** : la spec explique pourquoi l'identité passe par un préfixe de contenu.
- **`buildImmediateInsight` et son test ne sont PAS modifiés.** Vérifié en fin de lot par un diff qui doit être vide.
- **Une observation périmée est invalidée, jamais supprimée.** `supersededAt`, comme le fait déjà `reception/recompute.ts`.
- **Une nouvelle observation n'invalide QUE celle de même identité.** Deux sujets différents coexistent.
- **Toutes les formulations d'un même sujet partagent le même préfixe**, tiré d'une constante exportée. Un test doit le prouver — sans ça, basculer d'une formulation à l'autre crée un doublon et Naya se souvient de deux affirmations contraires.
- **L'embedding est au mieux.** `embedText` peut rendre `null` : l'observation est **quand même** écrite. Un embedding absent veut dire « non vectorisé », jamais « vecteur nul ».
- **Une écriture qui échoue ne fait jamais échouer la réponse de l'utilisatrice.** Elle a répondu ; c'est la donnée précieuse. La mémoire est un bénéfice, pas une condition.
- **Constantes exportées, nommées, documentées comme défauts révisables** — jamais un nombre au milieu de la logique.
- **Fonctions pures** : pas d'accès base, pas d'horloge implicite (`Date.now()`, `new Date()` sans argument), pas d'aléa. L'instant entre par paramètre.
- **Aucune observation sur les durées.** `actualDuration` n'est pas mesurée ; rien ne doit en dépendre.
- Vérification à chaque tâche : `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` vert sous `TZ=UTC` **et** `TZ=Pacific/Kiritimati`.
- **Ne jamais lancer `npm install`.** **Ne jamais `git push`.** Ne pas toucher la production ni ses variables, ni `mobile/`.
- **Si une micro-décision n'est pas couverte, noter l'hypothèse dans le commit** plutôt que deviner en silence.
- **Prouver la discriminance par mutation.** Sept tests du lot précédent se sont révélés creux. Ne pas affirmer qu'un test est discriminant : casser le code exprès, montrer qu'il devient rouge, restaurer, **rapporter le chiffre**.

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `server/services/result-capture/observations.ts` *(créé)* | Extrait **toutes** les observations, structurées. Pure. |
| `server/services/result-capture/observation-memory.ts` *(créé)* | Décide écrire / ne rien faire / remplacer. Pure. |
| `server/services/result-capture/observation-writer.ts` *(créé)* | Enveloppe base : lit la mémoire vivante, applique la décision. Impure, fine. |
| `server/routes.ts` *(modifié)* | Appelle l'enveloppe après une réponse, sans jamais la laisser faire échouer la réponse. |
| `server/services/result-capture/insight.ts` | **NON MODIFIÉ.** |

---

### Task 1 : extraire toutes les observations

**Fichiers :**
- Créer : `server/services/result-capture/observations.ts`
- Test : `server/services/result-capture/observations.test.ts`

**Interfaces :**
- Consomme : le type `TaskAnswer` de `./insight` (`{ category: string | null; scheduledHour: number; done: boolean }`) et la constante `MIN_OBSERVATIONS` (valeur 5).
- Produit :

```ts
export const PREFIXE_CATEGORIE = (categorie: string) => `Les tâches « ${categorie} » :`;
export const PREFIXE_MOMENT = "Ton rythme dans la journée :";

export interface Observation {
  /** Préfixe stable identifiant le SUJET. Deux observations de même préfixe se remplacent. */
  prefixe: string;
  /** Texte complet mémorisé, commençant TOUJOURS par `prefixe`. */
  contenu: string;
  /** Nombre de réponses qui fondent cette observation — sert à pondérer la salience. */
  appuis: number;
}

export function extractObservations(answers: TaskAnswer[]): Observation[];
```

`extractObservations` reprend **les mêmes règles et les mêmes seuils** que `buildImmediateInsight` — ne les réinvente pas, lis le fichier — mais elle rend **toutes** les observations au lieu de s'arrêter à la première, et son texte est celui de la **mémoire**, pas celui de la notification.

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import { extractObservations, PREFIXE_CATEGORIE, PREFIXE_MOMENT } from "./observations";
import type { TaskAnswer } from "./insight";

const rep = (category: string | null, scheduledHour: number, done: boolean): TaskAnswer =>
  ({ category, scheduledHour, done });

describe("extractObservations", () => {
  it("ne dit rien sous le seuil d'observations", () => {
    expect(extractObservations([rep("admin", 10, false)])).toEqual([]);
  });

  it("observe une categorie qui ne passe pas", () => {
    const answers = Array.from({ length: 6 }, () => rep("admin", 10, false));
    const obs = extractObservations(answers);
    expect(obs).toHaveLength(1);
    expect(obs[0].prefixe).toBe(PREFIXE_CATEGORIE("admin"));
    expect(obs[0].contenu.startsWith(PREFIXE_CATEGORIE("admin"))).toBe(true);
    expect(obs[0].appuis).toBe(6);
  });

  it("ne cite jamais une categorie inconnue", () => {
    const answers = Array.from({ length: 6 }, () => rep(null, 10, false));
    expect(extractObservations(answers)).toEqual([]);
  });

  it("observe DEUX categories distinctes, sans s'arreter a la premiere", () => {
    const answers = [
      ...Array.from({ length: 6 }, () => rep("admin", 10, false)),
      ...Array.from({ length: 6 }, () => rep("compta", 10, false)),
    ];
    const prefixes = extractObservations(answers).map((o) => o.prefixe).sort();
    expect(prefixes).toEqual([PREFIXE_CATEGORIE("admin"), PREFIXE_CATEGORIE("compta")].sort());
  });

  it("observe le moment ET la categorie ensemble — la premiere ne masque pas la seconde", () => {
    const answers = [
      ...Array.from({ length: 6 }, () => rep("admin", 10, false)), // categorie en echec, le matin
      ...Array.from({ length: 6 }, () => rep("autre", 10, true)),  // matin qui tient
      ...Array.from({ length: 6 }, () => rep("autre", 15, false)), // apres-midi qui decroche
    ];
    const prefixes = extractObservations(answers).map((o) => o.prefixe);
    expect(prefixes).toContain(PREFIXE_CATEGORIE("admin"));
    expect(prefixes).toContain(PREFIXE_MOMENT);
  });

  it("les DEUX formulations du moment partagent le meme prefixe", () => {
    const matinTient = [
      ...Array.from({ length: 6 }, () => rep("x", 10, true)),
      ...Array.from({ length: 6 }, () => rep("x", 15, false)),
    ];
    const apremTient = [
      ...Array.from({ length: 6 }, () => rep("x", 10, false)),
      ...Array.from({ length: 6 }, () => rep("x", 15, true)),
    ];
    const a = extractObservations(matinTient).find((o) => o.prefixe === PREFIXE_MOMENT);
    const b = extractObservations(apremTient).find((o) => o.prefixe === PREFIXE_MOMENT);
    expect(a, "le cas matin doit produire une observation de moment").toBeDefined();
    expect(b, "le cas apres-midi doit produire une observation de moment").toBeDefined();
    expect(a!.contenu).not.toBe(b!.contenu);          // deux formulations differentes
    expect(a!.prefixe).toBe(b!.prefixe);              // MEME identite
    expect(a!.contenu.startsWith(a!.prefixe)).toBe(true);
    expect(b!.contenu.startsWith(b!.prefixe)).toBe(true);
  });

  it("est pure : deux appels sur les memes donnees rendent la meme chose", () => {
    const answers = Array.from({ length: 6 }, () => rep("admin", 10, false));
    expect(extractObservations(answers)).toEqual(extractObservations(answers));
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec**

`npx vitest run server/services/result-capture/observations.test.ts`
Attendu : module introuvable. **Si un test passe déjà, arrête-toi et rapporte.**

- [ ] **Étape 3 : implémenter**

Lis `server/services/result-capture/insight.ts` et **reprends ses seuils** (`MIN_OBSERVATIONS`, le seuil bas d'achèvement, l'écart minimal matin/après-midi, l'heure de bascule). Ne les redéfinis pas : importe-les si c'est possible, sinon signale dans le commit qu'ils sont dupliqués et pourquoi.

Deux différences avec `buildImmediateInsight`, et ce sont les seules :
1. elle **n'interrompt pas** après la première trouvaille : elle collecte ;
2. son texte commence par le **préfixe du sujet**, pour que l'identité tienne.

- [ ] **Étape 4 : prouver la discriminance par mutation**

Applique cette mutation : fais que la boucle des catégories **s'arrête à la première** (ajoute un `break` après la première observation collectée). Lance les tests, **rapporte combien tombent**, puis restaure et vérifie le retour au vert. C'est le cœur de la tâche : si aucun test ne tombe, l'accumulation n'est pas testée.

- [ ] **Étape 5 : vérifier** — `TZ=UTC npx vitest run` et `TZ=Pacific/Kiritimati npx vitest run` verts, `npx tsc --noEmit -p tsconfig.json` silencieux.

- [ ] **Étape 6 : commit**

```bash
git add server/services/result-capture/observations.ts server/services/result-capture/observations.test.ts
git commit -m "feat(memoire): extraire toutes les observations, pas seulement la premiere"
```

---

### Task 2 : décider quoi écrire

**Fichiers :**
- Créer : `server/services/result-capture/observation-memory.ts`
- Test : `server/services/result-capture/observation-memory.test.ts`

**Interfaces :**
- Consomme : `Observation` (Task 1).
- Produit :

```ts
/** Nombre d'appuis au-delà duquel la salience est maximale. DÉFAUT RÉVISABLE. */
export const APPUIS_POUR_SALIENCE_MAX = 20;
/** Salience d'une observation tout juste au seuil. DÉFAUT RÉVISABLE. */
export const SALIENCE_MIN = 0.4;
/** Salience d'une observation largement étayée. DÉFAUT RÉVISABLE. */
export const SALIENCE_MAX = 0.9;

export interface MemoireVivante { id: number; contenu: string; prefixe: string }

export type DecisionMemoire =
  | { action: "rien" }
  | { action: "ecrire"; contenu: string; salience: number }
  | { action: "remplacer"; ancienId: number; contenu: string; salience: number };

export function decideMemoire(obs: Observation, vivantes: MemoireVivante[]): DecisionMemoire;
export function salienceDe(appuis: number): number;
```

- [ ] **Étape 1 : écrire les tests d'abord**

```ts
import { describe, it, expect } from "vitest";
import {
  decideMemoire, salienceDe,
  APPUIS_POUR_SALIENCE_MAX, SALIENCE_MIN, SALIENCE_MAX,
} from "./observation-memory";

const obs = (prefixe: string, contenu: string, appuis = 6) => ({ prefixe, contenu, appuis });

describe("decideMemoire", () => {
  it("ecrit quand l'identite est absente", () => {
    const d = decideMemoire(obs("P:", "P: quelque chose"), []);
    expect(d.action).toBe("ecrire");
  });

  it("ne fait rien quand l'identite est presente et le contenu identique", () => {
    const vivantes = [{ id: 7, prefixe: "P:", contenu: "P: quelque chose" }];
    expect(decideMemoire(obs("P:", "P: quelque chose"), vivantes)).toEqual({ action: "rien" });
  });

  it("remplace quand l'identite est presente et le contenu different", () => {
    const vivantes = [{ id: 7, prefixe: "P:", contenu: "P: ancienne" }];
    const d = decideMemoire(obs("P:", "P: nouvelle"), vivantes);
    expect(d).toMatchObject({ action: "remplacer", ancienId: 7 });
  });

  it("n'invalide QUE l'identite concernee — un autre sujet vit sa vie", () => {
    const vivantes = [
      { id: 1, prefixe: "A:", contenu: "A: ancienne" },
      { id: 2, prefixe: "B:", contenu: "B: intacte" },
    ];
    const d = decideMemoire(obs("A:", "A: nouvelle"), vivantes);
    expect(d).toMatchObject({ action: "remplacer", ancienId: 1 });
  });

  it("apparie par PREFIXE, jamais par contenu partiel", () => {
    // Une memoire dont le contenu contient le prefixe ailleurs qu'au debut
    // ne doit pas etre prise pour la meme identite.
    const vivantes = [{ id: 9, prefixe: "AUTRE:", contenu: "AUTRE: mentionne P: au milieu" }];
    expect(decideMemoire(obs("P:", "P: nouvelle"), vivantes).action).toBe("ecrire");
  });
});

describe("salienceDe", () => {
  it("rend la salience minimale au seuil", () => {
    expect(salienceDe(1)).toBeCloseTo(SALIENCE_MIN, 5);
  });

  it("rend la salience maximale quand l'observation est largement etayee", () => {
    expect(salienceDe(APPUIS_POUR_SALIENCE_MAX)).toBeCloseTo(SALIENCE_MAX, 5);
  });

  it("ne depasse jamais le maximum, meme tres au-dela", () => {
    expect(salienceDe(APPUIS_POUR_SALIENCE_MAX * 100)).toBeCloseTo(SALIENCE_MAX, 5);
  });

  it("croit avec le nombre d'appuis", () => {
    expect(salienceDe(10)).toBeGreaterThan(salienceDe(3));
  });

  it("reste bornee sur une entree absurde", () => {
    expect(salienceDe(0)).toBeGreaterThanOrEqual(SALIENCE_MIN);
    expect(salienceDe(-5)).toBeGreaterThanOrEqual(SALIENCE_MIN);
  });
});
```

- [ ] **Étape 2 : lancer et constater l'échec** — module introuvable.

- [ ] **Étape 3 : implémenter**

```ts
import type { Observation } from "./observations";

/** Nombre d'appuis au-delà duquel la salience est maximale. DÉFAUT RÉVISABLE. */
export const APPUIS_POUR_SALIENCE_MAX = 20;
/** Salience d'une observation tout juste au seuil. DÉFAUT RÉVISABLE. */
export const SALIENCE_MIN = 0.4;
/** Salience d'une observation largement étayée. DÉFAUT RÉVISABLE. */
export const SALIENCE_MAX = 0.9;

export interface MemoireVivante { id: number; contenu: string; prefixe: string }

export type DecisionMemoire =
  | { action: "rien" }
  | { action: "ecrire"; contenu: string; salience: number }
  | { action: "remplacer"; ancienId: number; contenu: string; salience: number };

/**
 * Salience croissante avec le nombre de réponses qui fondent l'observation.
 * Une observation au seuil minimal est vraie mais fragile ; une observation
 * adossée à vingt réponses mérite de peser plus dans le contexte de Naya.
 * PURE, et bornée des deux côtés.
 */
export function salienceDe(appuis: number): number {
  const n = Math.max(0, appuis);
  const t = Math.min(1, n / APPUIS_POUR_SALIENCE_MAX);
  return SALIENCE_MIN + t * (SALIENCE_MAX - SALIENCE_MIN);
}

/**
 * Que faire de cette observation, compte tenu de la mémoire vivante ?
 *
 * L'appariement se fait sur le PRÉFIXE, qui porte l'identité du sujet — jamais
 * sur le contenu, qui change quand l'observation change. Une nouvelle
 * observation n'invalide que celle de même identité : deux sujets différents
 * coexistent, c'est le sens même de l'accumulation.
 *
 * PURE : aucune base, aucune horloge.
 */
export function decideMemoire(obs: Observation, vivantes: MemoireVivante[]): DecisionMemoire {
  const salience = salienceDe(obs.appuis);
  const meme = vivantes.find((v) => v.prefixe === obs.prefixe);
  if (!meme) return { action: "ecrire", contenu: obs.contenu, salience };
  if (meme.contenu === obs.contenu) return { action: "rien" };
  return { action: "remplacer", ancienId: meme.id, contenu: obs.contenu, salience };
}
```

- [ ] **Étape 4 : prouver la discriminance par mutation**

Deux mutations, chacune exécutée puis restaurée, chiffres rapportés :
1. faire apparier par `contenu.includes(obs.prefixe)` au lieu de l'égalité de préfixe ;
2. supprimer le cas « contenu identique » pour toujours remplacer.

- [ ] **Étape 5 : vérifier** sous les deux fuseaux + `tsc`.

- [ ] **Étape 6 : commit**

```bash
git add server/services/result-capture/observation-memory.ts server/services/result-capture/observation-memory.test.ts
git commit -m "feat(memoire): decider ecrire, ne rien faire, ou remplacer"
```

---

### Task 3 : écrire dans la mémoire de Naya

**Fichiers :**
- Créer : `server/services/result-capture/observation-writer.ts`

**Interfaces :**
- Consomme : `extractObservations` (Task 1), `decideMemoire` (Task 2).
- Produit :

```ts
/** Dépendances injectables — permet de tester sans base ni service d'embedding. */
export interface ObservationDeps {
  lireVivantes(userId: string): Promise<Array<{ id: number; content: string }>>;
  embed(texte: string): Promise<number[] | null>;
  inserer(e: { userId: string; contenu: string; salience: number; embedding: number[] | null }): Promise<void>;
  remplacer(
    ancienId: number,
    e: { userId: string; contenu: string; salience: number; embedding: number[] | null },
  ): Promise<void>;
}

export async function rememberObservations(
  userId: string,
  answers: TaskAnswer[],
  deps?: Partial<ObservationDeps>,
): Promise<void>;
```

`deps` est **optionnel** : en production la fonction utilise ses dépendances réelles. C'est le même motif d'injection que `server/services/reception/recompute.ts` — suis-le.

**Lis d'abord `server/services/reception/recompute.ts`**, autour de `findActiveMemoryEntry` et `replaceMemoryEntry` : c'est le précédent exact de ce que tu écris — identification par préfixe, remplacement en transaction. **Suis ce motif**, ne l'invente pas.

Lis aussi `server/services/memory/embed.ts` (`embedText`, `toVectorLiteral`) et `server/services/memory/extract.ts` autour de la ligne 98 pour la forme d'une insertion dans `memoryEntries`.

- [ ] **Étape 1 : écrire l'enveloppe**

Le squelette, à compléter en suivant les fichiers ci-dessus :

```ts
/**
 * Écrit dans la mémoire de Naya ce qu'elle vient de comprendre du rythme de
 * l'utilisatrice, pour qu'une observation ne soit plus perdue quand la
 * notification n'est pas vue.
 *
 * Trois règles qui ne se négocient pas :
 *
 * 1. L'embedding est AU MIEUX. `embedText` peut rendre `null` ; l'observation
 *    est alors écrite SANS vecteur. Perdre une observation parce qu'un appel
 *    réseau a raté serait exactement le défaut que cette feature corrige. Un
 *    embedding absent veut dire « non vectorisé », jamais « vecteur nul » — et
 *    le scoring de `memory/retrieve.ts` est ADDITIF, donc l'observation reste
 *    retrouvable par son importance et sa fraîcheur.
 *
 * 2. Une observation périmée est INVALIDÉE (`supersededAt`), jamais supprimée.
 *
 * 3. Cette fonction ne doit JAMAIS faire échouer la réponse de l'utilisatrice.
 *    Elle a répondu ; c'est la donnée précieuse. La mémoire est un bénéfice,
 *    pas une condition. L'appelant l'invoque sans l'attendre et sans la laisser
 *    propager d'exception.
 */
export async function rememberObservations(userId: string, answers: TaskAnswer[]): Promise<void> {
  // 1. Extraire toutes les observations (pur).
  // 2. Lire les mémoires vivantes du fil "founder", entryType "observation",
  //    supersededAt IS NULL — en suivant `findActiveMemoryEntry`.
  // 3. Pour chacune, `decideMemoire` (pur), puis appliquer :
  //    - "rien"       → ne rien faire ;
  //    - "ecrire"     → insert ;
  //    - "remplacer"  → `replaceMemoryEntry` (transaction : supersede + insert).
  // 4. Chaque écriture est indépendante : l'échec de l'une n'empêche pas les autres.
}
```

⚠️ **Le `prefixe` n'est pas une colonne.** Pour construire les `MemoireVivante` attendues par `decideMemoire`, dérive le préfixe de chaque mémoire lue en la confrontant aux préfixes que `extractObservations` vient de produire — une mémoire vivante dont le contenu **commence par** l'un d'eux porte ce préfixe. Une mémoire qui ne correspond à aucun préfixe courant n'est pas concernée et **ne doit pas être invalidée**.

- [ ] **Étape 2 : écrire les trois tests que l'injection rend possibles**

La convention du dépôt est que les enveloppes base ne sont pas testées — mais l'injection de `deps` rend testables trois comportements qui sont des **critères d'acceptation**, et qu'aucune autre tâche ne couvre. Ceux-là ne sont pas décoratifs.

```ts
import { describe, it, expect, vi } from "vitest";
import { rememberObservations } from "./observation-writer";
import type { TaskAnswer } from "./insight";

const reponses: TaskAnswer[] = Array.from({ length: 6 }, () => ({
  category: "admin", scheduledHour: 10, done: false,
}));

function deps(over: Record<string, any> = {}) {
  return {
    lireVivantes: vi.fn().mockResolvedValue([]),
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    inserer: vi.fn().mockResolvedValue(undefined),
    remplacer: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("rememberObservations", () => {
  it("ecrit MEME quand l'embedding est indisponible", async () => {
    const d = deps({ embed: vi.fn().mockResolvedValue(null) });
    await rememberObservations("u1", reponses, d);
    expect(d.inserer).toHaveBeenCalledTimes(1);
    expect(d.inserer.mock.calls[0][0].embedding).toBeNull();
  });

  it("ecrit MEME quand le service d'embedding leve", async () => {
    const d = deps({ embed: vi.fn().mockRejectedValue(new Error("reseau")) });
    await rememberObservations("u1", reponses, d);
    expect(d.inserer).toHaveBeenCalledTimes(1);
    expect(d.inserer.mock.calls[0][0].embedding).toBeNull();
  });

  it("n'invalide JAMAIS une memoire qui ne correspond a aucun sujet courant", async () => {
    const d = deps({
      lireVivantes: vi.fn().mockResolvedValue([
        { id: 42, content: "Une memoire d'un tout autre sujet, sans rapport." },
      ]),
    });
    await rememberObservations("u1", reponses, d);
    expect(d.remplacer).not.toHaveBeenCalled();
    expect(d.inserer).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Étape 3 : prouver la discriminance par mutation**

Deux mutations, chacune exécutée puis restaurée, chiffres rapportés :
1. faire que l'échec de l'embedding empêche l'écriture (`if (!embedding) return;`) — les deux premiers tests doivent tomber ;
2. faire que toute mémoire vivante non appariée soit invalidée — le troisième doit tomber.

- [ ] **Étape 4 : vérifier** — `npx tsc --noEmit -p tsconfig.json` silencieux et `npx vitest run` vert sous les deux fuseaux.

- [ ] **Étape 5 : commit**

```bash
git add server/services/result-capture/observation-writer.ts server/services/result-capture/observation-writer.test.ts
git commit -m "feat(memoire): ecrire les observations dans la memoire de Naya"
```

---

### Task 4 : brancher après une réponse

**Fichiers :**
- Modifier : `server/routes.ts`, route `POST /api/task-prompts/:taskId/answer`

**Interfaces :**
- Consomme : `rememberObservations` (Task 3).

La route calcule déjà les réponses récentes pour produire le retour immédiat — **réutilise-les**, ne les relis pas une seconde fois.

- [ ] **Étape 1 : appeler sans jamais bloquer la réponse**

Après que la réponse de l'utilisatrice est enregistrée et **avant** de renvoyer la réponse HTTP :

```ts
// La mémoire est un bénéfice, pas une condition : si elle échoue, la réponse de
// l'utilisatrice reste enregistrée et la requête aboutit. On trace, on ne propage pas.
rememberObservations(userId, reponsesRecentes).catch((e) =>
  console.error("[Memoire] écriture des observations échouée", e?.message),
);
```

Ne l'attends pas avec `await` : l'écriture peut appeler un service d'embedding, et la réponse de l'utilisatrice ne doit pas dépendre de sa latence.

- [ ] **Étape 2 : vérifier que la réponse aboutit même si la mémoire échoue**

Écris un test d'intégration : `rememberObservations` rejette, et la route renvoie quand même 200 avec la réponse enregistrée. Puis **applique la mutation** — remplace l'appel par `await rememberObservations(...)` sans `catch` — et vérifie que le test devient rouge. **Rapporte le chiffre.**

- [ ] **Étape 3 : vérifier** — `tsc` silencieux, `npx vitest run` vert sous les deux fuseaux, `npm run build` réussi.

- [ ] **Étape 4 : commit**

```bash
git add server/routes.ts
git commit -m "feat(memoire): une reponse nourrit la memoire, sans jamais en dependre"
```

---

### Task 5 : vérification de bout en bout

- [ ] **Étape 1 : suite complète** — `npx tsc --noEmit -p tsconfig.json`, `TZ=UTC npx vitest run`, `TZ=Pacific/Kiritimati npx vitest run`, `npm run build`. Tout vert.

- [ ] **Étape 2 : `buildImmediateInsight` n'a pas été touchée**

```bash
git diff <base-du-lot>..HEAD -- server/services/result-capture/insight.ts
```
Attendu : **vide**.

- [ ] **Étape 3 : aucune migration n'a été créée**

```bash
git diff --stat <base-du-lot>..HEAD -- migrations/ shared/schema.ts
```
Attendu : **vide**. Si quelque chose apparaît, c'est que le préfixe a été abandonné en cours de route — arrête-toi et rapporte.

- [ ] **Étape 4 : les fonctions pures le sont restées**

```bash
grep -nE "Date\.now\(\)|new Date\(\)|Math\.random|db\." \
  server/services/result-capture/observations.ts \
  server/services/result-capture/observation-memory.ts || echo "pures — OK"
```

- [ ] **Étape 5 : rendre la main.** Ne pousse pas, ne merge pas.

---

## Notes pour l'implémenteur

Ce dépôt a corrigé **neuf défauts Critiques** en dix jours, tous du même motif : **confondre « je n'ai pas pu mesurer » avec « la mesure vaut zéro »**. Ici il prendrait cette forme : un embedding indisponible traité comme une raison de ne pas écrire, ou une mémoire qu'on n'a pas su apparier traitée comme une mémoire à invalider.

**En cas de doute, écris l'observation et n'invalide rien.** Une observation en trop se corrige ; une observation perdue ne revient pas.

Et une leçon de méthode, gagnée sept fois : **un test écrit après le code passe toujours.** Si tu affirmes qu'un test est discriminant, prouve-le en cassant le code exprès et rapporte le résultat.
