// Écrire une tâche : la logique partagée par les routes (POST /api/tasks, PATCH
// /api/tasks/:id) et l'agent. Rien ici ne dépend de `req` : l'agent appelle les mêmes
// fonctions que le web, avec les mêmes garde-fous.
//
// Contrat : un refus attendu revient en `{ ok: false, status, message }` (la route le
// traduit tel quel en réponse HTTP). Une erreur imprévue (corps invalide pour
// `insertTaskSchema`, base indisponible…) est levée : la route la transforme en 500,
// exactement comme avant le déplacement.

import { storage } from "../../storage";
import { insertTaskSchema, type Task } from "@shared/schema";
import { DAY_ABBRS, parseWorkDays } from "../campagne/placement";
import { filtrerEditionTache } from "./edition";
import { resolveScheduledEndTime } from "../task-schedule-fields";
import { dateDeRetassage } from "../repack-from";

export type Refus = { ok: false; status: number; message: string };

const NOMS_JOURS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/** Jour non travaillé → refus 400 (on ne déplace jamais en silence vers un jour travaillé). */
async function refusJourNonTravaille(userId: string, date: string): Promise<Refus | null> {
  const prefs = await storage.getUserPreferences(userId).catch(() => null);
  const workDaySet = parseWorkDays(prefs?.workDays);
  const dow = new Date(date + 'T00:00:00').getDay();
  if (!workDaySet.has(DAY_ABBRS[dow])) {
    return { ok: false, status: 400, message: `${NOMS_JOURS[dow]} is not one of your work days.` };
  }
  return null;
}

export async function creerTache(
  userId: string,
  donnees: Record<string, unknown>,
): Promise<{ ok: true; tache: Task } | Refus> {
  const taskData = insertTaskSchema.parse({ ...donnees, userId });

  // Le projet vient du client (ou de l'agent) : il doit appartenir à l'utilisatrice.
  if (taskData.projectId != null) {
    const projet = await storage.getProject(taskData.projectId, userId);
    if (!projet) return { ok: false, status: 404, message: 'project_not_found' };
  }

  // Règle du projet : jamais de tâche rattachée à un jalon verrouillé.
  if (taskData.milestoneId != null) {
    const jalon = await storage.getMilestone(taskData.milestoneId);
    if (jalon && jalon.status === 'locked') return { ok: false, status: 409, message: 'milestone_locked' };
  }

  // Weekend check — still a hard reject (don't silently move to a work day)
  if (taskData.scheduledDate) {
    const refus = await refusJourNonTravaille(userId, taskData.scheduledDate);
    if (refus) return refus;
  }

  // Auto-assign time: date définie mais pas d'heure → trouver le premier créneau libre
  if (taskData.scheduledDate && !taskData.scheduledTime) {
    const slot = await storage.findFirstFreeSlot(userId, taskData.scheduledDate, taskData.estimatedDuration || 30);
    taskData.scheduledDate = slot.date;
    taskData.scheduledTime = slot.time;
    const [h, m] = slot.time.split(':').map(Number);
    const endMin = h * 60 + m + (taskData.estimatedDuration || 30);
    taskData.scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  }

  // Slot conflict — auto-shift to next available time, never reject
  if (taskData.scheduledDate && taskData.scheduledTime && taskData.estimatedDuration) {
    const check = await storage.checkSlotAvailability(
      userId, taskData.scheduledDate, taskData.scheduledTime, taskData.estimatedDuration
    );
    if (!check.available && check.nextAvailableTime) {
      taskData.scheduledTime = check.nextAvailableTime;
      const [h, m] = check.nextAvailableTime.split(':').map(Number);
      const endMin = h * 60 + m + taskData.estimatedDuration;
      taskData.scheduledEndTime = `${String(Math.floor(endMin / 60)).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`;
    }
  }

  const tache = await storage.createTask(taskData);
  return { ok: true, tache };
}

export async function modifierTache(
  userId: string,
  taskId: number,
  patch: Record<string, unknown>,
): Promise<{ ok: true; tache: Task; avant: Task } | Refus> {
  // Propriété AVANT toute écriture : un identifiant fictif (événement d'agenda, jalon
  // virtuel) ou la tâche d'un autre compte → 404, rien n'est modifié.
  if (!Number.isInteger(taskId) || taskId <= 0) return { ok: false, status: 404, message: 'task_not_found' };
  const currentTask = await storage.getTask(taskId);
  if (!currentTask || (currentTask as any).userId !== userId) {
    return { ok: false, status: 404, message: 'task_not_found' };
  }

  // Liste blanche : on n'écrit jamais `userId`, `id`, `projectId`… venus du corps.
  const filtre = filtrerEditionTache(patch);
  if (!filtre.ok) return { ok: false, status: 400, message: filtre.erreur };
  const updates: any = filtre.updates;

  // If updating schedule-related fields, apply slot-safe logic
  const touchesSchedule = !!(updates.scheduledDate || updates.scheduledTime || updates.estimatedDuration);
  let ancienneDate: string | null = null;
  if (touchesSchedule) {
    ancienneDate = currentTask.scheduledDate ?? null;

    const merged: any = { ...currentTask, ...updates, userId };

    // Weekend check — hard reject
    if (merged.scheduledDate) {
      const refus = await refusJourNonTravaille(userId, merged.scheduledDate);
      if (refus) return refus;
    }

    // Auto-assign time: date définie mais pas d'heure → trouver le premier créneau libre
    if (merged.scheduledDate && !merged.scheduledTime) {
      const slot = await storage.findFirstFreeSlot(userId, merged.scheduledDate, merged.estimatedDuration || 30);
      updates.scheduledDate = slot.date;
      updates.scheduledTime = slot.time;
      merged.scheduledDate = slot.date;
      merged.scheduledTime = slot.time;
      // `scheduledEndTime` est dérivée plus bas, une seule fois pour tous les chemins.
    }

    // Slot conflict — auto-shift
    if (merged.scheduledDate && merged.scheduledTime && merged.estimatedDuration) {
      const check = await storage.checkSlotAvailability(
        userId, merged.scheduledDate, merged.scheduledTime, merged.estimatedDuration, taskId
      );
      if (!check.available && check.nextAvailableTime) {
        updates.scheduledTime = check.nextAvailableTime;
        merged.scheduledTime = check.nextAvailableTime;
      }
    }

    // `scheduledEndTime` est DÉRIVÉE : on la recalcule dès que l'heure ou la durée
    // bouge, quel que soit le chemin. Sans ça, redimensionner une carte (qui n'envoie
    // que `estimatedDuration`) laissait une heure de fin périmée en base.
    updates.scheduledEndTime = resolveScheduledEndTime(
      merged.scheduledTime,
      merged.estimatedDuration,
    );
  }

  // Normalise completedAt : si completed=true, on force un vrai Date (pas une string ISO)
  const safeUpdates: any = { ...updates };
  if (safeUpdates.completed === true) {
    safeUpdates.completedAt = new Date();
  }
  // Retire completedAt si c'est une string (envoyée par vieux clients)
  if (typeof safeUpdates.completedAt === 'string') {
    safeUpdates.completedAt = new Date(safeUpdates.completedAt);
  }

  const tache = await storage.updateTask(taskId, safeUpdates);

  // Règle du projet : tout chemin de (re)planification se termine par le filet
  // idempotent. On repart du MIN(ancienne, nouvelle date) : un prérequis déplacé de
  // mardi à jeudi doit recharger le mercredi, sinon son dépendant reste devant lui.
  const depuis = touchesSchedule ? dateDeRetassage(ancienneDate, tache?.scheduledDate) : null;
  if (depuis) {
    await storage.fixOverlappingTasks(userId, depuis).catch((e: any) =>
      console.error('[tasks:patch] fixOverlappingTasks:', e?.message),
    );
  }

  return { ok: true, tache, avant: currentTask };
}
