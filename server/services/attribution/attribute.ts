/**
 * RÉPARTITION DU CRÉDIT D'UNE CONVERSION — fonctions PURES.
 *
 * ═══ INTERDIT ABSOLU : PAS DE LAST-TOUCH ═══
 *
 * Une conversion n'est JAMAIS créditée au dernier contenu publié avant elle. Elle est
 * créditée à la FENÊTRE de contenus qui l'a précédée, répartie entre eux.
 *
 * La raison, et elle n'est pas esthétique : une conversion est un signal LENT de marque,
 * pas un applaudissement de post. Elle résulte du cumul de plusieurs contenus. Créditer le
 * dernier reviendrait à apprendre que « les posts d'offre convertissent » alors que le
 * travail a souvent été fait des semaines plus tôt par le contenu qui a fait découvrir la
 * marque. Naya en tirerait une leçon fausse, et cette leçon remonterait dans la génération
 * de contenu. On apprendrait faux, à grande échelle, sans jamais s'en apercevoir.
 *
 * Aucun chemin de ce fichier ne peut produire un poids de 1 sur un contenu quand la fenêtre
 * en contient plusieurs — c'est testé (« ne crédite jamais 100 % au contenu le plus récent »).
 */

export interface ConversionForAttribution {
  id: number;
  projectId: number;
  convertedAt: Date;
  /** FIGÉ sur la ligne de conversion au moment du calcul — jamais relu depuis le projet. */
  attributionWindowDays: number;
}

export interface ContentCandidate {
  id: number;
  projectId: number;
  publishedAt: Date | null;
}

export interface ContentInWindow {
  id: number;
  publishedAt: Date;
}

export interface CreditLine {
  contentId: number;
  creditWeight: number;
}

/**
 * DÉFAUT PROVISOIRE — décision Jeanne du 31 août 2026, pas une vérité.
 *
 * Linéaire uniforme : chaque contenu de la fenêtre reçoit `1/n`. Retenu contre la
 * décroissance exponentielle pour une raison d'asymétrie des erreurs : si le linéaire se
 * trompe, un contenu réellement décisif reçoit 20 % au lieu de 50 % — il reste visible ; si
 * l'exponentiel se trompe, il reçoit 6 % — il disparaît. Quand on ne peut rien calibrer, on
 * choisit le schéma dont l'échec est le moins destructeur.
 *
 * CONDITIONS DE BASCULE VERS L'EXPONENTIEL (à ne pas franchir sur une intuition) :
 *   - au moins 20 conversions attribuées, sur au moins 2 marques ;
 *   - ET un écart mesurable entre l'âge médian des contenus des fenêtres qui ont converti
 *     et celui des fenêtres qui n'ont pas converti.
 * Sinon, on ne bascule pas. Le changement est réversible sans migration : le poids est
 * stocké et le recalcul est idempotent.
 */
export const LINEAR_UNIFORM = "linear_uniform" as const;
export type AttributionPolicy = typeof LINEAR_UNIFORM;

const JOUR_MS = 86_400_000;

/**
 * Les contenus de la fenêtre d'une conversion.
 *
 * Bornes INCLUSIVES des deux côtés (décision actée n°3 pour la borne basse, symétrie pour
 * la haute). L'arithmétique est en millisecondes — `attributionWindowDays × 24 h`, pas des
 * jours calendaires : déterministe et insensible au fuseau, comme le reste du Fil 3.
 *
 * L'intention du contenu n'entre PAS dans la sélection : tout contenu publié de la marque
 * compte. C'est précisément ce qui permettra ensuite de mesurer quelle intention a porté
 * la conversion.
 */
export function selectContentsInWindow(
  conversion: ConversionForAttribution,
  candidates: ContentCandidate[],
): ContentInWindow[] {
  const fin = conversion.convertedAt.getTime();
  const debut = fin - conversion.attributionWindowDays * JOUR_MS;

  return candidates
    .filter((c) => {
      if (c.projectId !== conversion.projectId) return false;
      if (!c.publishedAt) return false;
      const t = c.publishedAt.getTime();
      return t >= debut && t <= fin;
    })
    .map((c) => ({ id: c.id, publishedAt: c.publishedAt as Date }))
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.id - b.id);
}

/**
 * Répartit le crédit d'une conversion sur les contenus de sa fenêtre.
 *
 * Une fenêtre vide renvoie `[]` : la conversion existe, elle n'est créditée à personne.
 * Ce n'est pas une erreur et il ne faut forcer aucun rattachement.
 *
 * La somme vaut EXACTEMENT 1 : `1/n` ne se somme pas à 1 en virgule flottante, donc les
 * n−1 premiers reçoivent `1/n` et le dernier absorbe le résidu. L'écart au `1/n` théorique
 * est de l'ordre de 1e-16.
 */
export function attribute(
  conversion: ConversionForAttribution,
  contentsInWindow: ContentInWindow[],
  policy: AttributionPolicy = LINEAR_UNIFORM,
): CreditLine[] {
  void policy; // un seul schéma aujourd'hui ; le paramètre existe pour la bascule documentée
  const n = contentsInWindow.length;
  if (n === 0) return [];

  const part = 1 / n;
  const lignes: CreditLine[] = [];
  let cumul = 0;

  for (let i = 0; i < n - 1; i++) {
    lignes.push({ contentId: contentsInWindow[i].id, creditWeight: part });
    cumul += part;
  }
  lignes.push({ contentId: contentsInWindow[n - 1].id, creditWeight: 1 - cumul });

  return lignes;
}
