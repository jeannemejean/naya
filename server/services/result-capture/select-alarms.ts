/**
 * Quelles alarmes poser aujourd'hui — PURE.
 *
 * Extrait de `GET /api/task-prompts/today` (revue finale : « aucun test sur les trois
 * routes → corriger avant fusion ; les deux Critiques étaient dans ces routes »). La
 * route ne garde que l'accès base et le HTTP ; toute la décision vit ici, en fonction
 * pure et testable.
 *
 * L'invariant à ne pas casser : le jeu renvoyé ici est à la fois celui envoyé au
 * mobile ET celui persisté par la route — jamais deux jeux différents (voir C1 de la
 * revue finale : une alarme écrite en base mais jamais transmise au mobile ne sonnera
 * jamais, et devient à tort une "ignorée" qui referme la soupape sur du vide).
 */

/** Ce dont cette fonction a besoin d'une tâche — pas le type `Task` complet. */
export interface AlarmCandidateTask {
  id: number;
  title: string;
  completed: boolean;
  scheduledDate: string | null;
  scheduledEndTime: string | null;
}

export interface AlarmToPost {
  taskId: number;
  title: string;
  scheduledFor: Date;
}

import { parisWallClockToInstant } from "../../utils/timezone";

/**
 * `now` et `reduceFrequency` entrent par la signature — aucune horloge implicite,
 * aucun accès à la soupape ici (`reduceFrequency` est déjà tranché par l'appelant via
 * `unansweredStreak`/`shouldReduceFrequency`, sur l'historique EXISTANT, avant que
 * cette fonction ne soit appelée — sinon les alarmes qu'on s'apprête à créer se
 * mesureraient elles-mêmes).
 */
export function selectAlarmsToPost(
  todaysTasks: AlarmCandidateTask[],
  now: Date,
  reduceFrequency: boolean,
): AlarmToPost[] {
  // Non terminée, et une heure de fin valide ("HH:MM") — sans ça, pas d'instant à
  // calculer, donc pas d'alarme possible.
  const pending = todaysTasks.filter(
    (t) =>
      !t.completed &&
      typeof t.scheduledEndTime === "string" &&
      /^\d{2}:\d{2}$/.test(t.scheduledEndTime),
  );

  const candidates: AlarmToPost[] = pending.map((t) => ({
    taskId: t.id,
    title: t.title,
    // `scheduledEndTime` est une heure murale de Paris — jamais interprétée dans le
    // fuseau du process (UTC en prod).
    scheduledFor: parisWallClockToInstant(t.scheduledDate!, t.scheduledEndTime!),
  }));

  // Borne stricte `>` : une alarme dont l'échéance est déjà passée n'est jamais posée.
  // Alignement délibéré avec le reste de la couture, qui traite `scheduledFor <= now`
  // comme "échue" : `unansweredStreak` (throttle.ts) compte comme échue toute alarme
  // `scheduledFor <= now`, et `replaceTaskPromptsForDay` (storage.ts) ne supprime (donc
  // ne remplace) que les alarmes `gt(scheduledFor, now)`. Une alarme pile sur `now`
  // doit donc être exclue ICI aussi — sinon elle serait posée par cette fonction ET,
  // au prochain calcul de la soupape, immédiatement comptée comme "échue sans
  // réponse", ce qui n'aurait jamais pu sonner avant d'être jugée ignorée.
  const futureAlarms = candidates.filter((a) => a.scheduledFor.getTime() > now.getTime());

  if (!reduceFrequency) return futureAlarms;
  if (futureAlarms.length === 0) return [];
  // Sous la soupape : une seule alarme, la dernière de la journée.
  return [
    futureAlarms.reduce((last, a) => (a.scheduledFor.getTime() > last.scheduledFor.getTime() ? a : last)),
  ];
}
