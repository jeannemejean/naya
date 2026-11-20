// Branchement en base des jalons d'appels d'offres (jalons-ao.ts reste pur).
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { tasks } from "@shared/schema";
import { storage } from "../../storage";
import { appelsOffresStore } from "../appels-offres-store";
import { DAY_ABBRS, parseWorkDays } from "../campagne/placement";
import { creerTache } from "../taches/ecrire-tache";
import { wallClockToInstant } from "../../utils/timezone";
import { SOURCE_AO, type DepsJalonsAO } from "./jalons-ao";

export const depsJalonsAO: DepsJalonsAO = {
  listerAO: (userId) => appelsOffresStore.listerAppelsOffres(userId),
  tachesAO: (userId) => db.select({ id: tasks.id, completed: tasks.completed, archivedAt: tasks.archivedAt, actionData: tasks.actionData })
    .from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.source, SOURCE_AO))),
  async estTravaille(userId) {
    const prefs = await storage.getUserPreferences(userId).catch(() => null);
    const jours = parseWorkDays(prefs?.workDays);
    return (jour: string) => jours.has(DAY_ABBRS[new Date(`${jour}T12:00:00Z`).getUTCDay()]);
  },
  async creer(userId, donnees) {
    const r = await creerTache(userId, donnees);
    if (!r.ok) console.warn(`[orchestre] jalon AO refusé user=${userId} (${r.status} ${r.message})`);
    return r.ok;
  },
  async archiver(userId, id) {
    await db.update(tasks).set({ archivedAt: new Date() }).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
  async reEcheancer(userId, id, echeance) {
    const [t] = await db.select({ actionData: tasks.actionData }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    if (!t) return;
    await db.update(tasks).set({
      actionData: { ...((t.actionData as object) ?? {}), echeanceDure: echeance },
      dueDate: wallClockToInstant("Europe/Paris", echeance, "23:59"),
    }).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },
};
