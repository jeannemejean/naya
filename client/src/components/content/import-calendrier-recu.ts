// Construction du reçu affiché après un import de calendrier réussi (Tâche 6).
//
// PUR — aucun accès réseau, aucun JSX — pour rester testable en environnement `node` sans
// jsdom (ce dépôt n'en a pas, voir le commentaire de `@/lib/one-shot-guard`). Le composant
// `import-calendrier.tsx` ne fait qu'appeler `construireRecu` et afficher les lignes.
//
// Le reçu est un CONSTAT ponctuel, jamais un compteur ni une série : chaque ligne décrit ce
// qui vient de se passer pour CE collage, rien de cumulatif. Aucune ligne à zéro — « 0 post
// ignoré » est du bruit — sauf les deux premières, qui restent la tête du reçu même à zéro
// (un import qui n'a rien trouvé reste un résultat qu'il faut pouvoir lire).

/** Forme du 200 de `POST /api/content/import`, réduite à ce que le reçu affiche. */
export interface ReponseImportCalendrier {
  posts: Array<{ scheduledFor: string | Date | null }>;
  ignores: number;
  couverture: number; // entier 0-100, déjà borné côté serveur
  tronque: boolean;
  collisions: Array<{ marque: string }>;
}

/** Accord simple singulier/pluriel sur un compte — ce dépôt n'a pas de pluriel i18n ici
 * (le reçu est construit en français brut, voir le commentaire de tête), donc la règle vit
 * ici plutôt que dans une clé de traduction. */
function accorder(n: number, singulier: string, pluriel: string): string {
  return n === 1 ? singulier : pluriel;
}

/** "Agence JMD", "Agence JMD et Studio X", "Agence JMD, Studio X et Autre" — jamais de
 * virgule finale avant le dernier élément. */
function enumerer(noms: string[]): string {
  const uniques = [...new Set(noms)];
  if (uniques.length <= 1) return uniques[0] ?? "";
  return `${uniques.slice(0, -1).join(", ")} et ${uniques[uniques.length - 1]}`;
}

/**
 * Rend les lignes du reçu, dans l'ordre d'affichage. Chaque ligne conditionnelle
 * (ignorés, collisions, tronqué) n'apparaît que si son compte est strictement positif.
 */
export function construireRecu(reponse: ReponseImportCalendrier): string[] {
  const total = reponse.posts.length;
  const dates = reponse.posts.filter((p) => p.scheduledFor !== null).length;
  const enReserve = total - dates;

  const lignes: string[] = [];

  lignes.push(
    `${total} ${accorder(total, "post créé", "posts créés")}, couvrant environ ${reponse.couverture} % de ton texte.`,
  );

  // Décompose la première ligne : n'a de sens que s'il y a au moins un post à répartir.
  if (total > 0) {
    lignes.push(
      `${dates} ${accorder(dates, "est daté", "sont datés")}, ${enReserve} ${accorder(enReserve, "est en réserve", "sont en réserve")}.`,
    );
  }

  if (reponse.ignores > 0) {
    lignes.push(
      `${reponse.ignores} ${accorder(
        reponse.ignores,
        "post était déjà présent, ignoré",
        "posts étaient déjà présents, ignorés",
      )}.`,
    );
  }

  if (reponse.collisions.length > 0) {
    const marques = enumerer(reponse.collisions.map((c) => c.marque));
    lignes.push(
      `${reponse.collisions.length} ${accorder(reponse.collisions.length, "recoupe", "recoupent")} du contenu déjà programmé sur ${marques}.`,
    );
  }

  if (reponse.tronque) {
    lignes.push("Ton texte était trop long pour un seul passage : une partie n'a pas été lue.");
  }

  return lignes;
}
