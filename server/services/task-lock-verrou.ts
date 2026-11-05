import { storage } from "../storage";
import { verrouDeTache } from "./task-lock";

/**
 * Charge les dependances d'une tache et applique le verrou de sequence (task-lock.ts).
 * Partage par /api/tasks/:id/toggle, /api/tasks/:id/complete et l'outil cocher_tache de
 * l'agent : une seule regle, ou qu'on coche.
 *
 * Une dependance introuvable ne bloque pas : voir task-lock.ts. Une lecture qui echoue non
 * plus — on ne verrouille pas le travail de quelqu'un parce qu'une requete a rate.
 */
export async function verrouPourTache(taskId: number) {
  const dependances = await storage.getTaskDependencies(taskId).catch(() => [] as any[]);
  if (!dependances.length) return { verrouillee: false, bloqueePar: [] as { id: number; titre: string }[] };

  const prerequis = new Map<number, { title: string | null; completed: boolean | null }>();
  for (const d of dependances as any[]) {
    const id = d?.dependsOnTaskId;
    if (typeof id !== "number") continue;
    const t = await storage.getTask(id).catch(() => undefined);
    if (t) prerequis.set(id, { title: (t as any).title ?? null, completed: (t as any).completed ?? null });
  }
  return verrouDeTache({ dependances: dependances as any[], prerequis, tacheId: taskId });
}
