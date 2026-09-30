import { db } from "../../db";
import { and, eq, inArray, or } from "drizzle-orm";
import { projectLinks, campaigns, projects } from "@shared/schema";
import { anglesDepuisPhases, type Articulation } from "./links";

/** Les statuts de campagne qu'on propose d'articuler. `completed` est exclu. */
export const STATUTS_ARTICULABLES = ["draft", "active", "running"] as const;

/**
 * Les articulations proposables pour une marque : pour chacun de ses liens, les
 * campagnes vivantes de la marque liée, réduites à ce qui peut entrer dans un prompt.
 *
 * Quand la marque n'a AUCUN lien, on rend une liste vide sans interroger les
 * campagnes. C'est ce qui garantit qu'une marque sans lien produit exactement la
 * même génération qu'avant ce chantier.
 */
export async function articulationsDisponibles(userId: string, projectId: number): Promise<Articulation[]> {
  const liens = await db
    .select()
    .from(projectLinks)
    .where(and(
      eq(projectLinks.userId, userId),
      or(eq(projectLinks.fromProjectId, projectId), eq(projectLinks.toProjectId, projectId)),
    ));

  if (liens.length === 0) return [];

  const out: Articulation[] = [];
  for (const lien of liens) {
    const sortant = lien.fromProjectId === projectId;
    const autreId = sortant ? lien.toProjectId : lien.fromProjectId;

    const [autre] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, autreId));
    if (!autre) continue; // marque supprimée entre-temps : on saute, sans bruit

    const vivantes = await db
      .select()
      .from(campaigns)
      .where(and(
        eq(campaigns.userId, userId),
        eq(campaigns.projectId, autreId),
        inArray(campaigns.status, [...STATUTS_ARTICULABLES]),
      ));

    for (const c of vivantes) {
      out.push({
        lien: { roleAmont: lien.roleAmont, roleAval: lien.roleAval, nature: lien.nature },
        sens: sortant ? "nourrit" : "estNourriePar",
        campagne: {
          id: c.id,
          marque: autre.name,
          name: c.name,
          objective: c.objective,
          coreMessage: c.coreMessage,
          angles: anglesDepuisPhases(c.phases),
        },
      });
    }
  }
  return out;
}
