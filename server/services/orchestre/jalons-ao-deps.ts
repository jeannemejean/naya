// Branchement en base des jalons d'appels d'offres (jalons-ao.ts reste pur).
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "@shared/schema";
import { storage } from "../../storage";
import { appelsOffresStore } from "../appels-offres-store";
import { DAY_ABBRS, parseWorkDays } from "../campagne/placement";
import { creerTache } from "../taches/ecrire-tache";
import { wallClockToInstant } from "../../utils/timezone";
import { MARQUE_ARCHIVE, SOURCE_AO, type DepsJalonsAO } from "./jalons-ao";

export const depsJalonsAO: DepsJalonsAO = {
  listerAO: (userId) => appelsOffresStore.listerAppelsOffres(userId),
  tachesAO: (userId) => db.select({ id: tasks.id, completed: tasks.completed, archivedAt: tasks.archivedAt, scheduledDate: tasks.scheduledDate, actionData: tasks.actionData })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.source, SOURCE_AO))),
  async estTravaille(userId) {
    const prefs = await storage.getUserPreferences(userId).catch(() => null);
    const jours = parseWorkDays(prefs?.workDays);
    return (jour: string) => jours.has(DAY_ABBRS[new Date(`${jour}T12:00:00Z`).getUTCDay()]);
  },
  async creer(userId, donnees) {
    let r = await creerTache(userId, donnees);
    // Projet de l'AO supprimé ou pas à elle : le jalon se pose quand même, sans projet.
    if (!r.ok && r.message === "project_not_found") r = await creerTache(userId, { ...donnees, projectId: null });
    if (!r.ok) { console.warn(`[orchestre] jalon AO refusé user=${userId} (${r.status} ${r.message})`); return null; }
    return { id: r.tache.id, scheduledDate: r.tache.scheduledDate ?? null };
  },
  async archiver(userId, id) {
    const t = await lire(userId, id);
    if (!t) return;
    await db.update(tasks).set({ archivedAt: new Date(), actionData: { ...((t.actionData as object) ?? {}), [MARQUE_ARCHIVE]: true } })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
  async reEcheancer(userId, id, echeance) {
    const t = await lire(userId, id);
    if (!t) return;
    await db.update(tasks).set({
      actionData: { ...((t.actionData as object) ?? {}), echeanceDure: echeance },
      dueDate: wallClockToInstant("Europe/Paris", echeance, "23:59"),
    }).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
  async rouvrir(userId, id, echeance, jour) {
    const t = await lire(userId, id);
    if (!t) return;
    const { [MARQUE_ARCHIVE]: _m, ...reste } = ((t.actionData as Record<string, unknown>) ?? {});
    await db.update(tasks).set({
      archivedAt: null, actionData: { ...reste, echeanceDure: echeance },
      dueDate: wallClockToInstant("Europe/Paris", echeance, "23:59"),
      scheduledDate: jour, scheduledTime: null, scheduledEndTime: null,
    }).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
  async replacer(userId, id, jour) {
    await db.update(tasks).set({ scheduledDate: jour, scheduledTime: null, scheduledEndTime: null })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
};

async function lire(userId: string, id: number) {
  const [t] = await db.select({ actionData: tasks.actionData }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  return t;
}
