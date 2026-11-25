// Relances des envois aux marques : le jour venu, une tâche courte « Relancer {marque} : {objet} ».
// Matérialisée au moment où la journée est préparée (comme les rituels), jamais par un job de fond.
// Naya ne relance jamais la marque elle-même : elle rappelle à l'utilisatrice de le faire.
import type { Envoi } from "@shared/schema";
import { STATUTS_A_RELANCER } from "@shared/envois";

export const SOURCE_RELANCE = "relance_envoi";
export const DUREE_RELANCE_MIN = 15;

export const titreRelance = (e: Pick<Envoi, "marque" | "objet">) => `Relancer ${e.marque} : ${e.objet}`;

export interface DepsRelances {
  /** Envois dont la relance est due à cette date OU AVANT (rattrapage d'un jour non ouvert). */
  envoisARelancer(userId: string, date: string): Promise<Envoi[]>;
  /** Toutes ses tâches de relance (non archivées), quelle que soit leur date. */
  tachesDeRelance(userId: string): Promise<Array<{ id: number; title: string; source?: string | null; completed?: boolean | null; scheduledDate?: unknown; userId?: string }>>;
  creerTache(t: Record<string, unknown>): Promise<unknown>;
  /** Note que la tâche de relance de cette date a été créée (supprimée à la main, elle ne revient pas). */
  marquerRelanceCreee(userId: string, envoiId: number, jour: string): Promise<void>;
}

export const depsRelances: DepsRelances = {
  envoisARelancer: async (userId, date) => (await import("./store")).envoisARelancer(userId, date),
  tachesDeRelance: async (userId) => (await import("./store")).tachesDeRelance(userId, SOURCE_RELANCE),
  creerTache: async (t) => (await import("../../storage")).storage.createTask(t as any),
  marquerRelanceCreee: async (userId, envoiId, jour) => (await import("./store")).marquerRelanceCreee(userId, envoiId, jour),
};

const jourDe = (v: unknown) => String(v ?? "").slice(0, 10);

/**
 * Crée les tâches de relance dues (aujourd'hui ou en retard), datées d'aujourd'hui. Une relance
 * n'est créée qu'une fois par date de relance (`relanceCreeePour`) : supprimée à la main, elle ne
 * revient pas. Filet pour les envois d'avant ce champ : pas recréée si une tâche de relance de cet
 * envoi attend encore, ou a été faite depuis la date prévue. Renvoie le nombre créé.
 */
export async function materializeRelances(userId: string, date: string, deps: DepsRelances = depsRelances): Promise<number> {
  const dus = (await deps.envoisARelancer(userId, date))
    .filter((e) => e.userId === userId && STATUTS_A_RELANCER.has(e.statut) && !!e.prochaineRelance && e.prochaineRelance <= date);
  if (dus.length === 0) return 0;
  const existantes = (await deps.tachesDeRelance(userId)).filter((t) => t.source === SOURCE_RELANCE && (t.userId === undefined || t.userId === userId));
  let creees = 0;
  for (const e of dus) {
    // Déjà créée pour cette date de relance (même si elle l'a supprimée depuis) : rien.
    if ((e as any).relanceCreeePour && String((e as any).relanceCreeePour) === String(e.prochaineRelance)) continue;
    const titre = titreRelance(e);
    const dejaLa = existantes.some((t) => t.title === titre && (!t.completed || jourDe(t.scheduledDate) >= String(e.prochaineRelance)));
    if (dejaLa) continue;
    try {
      const t = {
        userId, projectId: e.projectId ?? null, title: titre, scheduledDate: date,
        estimatedDuration: DUREE_RELANCE_MIN, source: SOURCE_RELANCE, schedulingMode: "flexible",
        type: "admin", category: "communication", taskEnergyType: "execution", priority: 2,
      };
      await deps.creerTache(t);
      await deps.marquerRelanceCreee(userId, e.id, String(e.prochaineRelance));
      existantes.push({ id: -1, title: titre, source: SOURCE_RELANCE, completed: false, scheduledDate: date });
      creees++;
    } catch (err: any) {
      console.error(`[Relances] envoi ${e.id} le ${date} :`, err?.message);
    }
  }
  return creees;
}

/** Relance devenue inutile (date changée, réponse reçue…) : retire ses tâches NON faites, quelle que soit leur date. */
export async function retirerRelanceNonFaite(
  userId: string,
  e: Pick<Envoi, "marque" | "objet">,
  deps: Pick<DepsRelances, "tachesDeRelance"> = depsRelances,
): Promise<number> {
  const { storage } = await import("../../storage");
  let n = 0;
  for (const t of (await deps.tachesDeRelance(userId)) as any[]) {
    if (t.userId === userId && t.source === SOURCE_RELANCE && t.title === titreRelance(e) && !t.completed) {
      await storage.deleteTask(t.id);
      n++;
    }
  }
  return n;
}
