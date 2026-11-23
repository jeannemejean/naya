// Types et petites aides partagés par les sections de la page Vie perso.
import type { PlanRepas, ProfilViePerso, ContenuActivite } from "@shared/vie-perso";

export type Plan = { statut: "brouillon" | "valide"; contenu: PlanRepas; coches: number[] };
export type Preparation = { semaine: string; statut: "en_cours" | "fini" | "erreur"; erreur?: string };
export type ReponsePlan = { plan: Plan | null; preparation: Preparation | null };

export type Membre = {
  id: number; prenom: string; estMoi: boolean; regime: string; exclusions: string; aime: string; aimePas: string; repasMaison: string;
};
export type Recette = { id: number; titre: string; lien: string | null; notes: string | null; avis: "aime" | "bof" | "non" };
export type ReponseProfil = { profil: ProfilViePerso; membres: Membre[]; recettes: Recette[] };

export type Activite = {
  id: number; titre: string; description: string; avecQui: string; quand: "soir" | "weekend" | "indifferent";
  dateCible: string | null; statut: "a_planifier" | "planifiee" | "faite"; contenu: ContenuActivite | null;
};

/** Code d'erreur d'une réponse apiRequest (« 409: {"message":"x"} ») ; « erreur » à défaut. */
export function codeErreur(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return /"message":"(\w+)"/.exec(m)?.[1] ?? "erreur";
}

export const enListe = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
