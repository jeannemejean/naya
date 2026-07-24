// Matérialise les rituels d'un utilisateur en tâches concrètes pour une date donnée.
// Appelée AVANT toute génération IA : le créneau du rituel est ainsi déjà occupé.
import { storage } from "../storage";
import { ritualOccursOn, buildRitualTask } from "./rituals";

/**
 * Crée la tâche du jour pour chaque rituel actif tombant à cette date.
 * Idempotente : ne crée rien si une tâche existe déjà pour (ritualId, date).
 * Renvoie le nombre de tâches créées.
 */
export async function materializeRituals(userId: string, date: string): Promise<number> {
  const rituals = await storage.getActiveRituals(userId);
  let created = 0;

  for (const ritual of rituals) {
    if (!ritualOccursOn(ritual.days, date)) continue;

    const existing = await storage.getRitualTaskForDate(ritual.id, date);
    if (existing) continue;

    const draft = buildRitualTask(ritual, date);
    try {
      await storage.createTask({
        userId,
        projectId: ritual.projectId,
        ritualId: ritual.id,
        type: "admin",
        category: "planning",
        taskEnergyType: "execution",
        priority: 1,
        ...draft,
      });
      created++;
    } catch (e: any) {
      // Un rituel en échec ne doit jamais bloquer les autres ni la génération.
      console.error(`[Rituals] materialize ${ritual.id} on ${date}:`, e?.message);
    }
  }

  return created;
}
