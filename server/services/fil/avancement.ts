// Avancement d'une étape : tâches faites sur tâches prévues, comptées à partir de la mise en
// route du fil. Pur : la requête vit dans storage.getAvancementEtapes, qui filtre déjà en SQL ;
// le filtre est refait ici pour que le comptage ne dépende pas de la requête.

export interface LigneAvancement {
  milestoneId: number | null;
  completed: boolean | null;
  createdAt: Date | null;
  archivedAt: Date | null;
}

export function agregerAvancement(
  lignes: LigneAvancement[],
  milestoneIds: number[],
  depuis: Date | null,
): Map<number, { faites: number; prevues: number }> {
  const carte = new Map<number, { faites: number; prevues: number }>();
  for (const id of milestoneIds) carte.set(id, { faites: 0, prevues: 0 });
  for (const l of lignes) {
    if (l.milestoneId == null) continue;
    const c = carte.get(l.milestoneId);
    if (!c || l.archivedAt) continue;
    // Pas de reclassement de l'historique : une tâche d'avant la mise en route ne compte pas.
    if (depuis && (!l.createdAt || l.createdAt.getTime() < depuis.getTime())) continue;
    c.prevues += 1;
    if (l.completed) c.faites += 1;
  }
  return carte;
}
