/**
 * L'état réel d'une connexion à un réseau social. PURE.
 *
 * Le défaut constaté le 18 septembre 2026 : les deux comptes de la production portaient
 * `is_active = true` alors que leurs jetons étaient morts depuis 56 jours (LinkedIn) et
 * 26 jours (Instagram). L'écran Réglages affichait « Connecté ». Ni la publication ni rien
 * d'autre ne fonctionnait, et rien ne le disait.
 *
 * `is_active` ne dit pas si la connexion marche : il dit qu'elle n'a pas été révoquée depuis
 * l'application. C'est une INTENTION, pas un état. Les confondre, c'est présenter une absence
 * comme une santé.
 *
 * Google Calendar, dans ce même dépôt, rafraîchit son jeton. Les réseaux sociaux, non — et
 * personne ne vérifiait l'expiration avant de s'en servir.
 */

export type EtatConnexion =
  /** Jeton valide, échéance connue et lointaine. */
  | "connectee"
  /** Jeton encore valide mais bientôt mort : c'est le moment de le renouveler. */
  | "expire_bientot"
  /** Jeton mort. La publication échouera. */
  | "expiree"
  /** Pas de jeton, ou connexion désactivée. */
  | "absente"
  /** Jeton présent, échéance inconnue — on ne prétend ni qu'il est sain ni qu'il est mort. */
  | "echeance_inconnue";

/**
 * Fenêtre de renouvellement avant l'échéance.
 *
 * Sept jours : assez tôt pour que plusieurs tentatives puissent échouer sans casser la
 * publication, assez tard pour ne pas renouveler en permanence.
 */
export const MARGE_RAFRAICHISSEMENT_JOURS = 7;

export interface EntreeEtat {
  accessToken: string | null | undefined;
  isActive: boolean | null | undefined;
  expiresAt: Date | null | undefined;
  now: Date;
}

export function etatConnexion(e: EntreeEtat): EtatConnexion {
  // Sans jeton, ou explicitement désactivée : il n'y a pas de connexion à qualifier.
  if (!e.accessToken || !e.isActive) return "absente";

  // Une date INVALIDE — `new Date("x")` est un objet Date réel dont le temps vaut NaN — doit
  // être traitée ici. Toute comparaison avec NaN étant fausse, elle passerait sinon par tous
  // les tests d'expiration et un jeton mort serait déclaré connecté.
  const echeance = e.expiresAt instanceof Date && !Number.isNaN(e.expiresAt.getTime())
    ? e.expiresAt
    : null;
  if (!echeance) return "echeance_inconnue";

  const restantMs = echeance.getTime() - e.now.getTime();
  if (restantMs <= 0) return "expiree";
  if (restantMs <= MARGE_RAFRAICHISSEMENT_JOURS * 86_400_000) return "expire_bientot";
  return "connectee";
}

/**
 * Faut-il tenter un renouvellement ?
 *
 * `expiree` en fait partie : un jeton de rafraîchissement peut survivre à son jeton d'accès.
 * Renoncer d'emblée imposerait une reconnexion manuelle là où un appel aurait suffi.
 *
 * `echeance_inconnue` n'en fait PAS partie : rafraîchir sans savoir pourquoi consomme un
 * quota et risque d'invalider un jeton qui fonctionne.
 */
export function doitEtreRafraichie(etat: EtatConnexion): boolean {
  switch (etat) {
    case "expire_bientot":
    case "expiree":
      return true;
    case "connectee":
    case "absente":
    case "echeance_inconnue":
      return false;
  }
}
