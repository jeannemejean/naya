// Garde anti-concurrence à un seul créneau, pour un geste déclenché par un clic qui ne
// passe par AUCUNE mutation react-query (donc par aucun `isPending` existant) pendant
// sa propre phase réseau — typiquement un `fetch` brut suivi d'une mutation séparée.
//
// `verrou` est un objet MUTABLE (porté par une `useRef` côté appelant), pas un état
// React : un `setState` ne change la valeur lue par les CLOSURES suivantes qu'au
// PROCHAIN rendu — deux appels déclenchés avant ce rendu liraient tous deux l'ancienne
// valeur d'un state, alors qu'une ref change immédiatement, dans le même tick. C'est
// cette lecture immédiate qui ferme réellement la fenêtre d'un double clic rapide ; un
// état React ne sert qu'à REFLÉTER la garde dans le JSX (désactiver un bouton), jamais
// à la faire respecter.
//
// Fichier séparé de la page qui l'utilise (plutôt qu'une fonction locale) : ce dépôt a
// `tsconfig.json` en `"jsx": "preserve"` sans plugin React dans `vitest.config.ts`, donc
// un fichier `.tsx` contenant du vrai JSX échoue à l'import direct par un test (voir
// `ErrorBoundary.tsx`, qui documente la même contrainte). Un module `.ts` pur, comme
// celui-ci, s'importe et se teste sans ce problème.

/**
 * Rend `null` sans rien exécuter si un passage est déjà en cours (deuxième appel
 * ignoré) ; sinon pose le verrou, exécute `tache`, et le libère que `tache` réussisse
 * ou échoue — jamais de verrou qui reste posé après coup.
 */
export function tenterUneFois<T>(
  verrou: { current: boolean },
  tache: () => Promise<T>,
): Promise<T> | null {
  if (verrou.current) return null;
  verrou.current = true;
  return tache().finally(() => { verrou.current = false; });
}
