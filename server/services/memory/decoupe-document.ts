/**
 * Découpage d'un dossier de recherche en morceaux retrouvables. PURE.
 *
 * Demande de Jeanne (18 septembre 2026) : pouvoir déposer des dossiers de recherche sur ce
 * qui fonctionne en digital, pour que Naya s'en serve dans sa création de contenu et dans sa
 * prospection — « plus pointue, moins générique ».
 *
 * Un dossier fait plusieurs pages ; un embedding porte sur un texte court. Il faut donc
 * découper, et tout le risque est là : un découpage qui perd du texte fait disparaître
 * silencieusement ce que Jeanne a pris la peine de rassembler, sans que personne ne s'en
 * aperçoive. D'où l'invariant testé — recoller les morceaux redonne le document.
 *
 * Deux principes de coupe, dans cet ordre :
 *   1. On coupe sur les frontières de PARAGRAPHE tant que c'est possible.
 *   2. Un paragraphe trop long est coupé sur des frontières de PHRASE, jamais au milieu
 *      d'un mot — un fragment sans début ni fin donne un embedding sans signification.
 */

/**
 * Taille visée d'un morceau, en caractères.
 *
 * Assez grand pour qu'un morceau porte une idée complète, assez petit pour qu'un embedding
 * reste précis : un vecteur calculé sur trois pages ne distingue plus rien.
 */
export const TAILLE_MAX_MORCEAU = 1200;

/**
 * En dessous, un morceau est regroupé avec le suivant.
 *
 * Sans ce seuil, « Titre », « Introduction », « 1. » deviendraient des entrées de mémoire
 * sans contenu, qui remonteraient dans toutes les recherches sans rien apporter.
 */
export const TAILLE_MIN_MORCEAU = 120;

export interface OptionsDecoupe {
  tailleMax?: number;
  tailleMin?: number;
}

export function decouperDocument(
  texte: string | null | undefined,
  options: OptionsDecoupe = {},
): string[] {
  const tailleMax = options.tailleMax ?? TAILLE_MAX_MORCEAU;
  const tailleMin = options.tailleMin ?? TAILLE_MIN_MORCEAU;

  const doc = (texte ?? "").trim();
  if (!doc) return [];

  const paragraphes = doc
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const morceaux: string[] = [];
  let courant = "";

  const pousser = () => {
    const t = courant.trim();
    if (t) morceaux.push(t);
    courant = "";
  };

  for (const paragraphe of paragraphes) {
    // Un paragraphe qui tient dans un morceau vide mais pas dans le courant : on ferme.
    if (courant && courant.length + 1 + paragraphe.length > tailleMax) pousser();

    if (paragraphe.length <= tailleMax) {
      courant = courant ? `${courant} ${paragraphe}` : paragraphe;
      // Un morceau suffisamment garni est ferme : on ne cherche pas a remplir jusqu'au bord.
      if (courant.length >= tailleMax - tailleMin) pousser();
      continue;
    }

    // Paragraphe trop long pour tenir seul : on coupe sur les phrases.
    pousser();
    for (const phrase of couperEnPhrases(paragraphe, tailleMax)) {
      if (courant && courant.length + 1 + phrase.length > tailleMax) pousser();
      courant = courant ? `${courant} ${phrase}` : phrase;
    }
    pousser();
  }
  pousser();

  // Un dernier morceau trop court est recolle au precedent plutot que de rester en miette.
  if (morceaux.length > 1) {
    const dernier = morceaux[morceaux.length - 1];
    if (dernier.length < tailleMin && morceaux[morceaux.length - 2].length + 1 + dernier.length <= tailleMax) {
      morceaux.splice(morceaux.length - 2, 2, `${morceaux[morceaux.length - 2]} ${dernier}`);
    }
  }

  return morceaux;
}

/**
 * Coupe un paragraphe en phrases, et une phrase démesurée en tranches sur des espaces.
 *
 * Couper au milieu d'un mot produirait un fragment illisible dont l'embedding ne voudrait
 * rien dire ; on préfère une tranche un peu plus courte.
 */
function couperEnPhrases(paragraphe: string, tailleMax: number): string[] {
  const phrases = paragraphe.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraphe];
  const sortie: string[] = [];

  for (const brute of phrases) {
    const phrase = brute.trim();
    if (!phrase) continue;
    if (phrase.length <= tailleMax) {
      sortie.push(phrase);
      continue;
    }
    // Phrase plus longue qu'un morceau entier : on tranche sur des espaces.
    let reste = phrase;
    while (reste.length > tailleMax) {
      const coupe = reste.lastIndexOf(" ", tailleMax);
      const position = coupe > tailleMax / 2 ? coupe : tailleMax;
      sortie.push(reste.slice(0, position).trim());
      reste = reste.slice(position).trim();
    }
    if (reste) sortie.push(reste);
  }
  return sortie;
}
