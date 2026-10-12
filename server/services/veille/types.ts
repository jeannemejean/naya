/** Veille élargie : types et constantes partagés. */
export const KIND_CONCURRENTS = "veille_concurrents";
export const KIND_VOIX_CLIENT = "veille_voix_client";
export const KIND_SERP = "veille_serp";
export const KIND_GEO = "veille_geo";
export const KINDS_VEILLE = [KIND_CONCURRENTS, KIND_VOIX_CLIENT, KIND_SERP, KIND_GEO] as const;
export type KindVeille = (typeof KINDS_VEILLE)[number];

export const TYPES_ITEM = ["marque", "concurrent", "requete_voc", "mot_cle", "prompt_geo"] as const;
export type TypeItem = (typeof TYPES_ITEM)[number];
export const STATUTS_ITEM = ["propose", "suivi", "ecarte"] as const;
export const STATUTS_CONSTAT = ["nouveau", "vu", "ecarte"] as const;

/** Constat produit par une analyse, avant enregistrement. */
export interface ConstatBrut {
  type: string;
  titre: string;
  texte: string;
  preuve?: { url?: string; extrait?: string; source?: string } | null;
}

/** Par passage (une fois par semaine) : de quoi tenir dans le budget de 2 € par mois. */
export const LIMITES = {
  pagesVocParPassage: 8,
  instagramPostsMin: 4,
  /** GEO hors propriétaire : une seule IA et 5 questions par passage (~0,65 € par mois). */
  geoQuestionsStandard: 5,
} as const;

export const HEURE_VEILLE_UTC = 5;
export const PAYS_DEFAUT = "fr";
export const LANGUE_DEFAUT = "fr";
