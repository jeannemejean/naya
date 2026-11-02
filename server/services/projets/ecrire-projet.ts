// Écrire un projet ou ses jalons : la logique partagée par les routes (POST /api/projects,
// POST /api/projects/:id/milestone-chain, POST /api/milestones/:id/confirm) et l'agent.
// Les corps des routes ont été déplacés ici à l'identique : rien ne dépend de `req`.
//
// Contrat (le même que services/taches/ecrire-tache.ts) : un refus attendu revient en
// `{ ok: false, status, message }`, que la route traduit tel quel en réponse HTTP. Une
// erreur imprévue (corps invalide pour `insertProjectSchema`, base indisponible…) est levée :
// la route la transforme en 500, exactement comme avant le déplacement.

import { storage } from "../../storage";
import { insertProjectSchema, type Project, type ProjectMilestone } from "@shared/schema";
import { confirmMilestone, createMilestoneChain } from "../milestone-engine";

export type Refus = { ok: false; status: number; message: string };

/** Crée un projet. Le tout premier projet devient le projet principal et le projet actif. */
export async function creerProjet(
  userId: string,
  donnees: Record<string, unknown> | undefined,
): Promise<{ ok: true; projet: Project }> {
  const projectData = insertProjectSchema.parse({ ...donnees, userId });
  const existingProjects = await storage.getProjects(userId);
  if (existingProjects.length === 0) {
    projectData.isPrimary = true;
    projectData.priorityLevel = 'primary';
  }
  const project = await storage.createProject(projectData);
  if (existingProjects.length === 0) {
    await storage.upsertUserPreferences(userId, { activeProjectId: project.id });
  }
  return { ok: true, projet: project };
}

/**
 * Crée une chaîne de jalons en bloc (le premier actif, les suivants `locked`). Aucune tâche
 * n'est créée ici (createMilestoneTask est un no-op) : jamais de tâche pour un jalon `locked`.
 */
export async function creerChaineJalons(
  userId: string,
  projectId: number,
  corps: any, // le corps de la requête : { milestones }
): Promise<{ ok: true; jalons: ProjectMilestone[] } | Refus> {
  if (isNaN(projectId)) return { ok: false, status: 400, message: "projectId invalide" };
  const { milestones } = corps;
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { ok: false, status: 400, message: "milestones[] requis" };
  }
  // Vérifier que chaque jalon a un title
  const valid = milestones.every((m: any) => typeof m?.title === 'string' && m.title.trim());
  if (!valid) return { ok: false, status: 400, message: "Chaque jalon doit avoir un title" };
  // Vérifier que le projet appartient à l'utilisateur
  const project = await storage.getProject(projectId, userId);
  if (!project) return { ok: false, status: 404, message: "Projet introuvable" };
  const chain = await createMilestoneChain(projectId, userId, milestones);
  return { ok: true, jalons: chain };
}

/** Confirmation manuelle d'un jalon (après vérification qu'il est à l'utilisatrice). */
export async function confirmerJalon(
  userId: string,
  id: number,
): Promise<{ ok: true; jalon: ProjectMilestone | null } | Refus> {
  const milestone = await storage.getMilestone(id);
  if (!milestone || milestone.userId !== userId) {
    return { ok: false, status: 404, message: "Jalon introuvable" };
  }
  const updated = await confirmMilestone(id);
  return { ok: true, jalon: updated };
}
