/**
 * Écrit dans la mémoire de Naya ce qu'elle vient de comprendre du rythme de
 * l'utilisatrice, pour qu'une observation ne soit plus perdue quand la
 * notification n'est pas vue.
 *
 * Trois règles qui ne se négocient pas :
 *
 * 1. L'embedding est AU MIEUX. `embedText` peut rendre `null`, et peut aussi
 *    LEVER. Dans les deux cas l'observation est écrite SANS vecteur. Perdre une
 *    observation parce qu'un appel réseau a raté serait exactement le défaut
 *    que cette feature corrige. Un embedding absent veut dire « non vectorisé »,
 *    jamais « vecteur nul » — et le scoring de `memory/retrieve.ts` est ADDITIF,
 *    donc l'observation reste retrouvable par son importance et sa fraîcheur.
 *
 * 2. Une observation périmée est INVALIDÉE (`supersededAt`), jamais supprimée.
 *
 * 3. Cette fonction ne doit JAMAIS faire échouer la réponse de l'utilisatrice.
 *    Elle a répondu ; c'est la donnée précieuse. La mémoire est un bénéfice,
 *    pas une condition. L'appelant peut l'invoquer sans l'attendre : elle ne
 *    laisse jamais une exception se propager.
 *
 * ⚠️ Le `prefixe` de `MemoireVivante` n'est PAS une colonne de `memory_entries`
 * (délibérément, pour ne pas ajouter de migration). On le reconstruit en
 * confrontant chaque mémoire vivante lue aux préfixes des observations qu'on
 * vient d'extraire pour CET appel — une mémoire dont le contenu COMMENCE PAR
 * l'un d'eux porte ce préfixe. Une mémoire qui ne correspond à AUCUN préfixe
 * courant n'est pas concernée : elle n'entre même pas dans la liste passée à
 * `decideMemoire`, et ne peut donc jamais être invalidée. C'est le même motif
 * d'appariement par préfixe que `findActiveMemoryEntry` dans
 * `server/services/reception/recompute.ts` — suivi ici, pas réinventé.
 */

import { and, eq, isNull } from "drizzle-orm";
import { memoryEntries } from "@shared/schema";
import { db } from "../../db";
import { embedText } from "../memory/embed";
import { extractObservations } from "./observations";
import { decideMemoire, type MemoireVivante } from "./observation-memory";
import type { TaskAnswer } from "./insight";

/** Fil et type d'entrée où vivent déjà les observations de Naya en production. */
const FIL = "founder";
const ENTRY_TYPE = "observation";

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

// ── Dépendances réelles (production) ────────────────────────────────────────────
const dbDeps: ObservationDeps = {
  async lireVivantes(userId) {
    return db
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
    await db.insert(memoryEntries).values({
      userId: e.userId,
      projectId: null, // fil "founder" est transverse — jamais rattaché à un projet
      fil: FIL,
      entryType: ENTRY_TYPE,
      content: e.contenu,
      embedding: e.embedding,
      salience: e.salience,
    });
  },
  async remplacer(ancienId, e) {
    // Transaction : périmer l'ancienne ET insérer la nouvelle ENSEMBLE — jamais l'une
    // sans l'autre. Même motif que `replaceMemoryEntry` dans reception/recompute.ts.
    await db.transaction(async (tx) => {
      await tx.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, ancienId));
      await tx.insert(memoryEntries).values({
        userId: e.userId,
        projectId: null,
        fil: FIL,
        entryType: ENTRY_TYPE,
        content: e.contenu,
        embedding: e.embedding,
        salience: e.salience,
      });
    });
  },
};

export async function rememberObservations(
  userId: string,
  answers: TaskAnswer[],
  deps?: Partial<ObservationDeps>,
): Promise<void> {
  const d: ObservationDeps = { ...dbDeps, ...deps };

  try {
    // 1. Extraire toutes les observations (pur).
    const observations = extractObservations(answers);
    if (observations.length === 0) return;

    const prefixesCourants = observations.map((o) => o.prefixe);

    // 2. Lire les mémoires vivantes du fil "founder", entryType "observation".
    let vivantesBrutes: Array<{ id: number; content: string }> = [];
    try {
      vivantesBrutes = await d.lireVivantes(userId);
    } catch (error) {
      // Best-effort : sans base de comparaison on écrit quand même les observations —
      // au pire une mémoire existante n'est pas remplacée cette fois-ci.
      console.error(`[observation-writer] lecture des mémoires vivantes impossible pour ${userId} :`, error);
    }

    // Reconstruction du préfixe (voir en-tête) : SEULES les mémoires dont le contenu
    // commence par un préfixe courant entrent dans la liste — les autres ne sont même
    // pas candidates à l'invalidation.
    const vivantes: MemoireVivante[] = [];
    for (const v of vivantesBrutes) {
      const prefixe = prefixesCourants.find((p) => v.content.startsWith(p));
      if (prefixe) vivantes.push({ id: v.id, contenu: v.content, prefixe });
    }

    // 3. Pour chacune, décider (pur) puis appliquer. 4. Chaque écriture est indépendante.
    for (const obs of observations) {
      try {
        const decision = decideMemoire(obs, vivantes);
        if (decision.action === "rien") continue;

        // Embedding AU MIEUX : un échec (null ou exception) n'empêche jamais l'écriture.
        const embedding = await d.embed(decision.contenu).catch(() => null);

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
      } catch (error) {
        console.error(`[observation-writer] écriture d'une observation impossible pour ${userId} :`, error);
      }
    }
  } catch (error) {
    // Règle 3 : cette fonction ne doit JAMAIS faire échouer la réponse de l'utilisatrice.
    console.error(`[observation-writer] rememberObservations a échoué pour ${userId} :`, error);
  }
}
