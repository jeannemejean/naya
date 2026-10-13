import type { Routine } from "@shared/schema";

export type StatutPassage = "ok" | "rien_a_faire" | "erreur";

export interface ResultatPassage {
  statut: StatutPassage;
  /** Une phrase lisible, montrée à l'utilisatrice. */
  resume: string;
  details?: Record<string, unknown>;
  /** Prévenir l'utilisatrice (message du compagnon) : seulement quand il se passe quelque chose. */
  notifier?: boolean;
  /** La cible n'existe plus : la routine est désactivée. */
  desactiver?: boolean;
  /** Écran à ouvrir depuis la notification (ex. « /projects/7?onglet=mesure »). */
  lien?: string;
}

export type ExecuteurRoutine = (routine: Routine) => Promise<ResultatPassage>;
