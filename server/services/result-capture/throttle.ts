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
 * Hypothèse (non couverte par le brief, notée ici plutôt que devinée en silence) :
 * `PromptRecord` ne porte pas d'heure prévue. La règle « une notification future en
 * attente n'est pas une absence de réponse » est donc portée par l'appelant (tâche 5) :
 * il ne construit `prompts` qu'à partir des notifications dont l'heure prévue est déjà
 * passée. Cette fonction reste pure et ignore la notion de « maintenant ».
 */

export interface PromptRecord {
  /** `null` = restée sans réponse. */
  answeredAt: Date | null;
}

/** Notifications ignorées d'affilée avant que Naya se calme. Décidé avec Jeanne. */
export const SEUIL_SOUPAPE = 3;

/** Série d'ignorées la plus récente. `prompts` est trié du plus récent au plus ancien. */
export function unansweredStreak(prompts: PromptRecord[]): number {
  let n = 0;
  for (const p of prompts) {
    if (p.answeredAt !== null) break;
    n++;
  }
  return n;
}

export function shouldReduceFrequency(streak: number): boolean {
  return streak >= SEUIL_SOUPAPE;
}
