import { storage } from "../storage";
import type { ProjectMilestone, MilestoneCondition } from "@shared/schema";
import { filActifPour } from "./fil/interrupteur";

/**
 * NB : les jalons ne sont PLUS des tâches horaires dans le planning.
 * Ils sont injectés comme marqueurs « toute la journée » à leur date LOGIQUE par
 * GET /api/tasks/range (cf. server/services/milestone-dates.ts). Cette fonction est
 * conservée comme no-op pour ne pas recréer de « fausses tâches » (ex. 8h30 aujourd'hui).
 */
async function createMilestoneTask(_milestone: ProjectMilestone): Promise<void> {
  /* no-op volontaire — voir le commentaire ci-dessus */
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
    // Tâche détachée (ne lève jamais) : la confirmation n'attend ni la lecture ni l'IA.
    if (updated.goalId != null) void proposerSuiteSiChaineFranchie(updated.projectId, updated.userId, updated.goalId);
  }

  return updated;
}

/**
 * Fil conducteur : quand toutes les étapes d'un objectif sont faites (ou sautées), Naya propose
 * la suite. Ne lève jamais : appelée en tâche détachée, la confirmation du jalon n'échoue pas à cause d'elle.
 */
export async function proposerSuiteSiChaineFranchie(projectId: number, userId: string, goalId: number): Promise<void> {
  if (!filActifPour(userId)) return;
  try {
    const etapes = (await storage.getMilestones(projectId, userId)).filter((m) => m.goalId === goalId);
    if (etapes.length === 0 || !etapes.every((m) => m.status === 'completed' || m.status === 'skipped')) return;
    // Import différé : etapes.ts importe ce module (createMilestoneChain).
    const { proposerEtapesPour } = await import("./fil/etapes");
    await proposerEtapesPour(userId, goalId, new Date());
  } catch (e: any) {
    console.error(`[fil] proposition d'étapes après la chaîne de l'objectif ${goalId} :`, e?.message ?? e);
  }
}

/**
 * Crée une chaîne de jalons en bloc (Companion, propositions d'étapes du fil conducteur).
 * Chaque jalon peut dire où il en est (`etat`) : `faite` → completed (avec completedAt). La
 * première étape non faite devient active ; les suivantes non faites sont locked, chacune avec
 * UNE condition sur la précédente. Sans `etat`, comportement historique : le premier jalon est
 * actif, tous les autres verrouillés. `opts.goalId` relie toute la chaîne à un objectif ;
 * `opts.ordreDepart` la place après les étapes déjà franchies de cet objectif.
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
    pourquoi?: string;
    etat?: "faite" | "en_cours" | "a_venir";
  }>,
  opts: { goalId?: number; ordreDepart?: number } = {},
): Promise<ProjectMilestone[]> {
  const created: ProjectMilestone[] = [];
  let activeDejaPosee = false;

  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    const isFirst = i === 0;
    const maintenant = new Date();
    const faite = m.etat === "faite";
    // Règle absolue : seule la première étape non faite est active, jamais deux dans la chaîne.
    const status = faite ? 'completed' : (!activeDejaPosee ? 'active' : 'locked');
    if (status === 'active') activeDejaPosee = true;

    const milestone = await storage.createMilestone({
      projectId,
      userId,
      title: m.title,
      description: m.description || null,
      order: (opts.ordreDepart ?? 0) + i,
      status,
      milestoneType: (m.milestoneType as any) || 'action',
      activatedAt: status === 'locked' ? null : maintenant,
      completedAt: faite ? maintenant : null,
      goalId: opts.goalId ?? null,
      pourquoi: m.pourquoi?.trim() || null,
    });

    created.push(milestone);

    // L'étape devenue active → créer sa tâche dans le planning (no-op, voir createMilestoneTask)
    if (status === 'active') await createMilestoneTask(milestone);

    // Créer la condition de dépendance au jalon précédent (sauf pour le premier). Elle est déjà
    // remplie quand la précédente est faite.
    if (!isFirst) {
      const prevMilestone = created[i - 1];
      const remplie = prevMilestone.status === 'completed';
      await storage.createMilestoneCondition({
        milestoneId: milestone.id,
        conditionType: m.conditionType || 'milestone_completed',
        label: m.conditionLabel || `${prevMilestone.title} doit être complété`,
        blockedByMilestoneId: prevMilestone.id,
        requiredDays: m.requiredDays || null,
        isFulfilled: remplie,
        ...(remplie ? { fulfilledAt: maintenant } : {}),
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
