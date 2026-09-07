/**
 * La soupape — PURE.
 *
 * Jeanne a choisi une notification par tâche en connaissance de cause. Ce garde-fou
 * existe pour que le jour où c'est trop, elle ajuste plutôt qu'elle coupe : le jour où
 * elle désactive les notifications de Naya, tout s'arrête d'un coup et EN SILENCE,
 * sans qu'aucun signal ne remonte.
 *
 * ⚠️ Une notification IGNORÉE n'est pas un « pas fait ». C'est pour tenir cette
 * distinction que `task_prompts` existe : `answeredAt IS NULL` = ignorée, et ça n'entre
 * jamais dans les observations du retour immédiat.
 *
 * `unansweredStreak` GARANTIT elle-même — sans dépendre de la discipline de
 * l'appelant — qu'une alarme dont l'échéance (`scheduledFor`) n'est pas encore passée
 * n'est jamais comptée comme une absence de réponse : elle n'existe tout simplement pas
 * pour ce calcul. C'est nécessaire parce que le stockage lit « les N dernières alarmes,
 * triées de la plus récente à la plus ancienne » sans filtrer sur l'échéance — si des
 * alarmes futures (donc forcément sans réponse) se retrouvent en tête de cette liste, la
 * fonction doit les ignorer elle-même plutôt que de compter sur le fait que personne ne
 * les lui passera. `now` entre par la signature : aucune horloge implicite.
 */

export interface PromptRecord {
  /** Heure prévue de l'alarme. */
  scheduledFor: Date;
  /** `null` = restée sans réponse. */
  answeredAt: Date | null;
}

/** Notifications ignorées d'affilée avant que Naya se calme. Décidé avec Jeanne. */
export const SEUIL_SOUPAPE = 3;

/**
 * Série d'ignorées la plus récente. `prompts` est trié du plus récent au plus ancien.
 * `now` est l'instant présent, fourni par l'appelant (fonction pure, pas d'horloge
 * implicite).
 *
 * Une alarme dont `scheduledFor` est encore à venir n'est ni une absence de réponse, ni
 * un « pas fait » : elle est exclue du calcul, où qu'elle se trouve dans la liste.
 * Bornes inclusives : une alarme échue pile à `now` compte comme échue (même convention
 * que la fenêtre d'attribution ailleurs dans ce dépôt, `attribute.ts`).
 */
export function unansweredStreak(prompts: PromptRecord[], now: Date): number {
  const echues = prompts.filter((p) => p.scheduledFor.getTime() <= now.getTime());
  let n = 0;
  for (const p of echues) {
    if (p.answeredAt !== null) break;
    n++;
  }
  return n;
}

export function shouldReduceFrequency(streak: number): boolean {
  return streak >= SEUIL_SOUPAPE;
}
