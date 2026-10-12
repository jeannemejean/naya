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
import type { ExecuteurRoutine } from "./types";

export const REGISTRE: Record<string, ExecuteurRoutine> = {
  [KIND_SOURCING]: executerSourcing,
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

/** Exécute une routine et consigne le passage. Ne lève jamais. */
export async function executerUne(r: Routine, executer: ExecuteurRoutine, maintenant = new Date()) {
  const debut = new Date();
  try {
    const res = await executer(r);
    await storage.addRoutineRun({ routineId: r.id, userId: r.userId, debut, fin: new Date(), statut: res.statut, resume: res.resume, details: res.details ?? null });
    await storage.updateRoutine(r.id, r.userId, {
      dernierPassage: maintenant,
      derniereErreur: res.statut === "erreur" ? res.resume : null,
      ...(res.desactiver ? { actif: false } : {}),
    });
    if (res.notifier) await notifierRoutine(r.userId, res.resume).catch(() => {});
    return res;
  } catch (e: any) {
    const raison = `Échec de la routine : ${e?.message || e}`;
    console.error(`[routines] routine ${r.id} (${r.kind}) :`, e?.message || e);
    await storage.addRoutineRun({ routineId: r.id, userId: r.userId, debut, fin: new Date(), statut: "erreur", resume: raison, details: null }).catch(() => {});
    await storage.updateRoutine(r.id, r.userId, { dernierPassage: maintenant, derniereErreur: raison }).catch(() => {});
    return { statut: "erreur" as const, resume: raison };
  }
}

/** Valeurs d'une routine de sourcing pour une campagne (création idempotente). */
export function routineSourcingPour(campaign: { id: number; userId: string; projectId?: number | null }, maintenant: Date) {
  return {
    userId: campaign.userId, projectId: campaign.projectId ?? null, kind: KIND_SOURCING,
    cible: { campaignId: campaign.id }, cibleCle: cleSourcing(campaign.id),
    cadence: "quotidienne", heureUtc: HEURE_SOURCING_UTC, actif: true,
    prochainPassage: prochainPassageApres("quotidienne", HEURE_SOURCING_UTC, maintenant),
  };
}

/** Chaque campagne active a sa routine de sourcing (sans toucher à celles qui existent). */
export async function assurerRoutinesSourcing(maintenant = new Date()): Promise<void> {
  const campagnes = await storage.getAllActiveProspectionCampaigns();
  for (const c of campagnes) {
    await storage.ensureRoutine(routineSourcingPour(c as any, maintenant) as any).catch((e: any) =>
      console.error(`[routines] création de la routine de sourcing (campagne ${c.id}) :`, e?.message));
  }
}

const QUINZE_MINUTES = 15 * 60_000;

export function scheduleRoutines() {
  const tour = async () => {
    try {
      await assurerRoutinesSourcing();
      const n = await executerRoutinesDues(new Date());
      if (n > 0) console.log(`[routines] ${n} routine(s) exécutée(s)`);
    } catch (e: any) {
      console.error("[routines] tour échoué :", e?.message || e);
    }
  };
  // Premier tour une minute après le démarrage (laisse le serveur répondre au healthcheck).
  setTimeout(() => { void tour(); setInterval(() => void tour(), QUINZE_MINUTES); }, 60_000);
}
