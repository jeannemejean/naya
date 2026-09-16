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

/** Nombre d'appuis au-delà duquel la salience est maximale. DÉFAUT RÉVISABLE. */
export const APPUIS_POUR_SALIENCE_MAX = 20;
/** Salience d'une observation tout juste au seuil (1 appui — en-deçà, l'observation n'existe pas). DÉFAUT RÉVISABLE. */
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
 * Une observation ne peut exister qu'à partir de 1 appui : c'est le seuil, et
 * il vaut SALIENCE_MIN pile. Elle atteint SALIENCE_MAX à
 * APPUIS_POUR_SALIENCE_MAX appuis et ne va jamais au-delà, même très au-delà.
 * Interpolation linéaire entre ces deux bornes ; entrée absurde (0 ou
 * négative) ramenée au seuil, jamais en dessous.
 *
 * PURE, et bornée des deux côtés.
 */
export function salienceDe(appuis: number): number {
  const n = Math.max(0, appuis);
  const plage = APPUIS_POUR_SALIENCE_MAX - 1; // distance entre le seuil (1 appui) et le max
  const t = plage > 0 ? Math.min(1, Math.max(0, (n - 1) / plage)) : 1;
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
