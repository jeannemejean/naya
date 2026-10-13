// server/services/rapports/routine.ts — chaque mois, Naya prépare le brouillon du rapport du
// mois écoulé pour un projet client et prévient l'utilisatrice. Rien ne part au client : elle
// relit, corrige et publie elle-même.
import type { Routine } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import { prochainPassageApres } from "../routines/temps";
import { porteeDe } from "../connexions/portee";
import { libelleMois, moisPrecedent } from "../mesure/calculs";
import type { ResultatPreparation } from "./rediger";

export const KIND_RAPPORT = "rapport_client";
/** Le 2 du mois (cadence mensuelle), deux heures après le bilan de la Mesure (5 h UTC). */
export const HEURE_RAPPORT_UTC = 7;

export function routineRapportPour(p: { userId: string; projectId: number }, maintenant: Date, actif = true) {
  return {
    userId: p.userId, projectId: p.projectId, kind: KIND_RAPPORT,
    cible: { projectId: p.projectId }, cibleCle: `project:${p.projectId}`,
    cadence: "mensuelle", heureUtc: HEURE_RAPPORT_UTC, actif,
    prochainPassage: prochainPassageApres("mensuelle", HEURE_RAPPORT_UTC, maintenant),
  };
}

export interface DepsRoutineRapport {
  getProject(id: number, userId: string): Promise<any>;
  getRapport(userId: string, projectId: number, mois: string): Promise<{ statut: string } | undefined>;
  preparer(userId: string, projectId: number, mois: string): Promise<ResultatPreparation>;
  maintenant(): Date;
}

export async function executerRapport(routine: Routine, deps: DepsRoutineRapport): Promise<ResultatPassage> {
  const projectId = Number((routine.cible as any)?.projectId);
  const projet = Number.isInteger(projectId) ? await deps.getProject(projectId, routine.userId) : null;
  if (!projet) return { statut: "rien_a_faire", resume: "Ce projet n'existe plus : rapports arrêtés.", desactiver: true };
  if (porteeDe(projet) == null) return { statut: "rien_a_faire", resume: "Ce projet n'est plus un projet client : rapports arrêtés.", desactiver: true };

  const now = deps.maintenant();
  const mois = moisPrecedent(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  const client = projet.clientName || projet.name;
  if (await deps.getRapport(routine.userId, projectId, mois)) {
    return { statut: "rien_a_faire", resume: `Le rapport de ${libelleMois(mois)} pour ${client} existe déjà.` };
  }

  const r = await deps.preparer(routine.userId, projectId, mois);
  switch (r.statut) {
    case "ok":
      return { statut: "ok", notifier: true, resume: `Le rapport de ${libelleMois(mois)} pour ${client} est prêt à relire.`, details: { mois } };
    case "refus":
      return r.raison;
    case "rien":
      return { statut: "rien_a_faire", resume: `Aucune donnée pour ${client} en ${libelleMois(mois)} : pas de rapport.` };
    case "illisible":
      return { statut: "erreur", resume: "Réponse de l'IA illisible : rapport non préparé." };
    case "deja_publie":
      return { statut: "rien_a_faire", resume: `Le rapport de ${libelleMois(mois)} pour ${client} est déjà publié.` };
    default:
      return { statut: "rien_a_faire", resume: "Rapport non préparé.", desactiver: r.statut === "introuvable" || r.statut === "projet_perso" };
  }
}
