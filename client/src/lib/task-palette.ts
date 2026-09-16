/**
 * La palette de tâches de Naya — une seule, pour toute l'application.
 *
 * Elle existe parce que le dashboard et le planning peignaient les mêmes tâches avec deux
 * jeux de couleurs distincts. Les deux indexaient pourtant de la même manière
 * (`projectId % longueur`) : un projet tombait donc toujours sur la même CASE, seul le
 * contenu des cases différait. La divergence n'était pas une question de logique, mais de
 * duplication — d'où un module unique plutôt qu'une correction de chaque côté.
 *
 * `todays-tasks` choisissait en plus entre une variante claire et une variante sombre selon
 * `theme === 'dark'`. Or le thème par défaut est 'dark' (ThemeContext.tsx) alors qu'aucun
 * vrai mode sombre n'existe en CSS — `index.css` se contente de ramener les utilitaires
 * `dark:*` vers leurs valeurs claires. Le dashboard peignait donc des teintes sombres et
 * sourdes sur un fond clair. La variante sombre est supprimée : elle ne décrivait pas un
 * thème, elle décrivait un bug.
 *
 * Les couleurs sont celles de la marque (arbitrage de Jeanne, 2026-09-16), tirées des
 * tokens `naya-*` : sulphur, salvia, mauve, olive.
 */

export interface TaskPalette {
  bg: string;
  text: string;
  border: string;
}

/** 4 teintes de marque × 2 intensités = 7 variations, en rotation par projet. */
export const NAYA_TASK_PALETTES: readonly TaskPalette[] = [
  { bg: 'rgba(212,201,122,0.22)', text: '#5a4f0d', border: 'rgba(212,201,122,0.55)' }, // sulphur
  { bg: 'rgba(125,143,168,0.22)', text: '#354963', border: 'rgba(125,143,168,0.55)' }, // salvia
  { bg: 'rgba(158,126,135,0.22)', text: '#5c3d45', border: 'rgba(158,126,135,0.55)' }, // mauve
  { bg: 'rgba(43,45,28,0.10)',    text: '#2B2D1C', border: 'rgba(43,45,28,0.28)'   }, // olive
  { bg: 'rgba(212,201,122,0.13)', text: '#4a3e08', border: 'rgba(212,201,122,0.38)' }, // sulphur léger
  { bg: 'rgba(125,143,168,0.13)', text: '#354963', border: 'rgba(125,143,168,0.38)' }, // salvia léger
  { bg: 'rgba(158,126,135,0.13)', text: '#5c3d45', border: 'rgba(158,126,135,0.38)' }, // mauve léger
] as const;

/**
 * Couleur d'une tâche, à partir de son projet.
 *
 * Les trois cas d'absence — `null`, `undefined`, `0` — retombent sur la première teinte
 * plutôt que sur `undefined`. Sans ce garde, `undefined % 7` vaut `NaN`, `palettes[NaN]`
 * vaut `undefined`, et la tâche se retrouve sans couleur du tout : une absence rendue
 * invisible, exactement le motif corrigé neuf fois ailleurs dans ce dépôt.
 *
 * Le modulo est repris en valeur absolue : en JavaScript, `-1 % 7` vaut `-1`, et un index
 * négatif rendrait lui aussi `undefined`.
 */
export function taskPaletteFor(projectId: number | null | undefined): TaskPalette {
  const n = NAYA_TASK_PALETTES.length;
  if (typeof projectId !== 'number' || !Number.isFinite(projectId) || projectId === 0) {
    return NAYA_TASK_PALETTES[0];
  }
  return NAYA_TASK_PALETTES[Math.abs(Math.trunc(projectId)) % n];
}
