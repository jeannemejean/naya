// Le langage commun du planning (spec 2026-11-19-chef-d-orchestre-design.md §1-2). PUR : aucune
// base, aucune horloge (le jour est passé en argument).
//
// Chaque tâche, quelle que soit l'entité qui l'a créée, a une contrainte : une échéance DURE (une
// date extérieure qui ne se négocie pas : post, atelier, relance promise, clôture du vendredi,
// jalon d'appel d'offres), SOUPLE (son dueDate) ou aucune. Un dueDate dépassé de plus de
// PEREMPTION_JOURS n'est plus une échéance utile : la tâche va au tri du vivier (reprise).
import { echeanceAtelier } from "@shared/atelier";
import { echeanceTache } from "../campagne/production";
import { parisTodayString } from "../../utils/timezone";

export const PEREMPTION_JOURS = 14;

export type Durete = "dure" | "souple";
export interface Contrainte { echeance: string | null; durete: Durete | null }

export interface TacheContrainte {
  title?: string | null;
  contentId?: number | null;
  taskType?: string | null;
  source?: string | null;
  actionData?: unknown;
  scheduledDate?: string | null;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
}

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const AUCUNE: Contrainte = { echeance: null, durete: null };

function jourParis(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : parisTodayString(d);
}

function moinsJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** L'échéance dure de la tâche, ou null. `jourPost` : le jour de publication de son post. */
function echeanceDure(t: TacheContrainte, jourPost?: string | null): string | null {
  if (t.contentId != null) return echeanceTache(t.title, jourPost ?? null);
  const atelier = echeanceAtelier({ taskType: t.taskType, actionData: t.actionData });
  if (atelier) return atelier;
  if (t.source === "relance_prospect" && t.scheduledDate && JOUR.test(t.scheduledDate)) return t.scheduledDate;
  if (t.source === "fil_cloture") return jourParis(t.createdAt);
  const e = (t.actionData as { echeanceDure?: unknown } | null)?.echeanceDure;
  return typeof e === "string" && JOUR.test(e) ? e : null;
}

export function contrainteDe(t: TacheContrainte, ctx: { aujourdhui: string; jourPost?: string | null }): Contrainte {
  const dure = echeanceDure(t, ctx.jourPost);
  if (dure) return { echeance: dure, durete: "dure" };
  // Une étape de post sans post lisible n'a pas d'échéance souple à inventer.
  if (t.contentId != null) return AUCUNE;
  const souple = jourParis(t.dueDate);
  if (!souple || souple < moinsJours(ctx.aujourdhui, PEREMPTION_JOURS)) return AUCUNE;
  return { echeance: souple, durete: "souple" };
}

/** Vrai si la tâche est au vivier : échéance souple dépassée de plus de PEREMPTION_JOURS, sans échéance dure. */
export function estPerimee(t: TacheContrainte, aujourdhui: string): boolean {
  if (t.contentId != null || echeanceDure(t)) return false;
  const souple = jourParis(t.dueDate);
  return !!souple && souple < moinsJours(aujourdhui, PEREMPTION_JOURS);
}

export interface Rangeable { contrainte: Contrainte; priority?: number | null; scheduledDate?: string | null }

/**
 * Ordre de qui garde sa place : l'échéance la plus proche d'abord (dure avant souple à date
 * égale), puis la priorité (1 avant 3), puis la tâche planifiée depuis le plus longtemps.
 */
export function comparerRang(a: Rangeable, b: Rangeable): number {
  const ea = a.contrainte.echeance ?? "9999-12-31";
  const eb = b.contrainte.echeance ?? "9999-12-31";
  if (ea !== eb) return ea < eb ? -1 : 1;
  const da = a.contrainte.durete === "dure" ? 0 : 1;
  const db = b.contrainte.durete === "dure" ? 0 : 1;
  if (da !== db) return da - db;
  const pa = a.priority ?? 3;
  const pb = b.priority ?? 3;
  if (pa !== pb) return pa - pb;
  return String(a.scheduledDate ?? "9999").localeCompare(String(b.scheduledDate ?? "9999"));
}

/**
 * Une tâche planifiée APRÈS son échéance (dure ou souple non périmée) revient à `aujourdhui` ; le
 * rangement par rang décide ensuite ce qui reste. Sans ça, une tâche partie loin n'en revenait
 * jamais (le re-tassage ne fait que pousser vers l'avant). Étapes de posts et ateliers exclus :
 * ils ont leur propre placement. Rend le jour cible, ou null.
 */
export function aRamener(t: TacheContrainte, aujourdhui: string): string | null {
  if (t.contentId != null || echeanceAtelier({ taskType: t.taskType, actionData: t.actionData })) return null;
  if (!t.scheduledDate || t.scheduledDate <= aujourdhui) return null;
  const { echeance } = contrainteDe(t, { aujourdhui });
  return echeance && t.scheduledDate > echeance ? aujourdhui : null;
}

/**
 * Le jour où revient une tâche ramenée : aujourd'hui s'il est travaillé, sinon le prochain jour
 * travaillé. Null quand le re-tassage part d'un jour plus tard (`depuis` > aujourd'hui : reprise
 * du soir, semaine, campagne…) : les tâches d'aujourd'hui ne sont alors pas chargées, et une
 * tâche ramenée y tomberait sur des créneaux occupés.
 */
export function jourDeRamenee(
  aujourdhui: string, depuis: string, estTravaille: (j: string) => boolean, prochainJourTravaille: (j: string) => string,
): string | null {
  if (depuis > aujourdhui) return null;
  return estTravaille(aujourdhui) ? aujourdhui : prochainJourTravaille(aujourdhui);
}
