// Les tâches générées repérées comme faisant avancer un jalon verrouillé. PURE (aucune I/O).
//
// Une marque plutôt qu'un retrait immédiat : la journée et le mois renvoient des dépendances
// PAR POSITION (« la tâche 2 dépend de la tâche 0 »). Retirer une tâche dans le générateur
// décalerait toutes les positions. Le retrait se fait dans `filtrerTachesGenerees`, qui garde
// déjà les positions d'origine.
//
// La marque est une propriété à clé Symbol, et non l'identité de l'objet : entre la génération
// et le filtre, les routes RECOPIENT les tâches (`{ ...t, __srcIndex }` pour le mois et le
// planificateur, `normaliseTaskData` pour la journée). Une copie par étalement emporte les
// propriétés Symbol énumérables ; `JSON.stringify`, `Object.keys` et les insertions Drizzle
// (colonnes nommées) les ignorent : la marque n'atteint jamais la base ni une réponse.
const MARQUE = Symbol("jalonVerrouille");

export function marquer(tache: unknown): void {
  if (tache && typeof tache === "object") (tache as any)[MARQUE] = true;
}

export function estPourJalonVerrouille(tache: unknown): boolean {
  return !!tache && typeof tache === "object" && (tache as any)[MARQUE] === true;
}
