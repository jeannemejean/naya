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
