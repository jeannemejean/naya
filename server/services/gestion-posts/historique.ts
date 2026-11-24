// Historique d'un post : écrit AU MIEUX. Un journal qui échoue (base indisponible, table pas
// encore migrée) ne fait jamais échouer le geste qui l'a provoqué : on avale et on le dit.
import { db } from "../../db";
import { historiquePost } from "@shared/schema";
import { evenementsDuChangement, type EvenementPost } from "@shared/gestion-posts";

export async function journaliser(
  userId: string | null | undefined,
  contentId: number | null | undefined,
  evenement: EvenementPost,
  details?: Record<string, unknown> | null,
): Promise<void> {
  if (!userId || !contentId) return;
  try {
    await db.insert(historiquePost).values({ userId, contentId, evenement, details: details ?? null });
  } catch (e: any) {
    console.error(`[Historique] post ${contentId} (${evenement}) non journalisé:`, e?.message || e);
  }
}

/** Journalise ce qu'un changement (avant → après ou patch) a de notable. */
export async function journaliserChangement(
  userId: string | null | undefined,
  avant: Record<string, any> | null | undefined,
  apres: Record<string, any> | null | undefined,
): Promise<void> {
  if (!avant || !apres) return;
  try {
    for (const e of evenementsDuChangement(avant, apres)) await journaliser(userId, avant.id, e.evenement, e.details ?? null);
  } catch (e: any) {
    console.error(`[Historique] changement du post ${avant?.id} non journalisé:`, e?.message || e);
  }
}
