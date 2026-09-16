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

const REGEX_PREFIXE_CATEGORIE = /^Les tâches « (.+?) » :/;

/**
 * Retrouve le préfixe stable — donc l'identité — du contenu d'une mémoire déjà
 * écrite, pour une catégorie QUELCONQUE, pas seulement celles que l'appel courant
 * vient de produire.
 *
 * Nécessaire pour ne jamais oublier qu'un motif a cessé d'exister (revue finale du
 * 2026-09-16, défaut Critique) : `observation-writer.ts` ne peut confronter une
 * mémoire vivante à la fenêtre actuelle que s'il sait à quel sujet elle appartient.
 * Avant ce correctif, seules les mémoires dont le contenu commençait par un préfixe
 * PRODUIT CE JOUR-LÀ étaient reconnues — une catégorie qui a cessé d'apparaître dans
 * les observations (parce que l'utilisatrice a recommencé à faire ses tâches
 * « admin », par exemple) devenait alors invisible à la relecture, et son ancienne
 * observation ne pouvait plus jamais être remise en cause.
 *
 * `null` = ce contenu ne correspond à aucune règle connue (mémoire d'une tout autre
 * origine, ou legacy) — délibérément ignoré, jamais une erreur.
 *
 * PURE.
 */
export function prefixeDeContenu(contenu: string): string | null {
  if (contenu.startsWith(PREFIXE_MOMENT)) return PREFIXE_MOMENT;
  const m = contenu.match(REGEX_PREFIXE_CATEGORIE);
  return m ? PREFIXE_CATEGORIE(m[1]) : null;
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
    // `appuis` = le CÔTÉ LE MOINS étayé (Math.min), jamais la somme des deux —
    // sinon `appuis` vaudrait systématiquement plus que le `e.total` d'une
    // observation de catégorie, qui ne compte qu'UN seul segment. Une comparaison
    // matin/après-midi n'est jamais plus solide que son côté le moins fourni ; la
    // sommer gonflait artificiellement la salience de la règle « moment » face à
    // la règle « catégorie » dans `salienceDe`, qui traite `appuis` de façon
    // identique quelle que soit la règle d'origine (Important 3, revue finale du
    // 2026-09-16 : avec TOP_K.founder = 4, ce biais décidait systématiquement ce
    // que Naya voit, sans rapport avec la solidité réelle de l'observation).
    const appuis = Math.min(matin.length, aprem.length);
    if (tm - ta >= ECART_MIN) {
      observations.push({
        prefixe: PREFIXE_MOMENT,
        contenu: `${PREFIXE_MOMENT} ce qui est posé le matin se fait ; l'après-midi décroche.`,
        appuis,
      });
    } else if (ta - tm >= ECART_MIN) {
      observations.push({
        prefixe: PREFIXE_MOMENT,
        contenu: `${PREFIXE_MOMENT} tes après-midis tiennent mieux que tes matinées.`,
        appuis,
      });
    }
  }

  return observations;
}
