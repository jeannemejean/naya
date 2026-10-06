// Implémentation réelle des dépendances du refus (base, mémoire, génération).
import { and, eq } from "drizzle-orm";
import { memoryEntries, taskDependencies, tasks } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { embedText } from "../memory/embed";
import { ajouterDependance } from "../dependances";
import { aujourdhuiParis } from "../repack-from";
import { ligneContexteRefus } from "./pur";
import { genererRemplacement } from "./remplacement";
import type { RefusDeps } from "./service";

const SALIENCE_REFUS = 0.8;
const TYPES_NEGATIFS = ["deleted", "dismissed", "deferred", "refused"];

export const refusDeps: RefusDeps = {
  lireTache: (id) => storage.getTask(id),

  enregistrerRetour: async (row) => {
    await storage.createTaskFeedback(row);
  },

  ecrireSouvenir: async ({ userId, projectId, texte }) => {
    // Embedding best-effort : sans vecteur, le souvenir est écrit quand même.
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(texte);
    } catch {
      embedding = null;
    }
    await db.insert(memoryEntries).values({
      userId,
      projectId,
      fil: "founder",
      entryType: "préférence",
      content: texte,
      salience: SALIENCE_REFUS,
      ...(embedding ? { embedding } : {}),
    });
  },

  lireDependances: async (taskId) => {
    const prerequis = await db
      .select({ id: taskDependencies.dependsOnTaskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, taskId));
    const dependants = await db
      .select({ id: taskDependencies.taskId })
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnTaskId, taskId));
    return { prerequis: prerequis.map((r) => r.id), dependants: dependants.map((r) => r.id) };
  },

  refusRecents: async (userId) => {
    const recents = await storage.getRecentTaskFeedback(userId, undefined, 30);
    return recents
      .filter((f) => TYPES_NEGATIFS.includes(f.feedbackType))
      .slice(0, 10)
      .map(ligneContexteRefus);
  },

  generer: (input) => genererRemplacement(input),

  creerTache: (row) => storage.createTask(row),

  ajouterDependance: (userId, taskId, dependsOnTaskId) => ajouterDependance(userId, taskId, dependsOnTaskId),

  supprimerTache: (id) => storage.deleteTask(id),

  restaurerCreneau: async (userId, id, creneau) => {
    await db.update(tasks).set(creneau).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  },

  retasser: async (userId, fromDate) => {
    await storage.fixOverlappingTasks(userId, fromDate);
  },

  aujourdhui: () => aujourdhuiParis(),
};
