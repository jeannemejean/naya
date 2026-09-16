/**
 * État du bouton « Enregistrer » de l'espace de travail d'une tâche.
 *
 * Pourquoi ce module existe. L'enregistrement était automatique : chaque frappe armait un
 * minuteur de 800 ms. Un drapeau `hasUnsavedRef` était posé à chaque frappe et remis à zéro
 * à la fermeture du panneau — mais il n'était jamais lu. Fermer dans les 800 ms suivant la
 * dernière frappe annulait le minuteur et réinitialisait l'état : le texte disparaissait,
 * sans message et sans trace.
 *
 * Jeanne a demandé un bouton explicite. Le corollaire est qu'il faut savoir, à tout instant,
 * s'il reste du travail non enregistré — et cette réponse ne doit pas dépendre d'un minuteur.
 * D'où une fonction pure, vérifiable sans navigateur.
 */

export type EtatSauvegarde = "vide" | "modifie" | "enregistrement" | "enregistre";

export interface EntreeSauvegarde {
  contenu: string;
  titre: string;
  /** Ce qui se trouve réellement en base. `null` tant que rien n'a été enregistré. */
  contenuEnregistre: string | null;
  titreEnregistre: string | null;
  enCours: boolean;
}

export function etatSauvegarde(e: EntreeSauvegarde): EtatSauvegarde {
  if (e.enCours) return "enregistrement";

  // Un contenu blanc n'est pas enregistrable : il encombrerait l'historique sans rien dire.
  // Ce cas passe AVANT la comparaison — sinon un champ que l'on vient d'effacer afficherait
  // « enregistré », laissant croire que l'effacement a été pris en compte.
  if (!e.contenu.trim()) return "vide";

  const memeContenu = e.contenuEnregistre !== null && e.contenu === e.contenuEnregistre;
  const memeTitre = (e.titreEnregistre ?? "") === e.titre;

  return memeContenu && memeTitre ? "enregistre" : "modifie";
}

/**
 * Fermer le panneau dans cet état ferait-il perdre du travail ?
 *
 * `enregistrement` compte comme un risque : tant que la requête n'a pas abouti, le texte
 * n'est nulle part. C'est précisément la fenêtre où l'ancien code perdait les données.
 */
export function risqueDePerte(etat: EtatSauvegarde): boolean {
  switch (etat) {
    case "modifie":
    case "enregistrement":
      return true;
    case "vide":
    case "enregistre":
      return false;
  }
}
