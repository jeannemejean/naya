// Les points faits en séance de redémarrage, par projet : un projet revu (fait ou passé) a bougé
// à cette date, même sans tâche cochée. Le matin s'en sert pour ne plus dire « ça n'avance plus »
// d'un projet dont elle vient de faire le point (27 nov. 2026).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { seancesRedemarrage } from "@shared/schema";

type LigneSeance = { statut: string; termineeAt: Date | null; updatedAt: Date | null; projets: unknown };

/** Pur : la date du dernier point par projet (séances terminées ou en cours). */
export function pointsDe(seances: LigneSeance[]): Map<number, Date> {
  const res = new Map<number, Date>();
  for (const s of seances) {
    if (s.statut !== "terminee" && s.statut !== "en_cours") continue;
    const quand = s.termineeAt ?? s.updatedAt;
    if (!quand) continue;
    for (const p of (Array.isArray(s.projets) ? s.projets : []) as Array<{ projectId: number; etat: string }>) {
      if (p.etat !== "fait" && p.etat !== "saute") continue;
      const avant = res.get(p.projectId);
      if (!avant || avant.getTime() < quand.getTime()) res.set(p.projectId, new Date(quand));
    }
  }
  return res;
}

export async function pointsParProjet(userId: string): Promise<Map<number, Date>> {
  const lignes = await db.select({
    statut: seancesRedemarrage.statut, termineeAt: seancesRedemarrage.termineeAt,
    updatedAt: seancesRedemarrage.updatedAt, projets: seancesRedemarrage.projets,
  }).from(seancesRedemarrage)
    .where(and(eq(seancesRedemarrage.userId, userId), inArray(seancesRedemarrage.statut, ["terminee", "en_cours"])));
  return pointsDe(lignes as LigneSeance[]);
}

/** Une lecture ratée n'efface rien : sans points, le matin compte comme avant. */
export async function pointsParProjetSurs(userId: string): Promise<Map<number, Date>> {
  try {
    return await pointsParProjet(userId);
  } catch (e: any) {
    console.error("[redemarrage] points de séance :", e?.message ?? e);
    return new Map();
  }
}
