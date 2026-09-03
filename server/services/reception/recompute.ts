/**
 * Le rebouclage vers 3A (§4.3 du brief LOT 3B) : « une fois 3B en place,
 * `receivedVsIntentScore` reçoit son `conversionsInWindow` réel ».
 *
 * DEUX USAGES, UNE SEULE LOGIQUE (`recomputeOneRow`) :
 *
 *  1. LE RATTRAPAGE HISTORIQUE, en ligne de commande, sur TOUT le corpus — c'est le rôle
 *     de `server/scripts/recompute-reception-scores.ts`, qui n'est plus qu'un lanceur.
 *     Toutes les lignes `content_reception` ont été écrites AVANT que le moteur
 *     d'attribution n'existe : leur score a été calculé avec `conversionsInWindow: null`
 *     (non mesuré), quelle que soit l'intention réelle du contenu.
 *  2. LE RAFRAÎCHISSEMENT À CHAUD, après une attribution, sur les SEULS contenus crédités —
 *     `refreshReceptionForContents`, appelé par les routes de déclaration et de
 *     ré-attribution. Sans lui, déclarer une conversion périmait immédiatement les scores
 *     qu'elle venait de changer : les lignes `content_reception` gardaient le score calculé
 *     à l'ingestion et leurs entrées mémoire continuaient de l'affirmer à la salience la
 *     plus haute du fil, réinstallant exactement la dérive que le rattrapage ci-dessus
 *     corrige une fois à la main.
 *
 * La somme des crédits vient de `storage.getConversionCreditSumForContent` (`null` = aucune
 * ligne d'attribution = NON MESURÉ, jamais un zéro mesuré — voir attribution/credit-sum.ts).
 *
 * IDEMPOTENT : une ligne n'est écrite que si le score/la confiance/le rationale recalculés
 * diffèrent de ce qui est déjà stocké. Deux passages consécutifs sans nouvelle donnée
 * d'attribution entre les deux : le second ne met à jour AUCUNE ligne (`updated: 0`).
 *
 * Hypothèse H6 (ajout au §4.3, décidée dans la spec) : un changement MATÉRIEL de score
 * (écart absolu > 0,05, ou passage de/vers `null`) périme (`superseded_at`) l'entrée
 * `memory_entries` qui portait l'ancien verdict et en écrit une nouvelle avec la phrase
 * corrigée. Sans ça, LOT 3A n'ayant écrit en mémoire qu'à l'INSERTION (jamais sur une mise
 * à jour — voir `ingest.ts`), les souvenirs d'avant 3B continueraient d'affirmer les
 * anciens scores pour toujours, à la salience la plus haute du fil "reception".
 *
 * Le lien entre une ligne `content_reception` et SON entrée mémoire n'existe nulle part en
 * base (`memory_entries` n'a pas de `content_reception_id`) : on la retrouve en
 * reconstruisant le PRÉFIXE STABLE de la phrase que `formatReceptionMemoryPhrase` aurait
 * écrite pour l'ANCIENNE mesure (titre, plateforme, score, intention — tout ce qui NE
 * dépend PAS de la rationale), et en cherchant une entrée mémoire non périmée dont le
 * contenu COMMENCE par ce préfixe. Un appariement sur la phrase ENTIÈRE (rationale
 * comprise) échouerait silencieusement pour toute ligne historique à `rationale: null`
 * (la colonne est nullable en base, contrairement à ce que produit `ingest.ts` aujourd'hui)
 * — et cet échec serait PERMANENT : `existing` resterait introuvable, le score serait
 * quand même corrigé, la ligne ne serait donc plus jamais "changée", et aucun passage
 * futur du script ne la reverrait. Un appariement par préfixe est délibérément plus large
 * (deux mesures distinctes au même score littéral partageraient le même préfixe) : c'est
 * accepté — périmer l'une ou l'autre de deux entrées jumelles ne change rien d'observable —
 * alors qu'un appariement qui RATE est irrécupérable.
 *
 * ⚠️ COUPLAGE AU LIBELLÉ EXACT : cette reconstruction dépend du texte produit AUJOURD'HUI
 * par `formatReceptionMemoryPhrase` (voir ingest.ts). Un changement de formulation dans
 * cette fonction — même sans rapport avec cette tâche — casse SILENCIEUSEMENT
 * l'appariement de TOUT l'historique en une fois : plus aucune ligne ne retrouvera son
 * entrée mémoire, et le seul signal en sera l'avertissement `console.warn` émis pour
 * chaque changement matériel sans entrée retrouvée (voir `recomputeOneRow` ci-dessous).
 *
 *   NODE_ENV=development npx tsx server/scripts/recompute-reception-scores.ts
 */

import { db } from "../../db";
import { storage } from "../../storage";
import { contentReception, content, memoryEntries } from "@shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { receivedVsIntentScore, type Intent } from "./score";
import { formatReceptionMemoryPhrase } from "./ingest";
import { embedText } from "../memory/embed";

/** Écart absolu à partir duquel un changement de score est jugé MATÉRIEL (hypothèse H6). */
export const MATERIAL_THRESHOLD = 0.05;

export interface ReceptionRow {
  id: number;
  contentId: number;
  projectId: number;
  platform: string;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  reach: number | null;
  sentimentScore: number | null;
  receivedVsIntentScore: number | null;
  confidence: number | null;
  rationale: string | null;
  contentTitle: string;
  contentIntent: string | null;
  contentUserId: string;
}

export interface NewMemoryEntry {
  userId: string;
  projectId: number;
  fil: string;
  entryType: string;
  content: string;
  embedding: number[] | null;
  salience: number;
  /**
   * La date d'origine du souvenir REMPLACÉ, reprise telle quelle (`null` si l'ancienne
   * ligne n'en avait pas). POSÉE EXPLICITEMENT parce que `memory_entries.created_at` a un
   * `defaultNow()` : l'omettre redaterait la remplaçante à aujourd'hui. La demi-vie du fil
   * "reception" est de 10 jours — la plus courte des trois (services/memory/retrieve.ts) —
   * et ce script traite tout l'historique en un seul run : sans ça, une exécution
   * ramènerait la fraîcheur de TOUT le corpus à 1,0 d'un coup, et les vieilles mesures
   * passeraient devant les récentes dans le top-K de chaque appel IA suivant. Un verdict
   * corrigé sur un fait ancien reste un fait ancien.
   */
  createdAt: Date | null;
}

/**
 * Accès storage injectable — même précédent que `MemoryRepo` dans
 * `server/services/memory/extract.ts` : la vraie DB par défaut, un faux store en mémoire
 * dans les tests, pour compter des LIGNES réellement changées, pas des invocations de mock.
 */
export interface RecomputeRepo {
  /**
   * Sans argument : TOUT le corpus (rattrapage historique). Avec `contentIds` : seulement
   * les lignes de ces contenus — c'est ce qui permet au rafraîchissement à chaud de ne
   * toucher QUE les contenus que l'attribution vient de changer. Une liste vide ne renvoie
   * rien (et surtout pas tout le corpus).
   */
  listReceptionRows(contentIds?: number[]): Promise<ReceptionRow[]>;
  /**
   * `null` = AUCUNE ligne d'attribution, donc NON MESURÉ (le contenu n'est jamais passé par
   * une fenêtre de conversion) — surtout pas `0`, qui veut dire « mesuré à zéro » et fait
   * chuter le score. Voir services/attribution/credit-sum.ts pour la démonstration.
   */
  getConversionCreditSum(contentId: number): Promise<number | null>;
  updateReceptionScore(
    id: number,
    patch: { receivedVsIntentScore: number | null; confidence: number; rationale: string },
  ): Promise<void>;
  /**
   * Apparie sur un PRÉFIXE (voir en-tête du fichier), jamais sur l'égalité stricte.
   * Renvoie aussi la date d'origine : la remplaçante doit la reprendre (voir
   * `NewMemoryEntry.createdAt`).
   */
  findActiveMemoryEntry(args: {
    userId: string;
    fil: string;
    entryType: string;
    contentPrefix: string;
  }): Promise<{ id: number; createdAt: Date | null } | null>;
  /**
   * Périme l'ancienne entrée ET insère la nouvelle DANS LA MÊME TRANSACTION — jamais l'une
   * sans l'autre. Sans cette atomicité, un crash entre les deux (process tué, connexion DB
   * perdue) laisserait l'ancienne entrée périmée SANS remplaçante : le fil "reception"
   * deviendrait alors PERMANENTMENT vide pour ce contenu, sans qu'aucune erreur ne le
   * signale — le score `content_reception`, lui, ne serait corrigé que dans un second
   * appel `updateReceptionScore` séparé, donc au rejeu la ligne ne recalculerait plus rien
   * de "changé" et ne redéclencherait jamais cette branche.
   */
  replaceMemoryEntry(oldEntryId: number, newEntry: NewMemoryEntry): Promise<void>;
}

export const dbRecomputeRepo: RecomputeRepo = {
  async listReceptionRows(contentIds?: number[]) {
    // `contentIds` fourni mais vide = « rien à rafraîchir », JAMAIS « tout le corpus » :
    // un `inArray(..., [])` ou un filtre omis transformerait un rafraîchissement ciblé en
    // recalcul complet déclenché par une simple conversion sans crédit.
    if (contentIds && contentIds.length === 0) return [];
    const filtre = contentIds
      ? inArray(contentReception.contentId, contentIds)
      : undefined;
    const q = db
      .select({
        id: contentReception.id,
        contentId: contentReception.contentId,
        projectId: contentReception.projectId,
        platform: contentReception.platform,
        saves: contentReception.saves,
        shares: contentReception.shares,
        comments: contentReception.comments,
        reach: contentReception.reach,
        sentimentScore: contentReception.sentimentScore,
        receivedVsIntentScore: contentReception.receivedVsIntentScore,
        confidence: contentReception.confidence,
        rationale: contentReception.rationale,
        contentTitle: content.title,
        contentIntent: content.intent,
        contentUserId: content.userId,
      })
      .from(contentReception)
      .innerJoin(content, eq(contentReception.contentId, content.id));
    return filtre ? q.where(filtre) : q;
  },
  async getConversionCreditSum(contentId) {
    return storage.getConversionCreditSumForContent(contentId);
  },
  async updateReceptionScore(id, patch) {
    await db.update(contentReception).set(patch).where(eq(contentReception.id, id));
  },
  async findActiveMemoryEntry({ userId, fil, entryType, contentPrefix }) {
    // Filtrage du PRÉFIXE côté application, pas en SQL (`LIKE`) : le préfixe est construit
    // à partir de texte libre (titre de contenu) qui peut contenir des caractères spéciaux
    // de motif (`%`, `_`) — les échapper correctement pour un `LIKE` sûr coûterait plus
    // cher que de filtrer en mémoire un volume de lignes borné par (user, fil) sur un
    // script hors-ligne, jamais un chemin critique.
    const rows = await db
      .select({ id: memoryEntries.id, content: memoryEntries.content, createdAt: memoryEntries.createdAt })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userId),
          eq(memoryEntries.fil, fil),
          eq(memoryEntries.entryType, entryType),
          isNull(memoryEntries.supersededAt),
        ),
      );
    const found = rows.find((r) => r.content.startsWith(contentPrefix));
    return found ? { id: found.id, createdAt: found.createdAt } : null;
  },
  async replaceMemoryEntry(oldEntryId, newEntry) {
    await db.transaction(async (tx) => {
      await tx.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, oldEntryId));
      await tx.insert(memoryEntries).values(newEntry);
    });
  },
};

/** Transition de/vers `null`, ou écart absolu > seuil : voir hypothèse H6 en en-tête. */
function isMaterialChange(oldScore: number | null, newScore: number | null): boolean {
  if ((oldScore === null) !== (newScore === null)) return true;
  if (oldScore === null || newScore === null) return false;
  return Math.abs(newScore - oldScore) > MATERIAL_THRESHOLD;
}

export interface RecomputeError {
  receptionId: number;
  contentId: number;
  message: string;
}

export interface RecomputeResult {
  scanned: number;
  updated: number;
  memorySuperseded: number;
  errors: RecomputeError[];
}

export async function recomputeReceptionScores(
  repo: RecomputeRepo = dbRecomputeRepo,
  /** Restreint le recalcul à ces contenus. Omis = tout le corpus (rattrapage historique). */
  contentIds?: number[],
): Promise<RecomputeResult> {
  const rows = await repo.listReceptionRows(contentIds);
  let updated = 0;
  let memorySuperseded = 0;
  const errors: RecomputeError[] = [];

  // BEST-EFFORT ligne par ligne — même doctrine que `ingestSignals` (voir ingest.ts) :
  // une ligne en échec (DB, embedding, ...) ne doit jamais arrêter le recalcul des
  // autres. Sans cette isolation, une exception sur la ligne 50 d'un run de 500 laisserait
  // les 450 suivantes non recalculées SANS que ce soit visible dans le résultat renvoyé.
  // C'est aussi ce qui rend un run interrompu SANS DANGER : comme le recalcul est
  // idempotent, relancer le script reprend exactement là où il s'était arrêté, sans
  // jamais redoubler une ligne déjà correcte.
  for (const r of rows) {
    try {
      const outcome = await recomputeOneRow(repo, r);
      if (outcome.updated) updated++;
      if (outcome.memorySuperseded) memorySuperseded++;
    } catch (error) {
      errors.push({
        receptionId: r.id,
        contentId: r.contentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: rows.length, updated, memorySuperseded, errors };
}

/**
 * RAFRAÎCHISSEMENT À CHAUD après une attribution (finding I4 de la revue finale).
 *
 * Déclarer une conversion changeait la somme des crédits des contenus qu'elle venait de
 * créditer SANS toucher à leurs lignes `content_reception` : celles-ci gardaient le score
 * calculé à l'ingestion, et leurs entrées mémoire continuaient de l'affirmer à la salience
 * la plus haute du fil "reception" — exactement la dérive que le rattrapage historique
 * corrige une fois à la main. On rejoue donc ICI la MÊME logique par ligne
 * (`recomputeOneRow`, via `recomputeReceptionScores`), restreinte aux contenus concernés :
 * pas une deuxième implémentation du recalcul.
 *
 * BEST-EFFORT, ET C'EST STRUCTUREL : la déclaration a DÉJÀ réussi quand on arrive ici (la
 * conversion est écrite, ses crédits sont posés). Un échec du rafraîchissement ne doit donc
 * jamais faire échouer la réponse — l'utilisateur perdrait la trace d'une conversion
 * pourtant enregistrée, et la relancerait, alors que le recalcul, lui, est idempotent et
 * sera repris au prochain passage. Cette fonction NE LÈVE JAMAIS.
 */
export async function refreshReceptionForContents(
  contentIds: number[],
  repo: RecomputeRepo = dbRecomputeRepo,
): Promise<RecomputeResult | null> {
  const uniques = Array.from(new Set(contentIds));
  if (uniques.length === 0) return null;
  try {
    const result = await recomputeReceptionScores(repo, uniques);
    if (result.errors.length > 0) {
      console.error(
        `[reception] rafraîchissement partiel après attribution (${result.errors.length} ligne(s) en échec) :`,
        result.errors,
      );
    }
    return result;
  } catch (error) {
    // Y compris un échec de `listReceptionRows` : la déclaration reste un succès.
    console.error(
      `[reception] rafraîchissement des scores impossible après attribution ` +
        `(contenus ${uniques.join(", ")}) — la conversion, elle, est bien enregistrée :`,
      error,
    );
    return null;
  }
}

/** Traite UNE ligne `content_reception`. Isolé pour que le best-effort de la boucle
 * appelante puisse capturer une exception ligne par ligne — voir son commentaire. */
async function recomputeOneRow(
  repo: RecomputeRepo,
  r: ReceptionRow,
): Promise<{ updated: boolean; memorySuperseded: boolean }> {
  // Passé TEL QUEL au score : `null` (aucune ligne d'attribution) veut dire NON MESURÉ, et
  // le convertir en `0` graverait un échec de conversion mesuré pour tout contenu d'une
  // marque n'ayant jamais déclaré de conversion — voir credit-sum.ts et score.ts.
  const conversionsInWindow = await repo.getConversionCreditSum(r.contentId);

  const newResult = receivedVsIntentScore({
    intent: (r.contentIntent as Intent | null) ?? null,
    saves: r.saves,
    shares: r.shares,
    comments: r.comments,
    reach: r.reach,
    sentimentScore: r.sentimentScore,
    conversionsInWindow,
  });

  const changed =
    r.receivedVsIntentScore !== newResult.score ||
    r.confidence !== newResult.confidence ||
    r.rationale !== newResult.rationale;
  // IDEMPOTENCE : rien de neuf, on n'écrit rien.
  if (!changed) return { updated: false, memorySuperseded: false };

  let memorySuperseded = false;
  if (isMaterialChange(r.receivedVsIntentScore, newResult.score)) {
    // ⚠️ COUPLÉ AU LIBELLÉ EXACT de `formatReceptionMemoryPhrase` (voir avertissement en
    // en-tête du fichier). `rationale: ""` est délibéré, pas un oubli : on n'apparie QUE
    // sur le préfixe stable (titre, plateforme, score, intention), jamais sur la
    // rationale — une ligne historique à `rationale: null` en base doit quand même
    // retrouver son entrée mémoire.
    const oldPhrasePrefix = formatReceptionMemoryPhrase({
      contentTitle: r.contentTitle,
      platform: r.platform,
      score: r.receivedVsIntentScore,
      intent: r.contentIntent,
      rationale: "",
    });

    const existing = await repo.findActiveMemoryEntry({
      userId: r.contentUserId,
      fil: "reception",
      entryType: "signal_reception",
      contentPrefix: oldPhrasePrefix,
    });

    if (existing) {
      const newPhrase = formatReceptionMemoryPhrase({
        contentTitle: r.contentTitle,
        platform: r.platform,
        score: newResult.score,
        intent: r.contentIntent,
        rationale: newResult.rationale,
      });
      const embedding = await embedText(newPhrase).catch(() => null);
      await repo.replaceMemoryEntry(existing.id, {
        userId: r.contentUserId,
        projectId: r.projectId,
        fil: "reception",
        entryType: "signal_reception",
        content: newPhrase,
        embedding,
        salience: newResult.confidence > 0 ? newResult.confidence : 0.5,
        // I1 : la date d'ORIGINE, jamais « maintenant ». Voir NewMemoryEntry.createdAt.
        createdAt: existing.createdAt,
      });
      memorySuperseded = true;
    } else {
      // DISTINCT d'un simple "rien à faire" : un changement MATÉRIEL sans entrée
      // retrouvée est SUSPECT (mesure jamais devenue mémoire, déjà périmée par un passage
      // antérieur interrompu, ou — le risque documenté en en-tête — un changement de
      // libellé dans `formatReceptionMemoryPhrase` qui a cassé l'appariement pour tout
      // l'historique). Un opérateur doit pouvoir repérer CETTE ligne et vérifier le fil
      // "reception" à la main : un silence indiscernable rendrait le défaut permanent.
      console.warn(
        `[recompute-reception-scores] AUCUNE entrée mémoire active retrouvée pour périmer ` +
          `malgré un changement matériel de score (contenu ${r.contentId}, ligne ` +
          `content_reception ${r.id}, ${r.receivedVsIntentScore} → ${newResult.score}). ` +
          `Le score est corrigé quand même ; vérifier manuellement le fil "reception" pour ce contenu.`,
      );
    }
  }

  await repo.updateReceptionScore(r.id, {
    receivedVsIntentScore: newResult.score,
    confidence: newResult.confidence,
    rationale: newResult.rationale,
  });

  return { updated: true, memorySuperseded };
}
