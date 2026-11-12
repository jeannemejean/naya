// Interrupteur du fil conducteur : activé par utilisatrice via FIL_CONDUCTEUR_USERS (ids séparés
// par des virgules), puis date de mise en route posée une seule fois en base.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { userPreferences } from "@shared/schema";

/** Vrai si l'utilisatrice figure dans FIL_CONDUCTEUR_USERS. Variable vide ou absente : faux. */
export function filActifPour(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const ids = (env.FIL_CONDUCTEUR_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

/**
 * Pose `filConducteurDepuis` s'il est vide et renvoie la valeur en base. `nouveau` n'est vrai que
 * si CET appel a posé la date (sert à déclencher une proposition unique). La mise à jour est
 * conditionnée à « encore vide » : deux appels concurrents ne se piétinent pas.
 */
export async function miseEnRoute(userId: string, maintenant: Date): Promise<{ depuis: Date; nouveau: boolean }> {
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
  const posees = await db.update(userPreferences)
    .set({ filConducteurDepuis: maintenant })
    .where(and(eq(userPreferences.userId, userId), isNull(userPreferences.filConducteurDepuis)))
    .returning({ filConducteurDepuis: userPreferences.filConducteurDepuis });
  if (posees.length > 0) return { depuis: posees[0].filConducteurDepuis ?? maintenant, nouveau: true };
  const [ligne] = await db.select({ filConducteurDepuis: userPreferences.filConducteurDepuis })
    .from(userPreferences).where(eq(userPreferences.userId, userId));
  return { depuis: ligne?.filConducteurDepuis ?? maintenant, nouveau: false };
}
