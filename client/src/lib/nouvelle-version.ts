// Détecter qu'une nouvelle version de Naya est en ligne. PUR.
//
// Le 6 octobre 2026, un onglet ouvert avant un déploiement a continué de tourner sur
// l'ancien code : les livrables étaient en ligne, mais Jeanne ne pouvait que cocher sa
// tâche. Une application d'une seule page ne se recharge jamais d'elle-même. On compare
// donc le bundle principal servi aujourd'hui (Vite le nomme `index-<hash>.js`, le hash
// change à chaque build) à celui que l'onglet a chargé.

const MOTIF_BUNDLE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

/** Le chemin du bundle principal référencé par une page HTML, ou null (mode dev, page illisible). */
export function scriptPrincipal(html: string): string | null {
  return html.match(MOTIF_BUNDLE)?.[0] ?? null;
}

/**
 * Vrai seulement si l'on sait les deux bundles ET qu'ils diffèrent. Dans le doute, on ne
 * dérange pas : un faux « nouvelle version » qui revient sans cesse serait pire que rien.
 */
export function nouvelleVersionDisponible(bundleCourant: string | null, htmlServi: string): boolean {
  if (!bundleCourant) return false;
  const servi = scriptPrincipal(htmlServi);
  return servi !== null && servi !== bundleCourant;
}
