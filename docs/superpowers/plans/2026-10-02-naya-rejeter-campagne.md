# Rejeter une campagne générée — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Écarter une campagne générée depuis n'importe quel état, en disant éventuellement pourquoi, sans jamais détruire un contenu publié ni une tâche faite — et faire que la prochaine génération pour cette marque en tienne compte.

**Architecture :** deux services nouveaux. `campaign-reject/rejeter.ts` porte la règle du publié (pure) et l'orchestration transactionnelle ; `campaign-reject/preferences.ts` lit les préférences d'une marque dans `memoryEntries` et les formate pour le prompt. `generateCampaignStrategy` gagne un champ dédié, sur le motif de `articulation`. Côté client, le geste devient disponible depuis tout état, avec une confirmation qui annonce ce qu'elle va emporter.

**Tech Stack :** Express, Drizzle ORM (PostgreSQL/Neon), React + react-query v5, shadcn/ui, vitest.

**Spec :** `docs/superpowers/specs/2026-10-02-naya-rejeter-campagne-design.md`

## Global Constraints

- **AUCUN test n'exécute de requête réelle.** `DATABASE_URL` pointe sur une base Neon réelle (endpoint de développement `ep-jolly-sky-an1x7ddn`). `../../db` est moqué dans tout test qui touche un module le consommant. Motif de référence : en-tête de `server/services/brand-links/collision.test.ts`.
- **`npx vitest run` sur la suite complète prend jusqu'à 600 s sur cette machine et produit de FAUX échecs** (workers qui ne démarrent pas, comptés comme erreurs). Pendant le travail : tests ciblés uniquement. Pour une validation globale : `npx vitest run --no-file-parallelism`.
- **Aucune migration.** Ce chantier n'ajoute aucune colonne. `drizzle-kit push` est formellement interdit.
- **Aucun push.** `git push` déploie en production.
- **Français partout** : noms des nouveaux symboles, commentaires, messages d'interface, messages de commit.
- **`npx tsc --noEmit` à 0.** Le dépôt y est, il y reste.
- **Aucun compteur, aucune série, aucun rappel.**
- `throwOnError: false` sur toute requête react-query ajoutée, `onError` sur toute mutation — le `throwOnError` global de `client/src/lib/queryClient.ts` blanchit l'application sinon.
- **`SALIENCE_REJET = 0.8`** (défaut de la colonne : 0.5). Un rejet que l'utilisatrice a formulé explicitement est un signal plus fort qu'une observation déduite.
- **`PLAFOND_PREFERENCES = 8`** préférences envoyées au prompt.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/services/campaign-reject/rejeter.ts` (créer) | Règle du publié et tri gardés/partants (**purs**) ; construction du texte de la préférence (**pure**) ; orchestration transactionnelle. |
| `server/services/campaign-reject/rejeter.test.ts` (créer) | Purs sans mock ; orchestration avec `../../db` moqué. |
| `server/services/campaign-reject/preferences.ts` (créer) | Requête des préférences d'une marque ; `formaterPreferences` (**pure**). |
| `server/services/campaign-reject/preferences.test.ts` (créer) | `../../db` moqué. |
| `server/services/openai.ts` (modifier) | `CampaignGenerationRequest` gagne `preferences` ; les deux prompts de campagne l'injectent. |
| `server/routes.ts` (modifier) | `POST /api/campaigns/:id/reject`, `GET /api/campaigns/:id/reject-preview`, et le passage des préférences à la génération. |
| `client/src/pages/campaigns.tsx` (modifier) | Geste disponible depuis tout état + confirmation. |
| `client/src/pages/campaigns-rejet.ts` (créer) | Le texte de la confirmation (**pur**, testable sans jsdom — pas de jsdom dans ce dépôt). |

---

### Task 1 : la règle du publié, le tri, et le texte de la préférence

**Files:**
- Create: `server/services/campaign-reject/rejeter.ts`
- Test: `server/services/campaign-reject/rejeter.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit : `ContenuCandidat`, `TacheCandidate`, `Tri`, `contenuEstPublie`, `tacheEstFaite`, `trierContenus`, `trierTaches`, `construirePreference`, `SALIENCE_REJET`.

**Le point à ne pas inverser :** on **garde** dès qu'un seul signal de publication est allumé. Le coût de garder quelque chose en trop est de l'encombrement ; le coût de supprimer quelque chose de publié est de falsifier l'historique de l'utilisatrice. Le sens prudent est le bon, et il est assumé dans le spec.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
import { describe, it, expect } from "vitest";
import {
  contenuEstPublie, tacheEstFaite, trierContenus, trierTaches,
  construirePreference, SALIENCE_REJET,
} from "./rejeter";

const nu = { id: 1, publishedAt: null, postStatus: null, contentStatus: null };

describe("contenuEstPublie — on garde dès qu'UN signal est allumé", () => {
  it("rend faux quand aucun signal n'est allumé", () => {
    expect(contenuEstPublie(nu)).toBe(false);
  });

  it("rend vrai sur publishedAt seul", () => {
    expect(contenuEstPublie({ ...nu, publishedAt: new Date("2026-09-01") })).toBe(true);
  });

  it("rend vrai sur postStatus = posted seul", () => {
    expect(contenuEstPublie({ ...nu, postStatus: "posted" })).toBe(true);
  });

  it("rend vrai sur contentStatus = published seul", () => {
    expect(contenuEstPublie({ ...nu, contentStatus: "published" })).toBe(true);
  });

  it("ne confond pas les états intermédiaires de postStatus avec une publication", () => {
    for (const s of ["pending", "uploading", "processing", "posting", "failed"]) {
      expect(contenuEstPublie({ ...nu, postStatus: s })).toBe(false);
    }
  });

  it("ne confond pas les étapes amont de contentStatus avec une publication", () => {
    for (const s of ["idea", "draft", "ready"]) {
      expect(contenuEstPublie({ ...nu, contentStatus: s })).toBe(false);
    }
  });
});

describe("tacheEstFaite", () => {
  it("suit completed", () => {
    expect(tacheEstFaite({ id: 1, completed: true })).toBe(true);
    expect(tacheEstFaite({ id: 1, completed: false })).toBe(false);
  });
});

describe("trierContenus", () => {
  it("sépare les gardés des partants", () => {
    const tri = trierContenus([
      { id: 10, publishedAt: new Date("2026-09-01"), postStatus: null, contentStatus: null },
      { id: 11, publishedAt: null, postStatus: "posted", contentStatus: null },
      { id: 12, publishedAt: null, postStatus: null, contentStatus: "published" },
      { id: 13, publishedAt: null, postStatus: "pending", contentStatus: "draft" },
      { id: 14, publishedAt: null, postStatus: null, contentStatus: "idea" },
    ]);
    expect(tri.gardes).toEqual([10, 11, 12]);
    expect(tri.partants).toEqual([13, 14]);
  });

  it("rend deux listes vides sur une entrée vide, sans jeter", () => {
    expect(trierContenus([])).toEqual({ gardes: [], partants: [] });
  });
});

describe("trierTaches", () => {
  it("sépare les faites des non faites", () => {
    const tri = trierTaches([
      { id: 20, completed: true },
      { id: 21, completed: false },
      { id: 22, completed: true },
    ]);
    expect(tri.gardes).toEqual([20, 22]);
    expect(tri.partants).toEqual([21]);
  });
});

describe("construirePreference", () => {
  const campagne = { name: "De Stratège à Scène", objective: "asseoir l'autorité", coreMessage: "la stratège monte sur scène" };

  it("rend une phrase qui se tient SEULE, sans son contexte d'origine", () => {
    // Une entrée de mémoire est relue des mois plus tard, mêlée à d'autres, hors de
    // tout contexte. « Je ne veux pas ça » y serait illisible.
    const p = construirePreference({ campagne, raison: "trop centré sur moi, pas assez sur les clientes" });
    expect(p).toContain("De Stratège à Scène");
    expect(p).toContain("trop centré sur moi, pas assez sur les clientes");
    expect(p.length).toBeGreaterThan(40);
  });

  it("inclut l'objectif et le message central, qui sont ce que Naya doit éviter", () => {
    const p = construirePreference({ campagne, raison: "non" });
    expect(p).toContain("asseoir l'autorité");
    expect(p).toContain("la stratège monte sur scène");
  });

  it("rend null sur une raison vide ou blanche — pas de préférence sans raison", () => {
    expect(construirePreference({ campagne, raison: "" })).toBeNull();
    expect(construirePreference({ campagne, raison: "   " })).toBeNull();
  });

  it("supporte une campagne aux champs manquants sans produire « undefined »", () => {
    const p = construirePreference({ campagne: { name: "", objective: "", coreMessage: null }, raison: "pas ça" });
    expect(p).not.toBeNull();
    expect(p!).not.toContain("undefined");
    expect(p!).not.toContain("null");
  });
});

describe("la salience d'un rejet", () => {
  it("vaut 0,8 — plus qu'une observation déduite (défaut 0,5)", () => {
    expect(SALIENCE_REJET).toBe(0.8);
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run server/services/campaign-reject/rejeter.test.ts`
Attendu : ÉCHEC — `Cannot find module './rejeter'`.

- [ ] **Step 3 : écrire la partie pure de `rejeter.ts`**

```ts
// Rejet d'une campagne générée.
//
// Cette partie du fichier est PURE : aucun accès base, aucun appel modèle. Ce qui
// DÉCIDE quoi garder est ici et se teste sans infrastructure ; l'orchestration est en
// bas et ne décide rien.

/** Salience d'un rejet. Le défaut de la colonne est 0,5 ; un rejet explicitement
 *  formulé par l'utilisatrice est un signal plus fort qu'une observation déduite. */
export const SALIENCE_REJET = 0.8;

export interface ContenuCandidat {
  id: number;
  publishedAt: Date | null;
  postStatus: string | null;
  contentStatus: string | null;
}

export interface TacheCandidate {
  id: number;
  completed: boolean;
}

export interface Tri {
  /** Identifiants à DÉTACHER (campaignId → null) : ils survivent au rejet. */
  gardes: number[];
  /** Identifiants à supprimer avec la campagne. */
  partants: number[];
}

/**
 * Un contenu est considéré comme publié dès qu'UN SEUL signal est allumé.
 *
 * `content` porte quatre champs qui peuvent se contredire : une carte glissée en
 * « publié » dans le pipeline n'est pas forcément partie sur une plateforme, et un post
 * auto-publié n'a pas forcément vu son `contentStatus` suivre. On ne cherche pas à
 * arbitrer entre eux : on garde dès que l'un dit « publié ».
 *
 * Le sens prudent est le bon, et il est assumé : garder quelque chose en trop coûte de
 * l'encombrement ; supprimer quelque chose de publié falsifie l'historique de
 * l'utilisatrice.
 */
export function contenuEstPublie(c: ContenuCandidat): boolean {
  if (c.publishedAt !== null && c.publishedAt !== undefined) return true;
  if (c.postStatus === "posted") return true;
  if (c.contentStatus === "published") return true;
  return false;
}

export function tacheEstFaite(t: TacheCandidate): boolean {
  return t.completed === true;
}

export function trierContenus(cs: ContenuCandidat[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const c of cs) (contenuEstPublie(c) ? gardes : partants).push(c.id);
  return { gardes, partants };
}

export function trierTaches(ts: TacheCandidate[]): Tri {
  const gardes: number[] = [];
  const partants: number[] = [];
  for (const t of ts) (tacheEstFaite(t) ? gardes : partants).push(t.id);
  return { gardes, partants };
}

/**
 * Le texte de la préférence déposée en mémoire.
 *
 * Elle doit se tenir SEULE : une entrée de mémoire est relue des mois plus tard, mêlée
 * à d'autres, hors de tout contexte. « Je ne veux pas ça » y serait illisible — d'où le
 * rappel de ce qui a été rejeté, et pas seulement de la raison.
 *
 * Rend `null` quand la raison est vide : pas de préférence sans raison (Décision 4 du
 * spec). C'est l'appelant qui en informe l'utilisatrice.
 */
export function construirePreference(input: {
  campagne: { name: string | null; objective: string | null; coreMessage: string | null };
  raison: string;
}): string | null {
  const raison = (input.raison || "").trim();
  if (!raison) return null;

  const { name, objective, coreMessage } = input.campagne;
  const nom = (name || "").trim();
  const lignes: string[] = [
    nom
      ? `Campagne rejetée pour cette marque : « ${nom} ».`
      : "Une campagne générée pour cette marque a été rejetée.",
  ];
  const obj = (objective || "").trim();
  if (obj) lignes.push(`Son objectif était : ${obj}.`);
  const msg = (coreMessage || "").trim();
  if (msg) lignes.push(`Son message central était : ${msg}.`);
  lignes.push(`Ce qui n'allait pas, dans les mots de l'utilisatrice : ${raison}`);
  return lignes.join(" ");
}
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run server/services/campaign-reject/rejeter.test.ts`

- [ ] **Step 5 : vérifier par mutation**

Retirer la ligne `if (c.contentStatus === "published") return true;` et relancer. Attendu : les tests « rend vrai sur contentStatus = published seul » et « sépare les gardés des partants » tombent, et eux seuls. Remettre la ligne, relancer, puis `git diff` doit être vide avant le commit.

- [ ] **Step 6 : commit**

```bash
git add server/services/campaign-reject/
git commit -m "feat(rejet): règle du publié, tri des contenus et des tâches, texte de la préférence"
```

---

### Task 2 : l'orchestration transactionnelle du rejet

**Files:**
- Modify: `server/services/campaign-reject/rejeter.ts` (ajouter l'orchestration sous la partie pure)
- Modify: `server/services/campaign-reject/rejeter.test.ts`

**Interfaces:**
- Consomme : tout l'export pur de la tâche 1 ; `db` de `../../db` ; `content`, `tasks`, `campaigns`, `memoryEntries` de `@shared/schema` ; `embedText` de `../memory/embed`.
- Produit :

```ts
export interface ResultatRejet {
  contenusDetaches: number;
  contenusSupprimes: number;
  tachesDetachees: number;
  tachesSupprimees: number;
  preferenceEcrite: boolean;
  /** La préférence est écrite mais NON vectorisée : invisible à la récupération
   *  sémantique, et rien ne la rattrapera. Voir Décision 7 du spec. */
  preferenceSansEmbedding: boolean;
  articulationsRompues: Array<{ campagneId: number; campagneNom: string; marque: string }>;
}
export async function rejeterCampagne(input: {
  userId: string; campaignId: number; raison: string;
}): Promise<ResultatRejet>
```

**Trois décisions à ne pas improviser :**

1. **L'ORDRE dans une seule `db.transaction`** : détacher les gardés (`campaignId` → `null`) → supprimer les partants → écrire la préférence → supprimer la campagne. Dans cet ordre, aucune contrainte de clé étrangère ne peut mordre à la dernière étape. Si quoi que ce soit échoue, **rien** ne s'est passé.

2. **L'embedding est calculé AVANT d'ouvrir la transaction.** Tenir une transaction ouverte pendant un appel réseau est une faute. `embedText` rend `number[] | null` — un échec ne fait pas échouer le rejet, il met `preferenceSansEmbedding` à vrai.

3. **Les articulations rompues sont RELEVÉES avant la suppression**, par un `select` sur `WHERE articule_avec_campaign_id = <id>`, pour pouvoir les rendre. La contrainte est en `SET NULL` : rien ne casse, mais l'information disparaît si on ne la lit pas d'abord.

**Motif d'écriture de la mémoire à suivre :** `server/services/result-capture/observation-writer.ts` → `valeursObservation`. La forme est `{ userId, projectId, fil, entryType, content, embedding, salience }`. Ici : `fil: "cap"`, `entryType: "préférence"`, `projectId` = celui de la campagne.

- [ ] **Step 1 : écrire les tests qui échouent**

Reprendre l'en-tête de mock de `server/services/content-import/import.test.ts` (chaîne thenable + `db.transaction` moqué, qui existe déjà depuis le chantier précédent) et de `collision.test.ts` pour l'inspection du SQL via `PgDialect`. Cas à couvrir, chacun affirmant précisément :

1. Une campagne sans contenu ni tâche est supprimée ; aucun détachement, aucune suppression de contenu.
2. Un contenu publié (par chacun des **trois** signaux, testés séparément) est **détaché** et non supprimé — vérifier la clause `SET` rendue et les identifiants visés.
3. Un contenu non publié est supprimé.
4. Une tâche faite est détachée ; une tâche non faite est supprimée.
5. Avec une raison, une entrée est insérée dans `memoryEntries` avec `fil: "cap"`, `entryType: "préférence"`, le bon `projectId` et `salience: SALIENCE_REJET`.
6. **Sans raison, AUCUNE insertion dans `memoryEntries`** — et `preferenceEcrite` vaut faux. C'est le cœur de la Décision 4.
7. `embedText` qui rend `null` → la préférence est **quand même** insérée, `preferenceSansEmbedding` vaut vrai, et le rejet réussit.
8. `embedText` qui **lève** → même comportement que `null` (best-effort), le rejet réussit.
9. Tout passe par **une seule** `db.transaction` ; le mock doit le constater.
10. Un échec en cours de transaction ne laisse rien : vérifier qu'aucune opération n'est validée.
11. Les articulations pointant vers la campagne sont relevées **avant** la suppression et rendues dans le résultat.
12. L'ordre des opérations est bien détachement → suppression → préférence → campagne (le mock capture l'ordre).
13. Une campagne qui n'appartient pas à l'utilisatrice n'est jamais touchée : la clause porte sur `userId` ET `id`.

- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : écrire l'orchestration**
- [ ] **Step 4 : lancer, vérifier le vert**
- [ ] **Step 5 : commit**

```bash
git commit -m "feat(rejet): orchestration transactionnelle — détacher, supprimer, mémoriser, rejeter"
```

---

### Task 3 : les préférences atteignent la génération de campagne

**Files:**
- Create: `server/services/campaign-reject/preferences.ts`
- Test: `server/services/campaign-reject/preferences.test.ts`
- Modify: `server/services/openai.ts`

**Interfaces:**
- Produit :

```ts
export const PLAFOND_PREFERENCES = 8;
export interface Preference { id: number; content: string; salience: number | null; createdAt: Date | null }
export async function preferencesDeLaMarque(userId: string, projectId: number): Promise<Preference[]>
export function formaterPreferences(ps: Preference[]): string   // PURE
```

**La requête :** `memoryEntries` où `userId`, `projectId`, `fil = "cap"`, `entryType = "préférence"`, `supersededAt IS NULL`. Ordonnée par `salience` décroissante puis `createdAt` décroissante. `LIMIT PLAFOND_PREFERENCES`.

**Le tri est load-bearing :** sans `ORDER BY` explicite, quelles préférences atteignent le prompt dépendrait de l'ordre physique de Postgres, et deux générations identiques ne recevraient pas les mêmes. Le second critère (`createdAt`) rend le départage déterministe à salience égale.

**Le formatage** suit `formaterArticulation` de `server/services/brand-links/links.ts` : un en-tête en majuscules, des lignes nommées, **aucun étalement ni `JSON.stringify`** — des accès nommés seulement. C'est ce qui rend impossible la fuite d'un champ qu'on n'a pas voulu envoyer.

**Le branchement :** `CampaignGenerationRequest` (`server/services/openai.ts`, ligne 1088 — vérifié) gagne `preferences?: Preference[]` — un **objet**, pas une chaîne déjà formatée, pour être **symétrique de `articulation?: Articulation`** son voisin immédiat (openai.ts:1110). Le formatage se fait au site du prompt par `formaterPreferences`, exactement comme `formaterArticulation` y est appelée. Passer une chaîne pré-formatée marcherait, mais rendrait `openai.ts` dépendant du fait que l'appelant ait pensé à formater — et une chaîne quelconque y passerait sans que le typage bronche. Reprends aussi le style de commentaire du champ voisin, qui dit ce que le champ ne contient PAS. **Deux** prompts l'injectent — ceux de `generateCampaignStrategy` et `generateCampaignContent`, pas celui de `generateCampaignTasks` (voir le tableau de la tâche 4) — sur le motif **exact** de `articulation`, déjà présent : `${request.articulation ? `\n${formaterArticulation(request.articulation)}\n` : ''}`.

**Attention au piège de la ligne vide :** ce motif laisse un saut de ligne même quand le champ est absent — défaut mineur relevé et déféré au chantier précédent. Ne l'aggrave pas : si tu peux l'éviter proprement pour ton champ, fais-le, sinon suis le motif existant et dis-le dans ton rapport.

**Cas à couvrir :**
1. La requête porte bien sur `fil = "cap"`, `entryType = "préférence"` et `supersededAt IS NULL` — vérifier la clause rendue par `PgDialect`, pas seulement le résultat.
2. Le tri et le plafond sont rendus au constructeur de requête.
3. Les préférences d'une **autre** marque n'entrent jamais — vérifier la clause sur `projectId`.
4. `formaterPreferences([])` rend une chaîne vide, et l'appelant n'injecte alors rien.
5. Le formatage n'expose que `content` — aucun identifiant, aucune salience, aucune date dans la sortie.
6. Au-delà du plafond, le journal annonce le **compte réel** écarté.
7. Un test de régression : le prompt de `generateCampaignStrategy` contient les préférences quand elles existent, et est **inchangé** quand il n'y en a pas.

- [ ] **Steps :** tests → échec → implémentation → vert → commit

```bash
git commit -m "feat(rejet): les préférences d'une marque atteignent la génération de campagne"
```

---

### Task 4 : les deux endpoints

**Files:**
- Modify: `server/routes.ts` — ajouter près de `DELETE /api/campaigns/:id` (ligne 9924), et passer les préférences dans les trois appels à la génération de stratégie.
- Test: `server/routes.campaign-reject.test.ts` (créer)

**Contrat :**

```
GET /api/campaigns/:id/reject-preview
200 → { contenusGardes, contenusPartants, tachesGardees, tachesPartantes,
         articulationsRompues: [{campagneId, campagneNom, marque}] }
404   campagne inexistante ou non possédée  ← jamais 403

POST /api/campaigns/:id/reject       corps : { raison?: string }
200 → ResultatRejet
404   campagne inexistante ou non possédée
```

**Trois exigences :**
1. **La propriété est validée par `storage.getCampaign(id, userId)`**, qui filtre sur les deux. 404 et jamais 403 — motif du dépôt, ne pas révéler l'existence. Un test le verrouille.
2. **L'aperçu ne modifie rien.** Un test doit constater qu'aucune écriture n'est émise.
3. **Les préférences atteignent les fonctions qui décident de l'ANGLE.** Relevé vérifié par énumération — ne te fie pas à un souvenir, c'est l'erreur qu'a faite le spec du chantier précédent :

| Fonction | Appelée depuis | Injecte déjà `articulation` ? | Préférences ? |
|---|---|---|---|
| `generateCampaignStrategy` (openai.ts:1198) | `routes.ts:10024`, **une seule fois** | oui, 1 fois | **oui** |
| `generateCampaignContent` (openai.ts:1266) | `routes.ts:10052`, une seule fois | oui, 1 fois | **oui** |
| `generateCampaignTasks` (openai.ts:1318) | `routes.ts:10083`, une seule fois | **non** | **non** |

Les deux premières décident de l'angle et du message ; les préférences y vont, exactement là où `articulation` va déjà. `generateCampaignTasks` produit l'exécution opérationnelle et ne reçoit pas l'articulation non plus — ne l'y ajoute pas, ce serait élargir le chantier sans raison. **Si ton propre relevé contredit ce tableau, dis-le au lieu de le suivre.**

- [ ] **Steps :** tests → échec → implémentation → vert → commit

---

### Task 5 : le geste et sa confirmation

**Files:**
- Create: `client/src/pages/campaigns-rejet.ts` + son test
- Modify: `client/src/pages/campaigns.tsx`

**Pas de jsdom dans ce dépôt** (confirmé deux fois). Le texte de la confirmation vit donc dans un module `.ts` pur, testé en isolation — motif de `client/src/components/content/import-calendrier-recu.ts` et `content-calendar-limit.ts`.

**Produit :** `construireTexteConfirmation(apercu)` → `string[]`, une ligne par fait, **aucune ligne à zéro**.

```
Cette campagne a 12 posts et 8 tâches.
3 posts publiés et 5 tâches faites seront conservés, détachés de la campagne.
9 posts et 3 tâches seront supprimés.
La campagne « Make Brands Unmistakable » sur Agence JMD est articulée avec celle-ci — en la rejetant, cette articulation disparaît.
```

Et sous le champ de raison, quand il est vide : « sans raison, Naya ne pourra pas l'éviter la prochaine fois. »

**Exigences :**
- Le geste est disponible depuis **tout état** de la campagne, pas seulement l'aperçu.
- `onError` sur la mutation, `throwOnError: false` sur la requête d'aperçu.
- Un échec **définitif** (404) affiche le message du serveur, jamais « réessaie » — motif corrigé dans `BrandLinksPanel.tsx`.
- Aucun point d'exclamation, aucune injonction, aucun compteur.
- Invalider `['/api/campaigns']` et `['/api/content']` au succès.

- [ ] **Steps :** tests du module pur → échec → implémentation → câblage → `npx vitest run client/src/` → `npx tsc --noEmit` → commit

---

## Auto-revue du plan

**Couverture du spec.** Les 16 critères : 1 → T2+T4 ; 2 → T2 (l'ordre des opérations) ; 3, 4 → T1+T2 ; 5 → T1+T2 ; 6 → T1+T2 ; 7 → T2 ; 8 → T2+T5 ; 9 → T3 ; 10 → T3 ; 11 → T3 ; 12 → T3 ; 13 → T2+T4+T5 ; 14 → T2 ; 15 → T2 ; 16 → Global Constraints et chaque tâche.

**Décisions du spec.** 1 → T2 ; 2 → T3 ; 3 → T1+T2 ; 4 → T1+T2+T5 ; 5 → T2+T4+T5 ; 6 → T2 ; 7 → T2 (le champ `preferenceSansEmbedding`).

**Conflits entre tâches.** T1 et T2 écrivent le même fichier, dans cet ordre, à des endroits disjoints (pur en haut, orchestration en bas) — T2 ne doit modifier aucune fonction pure de T1, et la revue le vérifiera par `git diff`. T3 et T4 touchent tous deux `server/routes.ts` : T3 n'y touche pas du tout en réalité (elle modifie `openai.ts`), donc pas de conflit. T4 et T5 sont sur des fichiers disjoints. Ordre d'exécution : 1 → 2 → 3 → 4 → 5.

**Dépendance d'interface.** T2 consomme les purs de T1 ; T4 consomme `rejeterCampagne` de T2 et `preferencesDeLaMarque` de T3 ; T5 consomme le contrat des endpoints de T4.

**Un écart au standard de rédaction, assumé.** Les tâches 2 à 5 donnent leurs cas de test en liste nommée plutôt qu'en code exécutable. Motif : l'échafaudage existe déjà et est documenté en en-tête de `collision.test.ts` et `import.test.ts` (chaîne thenable, `db.transaction` moqué, rendu SQL par `PgDialect`), que chaque tâche désigne explicitement ; le prescrire à l'aveugle produirait du code à réécrire. Chaque cas nomme précisément ce qu'il doit affirmer, et la revue de tâche vérifie que les tests écrits échouent quand on annule ce qu'ils protègent. La tâche 1, qui n'a aucun échafaudage, donne son code de test en entier.
