/**
 * La réception MESURÉE CONTRE l'intention — la triangulation Fil 1 × Fil 3.
 *
 * Des saves élevés sur un post d'awareness sont un succès ; les mêmes saves sur un post
 * de conversion qui n'a rien converti sont un échec. C'est toute la règle.
 *
 * Fonction PURE : aucune base, aucun modèle, aucune horloge. Testable isolément.
 *
 * On ne mesure JAMAIS les likes (vanité) et on ne raisonne QUE sur des taux normalisés
 * par la portée. Sans portée, un compteur brut ne veut rien dire : on renvoie `null`,
 * jamais `0` — l'absence de mesure n'est pas une mauvaise mesure.
 */

export type Intent = "awareness" | "consideration" | "conversion";

export interface ScoreInput {
  intent: Intent | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  reach: number | null;
  /** -1..1, optionnel. Voir D5 de la spec : aucun calcul automatique dans ce lot. */
  sentimentScore: number | null;
  /** Reste 0 tant que le LOT 3B (attribution) n'existe pas. */
  conversionsInWindow: number;
}

export interface ScoreResult {
  score: number | null;
  confidence: number;
  rationale: string;
}

/**
 * Taux considérés comme « bons ». DÉFAUTS RÉVISABLES — pas des vérités.
 * Un taux brut n'est pas un score : il se compare à une référence.
 */
export const REFERENCE_RATES = {
  saves: 0.02,
  shares: 0.01,
  comments: 0.01,
  conversions: 0.005,
} as const;

/** Poids par intention. DÉFAUTS RÉVISABLES. La conversion est ignorée hors intention conversion. */
export const INTENT_WEIGHTS: Record<Intent, Record<keyof typeof REFERENCE_RATES, number>> = {
  awareness:     { saves: 0.25, shares: 0.60, comments: 0.15, conversions: 0 },
  consideration: { saves: 0.45, shares: 0.20, comments: 0.35, conversions: 0 },
  conversion:    { saves: 0.15, shares: 0.05, comments: 0.10, conversions: 0.70 },
};

/** Portée au-delà de laquelle la mesure est jugée pleinement fiable. RÉVISABLE. */
export const REFERENCE_REACH = 500;

/** Le sentiment module le score d'au plus ±10 % : il nuance, il ne décide pas. RÉVISABLE. */
export const SENTIMENT_INFLUENCE = 0.1;

/** Facteur appliqué à la confiance quand le sentiment est inconnu. RÉVISABLE. */
const NO_SENTIMENT_CONFIDENCE = 0.9;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const LABELS: Record<keyof typeof REFERENCE_RATES, string> = {
  saves: "les enregistrements",
  shares: "les partages",
  comments: "les commentaires",
  conversions: "la conversion",
};

export function receivedVsIntentScore(input: ScoreInput): ScoreResult {
  const { intent, reach, sentimentScore } = input;

  if (!intent) {
    return {
      score: null,
      confidence: 0,
      rationale:
        "Ce contenu n'a pas d'intention déclarée : on ne peut pas juger sa réception contre elle. Il est exclu du scoring, ce n'est pas un échec.",
    };
  }

  if (reach === null || reach === undefined || reach <= 0) {
    return {
      score: null,
      confidence: 0,
      rationale:
        "Portée inconnue : sans elle, un compteur brut ne dit rien. On ne fabrique pas de taux — la mesure attend.",
    };
  }

  const weights = INTENT_WEIGHTS[intent];
  const raw: Record<keyof typeof REFERENCE_RATES, number | null> = {
    saves: input.saves,
    shares: input.shares,
    comments: input.comments,
    // La conversion est toujours connue : 0 conversion est une information, pas une absence.
    conversions: input.conversionsInWindow,
  };

  let score = 0;
  let presentWeight = 0;
  let totalWeight = 0;
  let best: { key: keyof typeof REFERENCE_RATES; sub: number } | null = null;

  for (const key of Object.keys(weights) as (keyof typeof REFERENCE_RATES)[]) {
    const w = weights[key];
    if (w <= 0) continue;
    totalWeight += w;

    const value = raw[key];
    if (value === null || value === undefined) continue; // absent ≠ zéro
    presentWeight += w;

    const sub = clamp01(value / reach / REFERENCE_RATES[key]);
    score += w * sub;
    if (!best || w > weights[best.key]) best = { key, sub };
  }

  const completeness = totalWeight > 0 ? presentWeight / totalWeight : 0;
  const reachConfidence = clamp01(reach / REFERENCE_REACH);
  const confidence = clamp01(
    reachConfidence * completeness * (sentimentScore === null ? NO_SENTIMENT_CONFIDENCE : 1),
  );

  if (sentimentScore !== null && sentimentScore !== undefined) {
    // Le sentiment nuance d'au plus ±10 % : un accueil hostile abîme un bon score,
    // il ne le renverse pas.
    const s = Math.min(1, Math.max(-1, sentimentScore));
    score = score * (1 + SENTIMENT_INFLUENCE * s);
  }
  score = clamp01(score);

  const dominant = best ? LABELS[best.key] : "aucun signal";
  const verdict =
    best === null ? "aucun signal exploitable"
    : best.sub >= 0.6 ? `${dominant} portent bien`
    : best.sub >= 0.3 ? `${dominant} restent tièdes`
    : `${dominant} ne suivent pas`;

  const rationale =
    `Intention ${intent} : ${verdict}. ` +
    (score < 0.4
      ? `Ce contenu n'a pas trouvé son public sur ce qui comptait pour lui.`
      : score < 0.7
        ? `Réception correcte, sans plus, au regard de ce qu'il visait.`
        : `Ce contenu a fait ce qu'on attendait de lui.`);

  return { score, confidence, rationale };
}
