/**
 * Ce que Naya vient de comprendre — une phrase, ou le silence.
 *
 * PURE : aucune base, aucune horloge, aucun appel modèle.
 *
 * Le silence est une sortie VALIDE et préférable à une banalité : c'est la même
 * règle que le `rationale` du score de réception. Et jamais de compteur, jamais de
 * palmarès, jamais de comparaison entre catégories — les interdits du Fil 3
 * s'appliquent ici aussi.
 *
 * ⚠️ Ce qu'on NE PEUT PAS dire aujourd'hui : rien sur les DURÉES. `actualDuration`
 * n'est jamais renseignée (on ne mesure pas l'heure de début), donc toute phrase du
 * type « tu finis plus vite que prévu » serait inventée.
 */

export interface TaskAnswer {
  /** Catégorie de la tâche. `null` = inconnue : on n'en dit jamais rien. */
  category: string | null;
  /** Heure de fin planifiée, 0-23. */
  scheduledHour: number;
  /** `true` = « Fait ». Une notification ignorée n'entre PAS ici. */
  done: boolean;
}

/** Observations minimales avant d'affirmer un motif. DÉFAUT RÉVISABLE. */
export const MIN_OBSERVATIONS = 5;

/** Sous ce taux d'achèvement, on considère que la catégorie ne passe pas. RÉVISABLE. */
const SEUIL_BAS = 0.25;
/** Écart minimal entre matin et après-midi pour le mentionner. RÉVISABLE. */
const ECART_MIN = 0.4;

const MIDI = 13;

export function buildImmediateInsight(answers: TaskAnswer[]): string | null {
  if (answers.length < MIN_OBSERVATIONS) return null;

  // 1. Une catégorie qui ne passe jamais.
  const parCategorie = new Map<string, { total: number; faits: number }>();
  for (const a of answers) {
    if (!a.category) continue; // une catégorie inconnue n'est jamais citée
    const e = parCategorie.get(a.category) ?? { total: 0, faits: 0 };
    e.total++;
    if (a.done) e.faits++;
    parCategorie.set(a.category, e);
  }

  for (const [cat, e] of Array.from(parCategorie.entries())) {
    if (e.total < MIN_OBSERVATIONS) continue;
    if (e.faits / e.total <= SEUIL_BAS) {
      return `Les tâches « ${cat} » ne passent presque jamais. C'est peut-être le moment de les poser autrement.`;
    }
  }

  // 2. L'écart matin / après-midi.
  const matin = answers.filter((a) => a.scheduledHour < MIDI);
  const aprem = answers.filter((a) => a.scheduledHour >= MIDI);
  if (matin.length >= MIN_OBSERVATIONS && aprem.length >= MIN_OBSERVATIONS) {
    const tm = matin.filter((a) => a.done).length / matin.length;
    const ta = aprem.filter((a) => a.done).length / aprem.length;
    if (tm - ta >= ECART_MIN) {
      return `Ce qui est posé le matin se fait ; l'après-midi décroche. Je peux en tenir compte.`;
    }
    if (ta - tm >= ECART_MIN) {
      return `Tes après-midis tiennent mieux que tes matinées. Je peux en tenir compte.`;
    }
  }

  return null;
}
