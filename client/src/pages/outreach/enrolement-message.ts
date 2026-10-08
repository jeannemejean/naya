/** Réponse de /enroll et /launch (server/services/prospection-enrolement.ts). */
export interface ReponseEnrolement {
  enrolled: number;
  skipped: number;
  skippedNotValidated?: number;
  total?: number;
}

/** Texte du toast après un enrôlement groupé — dit pourquoi des prospects sont restés à l'écart. */
export function resumeEnrolement(r: ReponseEnrolement): string {
  const pluriel = r.enrolled > 1 ? "s" : "";
  let texte = `${r.enrolled} prospect${pluriel} enrôlé${pluriel}.`;
  const nonValides = r.skippedNotValidated ?? 0;
  const autres = Math.max(0, r.skipped - nonValides);
  const details: string[] = [];
  if (nonValides > 0) details.push(`${nonValides} en attente de ta validation des messages`);
  if (autres > 0) details.push(`${autres} déjà en cours ou hors campagne`);
  if (details.length > 0) texte += ` ${details.join(", ")}.`;
  return texte;
}
