import { storage } from "../storage";
import type { ProjectMilestone, MilestoneCondition } from "@shared/schema";

/**
 * Vérifie les jalons locked d'un projet et débloque ceux dont toutes les conditions sont remplies.
 * Règle absolue : un jalon locked ne génère JAMAIS de tâches.
 */
export async function checkAndUnlockMilestones(projectId: number, userId: string): Promise<ProjectMilestone[]> {
  const milestones = await storage.getMilestones(projectId, userId);
  const milestoneMap = new Map(milestones.map(m => [m.id, m]));
  const unlocked: ProjectMilestone[] = [];

  for (const milestone of milestones.filter(m => m.status === 'locked')) {
    const conditions = await storage.getMilestoneConditions(milestone.id);

    // Résoudre automatiquement les conditions milestone_completed
    for (const condition of conditions.filter(c => !c.isFulfilled && c.conditionType === 'milestone_completed')) {
      if (condition.blockedByMilestoneId) {
        const dep = milestoneMap.get(condition.blockedByMilestoneId);
        if (dep && dep.status === 'completed') {
          await storage.fulfillCondition(condition.id);
          condition.isFulfilled = true; // Mise à jour locale pour la vérification suivante
        }
      }
    }

    const allFulfilled = conditions.length === 0 || conditions.every(c => c.isFulfilled);

    if (allFulfilled) {
      const updated = await storage.updateMilestone(milestone.id, {
        status: 'unlocked',
        activatedAt: new Date(),
      });
      if (updated) {
        unlocked.push(updated);
        milestoneMap.set(milestone.id, updated); // Mettre à jour la map pour les jalons suivants
        await storage.unblockTasksForMilestone(milestone.id);
      }
    }
  }

  return unlocked;
}

/**
 * Confirme manuellement un jalon (conditionType = manual_confirm).
 * Remplit toutes les conditions manuelles et re-vérifie le déverrouillage.
 */
export async function confirmMilestone(milestoneId: number): Promise<ProjectMilestone | null> {
  const milestone = await storage.getMilestone(milestoneId);
  if (!milestone) return null;

  const conditions = await storage.getMilestoneConditions(milestoneId);

  // Remplir toutes les conditions manuelles non encore remplies
  for (const condition of conditions.filter(c => c.conditionType === 'manual_confirm' && !c.isFulfilled)) {
    await storage.fulfillCondition(condition.id);
  }

  // Marquer le jalon comme completed si c'était le déclencheur final
  const updated = await storage.updateMilestone(milestoneId, {
    status: 'completed',
    completedAt: new Date(),
  });

  if (updated) {
    await storage.unblockTasksForMilestone(milestoneId);
    // Déclencher le déverrouillage des jalons suivants
    await checkAndUnlockMilestones(milestone.projectId, milestone.userId);
  }

  return updated;
}

/**
 * Crée une chaîne de jalons en bloc depuis le Companion.
 * Chaque jalon est locked sauf le premier (qui est unlocked/active).
 */
export async function createMilestoneChain(
  projectId: number,
  userId: string,
  milestones: Array<{
    title: string;
    description?: string;
    milestoneType?: string;
    conditionType?: string;
    conditionLabel?: string;
    requiredDays?: number;
  }>
): Promise<ProjectMilestone[]> {
  const created: ProjectMilestone[] = [];

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const isFirst = i === 0;

    const milestone = await storage.createMilestone({
      projectId,
      userId,
      title: m.title,
      description: m.description || null,
      order: i,
      status: isFirst ? 'active' : 'locked',
      milestoneType: (m.milestoneType as any) || 'action',
      activatedAt: isFirst ? new Date() : null,
    });

    created.push(milestone);

    // Créer la condition de dépendance au jalon précédent (sauf pour le premier)
    if (!isFirst) {
      const prevMilestone = created[i - 1];
      await storage.createMilestoneCondition({
        milestoneId: milestone.id,
        conditionType: m.conditionType || 'milestone_completed',
        label: m.conditionLabel || `${prevMilestone.title} doit être complété`,
        blockedByMilestoneId: prevMilestone.id,
        requiredDays: m.requiredDays || null,
        isFulfilled: false,
      });
    }
  }

  return created;
}

/**
 * Cron job quotidien : vérifie les conditions de type duration_elapsed.
 */
export async function checkDurationConditions(): Promise<void> {
  const pending = await storage.getPendingDurationConditions();

  for (const condition of pending) {
    const milestone = await storage.getMilestone(condition.milestoneId);
    if (!milestone?.activatedAt) continue;

    const days = Math.floor((Date.now() - new Date(milestone.activatedAt).getTime()) / 86_400_000);
    if (days >= (condition.requiredDays ?? 0)) {
      await storage.fulfillCondition(condition.id);
      await checkAndUnlockMilestones(milestone.projectId, milestone.userId);
    }
  }
}
