// Orchestration du refus d'une tâche, dépendances injectées (testable sans base).
import { libelleRaison, texteSouvenirRefus, type RaisonRefus, type Remplacement } from "./pur";
import type { genererRemplacement } from "./remplacement";

export interface TacheRefusable {
  id: number;
  userId: string;
  title: string;
  description: string | null;
  type: string;
  category: string;
  source: string | null;
  projectId: number | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedDuration: number | null;
  learnedAdjustmentCount: number | null;
}

export interface RetourRefus {
  taskId: number;
  taskTitle: string;
  taskType: string | null;
  taskCategory: string | null;
  taskSource: string | null;
  userId: string;
  projectId: number | null;
  feedbackType: "refused";
  reason: string;
  freeText: string | null;
  timesRescheduled: number;
}

export interface NouvelleTacheRemplacement {
  userId: string;
  projectId: number | null;
  title: string;
  description: string;
  type: string;
  category: string;
  estimatedDuration: number;
  activationPrompt: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  source: "replacement";
}

export interface RefusDeps {
  lireTache(id: number): Promise<TacheRefusable | undefined>;
  enregistrerRetour(row: RetourRefus): Promise<void>;
  ecrireSouvenir(input: { userId: string; projectId: number | null; texte: string }): Promise<void>;
  lireDependances(taskId: number): Promise<{ prerequis: number[]; dependants: number[] }>;
  refusRecents(userId: string): Promise<string[]>;
  generer(input: Parameters<typeof genererRemplacement>[0]): Promise<Remplacement | null>;
  creerTache(row: NouvelleTacheRemplacement): Promise<{ id: number } & Record<string, unknown>>;
  ajouterDependance(userId: string, taskId: number, dependsOnTaskId: number): Promise<boolean>;
  supprimerTache(id: number): Promise<void>;
  retasser(userId: string, fromDate: string): Promise<void>;
  aujourdhui(): string;
}

export type ResultatRefus =
  | { statut: "introuvable" }
  | { statut: "refusee"; remplacement: Record<string, unknown> | null; raison?: "generation_failed" };

// Exécute une étape best-effort : journalise et rend `fallback` en cas d'échec.
async function sansLever<T>(nom: string, f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.error(`[refus] ${nom} a échoué :`, e);
    return fallback;
  }
}

export async function refuserTache(
  deps: RefusDeps,
  input: { userId: string; taskId: number; raison: RaisonRefus; freeText?: string | null },
): Promise<ResultatRefus> {
  const { userId, taskId, raison } = input;
  const freeText = input.freeText ?? null;

  // 1. Lecture + contrôle de propriété : une tâche d'un autre compte est « introuvable ».
  const tache = await deps.lireTache(taskId);
  if (!tache || tache.userId !== userId) return { statut: "introuvable" };

  // 2. Le retour est l'étape qui fait réussir le refus ; les suivantes sont best-effort.
  await deps.enregistrerRetour({
    taskId: tache.id,
    taskTitle: tache.title,
    taskType: tache.type ?? null,
    taskCategory: tache.category ?? null,
    taskSource: tache.source ?? null,
    userId,
    projectId: tache.projectId ?? null,
    feedbackType: "refused",
    reason: raison,
    freeText,
    timesRescheduled: tache.learnedAdjustmentCount || 0,
  });

  // 3. Souvenir, seulement si une explication a été donnée.
  const texte = texteSouvenirRefus(tache.title, raison, freeText);
  if (texte !== null) {
    await sansLever("souvenir", () => deps.ecrireSouvenir({ userId, projectId: tache.projectId ?? null, texte }), undefined);
  }

  // 4. Dépendances lues AVANT suppression (elles cascadent avec la tâche).
  const { prerequis, dependants } = await sansLever("lecture des dépendances", () => deps.lireDependances(tache.id), {
    prerequis: [] as number[],
    dependants: [] as number[],
  });

  // 5. Génération du remplacement.
  const recents = await sansLever("refus récents", () => deps.refusRecents(userId), [] as string[]);
  const rempl = await sansLever(
    "génération",
    () => deps.generer({ userId, tache, raison, freeText, refusRecents: recents }),
    null as Remplacement | null,
  );

  const retasser = () =>
    sansLever("retassage", async () => {
      const aujourdhui = deps.aujourdhui();
      const date = tache.scheduledDate ?? aujourdhui;
      await deps.retasser(userId, date > aujourdhui ? date : aujourdhui);
    }, undefined);

  const sansRemplacement = async (): Promise<ResultatRefus> => {
    await sansLever("suppression", () => deps.supprimerTache(tache.id), undefined);
    await retasser();
    return { statut: "refusee", remplacement: null, raison: "generation_failed" };
  };

  if (!rempl) return sansRemplacement();

  // 6. Création AVANT suppression de la refusée (même créneau, même projet).
  const cree = await sansLever<({ id: number } & Record<string, unknown>) | null>(
    "création du remplacement",
    () =>
      deps.creerTache({
        userId,
        projectId: tache.projectId ?? null,
        title: rempl.title,
        description: rempl.description,
        type: rempl.type,
        category: rempl.category,
        estimatedDuration: rempl.estimatedDuration,
        activationPrompt: rempl.activationPrompt ?? null,
        scheduledDate: tache.scheduledDate ?? null,
        scheduledTime: tache.scheduledTime ?? null,
        source: "replacement",
      }),
    null,
  );
  if (!cree) return sansRemplacement();

  // 7. Transfert des dépendances dans les deux sens.
  for (const p of prerequis) {
    await sansLever("dépendance (prérequis)", () => deps.ajouterDependance(userId, cree.id, p), false);
  }
  for (const d of dependants) {
    await sansLever("dépendance (dépendant)", () => deps.ajouterDependance(userId, d, cree.id), false);
  }

  // 8-9. Suppression de la refusée puis re-tassage.
  await sansLever("suppression", () => deps.supprimerTache(tache.id), undefined);
  await retasser();

  return { statut: "refusee", remplacement: cree };
}
