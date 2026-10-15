// Les tâches générées repérées comme faisant avancer un jalon verrouillé. PURE (aucune I/O).
//
// Une marque plutôt qu'un retrait immédiat : la journée et le mois renvoient des dépendances
// PAR POSITION (« la tâche 2 dépend de la tâche 0 »). Retirer une tâche dans le générateur
// décalerait toutes les positions. Le retrait se fait dans `filtrerTachesGenerees`, qui garde
// déjà les positions d'origine. Un WeakSet plutôt qu'un champ ajouté à la tâche : rien de
// cette marque ne peut finir en base avec les données de la tâche.
const marquees = new WeakSet<object>();

export function marquer(tache: unknown): void {
  if (tache && typeof tache === "object") marquees.add(tache);
}

export function estPourJalonVerrouille(tache: unknown): boolean {
  return !!tache && typeof tache === "object" && marquees.has(tache);
}
