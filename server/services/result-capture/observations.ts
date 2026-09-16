/**
 * Toutes les observations que Naya peut tirer des réponses — pas seulement la
 * première. `buildImmediateInsight` (./insight.ts) produit une phrase de
 * NOTIFICATION et s'arrête à la première trouvaille ; cette fonction produit
 * des sujets de MÉMOIRE et les collecte tous, pour qu'une observation qui
 * n'a jamais été vue en notification ne soit pas perdue.
 *
 * Mêmes règles, mêmes seuils que buildImmediateInsight — voir ce fichier
 * pour leur justification. `MIN_OBSERVATIONS`, `SEUIL_BAS`, `ECART_MIN` et
 * `MIDI` y sont exportés et réutilisés ici tel quels : source unique, pas
 * de copie locale à garder synchronisée.
 *
 * PURE : aucune base, aucune horloge, aucun aléa.
 */

import { MIN_OBSERVATIONS, SEUIL_BAS, ECART_MIN, MIDI, type TaskAnswer } from "./insight";

export const PREFIXE_CATEGORIE = (categorie: string) => `Les tâches « ${categorie} » :`;
export const PREFIXE_MOMENT = "Ton rythme dans la journée :";

export interface Observation {
  /** Préfixe stable identifiant le SUJET. Deux observations de même préfixe se remplacent. */
  prefixe: string;
  /** Texte complet mémorisé, commençant TOUJOURS par `prefixe`. */
  contenu: string;
  /** Nombre de réponses qui fondent cette observation — sert à pondérer la salience. */
  appuis: number;
}

export function extractObservations(answers: TaskAnswer[]): Observation[] {
  if (answers.length < MIN_OBSERVATIONS) return [];

  const observations: Observation[] = [];

  // 1. Les catégories qui ne passent jamais — TOUTES, pas seulement la première.
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
      const prefixe = PREFIXE_CATEGORIE(cat);
      observations.push({
        prefixe,
        contenu: `${prefixe} elles ne passent presque jamais. C'est peut-être le moment de les poser autrement.`,
        appuis: e.total,
      });
    }
  }

  // 2. L'écart matin / après-midi.
  const matin = answers.filter((a) => a.scheduledHour < MIDI);
  const aprem = answers.filter((a) => a.scheduledHour >= MIDI);
  if (matin.length >= MIN_OBSERVATIONS && aprem.length >= MIN_OBSERVATIONS) {
    const tm = matin.filter((a) => a.done).length / matin.length;
    const ta = aprem.filter((a) => a.done).length / aprem.length;
    if (tm - ta >= ECART_MIN) {
      observations.push({
        prefixe: PREFIXE_MOMENT,
        contenu: `${PREFIXE_MOMENT} ce qui est posé le matin se fait ; l'après-midi décroche.`,
        appuis: matin.length + aprem.length,
      });
    } else if (ta - tm >= ECART_MIN) {
      observations.push({
        prefixe: PREFIXE_MOMENT,
        contenu: `${PREFIXE_MOMENT} tes après-midis tiennent mieux que tes matinées.`,
        appuis: matin.length + aprem.length,
      });
    }
  }

  return observations;
}
