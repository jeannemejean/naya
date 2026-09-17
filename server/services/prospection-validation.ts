/**
 * La barrière de validation : Naya prépare le message, l'humaine décide qu'il parte. PURE.
 *
 * Demande de Jeanne : « la tâche doit être réalisée par Naya en ne demandant qu'une simple
 * validation de l'utilisateur ».
 *
 * Cette séparation n'est pas une commodité d'interface. LinkedIn n'accorde aucun accord
 * d'automatisation pour les invitations et les messages : il poursuit les éditeurs d'outils
 * et applique aux comptes des restrictions graduées. Un message part parce qu'une personne
 * l'a voulu, jamais parce qu'un minuteur est arrivé à échéance. C'est aussi la règle
 * permanente de ce dépôt depuis l'incident des 14 posts publiés par erreur.
 *
 * ── Sur le vocabulaire ───────────────────────────────────────────────────────
 * Une première version de ce module inventait ses propres états — prepared, validated,
 * enrolled. C'était une faute : `leads.stage` porte DÉJÀ le pipeline, il est écrit par
 * prospection-pipeline.ts, lu par CampaignsGrid et stages.ts côté client, et couvert par
 * prospection-enrich.test.ts. Deux vocabulaires concurrents auraient diverge à la première
 * évolution. Ce module parle donc la langue du dépôt.
 *
 * Ce qui manquait n'était pas un état de plus, mais UN CRAN entre « messages prêts » et
 * « invitation envoyée » : l'accord explicite de l'utilisatrice, porté par `validatedAt`.
 */

/** Le pipeline existant, tel que `shared/schema.ts` le documente sur `leads.stage`. */
export const ETAPES_PROSPECT = [
  "identified",
  "messages_ready",
  "connection_sent",
  "connected",
  "followup1_sent",
  "followup2_sent",
  "in_discussion",
  "proposal_sent",
  "signed",
  "no_follow",
] as const;

export type EtapeProspect = (typeof ETAPES_PROSPECT)[number];

/**
 * L'étape à partir de laquelle Naya a fait son travail et attend une décision.
 * 43 prospects s'y trouvent déjà en production, dont 41 avec un message rédigé.
 */
export const ETAPE_EN_ATTENTE_DE_VALIDATION: EtapeProspect = "messages_ready";

/** La première étape qui touche réellement le prospect. Celle que la barrière protège. */
export const ETAPE_PREMIER_CONTACT: EtapeProspect = "connection_sent";

export interface ProspetValidable {
  stage: string | null | undefined;
  /** Instant de l'accord de l'utilisatrice. `null` = jamais validé, pas « validé à zéro ». */
  validatedAt: Date | null | undefined;
}

/**
 * Ce prospect peut-il être contacté ?
 *
 * Deux conditions, et les deux comptent. L'étape seule ne suffit pas : `messages_ready` dit
 * que Naya a écrit un message, pas que quelqu'un l'a lu. `validatedAt` seul ne suffit pas
 * non plus : une validation ancienne ne doit pas autoriser un contact si le prospect a
 * depuis quitté cette étape.
 */
export function peutEtreContacte(lead: ProspetValidable): boolean {
  return lead.stage === ETAPE_EN_ATTENTE_DE_VALIDATION && estValide(lead.validatedAt);
}

/**
 * `null` et `undefined` valent « jamais validé ». Une date invalide aussi : `new Date("x")`
 * est un objet Date parfaitement réel dont le temps est `NaN`, et un simple test de présence
 * le laisserait passer pour une validation.
 */
export function estValide(validatedAt: Date | null | undefined): boolean {
  return validatedAt instanceof Date && !Number.isNaN(validatedAt.getTime());
}

/**
 * Transition autorisée d'une étape à l'autre.
 *
 * `validee` n'est consultée que pour le passage au premier contact — c'est le seul endroit
 * où l'accord humain est requis. Le reste du pipeline avance sur des faits observés
 * (la personne a accepté, elle a répondu), pas sur des décisions.
 */
export function transitionAutorisee(
  de: string | null | undefined,
  vers: string | null | undefined,
  options: { validee: boolean } = { validee: false },
): boolean {
  if (typeof de !== "string" || typeof vers !== "string") return false;
  if (!Object.hasOwn(SUITES, de) || !(ETAPES_PROSPECT as readonly string[]).includes(vers)) {
    return false;
  }
  if (!SUITES[de as EtapeProspect].includes(vers as EtapeProspect)) return false;

  // LA barrière. Tout le lot tient dans ces deux lignes.
  if (vers === ETAPE_PREMIER_CONTACT) return options.validee;

  return true;
}

/**
 * Les suites possibles de chaque étape. `no_follow` est joignable depuis presque partout :
 * on peut renoncer à un prospect à tout moment.
 */
const SUITES: Readonly<Record<EtapeProspect, readonly EtapeProspect[]>> = {
  identified: ["messages_ready", "no_follow"],
  messages_ready: ["connection_sent", "no_follow"],
  connection_sent: ["connected", "no_follow"],
  connected: ["followup1_sent", "in_discussion", "no_follow"],
  followup1_sent: ["followup2_sent", "in_discussion", "no_follow"],
  followup2_sent: ["in_discussion", "no_follow"],
  in_discussion: ["proposal_sent", "no_follow"],
  proposal_sent: ["signed", "no_follow"],
  signed: [],
  // Renoncer n'est pas bannir : un prospect écarté peut être repréparé plus tard.
  no_follow: ["messages_ready"],
};

/**
 * La seule décision réservée à une personne : autoriser le premier contact.
 *
 * Existe pour être lue et testée. Si cette liste venait à grossir, c'est qu'une décision
 * humaine serait devenue automatisable sans que personne ne le remarque.
 */
export function transitionsHumaines(): [EtapeProspect, EtapeProspect][] {
  return [[ETAPE_EN_ATTENTE_DE_VALIDATION, ETAPE_PREMIER_CONTACT]];
}

/**
 * Tous les chemins simples menant de `depart` au premier contact, en ignorant la validation.
 *
 * Existe pour être TESTÉE : elle permet de vérifier une propriété du graphe entier — aucune
 * étape n'atteint le premier contact sans passer par `messages_ready`, donc sans passer par
 * le point où la validation est exigée. Un raccourci ajouté par mégarde la ferait tomber.
 */
export function cheminsVersPremierContact(depart: EtapeProspect): EtapeProspect[][] {
  const chemins: EtapeProspect[][] = [];

  const explorer = (courant: EtapeProspect, vus: EtapeProspect[]) => {
    if (courant === ETAPE_PREMIER_CONTACT) {
      // Un parcours sans transition n'est pas un parcours : le compter reviendrait à
      // affirmer qu'on atteint le premier contact sans rien franchir.
      if (vus.length > 0) chemins.push([...vus, courant]);
      return;
    }
    for (const suivant of SUITES[courant] ?? []) {
      if (vus.includes(suivant)) continue;
      explorer(suivant, [...vus, courant]);
    }
  };

  if (Object.hasOwn(SUITES, depart)) explorer(depart, []);
  return chemins;
}
