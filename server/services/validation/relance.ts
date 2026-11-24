// Relance de la validation client (lot 8) : un post en validation, validé ou refusé dont le
// texte, les médias, la date ou les options changent repasse « à valider » (le client revoit ce
// qui partira).
//
// La relance part DANS LA MÊME ÉCRITURE que la modification (`champsRelanceValidation`, à
// fusionner dans le `set`) : sinon, entre les deux écritures, le worker pourrait publier le post
// modifié comme s'il était validé. Le statut est conditionné en SQL (CASE), donc juste même si la
// ligne a changé depuis sa lecture. Les décisions passées ne comptent plus : elles sont filtrées
// sur `validation_demandee_at`, renouvelée ici.
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { content } from "@shared/schema";
import { editionRelanceValidation, STATUTS_VALIDATION } from "@shared/validation-client";
import { journaliser } from "../gestion-posts/historique";

const EN_VALIDATION = sql.raw(STATUTS_VALIDATION.map((s) => `'${s}'`).join(", "));

/**
 * Champs à ajouter au `set` de la modification ; vide si le post n'était pas en validation (lu
 * avant l'écriture) ou si rien de ce qui part ne change. Le CASE garde la décision juste si le
 * statut a bougé entre la lecture et l'écriture (validé entre-temps → repasse « à valider »).
 */
export function champsRelanceValidation(
  avant: Record<string, any> | null | undefined,
  patch: Record<string, any> | null | undefined,
): { validationStatut?: SQL; validationDemandeeAt?: SQL } {
  if (!avant || !editionRelanceValidation(avant, patch)) return {};
  return {
    validationStatut: sql`case when ${content.validationStatut} in (${EN_VALIDATION}) then 'a_valider' else ${content.validationStatut} end`,
    validationDemandeeAt: sql`case when ${content.validationStatut} in (${EN_VALIDATION}) then now() else ${content.validationDemandeeAt} end`,
  };
}

/** Historique de la relance, après une écriture réussie. Au mieux : ne fait jamais échouer. */
export async function journaliserRelanceSiEdite(
  userId: string | null | undefined,
  avant: Record<string, any> | null | undefined,
  patch: Record<string, any> | null | undefined,
): Promise<boolean> {
  if (!userId || !avant?.id || !editionRelanceValidation(avant, patch)) return false;
  try {
    await journaliser(userId, avant.id, "validation_relancee", { avant: avant.validationStatut });
  } catch (e: any) {
    console.error(`[Validation] historique de la relance du post ${avant.id}:`, e?.message || e);
  }
  return true;
}

/**
 * Relance en écriture séparée — seulement là où la modification passe par une écriture qui ne
 * peut pas porter les champs (déplacement groupé du calendrier). Au mieux.
 */
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
