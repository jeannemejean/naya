// Compléter un mois du registre de mesure : la logique partagée par la route
// POST /api/mesure/:projectId/mois/:mois/completer et l'agent (outil saisir_mesure).
// Corps de la route déplacé à l'identique ; contrat : refus attendu en
// `{ ok: false, status, message }`, erreur imprévue levée (la route en fait un 500).
import { storage } from "../../storage";
import type { MesureMensuelle } from "@shared/schema";
import { KIND_BILAN } from "./catalogues";
import { moisPrecedent } from "./calculs";
import { moisValide } from "./saisie";
import { routineBilanPour } from "./bilan";
import { completerMois } from "./phrase";

export type Refus = { ok: false; status: number; message: string };

const AVANCE_MS = 5 * 60_000;
const moisCourant = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const cleRoutine = (projectId: number) => `project:${projectId}`;

/**
 * Crée la routine (active) au premier mois enregistré ; une pause choisie est respectée. Si un
 * mois clos vient d'être saisi (après le passage du 2, par exemple), le prochain bilan est
 * avancé de quelques minutes plutôt que d'attendre le mois suivant.
 */
export async function assurerRoutine(userId: string, projectId: number, moisEcrits: string[]) {
  await storage.ensureRoutine(routineBilanPour({ userId, projectId }, new Date()) as any);
  if (!moisEcrits.some((m) => m <= moisPrecedent(moisCourant()))) return;
  const r = await storage.getRoutineByCible(userId, KIND_BILAN, cleRoutine(projectId));
  const bientot = new Date(Date.now() + AVANCE_MS);
  if (r?.actif && (!r.prochainPassage || new Date(r.prochainPassage) > bientot)) {
    await storage.updateRoutine(r.id, userId, { prochainPassage: bientot } as any);
  }
}

/** Le mois tel qu'il est enregistré (ou undefined), projet déjà vérifié. */
export async function lireMoisMesure(userId: string, projetId: number, mois: string): Promise<MesureMensuelle | undefined> {
  return (await storage.getMesures(userId, projetId, 600)).find((l) => l.mois === mois);
}

// Compléter un mois : seuls les chiffres envoyés sont écrits (phrase à Naya, compagnon, agent).
export async function completerMesure(
  userId: string,
  projetId: number,
  mois: unknown,
  champs: unknown,
): Promise<{ ok: true; ligne: MesureMensuelle } | Refus> {
  const projet = Number.isInteger(projetId) && projetId > 0 ? await storage.getProject(projetId, userId) : undefined;
  if (!projet) return { ok: false, status: 404, message: "not_found" };
  if (!moisValide(mois)) return { ok: false, status: 400, message: "mois_invalide" };
  const existant = await lireMoisMesure(userId, projet.id, mois);
  const v = completerMois(existant as any, (champs && typeof champs === "object" ? champs : {}) as Record<string, unknown>);
  if (!v.ok) return { ok: false, status: 400, message: v.erreur };
  const ligne = await storage.upsertMesure(userId, projet.id, mois, { ...v.valeur, source: "manuel" });
  await assurerRoutine(userId, projet.id, [mois]);
  return { ok: true, ligne };
}
