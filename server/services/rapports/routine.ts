// server/services/rapports/routine.ts — chaque mois, Naya prépare le brouillon du rapport du
// mois écoulé pour un projet client et prévient l'utilisatrice. Rien ne part au client : elle
// relit, corrige et publie elle-même.
import type { Routine } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import { prochainPassageApres } from "../routines/temps";
import { porteeDe } from "../connexions/portee";
import { libelleMois, moisPrecedent } from "../mesure/calculs";
import type { ResultatPreparation } from "./rediger";
import { moisDe } from "./donnees";

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
  langue?(userId: string): Promise<"fr" | "en">;
}

const moisEn = (m: string) => libelleMois(m, "en-US");
const TEXTES = {
  fr: {
    disparu: "Ce projet n'existe plus : rapports arrêtés.",
    perso: "Ce projet n'est plus un projet client : rapports arrêtés.",
    existe: (m: string, c: string) => `Le rapport de ${libelleMois(m)} pour ${c} existe déjà.`,
    pret: (m: string, c: string) => `Le rapport de ${libelleMois(m)} pour ${c} est prêt à relire.`,
    rien: (m: string, c: string) => `Aucune donnée pour ${c} en ${libelleMois(m)} : pas de rapport.`,
    illisible: "Réponse de l'IA illisible : rapport non préparé.",
    publie: (m: string, c: string) => `Le rapport de ${libelleMois(m)} pour ${c} est déjà publié.`,
    non: "Rapport non préparé.",
  },
  en: {
    disparu: "This project no longer exists: reports stopped.",
    perso: "This project is no longer a client project: reports stopped.",
    existe: (m: string, c: string) => `The ${moisEn(m)} report for ${c} already exists.`,
    pret: (m: string, c: string) => `The ${moisEn(m)} report for ${c} is ready to review.`,
    rien: (m: string, c: string) => `No data for ${c} in ${moisEn(m)}: no report.`,
    illisible: "Unreadable AI answer: report not prepared.",
    publie: (m: string, c: string) => `The ${moisEn(m)} report for ${c} is already published.`,
    non: "Report not prepared.",
  },
};

export async function executerRapport(routine: Routine, deps: DepsRoutineRapport): Promise<ResultatPassage> {
  const projectId = Number((routine.cible as any)?.projectId);
  const projet = Number.isInteger(projectId) ? await deps.getProject(projectId, routine.userId) : null;
  const T = TEXTES[(await deps.langue?.(routine.userId)) ?? "fr"];
  if (!projet) return { statut: "rien_a_faire", resume: T.disparu, desactiver: true };
  if (porteeDe(projet) == null) return { statut: "rien_a_faire", resume: T.perso, desactiver: true };

  const now = deps.maintenant();
  // Le mois écoulé à Paris (comme l'écran et la validation des routes), pas en UTC.
  const mois = moisPrecedent(moisDe(now));
  const client = projet.clientName || projet.name;
  if (await deps.getRapport(routine.userId, projectId, mois)) {
    return { statut: "rien_a_faire", resume: T.existe(mois, client) };
  }

  const r = await deps.preparer(routine.userId, projectId, mois);
  switch (r.statut) {
    case "ok":
      return { statut: "ok", notifier: true, resume: T.pret(mois, client), details: { mois }, lien: `/projects/${projectId}?onglet=client` };
    case "refus":
      return r.raison;
    case "rien":
      return { statut: "rien_a_faire", resume: T.rien(mois, client) };
    case "illisible":
      return { statut: "erreur", resume: T.illisible };
    case "deja_publie":
      return { statut: "rien_a_faire", resume: T.publie(mois, client) };
    default:
      return { statut: "rien_a_faire", resume: T.non, desactiver: r.statut === "introuvable" || r.statut === "projet_perso" };
  }
}
