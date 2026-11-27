// Règle produit (Jeanne, 27 nov. 2026) : chaque tâche est liée à un projet, ou au perso. Une
// tâche créée sans projet (tâches de Naya qui touchent plusieurs projets : atelier contenu,
// clôture du vendredi, reconnexion d'un compte, décision d'appel d'offres…) va au projet
// principal. Appliqué dans storage.createTask : tous les chemins de création passent par là.
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { projects } from "@shared/schema";

/** Les tâches de la vie perso n'ont pas de projet : elles sont « perso ». */
export const SOURCES_PERSO: readonly string[] = ["vie_perso"];

type ProjetMin = { id: number; priorityLevel?: string | null; projectStatus?: string | null };
const actif = (p: ProjetMin) => p.projectStatus == null || p.projectStatus === "active";

/** Pur : le projet principal actif, sinon le premier actif, sinon le premier ; null sans projet. */
export function projetParDefautDe(projets: ProjetMin[]): number | null {
  const tries = [...projets].sort((a, b) => a.id - b.id);
  return (tries.find((p) => actif(p) && p.priorityLevel === "primary") ?? tries.find(actif) ?? tries[0])?.id ?? null;
}

export async function projetParDefaut(userId: string): Promise<number | null> {
  const lignes = await db.select({ id: projects.id, priorityLevel: projects.priorityLevel, projectStatus: projects.projectStatus })
    .from(projects).where(and(eq(projects.userId, userId)));
  return projetParDefautDe(lignes);
}

/** La tâche, avec le projet par défaut si elle n'en a pas et n'est pas perso. Ne bloque jamais la création. */
export async function avecProjetParDefaut<T extends { userId?: string | null; projectId?: number | null; source?: string | null }>(
  tache: T, charger: (userId: string) => Promise<number | null> = projetParDefaut,
): Promise<T> {
  if (!tache.userId || tache.projectId != null || SOURCES_PERSO.includes(tache.source ?? "")) return tache;
  try {
    const id = await charger(tache.userId);
    return id != null ? { ...tache, projectId: id } : tache;
  } catch (e: any) {
    console.error("[taches] projet par défaut :", e?.message ?? e);
    return tache;
  }
}
