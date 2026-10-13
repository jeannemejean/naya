// Types de la page « Fondations » (miroir de GET /api/fondations/:projectId).
import type { RoutineDTO } from "@/components/routines/RoutineCard";

export type Section = "offre" | "motivations" | "kpis" | "plan";
export type Statut = "vide" | "propose" | "valide";

export type Offre = { nom: string; description: string; prix?: string; pourquoi: string; existe: boolean };
export type Motivation = {
  cle: string; nom: string; description: string; angle: string;
  accroches: string[]; preuves: string[]; objections: string[]; formats: string[];
};
export type Kpi = { cle: string; nom: string; etage: string; definition: string; frequence: string; cible?: string; source?: string };
export type Brique = { cle: string; statut: string; raison: string; action: string };
export type Plan = { maturite: string; resume: string; briques: Brique[] };
export type Releve = { date: string; valeur: number };

export type Catalogues = {
  formats: string[]; etages: string[]; frequences: string[]; maturites: string[]; statutsBrique: string[];
  briques: Array<{ cle: string; moteur: "creation" | "captation" | "socle"; page: string | null }>;
};

export type ContenuEtiquete = {
  id: number; title: string; status: string; publishedAt: string | null;
  angle: string | null; formatCreatif: string | null; etiquetage: string | null;
};

export type DonneesFondations = {
  fondations: {
    offre: Offre | null; motivations: Motivation[]; kpis: Kpi[]; plan: Plan | null;
    kpiReleves: Record<string, Releve[]>; statuts: Record<Section, Statut>;
  };
  catalogues: Catalogues;
  /** Aucune fondation encore enregistrée : l'onglet demande à Naya de les préparer. */
  aRemplir?: boolean;
  /** Série calculée depuis le registre mensuel, pour les KPI reliés (`source`). */
  kpiAuto: Record<string, Releve[]>;
  routine: RoutineDTO | null;
  couverture: {
    lignes: Array<{ cle: string; nom: string; contenus: number; publies: number; score: number | null; retiree?: boolean }>;
    horsMotivations: number; nonEtiquetes: number; jamaisExploitees: string[];
  };
  contenus: ContenuEtiquete[];
};

/** « 400: {"message":"x"} » → { message: "x" }. */
export function corpsErreur(e: unknown): { message?: string; raison?: string } {
  const m = e instanceof Error ? e.message : String(e ?? "");
  try { return JSON.parse(m.replace(/^\d{3}:\s*/, "")); } catch { return {}; }
}

/** Une ligne par élément ⇄ liste. */
export const versLignes = (l: string[] | undefined) => (l || []).join("\n");
export const depuisLignes = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
