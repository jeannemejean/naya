// Relance de la validation client (lot 8) : un post en validation, validé ou refusé dont le
// texte, les médias ou la date changent repasse « à valider » (le client revoit ce qui partira).
// Écrit AU MIEUX, comme l'historique : un échec ne fait jamais échouer l'enregistrement.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import { editionRelanceValidation, STATUTS_VALIDATION } from "@shared/validation-client";
import { journaliser } from "../gestion-posts/historique";

export async function relancerValidationSiEdite(
  userId: string | null | undefined,
  avant: Record<string, any> | null | undefined,
  patch: Record<string, any> | null | undefined,
): Promise<boolean> {
  if (!userId || !avant?.id || !editionRelanceValidation(avant, patch)) return false;
  try {
    const r = await db.update(content)
      .set({ validationStatut: "a_valider", validationDemandeeAt: new Date() } as any)
      .where(and(eq(content.id, avant.id), eq(content.userId, userId), inArray(content.validationStatut, [...STATUTS_VALIDATION])))
      .returning({ id: content.id });
    if (r.length === 0) return false;
    await journaliser(userId, avant.id, "validation_relancee", { avant: avant.validationStatut });
    return true;
  } catch (e: any) {
    console.error(`[Validation] relance du post ${avant.id}:`, e?.message || e);
    return false;
  }
}
