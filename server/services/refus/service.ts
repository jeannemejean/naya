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
  completed?: boolean | null;
  goalId?: number | null;
  milestoneId?: number | null;
  workflowGroup?: string | null;
  priority?: number | null;
}

// Heure de fin HH:MM = début + durée, plafonnée à 23:59 ; null si le début est invalide.
export function heureDeFin(debut: string | null, dureeMin: number): string | null {
  if (!debut || !/^\d{2}:\d{2}$/.test(debut)) return null;
  const [h, m] = debut.split(":").map(Number);
  const fin = Math.min(h * 60 + m + dureeMin, 23 * 60 + 59);
  return `${String(Math.floor(fin / 60)).padStart(2, "0")}:${String(fin % 60).padStart(2, "0")}`;
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
  scheduledEndTime: string | null;
  goalId: number | null;
  milestoneId: number | null;
  workflowGroup: string | null;
  priority?: number;
  source: "replacement";
}

export interface RefusDeps {
  lireTache(id: number): Promise<TacheRefusable | undefined>;
  enregistrerRetour(row: RetourRefus): Promise<void>;
  ecrireSouvenir(input: { userId: string; texte: string }): Promise<void>;
  nomProjet(userId: string, projectId: number): Promise<string | null>;
  lireDependances(taskId: number): Promise<{ prerequis: number[]; dependants: number[] }>;
  refusRecents(userId: string): Promise<string[]>;
  generer(input: Parameters<typeof genererRemplacement>[0]): Promise<Remplacement | null>;
  creerTache(row: NouvelleTacheRemplacement): Promise<{ id: number } & Record<string, unknown>>;
  ajouterDependance(userId: string, taskId: number, dependsOnTaskId: number): Promise<boolean>;
  supprimerTache(id: number): Promise<void>;
  restaurerCreneau(userId: string, id: number, creneau: { scheduledDate: string; scheduledTime: string; scheduledEndTime: string | null }): Promise<void>;
  retasser(userId: string, fromDate: string): Promise<void>;
  aujourdhui(): string;
}

export type ResultatRefus =
  | { statut: "introuvable" }
  | { statut: "deja_terminee" }
  | { statut: "evenement_agenda" }
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
  // Une tâche terminée ne se refuse pas : aucune écriture.
  if (tache.completed) return { statut: "deja_terminee" };
  // Un événement Google Agenda n'est pas une tâche Naya : on ne le refuse pas.
  if (tache.source === "gcal") return { statut: "evenement_agenda" };

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
  // Écrit au fil founder SANS projet (seule portée relue par la récupération) ; la marque reste dans le texte.
  await sansLever("souvenir", async () => {
    const nomProjet = tache.projectId != null
      ? await sansLever("nom du projet", () => deps.nomProjet(userId, tache.projectId as number), null as string | null)
      : null;
    const texte = texteSouvenirRefus(tache.title, raison, freeText, nomProjet);
    if (texte !== null) await deps.ecrireSouvenir({ userId, texte });
  }, undefined);

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
        scheduledEndTime: heureDeFin(tache.scheduledTime ?? null, rempl.estimatedDuration),
        goalId: tache.goalId ?? null,
        milestoneId: tache.milestoneId ?? null,
        workflowGroup: tache.workflowGroup ?? null,
        ...(tache.priority != null ? { priority: tache.priority } : {}),
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

  // 8. Suppression de la refusée. Si elle échoue après la création, les deux tâches
  // subsistent : l'utilisatrice peut simplement refuser à nouveau (rien n'est perdu).
  await sansLever("suppression", () => deps.supprimerTache(tache.id), undefined);

  // Le garde de collision de createTask a pu décaler le remplacement, la refusée
  // occupant encore son créneau : on le restaure maintenant qu'elle a disparu.
  if (tache.scheduledDate && tache.scheduledTime) {
    const { scheduledDate, scheduledTime } = tache;
    await sansLever("restauration du créneau", () =>
      deps.restaurerCreneau(userId, cree.id, {
        scheduledDate,
        scheduledTime,
        scheduledEndTime: heureDeFin(scheduledTime, rempl.estimatedDuration),
      }), undefined);
  }

  // 9. Re-tassage, puis relecture : on rend la ligne après tassage.
  await retasser();
  const finale = await sansLever<Record<string, unknown> | undefined>("relecture", () => deps.lireTache(cree.id) as Promise<any>, undefined);

  return { statut: "refusee", remplacement: finale ?? cree };
}
