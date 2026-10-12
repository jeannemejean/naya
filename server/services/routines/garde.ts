/**
 * Garde commune avant toute dépense d'une routine : accès actif (abonnement, propriétaire,
 * offert) et budget IA du mois. Mêmes règles que les actions lancées à la main.
 */
import { storage } from "../../storage";
import { isAiBlocked } from "../usage";
import { hasNayaAccess } from "../access";
import type { ResultatPassage } from "./types";

export async function aAccesActif(userId: string): Promise<boolean> {
  const [user, sub] = await Promise.all([storage.getUser(userId), storage.getSubscription(userId)]);
  return hasNayaAccess({ role: (user as any)?.role ?? null } as any, (sub ?? null) as any);
}

/** null : la dépense est permise. Sinon, le résultat du passage à rendre tel quel. */
export async function gardeDepense(userId: string): Promise<ResultatPassage | null> {
  if (!(await aAccesActif(userId))) {
    return { statut: "rien_a_faire", resume: "Abonnement inactif : aucune recherche automatique." };
  }
  if (await isAiBlocked(userId)) {
    return { statut: "rien_a_faire", resume: "Budget du mois atteint : recherche automatique en pause jusqu'au mois prochain." };
  }
  return null;
}
