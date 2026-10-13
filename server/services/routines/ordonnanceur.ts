/**
 * Ordonnanceur des routines planifiées (couche de pilotage du dossier Acquisition 360).
 *
 * Toutes les 15 minutes : prend les routines dues, AVANCE leur prochain passage avant de les
 * exécuter (mise à jour conditionnelle : deux instances ne lancent jamais le même passage),
 * exécute chaque routine isolément (une erreur n'empêche pas la suivante), consigne le
 * passage, et prévient l'utilisatrice seulement quand il se passe quelque chose.
 */
import type { Routine } from "@shared/schema";
import { storage } from "../../storage";
import { prochainPassageApres } from "./temps";
import { notifierRoutine } from "./notifier";
import { executerSourcing, KIND_SOURCING, cleSourcing } from "./sourcing";
import type { ExecuteurRoutine, ResultatPassage } from "./types";
import { EXECUTEURS_VEILLE } from "../veille/deps";
import { EXECUTEURS_FONDATIONS } from "../fondations/deps";
import { EXECUTEURS_MESURE } from "../mesure/deps";
import { EXECUTEURS_RAPPORTS } from "../rapports/deps";

export const REGISTRE: Record<string, ExecuteurRoutine> = {
  [KIND_SOURCING]: executerSourcing,
  ...EXECUTEURS_VEILLE,
  ...EXECUTEURS_FONDATIONS,
  ...EXECUTEURS_MESURE,
  ...EXECUTEURS_RAPPORTS,
};

const PAR_TOUR = 20;
const HEURE_SOURCING_UTC = 5;

export async function executerRoutinesDues(maintenant: Date, registre: Record<string, ExecuteurRoutine> = REGISTRE): Promise<number> {
  const dues = await storage.getDueRoutines(maintenant, PAR_TOUR);
  let executees = 0;
  for (const r of dues) {
    const executer = registre[r.kind];
    const prochain = prochainPassageApres(r.cadence, r.heureUtc, maintenant);
    if (!(await storage.claimRoutine(r.id, r.prochainPassage ?? null, prochain))) continue;
    if (!executer) {
      console.warn(`[routines] type inconnu « ${r.kind} » (routine ${r.id}) : ignoré`);
      continue;
    }
    executees++;
    await executerUne(r, executer, maintenant);
  }
  return executees;
}

/**
 * Exécute une routine et consigne le passage. Ne lève jamais. Un verrou en base empêche deux
 * passages simultanés de la même routine (ordonnanceur, « Lancer maintenant », autre instance).
 */
export async function executerUne(r: Routine, executer: ExecuteurRoutine, maintenant = new Date()): Promise<ResultatPassage & { dejaEnCours?: boolean }> {
  if (!(await storage.prendreRoutine(r.id))) {
    return { statut: "rien_a_faire", resume: "Un passage est déjà en cours.", dejaEnCours: true };
  }
  const debut = new Date();
  try {
    const res = await executer(r);
    await storage.addRoutineRun({ routineId: r.id, userId: r.userId, debut, fin: new Date(), statut: res.statut, resume: res.resume, details: res.details ?? null });
    await storage.updateRoutine(r.id, r.userId, {
      dernierPassage: maintenant,
      derniereErreur: res.statut === "erreur" ? res.resume : null,
      ...(res.desactiver ? { actif: false } : {}),
    });
    if (res.notifier) await notifierRoutine(r.userId, res.resume, res.lien).catch(() => {});
    return res;
  } catch (e: any) {
    const raison = `Échec de la routine : ${e?.message || e}`;
    console.error(`[routines] routine ${r.id} (${r.kind}) :`, e?.message || e);
    await storage.addRoutineRun({ routineId: r.id, userId: r.userId, debut, fin: new Date(), statut: "erreur", resume: raison, details: null }).catch(() => {});
    await storage.updateRoutine(r.id, r.userId, { dernierPassage: maintenant, derniereErreur: raison }).catch(() => {});
    return { statut: "erreur" as const, resume: raison };
  } finally {
    await storage.libererRoutine(r.id).catch(() => {});
  }
}

/** Valeurs d'une routine de sourcing pour une campagne (création idempotente). */
export function routineSourcingPour(campaign: { id: number; userId: string; projectId?: number | null }, maintenant: Date, actif = true) {
  return {
    userId: campaign.userId, projectId: campaign.projectId ?? null, kind: KIND_SOURCING,
    cible: { campaignId: campaign.id }, cibleCle: cleSourcing(campaign.id),
    cadence: "quotidienne", heureUtc: HEURE_SOURCING_UTC, actif,
    prochainPassage: prochainPassageApres("quotidienne", HEURE_SOURCING_UTC, maintenant),
  };
}

/**
 * Chaque campagne active a sa routine de sourcing (sans toucher à celles qui existent).
 * Une campagne jamais utilisée (aucun prospect : souvent créée automatiquement avec une
 * campagne de contenu) reçoit sa routine EN PAUSE : pas de dépense que l'utilisatrice n'a pas
 * demandée. Elle l'active d'un geste sur la carte « Sourcing automatique ».
 */
export async function assurerRoutinesSourcing(maintenant = new Date()): Promise<void> {
  const campagnes = await storage.getAllActiveProspectionCampaigns();
  for (const c of campagnes) {
    try {
      const utilisee = (await storage.getLeadsByCampaign(c.id, c.userId)).length > 0;
      await storage.ensureRoutine(routineSourcingPour(c as any, maintenant, utilisee) as any);
    } catch (e: any) {
      console.error(`[routines] création de la routine de sourcing (campagne ${c.id}) :`, e?.message);
    }
  }
}

const QUINZE_MINUTES = 15 * 60_000;
const UN_JOUR = 24 * 60 * 60_000;
let tourEnCours = false;
let derniereAssurance = 0;

/**
 * Un tour : routines dues, et une fois par jour la création des routines manquantes.
 * Deux tours ne se chevauchent jamais dans un même processus (un tour peut dépasser 15 min).
 */
export async function tourDeRoutines(maintenant = new Date()): Promise<number | "deja_en_cours"> {
  if (tourEnCours) return "deja_en_cours";
  tourEnCours = true;
  try {
    if (maintenant.getTime() - derniereAssurance >= UN_JOUR) {
      derniereAssurance = maintenant.getTime();
      await assurerRoutinesSourcing(maintenant);
    }
    return await executerRoutinesDues(maintenant);
  } finally {
    tourEnCours = false;
  }
}

export function scheduleRoutines() {
  const tour = async () => {
    try {
      const n = await tourDeRoutines(new Date());
      if (typeof n === "number" && n > 0) console.log(`[routines] ${n} routine(s) exécutée(s)`);
    } catch (e: any) {
      console.error("[routines] tour échoué :", e?.message || e);
    }
  };
  // Premier tour une minute après le démarrage (laisse le serveur répondre au healthcheck).
  setTimeout(() => { void tour(); setInterval(() => void tour(), QUINZE_MINUTES); }, 60_000);
}
