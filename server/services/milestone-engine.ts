import { storage } from "../storage";
import type { ProjectMilestone, MilestoneCondition } from "@shared/schema";

/** Crée une tâche-jalon dans le planning pour rendre le jalon visible et actionnable. */
async function createMilestoneTask(milestone: ProjectMilestone): Promise<void> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Vérifier qu'il n'y a pas déjà une tâche active pour ce jalon (via requête SQL directe)
    const { db } = await import('../db');
    const { tasks } = await import('../../shared/schema');
    const { and, eq } = await import('drizzle-orm');
    const existingTasks = await db.select({ id: tasks.id, completed: tasks.completed })
      .from(tasks)
      .where(and(eq(tasks.milestoneId, milestone.id), eq(tasks.completed, false)));
    if (existingTasks.length > 0) return;

    await storage.createTask({
      userId: milestone.userId,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      title: `🏁 ${milestone.title}`,
      description: milestone.description || '',
      type: 'milestone',
      category: 'planning',
      priority: 1,
      estimatedDuration: 30,
      scheduledDate: dateStr,
      scheduledTime: '08:30',
      taskEnergyType: 'execution',
      source: 'milestone',
      completed: false,
    } as any);
  } catch (e: any) {
    console.error(`[MilestoneEngine] Failed to create task for milestone ${milestone.id}:`, e.message);
  }
}

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

    // Résoudre automatiquement toute condition liée à un jalon complété
    // (quel que soit le conditionType : milestone_completed, manual, previous_completed, etc.)
    for (const condition of conditions.filter(c => !c.isFulfilled && c.blockedByMilestoneId)) {
      const dep = milestoneMap.get(condition.blockedByMilestoneId!);
      if (dep && dep.status === 'completed') {
        await storage.fulfillCondition(condition.id);
        condition.isFulfilled = true; // Mise à jour locale pour la vérification suivante
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
        milestoneMap.set(milestone.id, updated);
        await storage.unblockTasksForMilestone(milestone.id);
        await createMilestoneTask(updated); // rendre le jalon visible dans le planning
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
    // Compléter la tâche-jalon (🏁) dans le planning
    await storage.completeMilestoneTask(milestoneId);
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

    // Le premier jalon est immédiatement actif → créer sa tâche dans le planning
    if (isFirst) await createMilestoneTask(milestone);

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
