/**
 * Que faire d'une observation face à la mémoire vivante de Naya : l'écrire,
 * ne rien faire, ou remplacer l'ancienne. L'appariement se fait sur le
 * PRÉFIXE, qui porte l'identité du sujet — jamais sur le contenu, qui change
 * précisément quand l'observation change. Une nouvelle observation n'invalide
 * que celle de même identité : deux sujets différents coexistent, c'est le
 * sens même de l'accumulation.
 *
 * PURE : aucune base, aucune horloge, aucun aléa.
 */

import type { Observation } from "./observations";
import { MIN_OBSERVATIONS } from "./insight";

/** Nombre d'appuis au-delà duquel la salience est maximale. DÉFAUT RÉVISABLE. */
export const APPUIS_POUR_SALIENCE_MAX = 20;
/** Salience d'une observation tout juste au seuil (MIN_OBSERVATIONS appuis, ou moins). DÉFAUT RÉVISABLE. */
export const SALIENCE_MIN = 0.4;
/** Salience d'une observation largement étayée. DÉFAUT RÉVISABLE. */
export const SALIENCE_MAX = 0.9;

export interface MemoireVivante { id: number; contenu: string; prefixe: string }

export type DecisionMemoire =
  | { action: "rien" }
  | { action: "ecrire"; contenu: string; salience: number }
  | { action: "remplacer"; ancienId: number; contenu: string; salience: number };

/**
 * Passages consécutifs de `rememberObservations` (donc de `/answer` répondus, pas de
 * jours) sans que le motif d'une observation vivante soit reproduit, avant qu'elle
 * soit périmée (`supersededAt`, jamais supprimée). DÉFAUT RÉVISABLE.
 *
 * Décision de la propriétaire du projet, revue finale du 2026-09-16 : une observation
 * vraie ne doit jamais disparaître à la première fenêtre où son motif n'apparaît pas
 * — la fenêtre glissante de 200 réponses (`INSIGHT_TASK_PROMPTS_LOOKBACK`,
 * `server/routes.ts`) suffit à faire disparaître une catégorie entière d'une simple
 * semaine calme (peu ou pas de tâches de cette catégorie posées), sans que rien
 * n'ait réellement changé dans le comportement qu'elle décrit.
 *
 * Justification chiffrée du seuil (re-revue du 2026-09-16, ajustement de 600 à 200) :
 * au rythme DOCUMENTÉ dans `routes.ts` (~7-8 réponses/jour — jamais MESURÉ pour
 * l'utilisatrice réelle, donc une estimation, pas une vérité), une semaine calme
 * représente environ 50-56 passages consécutifs sans motif — le bruit à ne pas
 * confondre avec une résolution réelle. `SEUIL_PEREMPTION = 200` le dépasse d'un
 * facteur ~4 : une semaine calme, voire plusieurs, ne périment rien. En contrepartie,
 * une observation devenue fausse ne persiste plus qu'environ 25-29 jours (~1 mois) à
 * ce rythme avant péremption — contre ~75-86 jours (près d'un trimestre) avec
 * l'ancienne valeur de 600, jugée trop protectrice d'une affirmation qui a cessé
 * d'être vraie (mémoire injectée dans CHAQUE appel IA, fil "founder", TOP_K = 4).
 * Cette durée calendaire est elle-même une estimation : si le rythme réel de
 * l'utilisatrice diverge notablement de 7-8 réponses/jour, la persistance réelle en
 * jours divergera dans la même proportion — seul le nombre de PASSAGES est garanti.
 *
 * Valeur dupliquée à dessein plutôt qu'importée depuis `server/routes.ts` : ce
 * module est PUR (aucune dépendance impure), et `routes.ts` importe déjà
 * `observation-writer.ts` — importer dans l'autre sens créerait une dépendance
 * circulaire et ferait dépendre un module pur de l'enregistrement des routes HTTP.
 */
export const SEUIL_PEREMPTION = 200;

export type DecisionAbsence =
  | { action: "incrementer"; nouveauCompte: number }
  | { action: "perimer" };

/**
 * Que faire d'une observation vivante dont le motif n'a PAS été reproduit ce
 * cycle ? `compteActuel` est le nombre de passages consécutifs déjà sans motif
 * AVANT ce cycle (0 si aucun). Pure, bornée par `SEUIL_PEREMPTION` — jamais de
 * péremption avant qu'il soit atteint, y compris sur une entrée absurde.
 *
 * PURE.
 */
export function decideAbsence(compteActuel: number): DecisionAbsence {
  const nouveauCompte = Math.max(0, compteActuel) + 1;
  return nouveauCompte >= SEUIL_PEREMPTION ? { action: "perimer" } : { action: "incrementer", nouveauCompte };
}

/**
 * Salience croissante avec le nombre de réponses qui fondent l'observation.
 * Le vrai seuil d'existence d'une observation est MIN_OBSERVATIONS
 * (importé de "./insight", source unique — voir observations.ts qui l'applique
 * déjà en amont : `extractObservations` ne produit rien en dessous, donc tout
 * `appuis` réel vaut au moins MIN_OBSERVATIONS). En dessous de ce seuil —
 * y compris sur une entrée absurde (0, négative) — la salience est ramenée à
 * SALIENCE_MIN, jamais en dessous. Elle atteint SALIENCE_MAX à
 * APPUIS_POUR_SALIENCE_MAX appuis et ne va jamais au-delà, même très au-delà.
 * Interpolation linéaire entre ces deux bornes.
 *
 * PURE, et bornée des deux côtés.
 */
export function salienceDe(appuis: number): number {
  const n = Math.max(0, appuis);
  const plage = APPUIS_POUR_SALIENCE_MAX - MIN_OBSERVATIONS; // distance entre le seuil réel et le max
  const t = plage > 0 ? Math.min(1, Math.max(0, (n - MIN_OBSERVATIONS) / plage)) : 1;
  return SALIENCE_MIN + t * (SALIENCE_MAX - SALIENCE_MIN);
}

/**
 * Que faire de cette observation, compte tenu de la mémoire vivante ?
 *
 * L'appariement se fait sur le PRÉFIXE, qui porte l'identité du sujet —
 * jamais sur le contenu, qui change quand l'observation change. Une nouvelle
 * observation n'invalide que celle de même identité : deux sujets différents
 * coexistent, c'est le sens même de l'accumulation.
 *
 * PURE : aucune base, aucune horloge.
 */
export function decideMemoire(obs: Observation, vivantes: MemoireVivante[]): DecisionMemoire {
  const salience = salienceDe(obs.appuis);
  const meme = vivantes.find((v) => v.prefixe === obs.prefixe);
  if (!meme) return { action: "ecrire", contenu: obs.contenu, salience };
  if (meme.contenu === obs.contenu) return { action: "rien" };
  return { action: "remplacer", ancienId: meme.id, contenu: obs.contenu, salience };
}
