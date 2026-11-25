// Relances des envois aux marques : le jour venu, une tâche courte « Relancer {marque} : {objet} ».
// Matérialisée au moment où la journée est préparée (comme les rituels), jamais par un job de fond.
// Naya ne relance jamais la marque elle-même : elle rappelle à l'utilisatrice de le faire.
import type { Envoi } from "@shared/schema";
import { STATUTS_A_RELANCER } from "@shared/envois";

export const SOURCE_RELANCE = "relance_envoi";
export const DUREE_RELANCE_MIN = 15;

export const titreRelance = (e: Pick<Envoi, "marque" | "objet">) => `Relancer ${e.marque} : ${e.objet}`;

export interface DepsRelances {
  envoisARelancer(userId: string, date: string): Promise<Envoi[]>;
  tachesDuJour(userId: string, date: string): Promise<Array<{ id: number; title: string; source?: string | null; completed?: boolean | null; scheduledDate?: unknown }>>;
  creerTache(t: Record<string, unknown>): Promise<unknown>;
}

export const depsRelances: DepsRelances = {
  envoisARelancer: async (userId, date) => (await import("./store")).envoisARelancer(userId, date),
  tachesDuJour: async (userId, date) => {
    const { storage } = await import("../../storage");
    return (await storage.getTasksInRange(userId, date, date)) as any;
  },
  creerTache: async (t) => (await import("../../storage")).storage.createTask(t as any),
};

/** Crée les tâches de relance du jour. Idempotente : (source, titre, date). Renvoie le nombre créé. */
export async function materializeRelances(userId: string, date: string, deps: DepsRelances = depsRelances): Promise<number> {
  const dus = (await deps.envoisARelancer(userId, date))
    .filter((e) => e.userId === userId && STATUTS_A_RELANCER.has(e.statut));
  if (dus.length === 0) return 0;
  const existantes = new Set(
    (await deps.tachesDuJour(userId, date))
      .filter((t) => t.source === SOURCE_RELANCE && String(t.scheduledDate ?? "").slice(0, 10) === date)
      .map((t) => t.title),
  );
  let creees = 0;
  for (const e of dus) {
    const titre = titreRelance(e);
    if (existantes.has(titre)) continue;
    try {
      await deps.creerTache({
        userId, projectId: e.projectId ?? null, title: titre, scheduledDate: date,
        estimatedDuration: DUREE_RELANCE_MIN, source: SOURCE_RELANCE, schedulingMode: "flexible",
        type: "admin", category: "communication", taskEnergyType: "execution", priority: 2,
      });
      existantes.add(titre);
      creees++;
    } catch (err: any) {
      console.error(`[Relances] envoi ${e.id} le ${date} :`, err?.message);
    }
  }
  return creees;
}

/** Changement de date de relance : retire la tâche NON faite de l'ancienne date (une cochée reste). */
export async function retirerRelanceNonFaite(userId: string, e: Pick<Envoi, "marque" | "objet">, ancienneDate: string): Promise<number> {
  const { storage } = await import("../../storage");
  const taches = (await storage.getTasksInRange(userId, ancienneDate, ancienneDate)) as any[];
  let n = 0;
  for (const t of taches) {
    if (t.userId === userId && t.source === SOURCE_RELANCE && t.title === titreRelance(e) && !t.completed) {
      await storage.deleteTask(t.id);
      n++;
    }
  }
  return n;
}
