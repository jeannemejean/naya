/**
 * Écrit dans la mémoire de Naya ce qu'elle vient de comprendre du rythme de
 * l'utilisatrice, pour qu'une observation ne soit plus perdue quand la
 * notification n'est pas vue.
 *
 * Règles qui ne se négocient pas :
 *
 * 1. L'embedding est AU MIEUX. `embedText` peut rendre `null`, et peut aussi
 *    LEVER. Dans les deux cas l'observation est écrite SANS vecteur. Perdre une
 *    observation parce qu'un appel réseau a raté serait exactement le défaut
 *    que cette feature corrige. Un embedding absent veut dire « non vectorisé »,
 *    jamais « vecteur nul ».
 *
 *    ⚠️ CORRECTIF DU 2026-09-16 (revue finale, Important 2) : ce commentaire
 *    promettait auparavant qu'une observation sans embedding « reste retrouvable »
 *    grâce au scoring ADDITIF de `memory/retrieve.ts`. C'est FAUX sur le chemin IA
 *    principal. Le scoring additif ne s'applique QU'AUX candidats déjà sélectionnés
 *    par la requête SQL — `ORDER BY m.embedding <=> vec ASC LIMIT 20` dès qu'un
 *    focus est fourni, et `claude.ts:52` en fournit TOUJOURS un (le message de
 *    l'utilisatrice). Postgres trie les `embedding IS NULL` en DERNIER sur un
 *    `ORDER BY ... ASC`. Dès que l'utilisatrice a plus de 20 mémoires "founder"
 *    vivantes AVEC embedding, une observation SANS embedding ne rentre jamais dans
 *    les 20 candidats pré-scoring — donc jamais scorée, jamais injectée, quelle que
 *    soit son importance ou sa fraîcheur. Ce module ne peut pas corriger cela seul :
 *    le correctif appartient à `memory/retrieve.ts`, hors périmètre de ce lot
 *    (fichier partagé avec un autre fil — voir le rapport de la revue finale pour
 *    une piste : réessayer l'embedding plusieurs fois avant d'abandonner, ou une
 *    clause SQL qui complète les 20 candidats par un second tri sur `created_at`
 *    quand `embedding IS NULL`).
 *
 * 2. Une observation périmée est INVALIDÉE (`supersededAt`), jamais supprimée —
 *    que ce soit parce qu'une observation de même identité la remplace, ou parce
 *    que son motif a cessé d'exister (voir SEUIL_PEREMPTION, observation-memory.ts).
 *
 * 3. Cette fonction ne doit JAMAIS faire échouer la réponse de l'utilisatrice.
 *    Elle a répondu ; c'est la donnée précieuse. La mémoire est un bénéfice,
 *    pas une condition. L'appelant peut l'invoquer sans l'attendre : elle ne
 *    laisse jamais une exception se propager.
 *
 * ⚠️ Le `prefixe` de `MemoireVivante` n'est PAS une colonne de `memory_entries`
 * (délibérément, pour ne pas ajouter de migration). On le reconstruit depuis le
 * contenu de CHAQUE mémoire vivante lue, via `prefixeDeContenu` (./observations.ts)
 * — pas seulement les préfixes des observations qu'on vient d'extraire pour CET
 * appel (correctif du Critique, revue finale du 2026-09-16 : une catégorie qui a
 * cessé d'apparaître dans la fenêtre actuelle doit rester visible ici, sinon elle ne
 * peut jamais être confrontée à son absence — et une observation dont le motif a
 * disparu ne serait donc JAMAIS périmée). C'est le même motif d'appariement par
 * préfixe que `findActiveMemoryEntry` dans `server/services/reception/recompute.ts`
 * — suivi ici, pas réinventé.
 *
 * ── Le compteur d'absence (Critique, point 4 : où le stocker sans migration) ──────
 * Aucune colonne compteur n'existe sur `memory_entries`. Trois options considérées :
 *   (a) l'encoder dans le `content` de l'observation elle-même : REJETÉ — ce contenu
 *       est injecté VERBATIM dans chaque appel IA (`buildNayaContext`) ET est
 *       destiné à être un jour affiché tel quel dans un journal de consultation
 *       (spec §"Ce qu'on ne construit pas" — "le journal viendra dans un lot séparé
 *       ... il lira ce que celui-ci écrit"). Tout marqueur technique y polluerait le
 *       prompt de Naya ET une future UI.
 *   (b) une entrée de mémoire DÉDIÉE, sous le fil `founder` : REJETÉ aussi — la
 *       requête de `memory/retrieve.ts` filtre par `fil` mais PAS par `entryType`
 *       (`WHERE m.user_id = ... AND m.fil = ... AND m.superseded_at IS NULL`), donc
 *       une ligne "founder" de bookkeeping serait candidate à l'injection au même
 *       titre qu'une vraie observation, et compétirait pour les 4 places de
 *       TOP_K.founder.
 *   (c) une entrée dédiée sous un `fil` INTERNE (`FIL_COMPTEURS` ci-dessous),
 *       distinct de "cap" | "founder" | "reception" — RETENU. `retrieveMemories`
 *       n'interroge STRUCTURELLEMENT que ces trois fils (voir `memory/retrieve.ts`,
 *       `TOP_K`/`HALF_LIFE_DAYS` sont indexés dessus) : un `fil` en dehors de cet
 *       ensemble est invisible à l'injection IA et à TOP_K, pas par une garde
 *       conditionnelle qui pourrait un jour être oubliée, mais par construction —
 *       exactement le niveau de garantie déjà retenu ailleurs dans ce lot pour
 *       l'appariement par préfixe (voir revue de la tâche 3 : "plus fort qu'une
 *       garde conditionnelle"). Aucune migration : `fil` et `entryType` sont du
 *       texte libre, pas des enums en base.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { db, type DbExecutor } from "../../db";
import { embedText } from "../memory/embed";
import { extractObservations, prefixeDeContenu } from "./observations";
import { decideMemoire, decideAbsence, type MemoireVivante } from "./observation-memory";
import type { TaskAnswer } from "./insight";

/** Fil et type d'entrée où vivent déjà les observations de Naya en production. */
const FIL = "founder";
const ENTRY_TYPE = "observation";

/**
 * Fil et type réservés au compteur d'absence — jamais lus par `memory/retrieve.ts`,
 * jamais injectés dans un appel IA. Ce ne sont pas des observations, c'est une
 * table de bord technique. Voir l'en-tête du fichier.
 */
const FIL_COMPTEURS = "founder:absences";
const ENTRY_TYPE_COMPTEUR = "observation-absence-counter";

/** Dépendances injectables — permet de tester sans base ni service d'embedding. */
export interface ObservationDeps {
  lireVivantes(userId: string): Promise<Array<{ id: number; content: string }>>;
  /** Compteurs d'absence vivants de l'utilisateur, un par sujet (préfixe). */
  lireCompteurs(userId: string): Promise<Array<{ prefixe: string; count: number }>>;
  embed(texte: string): Promise<number[] | null>;
  inserer(e: { userId: string; contenu: string; salience: number; embedding: number[] | null }): Promise<void>;
  remplacer(
    ancienId: number,
    e: { userId: string; contenu: string; salience: number; embedding: number[] | null },
  ): Promise<void>;
  /** Invalide SANS remplacer — le motif d'une observation vivante a cessé d'exister. */
  expirer(id: number): Promise<void>;
  /** `count = null` efface le compteur (motif reproduit ce cycle) ; sinon le fixe. */
  majCompteur(userId: string, prefixe: string, count: number | null): Promise<void>;
}

// ── Valeurs communes à `inserer` et `remplacer` ─────────────────────────────────
// Auparavant dupliqué mot pour mot entre les deux (revue finale, mineur task 3) —
// factorisé ici puisque le correctif du Critique (péremption) touche les deux
// chemins.
function valeursObservation(e: { userId: string; contenu: string; salience: number; embedding: number[] | null }) {
  return {
    userId: e.userId,
    projectId: null, // fil "founder" est transverse — jamais rattaché à un projet
    fil: FIL,
    entryType: ENTRY_TYPE,
    content: e.contenu,
    embedding: e.embedding,
    salience: e.salience,
  };
}

/** `content` d'un compteur d'absence — format explicite, jamais lu par un humain ni une IA. */
function parseCompteur(content: string): { prefixe: string; count: number } | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed?.prefixe === "string" && typeof parsed?.count === "number") {
      return { prefixe: parsed.prefixe, count: parsed.count };
    }
  } catch {
    // Contenu non conforme — cette entrée n'est écrite que par `majCompteur` ci-
    // dessous, ne devrait jamais arriver. Ignoré plutôt que de faire échouer tout
    // le cycle pour une ligne de bookkeeping.
  }
  return null;
}

/**
 * Construit un jeu de dépendances réelles autour de `executor` — `db` (hors
 * transaction) ou `tx` (à l'intérieur d'une transaction déjà ouverte, verrouillée
 * par utilisateur). `jaEnTransaction` évite à `remplacer` d'ouvrir sa propre
 * transaction imbriquée quand `executor` est déjà un `tx`.
 */
function makeDbDeps(executor: DbExecutor, jaEnTransaction: boolean): ObservationDeps {
  async function lireCompteursBruts(userId: string) {
    return executor
      .select({ id: memoryEntries.id, content: memoryEntries.content })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userId),
          eq(memoryEntries.fil, FIL_COMPTEURS),
          eq(memoryEntries.entryType, ENTRY_TYPE_COMPTEUR),
          isNull(memoryEntries.supersededAt),
        ),
      );
  }

  return {
    async lireVivantes(userId) {
      return executor
        .select({ id: memoryEntries.id, content: memoryEntries.content })
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.userId, userId),
            eq(memoryEntries.fil, FIL),
            eq(memoryEntries.entryType, ENTRY_TYPE),
            isNull(memoryEntries.supersededAt),
          ),
        );
    },

    async lireCompteurs(userId) {
      const rows = await lireCompteursBruts(userId);
      const compteurs: Array<{ prefixe: string; count: number }> = [];
      for (const r of rows) {
        const parsed = parseCompteur(r.content);
        if (parsed) compteurs.push(parsed);
      }
      return compteurs;
    },

    async embed(texte) {
      // `embedText` ne lève déjà normalement pas (dégradation silencieuse interne),
      // mais la garde reste : l'interface `ObservationDeps.embed` promet un best-effort,
      // pas seulement l'implémentation du jour de `embedText`.
      try {
        return await embedText(texte);
      } catch {
        return null;
      }
    },

    async inserer(e) {
      await executor.insert(memoryEntries).values(valeursObservation(e));
    },

    async remplacer(ancienId, e) {
      // Transaction : périmer l'ancienne ET insérer la nouvelle ENSEMBLE — jamais
      // l'une sans l'autre. Même motif que `replaceMemoryEntry` dans
      // reception/recompute.ts. Si `executor` est déjà une transaction verrouillée
      // (chemin production), pas de transaction imbriquée : les deux opérations
      // s'exécutent simplement dans celle qui existe déjà.
      if (jaEnTransaction) {
        await executor.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, ancienId));
        await executor.insert(memoryEntries).values(valeursObservation(e));
      } else {
        await db.transaction(async (tx) => {
          await tx.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, ancienId));
          await tx.insert(memoryEntries).values(valeursObservation(e));
        });
      }
    },

    async expirer(id) {
      await executor.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, id));
    },

    async majCompteur(userId, prefixe, count) {
      const rows = await lireCompteursBruts(userId);
      const existant = rows.find((r) => parseCompteur(r.content)?.prefixe === prefixe);
      if (count === null) {
        if (existant) await executor.delete(memoryEntries).where(eq(memoryEntries.id, existant.id));
        return;
      }
      const content = JSON.stringify({ prefixe, count });
      if (existant) {
        await executor.update(memoryEntries).set({ content }).where(eq(memoryEntries.id, existant.id));
      } else {
        await executor.insert(memoryEntries).values({
          userId,
          projectId: null,
          fil: FIL_COMPTEURS,
          entryType: ENTRY_TYPE_COMPTEUR,
          content,
          embedding: null, // jamais retrouvé par recherche : inutile de l'embedder
          salience: 0,
        });
      }
    },
  };
}

// Chemin "déps partielles" (tests, ou tout appelant qui fournirait ses propres
// dépendances) : pas de verrou réel, chaque méthode non fournie retombe sur `db`
// directement. Chemin production (aucune déps fournie) : voir `rememberObservations`.
const dbDeps: ObservationDeps = makeDbDeps(db, false);

/** Au mieux : un embedding qui échoue — même de façon SYNCHRONE — n'empêche jamais l'écriture. */
async function embedAuMieux(d: ObservationDeps, texte: string): Promise<number[] | null> {
  // `d.embed(...).catch(() => null)` supposerait que `embed` REND une promesse.
  // Une dépendance qui lève de façon synchrone (avant même de retourner quoi que ce
  // soit) ne serait jamais rattrapée par ce `.catch()` — l'exception remonterait
  // directement au `try/catch` englobant de l'observation entière, qui perdrait
  // l'ÉCRITURE au lieu de simplement écrire sans vecteur (mineur, revue finale du
  // 2026-09-16). `try { await ... } catch { null }` est strictement plus sûr : il
  // attrape aussi bien un rejet qu'une levée synchrone.
  try {
    return await d.embed(texte);
  } catch {
    return null;
  }
}

/**
 * Le cœur du cycle : extraire, lire la mémoire vivante, décider, écrire, et faire
 * avancer (ou remettre à zéro) le compteur d'absence de chaque sujet vivant. Reçoit
 * ses dépendances déjà résolues — ne sait pas si elles pointent vers `db`, une
 * transaction verrouillée, ou des mocks de test.
 */
async function cycleObservations(d: ObservationDeps, userId: string, answers: TaskAnswer[]): Promise<void> {
  // 1. Extraire toutes les observations que permet la fenêtre actuelle (pur). Peut
  //    être VIDE : on ne court-circuite JAMAIS ici (Critique, revue finale du
  //    2026-09-16) — même sans nouvelle observation il faut lire la mémoire vivante,
  //    sinon un motif qui a cessé d'exister (l'utilisatrice se remet à faire ses
  //    tâches « admin ») ne serait plus jamais confronté à rien, et resterait
  //    mémorisé à vie.
  const observations = extractObservations(answers);
  const prefixesCourants = new Set(observations.map((o) => o.prefixe));

  // 2. Lire la mémoire vivante — la vraie ET les compteurs d'absence. Une lecture
  //    qui échoue n'est PAS "aucune mémoire vivante" : la traiter ainsi réécrirait
  //    une observation déjà là (Important 1, revue finale du 2026-09-16 — le
  //    commentaire précédent affirmait "au pire une mémoire existante n'est pas
  //    remplacée cette fois-ci", c'était FAUX : le pire est un DOUBLON PERMANENT,
  //    invisible à `vivantes.find(...)` qui ne voit que le premier). On laisse
  //    l'échec remonter : ce cycle entier est abandonné (silencieusement, voir le
  //    catch englobant de `rememberObservations`), le prochain `/answer`
  //    réessaiera avec un état à jour.
  const vivantesBrutes = await d.lireVivantes(userId);
  const compteurs = await d.lireCompteurs(userId);

  // Préfixe reconstruit depuis le contenu de CHAQUE mémoire vivante — pas
  // seulement les préfixes produits aujourd'hui (Critique, point 2) : une
  // catégorie qui n'apparaît plus DU TOUT dans la fenêtre actuelle doit quand même
  // être vue ici, sinon elle ne peut jamais être candidate à la péremption.
  const vivantes: MemoireVivante[] = [];
  for (const v of vivantesBrutes) {
    const prefixe = prefixeDeContenu(v.content);
    if (prefixe) vivantes.push({ id: v.id, contenu: v.content, prefixe });
  }

  // 3. Pour chaque observation produite ce cycle : décider (pur) puis appliquer.
  //    Chaque observation a son PROPRE try/catch — l'échec de l'une n'empêche
  //    jamais les suivantes (propriété certifiée par mutation, voir
  //    observation-writer.test.ts).
  for (const obs of observations) {
    try {
      const decision = decideMemoire(obs, vivantes);
      if (decision.action !== "rien") {
        const embedding = await embedAuMieux(d, decision.contenu);
        if (decision.action === "ecrire") {
          await d.inserer({ userId, contenu: decision.contenu, salience: decision.salience, embedding });
        } else {
          await d.remplacer(decision.ancienId, {
            userId,
            contenu: decision.contenu,
            salience: decision.salience,
            embedding,
          });
        }
      }
    } catch (error) {
      console.error(`[observation-writer] écriture d'une observation impossible pour ${userId} :`, error);
    }

    // Le motif est présent dans les DONNÉES ce cycle, que l'écriture ait réussi ou
    // non : son compteur d'absence retombe à zéro dans les deux cas. Un échec
    // d'écriture transitoire ne doit pas faire progresser artificiellement le
    // compte vers la péremption d'une observation qui, comportementalement, tient
    // toujours — try/catch séparé du bloc précédent, volontairement.
    try {
      await d.majCompteur(userId, obs.prefixe, null);
    } catch (error) {
      console.error(`[observation-writer] remise a zero du compteur d'absence impossible pour ${userId} :`, error);
    }
  }

  // 4. Péremption : toute mémoire vivante dont le préfixe n'a PAS été reproduit ce
  //    cycle avance d'un passage sans motif (voir `decideAbsence`,
  //    `SEUIL_PEREMPTION` dans observation-memory.ts pour la valeur et sa
  //    justification). Un seul passage absent ne périme rien.
  for (const v of vivantes) {
    if (prefixesCourants.has(v.prefixe)) continue; // motif reproduit ce cycle, déjà traité au 3.
    try {
      const precedent = compteurs.find((c) => c.prefixe === v.prefixe)?.count ?? 0;
      const decision = decideAbsence(precedent);
      if (decision.action === "perimer") {
        await d.expirer(v.id);
        await d.majCompteur(userId, v.prefixe, null);
      } else {
        await d.majCompteur(userId, v.prefixe, decision.nouveauCompte);
      }
    } catch (error) {
      console.error(`[observation-writer] mise a jour du compteur d'absence impossible pour ${userId} :`, error);
    }
  }
}

export async function rememberObservations(
  userId: string,
  answers: TaskAnswer[],
  deps?: Partial<ObservationDeps>,
): Promise<void> {
  try {
    if (deps) {
      // Chemin déps fournies (tests, ou tout appelant explicite) : pas de verrou
      // réel — chaque méthode non fournie retombe sur `dbDeps` (donc sur `db`,
      // sans transaction).
      const d: ObservationDeps = { ...dbDeps, ...deps };
      await cycleObservations(d, userId, answers);
      return;
    }

    // Chemin production : verrou consultatif PostgreSQL scope-transaction, par
    // utilisateur (`hashtext(userId)`). Toute la séquence lecture-décision-écriture
    // tourne DANS cette transaction : un deuxième appel concurrent pour le MÊME
    // utilisateur (par ex. trois `/answer` qui se chevauchent quand l'utilisatrice
    // répond le soir à plusieurs alarmes en attente) bloque sur le verrou jusqu'à ce
    // que le premier ait COMMIT, donc lit forcément un état déjà à jour — élimine la
    // race "les deux lisent 'vivantes' avant que l'un n'insère, doublon permanent"
    // (Important 1, revue finale du 2026-09-16). `pg_advisory_xact_lock` est un
    // verrou PostgreSQL natif, libéré automatiquement à la fin de la transaction :
    // aucune migration, aucune table de verrous à gérer.
    //
    // ⚠️ La transaction reste ouverte pendant l'appel réseau à `embedText` (borné à
    // EMBED_TIMEOUT_MS = 2500 ms, jusqu'à 2 observations par cycle). Choix délibéré :
    // l'écriture n'est jamais attendue par la réponse HTTP (fire-and-forget, voir
    // `routes.ts`) et le volume d'appels concurrents pour un même utilisateur reste
    // faible — plus simple qu'extraire l'embedding hors transaction, à revisiter si
    // la volumétrie change.
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const d = makeDbDeps(tx, true);
      await cycleObservations(d, userId, answers);
    });
  } catch (error) {
    // Règle 3 : cette fonction ne doit JAMAIS faire échouer la réponse de l'utilisatrice.
    console.error(`[observation-writer] rememberObservations a échoué pour ${userId} :`, error);
  }
}
