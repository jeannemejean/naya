/**
 * La barrière de validation entre un prospect préparé et son entrée en campagne. PURE.
 *
 * Demande de Jeanne : « la tâche doit être réalisée par Naya en ne demandant qu'une simple
 * validation de l'utilisateur ». Naya prépare le message, l'humaine décide.
 *
 * Cette séparation n'est pas une commodité d'interface, c'est la seule conduite défendable.
 * LinkedIn n'accorde aucun accord d'automatisation pour les invitations et les messages : il
 * poursuit les éditeurs d'outils et applique aux comptes des restrictions graduées. Un
 * message part donc parce qu'une personne l'a voulu, jamais parce qu'un minuteur est arrivé
 * à échéance.
 *
 * C'est aussi la règle permanente de ce dépôt depuis l'incident des 14 posts publiés par
 * erreur : rien qui agit vers l'extérieur ne part sans qu'un humain l'ait décidé.
 */

export const ETATS_PROSPECT = [
  /** Trouvé par la recherche, rien de préparé. */
  "discovered",
  /** Naya a rédigé un message ciblé. En attente de la décision de l'utilisatrice. */
  "prepared",
  /** L'utilisatrice a approuvé. Seul état qui ouvre la campagne. */
  "validated",
  /** L'utilisatrice a écarté ce message. Pas un bannissement : il pourra être réécrit. */
  "rejected",
  /** Entré dans la séquence de campagne. */
  "enrolled",
] as const;

export type EtatProspect = (typeof ETATS_PROSPECT)[number];

/**
 * Le graphe, écrit une seule fois. Toute la sécurité du lot tient dans ce tableau :
 * `enrolled` n'est accessible que depuis `validated`.
 */
const TRANSITIONS: Readonly<Record<EtatProspect, readonly EtatProspect[]>> = {
  discovered: ["prepared"],
  prepared: ["validated", "rejected"],
  validated: ["enrolled"],
  rejected: ["prepared"],
  // Terminal : un prospect déjà en campagne n'y rentre pas une seconde fois.
  enrolled: [],
};

/**
 * Les deux seules transitions qu'une personne doit déclencher. Naya n'a pas le droit de les
 * franchir seule.
 *
 * L'entrée en campagne n'en fait pas partie : elle DÉCOULE de la validation. L'utilisatrice
 * décide du message, pas de la mécanique qui suit.
 */
export function transitionsHumaines(): [EtatProspect, EtatProspect][] {
  return [
    ["prepared", "validated"],
    ["prepared", "rejected"],
  ];
}

/**
 * Consultation par `Object.hasOwn` : `TRANSITIONS["constructor"]` rendrait sinon une valeur
 * héritée du prototype au lieu d'`undefined`. L'état vient d'une colonne de base, rien ne
 * garantit qu'elle ne portera jamais une valeur ancienne ou mal écrite. Dans le doute, on
 * refuse — on n'enrôle pas.
 */
export function transitionAutorisee(de: EtatProspect, vers: EtatProspect): boolean {
  if (typeof de !== "string" || typeof vers !== "string") return false;
  if (!Object.hasOwn(TRANSITIONS, de) || !Object.hasOwn(TRANSITIONS, vers)) return false;
  return TRANSITIONS[de].includes(vers);
}

/** Seul un prospect validé peut entrer en campagne. */
export function peutEntrerEnCampagne(etat: EtatProspect): boolean {
  return etat === "validated";
}

/**
 * Tous les chemins simples menant de `depart` à `enrolled`.
 *
 * Existe pour être TESTÉE, pas pour être appelée en production : elle permet de vérifier une
 * propriété du graphe entier — aucun chemin ne mène en campagne sans traverser `validated` —
 * plutôt que de vérifier les transitions une à une. Une transition ajoutée par mégarde plus
 * tard ferait tomber ce test, ce qu'une liste d'assertions ponctuelles ne garantirait pas.
 */
export function cheminVersCampagne(depart: EtatProspect): EtatProspect[][] {
  const chemins: EtatProspect[][] = [];

  const explorer = (courant: EtatProspect, vus: EtatProspect[]) => {
    if (courant === "enrolled") {
      // `vus` vide signifie que le départ EST la cible : un parcours de longueur nulle, qui
      // n'est pas un chemin. Le compter reviendrait à affirmer qu'on peut atteindre
      // `enrolled` sans transition — donc sans validation.
      if (vus.length > 0) chemins.push([...vus, courant]);
      return;
    }
    for (const suivant of TRANSITIONS[courant] ?? []) {
      if (vus.includes(suivant)) continue; // pas de boucle
      explorer(suivant, [...vus, courant]);
    }
  };

  if (Object.hasOwn(TRANSITIONS, depart)) explorer(depart, []);
  return chemins;
}
