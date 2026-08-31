/**
 * L'INGESTION de la réception — le point d'entrée unique par lequel un `ReceptionSignal`
 * (peu importe sa provenance : CSV manuel aujourd'hui, adaptateur réseau demain) devient
 * une ligne `content_reception` et, en best-effort, une entrée mémoire sur le fil
 * "reception".
 *
 * Règle non négociable : L'INGESTION NE CASSE JAMAIS UNE ACTION UTILISATEUR. Aucune
 * exception ne doit remonter au routeur qui appelle `ingestSignals` — un signal en échec
 * est reporté dans `errors`, les autres continuent d'être traités.
 */

import { storage } from "../../storage";
import { db } from "../../db";
import { memoryEntries } from "@shared/schema";
import type { InsertContentReception } from "@shared/schema";
import { receivedVsIntentScore, type Intent } from "./score";
import { embedText } from "../memory/embed";
import type { ReceptionSignal } from "./types";

export interface IngestError {
  contentId: number;
  platform: string;
  message: string;
}

export interface IngestResult {
  written: number;
  /**
   * Réservé pour de futures conditions de skip volontaire (par ex. un signal jugé hors
   * périmètre sans être une erreur). Ce lot ne produit aucun skip : toute non-écriture
   * est reportée dans `errors`, jamais silencieuse. Le champ existe pour la forme du
   * contrat consommé par la tâche 5.
   */
  skipped: number;
  errors: IngestError[];
}

/**
 * Construit la phrase mémoire décrivant une mesure de réception. PURE — aucune base,
 * aucun réseau — donc testable isolément (voir ingest.test.ts), séparément du
 * branchement DB/embedding qui l'entoure.
 */
export function formatReceptionMemoryPhrase(input: {
  contentTitle: string;
  platform: string;
  score: number | null;
  intent: string | null;
  rationale: string;
}): string {
  const { contentTitle, platform, score, intent, rationale } = input;
  return (
    `Réception mesurée du contenu « ${contentTitle} » (${platform}) : ` +
    `${score === null ? "score indisponible" : `score ${(score * 100).toFixed(0)}/100`} ` +
    `contre une intention ${intent ?? "non déclarée"}. ${rationale}`
  );
}

/**
 * Ingère une liste de signaux de réception pour `userId`.
 *
 * Best-effort de bout en bout : une exception inattendue sur UN signal (contenu
 * introuvable, marque manquante, échec DB, ...) est capturée et reportée dans
 * `errors` — elle n'interrompt jamais le traitement des signaux suivants.
 */
export async function ingestSignals(userId: string, signals: ReceptionSignal[]): Promise<IngestResult> {
  let written = 0;
  const skipped = 0;
  const errors: IngestError[] = [];

  for (const signal of signals) {
    try {
      // 1. Le contenu doit exister ET appartenir à userId. `getContentById` applique déjà
      //    ce filtre d'ownership : un contenu d'un autre utilisateur renvoie `undefined`,
      //    exactement comme un contenu inexistant — jamais un skip silencieux qui rapporte
      //    un succès.
      const contentRow = await storage.getContentById(signal.contentId, userId);
      if (!contentRow) {
        errors.push({
          contentId: signal.contentId,
          platform: signal.platform,
          message: "contenu introuvable ou n'appartenant pas à cet utilisateur",
        });
        continue;
      }

      // La marque doit être CONNUE, jamais devinée (§3A.5) : `content_reception.project_id`
      // est NOT NULL alors que `content.projectId` est nullable. Un signal sans marque
      // n'apprend rien à Naya — on le refuse plutôt que d'inventer un projet de secours.
      if (contentRow.projectId === null || contentRow.projectId === undefined) {
        errors.push({
          contentId: signal.contentId,
          platform: signal.platform,
          message: "contenu sans marque (projectId manquant) : la réception ne peut pas être attribuée",
        });
        continue;
      }

      // 2. Le score — pur, testé isolément dans score.test.ts.
      const result = receivedVsIntentScore({
        intent: (contentRow.intent as Intent | null) ?? null,
        saves: signal.saves,
        shares: signal.shares,
        comments: signal.comments,
        reach: signal.reach,
        sentimentScore: signal.sentimentScore,
        conversionsInWindow: 0, // LOT 3B fournira la vraie valeur ; ce lot ne la calcule pas.
      });

      const row: InsertContentReception = {
        contentId: signal.contentId,
        projectId: contentRow.projectId,
        platform: signal.platform,
        saves: signal.saves,
        shares: signal.shares,
        comments: signal.comments,
        reach: signal.reach,
        sentimentScore: signal.sentimentScore,
        receivedVsIntentScore: result.score,
        confidence: result.confidence,
        rationale: result.rationale,
        source: signal.source,
        measuredAt: signal.measuredAt,
      };

      // 3. Upsert idempotent : rejouer la même mesure écrase, ne double pas.
      await storage.upsertContentReception(row);
      written++;

      // 4. Branchement mémoire — DÉCORATIF par rapport à la mesure : son échec ne doit
      //    jamais faire perdre la ligne content_reception qui vient d'être sauvegardée.
      try {
        // On écrit DIRECTEMENT dans memory_entries : il n'y a rien à « extraire » d'un
        // signal chiffré, donc on ne passe pas par extractToMemory. La marque est CONNUE
        // (celle du contenu) — aucune question de routage de marque ici.
        const phrase = formatReceptionMemoryPhrase({
          contentTitle: contentRow.title,
          platform: signal.platform,
          score: result.score,
          intent: contentRow.intent,
          rationale: result.rationale,
        });

        const embedding = await embedText(phrase).catch(() => null);
        await db.insert(memoryEntries).values({
          userId,
          projectId: contentRow.projectId,
          fil: "reception",
          entryType: "signal_reception",
          content: phrase,
          embedding,
          salience: result.confidence > 0 ? result.confidence : 0.5,
        });
      } catch (memoryError) {
        console.error(
          `[reception] écriture mémoire échouée pour le contenu ${signal.contentId} ` +
            `(best-effort — la mesure est déjà sauvegardée) :`,
          memoryError,
        );
      }
    } catch (error) {
      errors.push({
        contentId: signal.contentId,
        platform: signal.platform,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { written, skipped, errors };
}
