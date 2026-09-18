/**
 * Qualification d'un prospect à partir de son audit. PURE.
 *
 * Demande de Jeanne (18 septembre 2026) : « à partir du moment où elle fait l'audit, il faut
 * qu'elle se demande si c'est un prospect intelligent ou non, et du coup est-ce qu'on le
 * garde ou non dans la campagne ».
 *
 * L'audit existait déjà, et il est riche : pour CHANEL il connaît la maison fondée en 1910,
 * son actionnariat privé, ses huit millions d'abonnés, sa communication délibérément en
 * retrait. Mais rien ne le JUGEAIT. Il était écrit, stocké, et servait à rédiger un message.
 * Les 120 prospects de la production sont tous `discovered` : aucun n'a jamais été qualifié
 * ni écarté.
 *
 * ── La règle qui gouverne ce module ──────────────────────────────────────────
 * Un prospect n'est JAMAIS écarté en silence. Le retrait exige un verdict explicite ET une
 * confiance haute ET une raison écrite. Tout le reste remonte à l'humaine. C'est le même
 * principe que la barrière de validation : Naya prépare, Jeanne décide.
 */

export const VERDICTS = ["retenu", "ecarte", "attention_particuliere"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CONFIANCES = ["haute", "moyenne", "basse"] as const;
export type Confiance = (typeof CONFIANCES)[number];

export interface Qualification {
  verdict: Verdict;
  /** Pourquoi. Jamais vide : c'est ce qui rend un tri automatique contestable. */
  raison: string;
  confiance: Confiance;
}

/**
 * Lit la réponse du modèle. Ne lève jamais ; rend `null` sur tout ce qui n'est pas
 * exploitable, et `null` veut dire « pas qualifié », jamais « écarté ».
 */
export function lireQualification(brut: unknown): Qualification | null {
  if (typeof brut !== "object" || brut === null) return null;
  const o = brut as Record<string, unknown>;

  const verdict = (VERDICTS as readonly string[]).includes(o.verdict as string)
    ? (o.verdict as Verdict)
    : null;
  if (!verdict) return null;

  // Un prospect écarté sans motif est un prospect perdu sans recours : Jeanne ne peut ni
  // comprendre ni corriger. La raison est la condition, pas une décoration.
  const raison = typeof o.raison === "string" ? o.raison.trim() : "";
  if (!raison) return null;

  // Confiance absente ou inconnue → BASSE. On ne prête pas au modèle une assurance qu'il
  // n'a pas exprimée ; la prudence ne coûte qu'une relecture.
  const confiance = (CONFIANCES as readonly string[]).includes(o.confiance as string)
    ? (o.confiance as Confiance)
    : "basse";

  return { verdict, raison, confiance };
}

export type DecisionCampagne =
  /** Le prospect reste dans la campagne. */
  | "garder"
  /** Retiré de la campagne — le seul cas qui agit sans relecture. */
  | "retirer"
  /** Remonté à l'humaine : doute, ou prospect qui demande une autre approche. */
  | "signaler"
  /** Jamais qualifié. On ne touche à rien. */
  | "indecis";

/**
 * Que faire de ce prospect dans sa campagne ?
 *
 * `retirer` n'est atteignable que par un `ecarte` de confiance haute. Écarter sur une
 * intuition faible, c'est perdre un client possible sans que personne ne le sache.
 *
 * `attention_particuliere` est toujours signalé, quelle que soit la confiance : c'est le cas
 * CHANEL — pas un mauvais prospect, un prospect qui demande une autre approche. La décision
 * de ce qu'on lui envoie revient à Jeanne.
 */
export function decisionCampagne(q: Qualification | null | undefined): DecisionCampagne {
  if (!q) return "indecis";

  switch (q.verdict) {
    case "retenu":
      return "garder";
    case "attention_particuliere":
      return "signaler";
    case "ecarte":
      return q.confiance === "haute" ? "retirer" : "signaler";
    default:
      // Un verdict hors énumération ne doit jamais agir. `lireQualification` l'écarte déjà ;
      // ce cas protège les appelants qui construiraient une Qualification à la main.
      return "indecis";
  }
}

/**
 * Les champs à écrire sur le prospect après qualification. PURE.
 *
 * Extraite du pipeline pour une raison précise : le branchement n'était couvert par AUCUN
 * test. Remplacer `decision === "retirer"` par `decision !== "garder"` — ce qui aurait retiré
 * de la campagne tous les prospects signalés ET tous les non qualifiés — passait les 1278
 * tests du dépôt sans en casser un seul.
 *
 * Le verdict est écrit MÊME quand il vaut `retenu` : savoir qu'un prospect a été jugé et
 * retenu n'est pas la même chose que ne pas l'avoir jugé.
 */
export function champsMiseAJourQualification(
  q: Qualification | null | undefined,
  maintenant: Date,
): Record<string, unknown> {
  const decision = decisionCampagne(q);
  const champs: Record<string, unknown> = {};

  if (q) {
    champs.qualificationVerdict = q.verdict;
    champs.qualificationRaison = q.raison;
    champs.qualificationConfiance = q.confiance;
    champs.qualifiedAt = maintenant;
  }

  // SEUL « retirer » detache de la campagne. `signaler` et `indecis` laissent le prospect
  // exactement ou il est : c'est a l'utilisatrice de trancher.
  if (decision === "retirer") champs.prospectionCampaignId = null;

  return champs;
}
