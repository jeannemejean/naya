// Helpers PURS pour la sélection groupée de prospects (Outreach CRM).
// État de sélection local (Set d'ids), non persisté.

export type HeaderState = "none" | "some" | "all";

/**
 * État de la checkbox « Tout sélectionner » selon la sélection visible :
 * - "none"  : rien de sélectionné (ou aucune ligne)  → checkbox vide
 * - "all"   : toutes les lignes visibles sélectionnées → checkbox cochée
 * - "some"  : sélection partielle                      → checkbox INDÉTERMINÉE
 */
export function headerCheckboxState(selectedVisibleCount: number, totalVisible: number): HeaderState {
  if (totalVisible <= 0 || selectedVisibleCount <= 0) return "none";
  if (selectedVisibleCount >= totalVisible) return "all";
  return "some";
}

/** Ajoute/retire un id de la sélection (renvoie un nouveau Set, immuable). */
export function toggleId(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Sélectionne (ou désélectionne) en masse un lot d'ids (renvoie un nouveau Set). */
export function setSelection(set: ReadonlySet<number>, ids: number[], selected: boolean): Set<number> {
  const next = new Set(set);
  for (const id of ids) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Nombre d'ids sélectionnés parmi une liste visible. */
export function countSelectedIn(set: ReadonlySet<number>, visibleIds: number[]): number {
  let n = 0;
  for (const id of visibleIds) if (set.has(id)) n++;
  return n;
}
