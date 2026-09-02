/**
 * Le rebouclage vers 3A (§4.3 du brief LOT 3B) : « une fois 3B en place,
 * `receivedVsIntentScore` reçoit son `conversionsInWindow` réel ».
 *
 * Toutes les lignes `content_reception` ont été écrites AVANT que le moteur d'attribution
 * n'existe : leur score a été calculé avec `conversionsInWindow: null` (non mesuré), quelle
 * que soit l'intention réelle du contenu. Ce script les recalcule avec la somme RÉELLE des
 * crédits d'attribution — voir `storage.getConversionCreditSumForContent`.
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
 * reconstruisant la phrase EXACTE que `formatReceptionMemoryPhrase` aurait écrite pour
 * l'ANCIENNE mesure (même fonction pure qu'à l'insertion) et en cherchant une entrée
 * mémoire non périmée dont le contenu correspond mot pour mot.
 *
 *   NODE_ENV=development npx tsx server/scripts/recompute-reception-scores.ts
 */

import "dotenv/config";
import { db } from "../db";
import { storage } from "../storage";
import { contentReception, content, memoryEntries } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { receivedVsIntentScore, type Intent } from "../services/reception/score";
import { formatReceptionMemoryPhrase } from "../services/reception/ingest";
import { embedText } from "../services/memory/embed";

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

/**
 * Accès storage injectable — même précédent que `MemoryRepo` dans
 * `server/services/memory/extract.ts` : la vraie DB par défaut, un faux store en mémoire
 * dans les tests, pour compter des LIGNES réellement changées, pas des invocations de mock.
 */
export interface RecomputeRepo {
  listReceptionRows(): Promise<ReceptionRow[]>;
  getConversionCreditSum(contentId: number): Promise<number>;
  updateReceptionScore(
    id: number,
    patch: { receivedVsIntentScore: number | null; confidence: number; rationale: string },
  ): Promise<void>;
  findActiveMemoryEntry(args: {
    userId: string;
    fil: string;
    entryType: string;
    content: string;
  }): Promise<{ id: number } | null>;
  supersedeMemoryEntry(id: number): Promise<void>;
  insertMemoryEntry(entry: {
    userId: string;
    projectId: number;
    fil: string;
    entryType: string;
    content: string;
    embedding: number[] | null;
    salience: number;
  }): Promise<void>;
}

export const dbRecomputeRepo: RecomputeRepo = {
  async listReceptionRows() {
    return db
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
  },
  async getConversionCreditSum(contentId) {
    return storage.getConversionCreditSumForContent(contentId);
  },
  async updateReceptionScore(id, patch) {
    await db.update(contentReception).set(patch).where(eq(contentReception.id, id));
  },
  async findActiveMemoryEntry({ userId, fil, entryType, content: text }) {
    const [row] = await db
      .select({ id: memoryEntries.id })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userId),
          eq(memoryEntries.fil, fil),
          eq(memoryEntries.entryType, entryType),
          eq(memoryEntries.content, text),
          isNull(memoryEntries.supersededAt),
        ),
      )
      .limit(1);
    return row ?? null;
  },
  async supersedeMemoryEntry(id) {
    await db.update(memoryEntries).set({ supersededAt: new Date() }).where(eq(memoryEntries.id, id));
  },
  async insertMemoryEntry(entry) {
    await db.insert(memoryEntries).values(entry);
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
): Promise<RecomputeResult> {
  const rows = await repo.listReceptionRows();
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

/** Traite UNE ligne `content_reception`. Isolé pour que le best-effort de la boucle
 * appelante puisse capturer une exception ligne par ligne — voir son commentaire. */
async function recomputeOneRow(
  repo: RecomputeRepo,
  r: ReceptionRow,
): Promise<{ updated: boolean; memorySuperseded: boolean }> {
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
    // Reconstruire la phrase EXACTE que ingest.ts a écrite au moment de CETTE mesure —
    // seule clé disponible pour retrouver sa ligne mémoire (voir en-tête du fichier).
    const oldPhrase = formatReceptionMemoryPhrase({
      contentTitle: r.contentTitle,
      platform: r.platform,
      score: r.receivedVsIntentScore,
      intent: r.contentIntent,
      rationale: r.rationale ?? "",
    });

    const existing = await repo.findActiveMemoryEntry({
      userId: r.contentUserId,
      fil: "reception",
      entryType: "signal_reception",
      content: oldPhrase,
    });

    // Aucune entrée retrouvée (mesure jamais devenue une entrée mémoire, ex. insertion
    // suivie d'un échec d'embedding, ou déjà périmée par un passage antérieur du script)
    // : rien à périmer, on continue quand même la mise à jour de content_reception.
    if (existing) {
      await repo.supersedeMemoryEntry(existing.id); // bi-temporel : on invalide, on ne supprime pas.

      const newPhrase = formatReceptionMemoryPhrase({
        contentTitle: r.contentTitle,
        platform: r.platform,
        score: newResult.score,
        intent: r.contentIntent,
        rationale: newResult.rationale,
      });
      const embedding = await embedText(newPhrase).catch(() => null);
      await repo.insertMemoryEntry({
        userId: r.contentUserId,
        projectId: r.projectId,
        fil: "reception",
        entryType: "signal_reception",
        content: newPhrase,
        embedding,
        salience: newResult.confidence > 0 ? newResult.confidence : 0.5,
      });
      memorySuperseded = true;
    }
  }

  await repo.updateReceptionScore(r.id, {
    receivedVsIntentScore: newResult.score,
    confidence: newResult.confidence,
    rationale: newResult.rationale,
  });

  return { updated: true, memorySuperseded };
}

// ── Exécution standalone (jamais déclenchée par un import, ex. depuis les tests) ────────
if (import.meta.url === `file://${process.argv[1]}`) {
  recomputeReceptionScores()
    .then((result) => {
      console.log(
        `[recompute-reception-scores] lignes scannées : ${result.scanned}, ` +
          `mises à jour : ${result.updated}, entrées mémoire périmées : ${result.memorySuperseded}, ` +
          `erreurs : ${result.errors.length}`,
      );
      if (result.errors.length > 0) console.error(result.errors);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[recompute-reception-scores] échec :", err);
      process.exit(1);
    });
}
