/**
 * Catalogues des fondations (dossier Acquisition 360, étape 0 et stack par maturité).
 * Tout ce que l'IA propose est ramené à ces listes : ce qui en sort est retiré, jamais deviné.
 */
export const SECTIONS = ["offre", "motivations", "kpis", "plan"] as const;
export type Section = (typeof SECTIONS)[number];

export const STATUTS_SECTION = ["vide", "propose", "valide"] as const;
export type StatutSection = (typeof STATUTS_SECTION)[number];

/** Formats du dossier (p. 7), plus deux formats écrits : beaucoup d'utilisatrices ne font pas de vidéo. */
export const FORMATS_CREATIFS = ["face_camera", "demonstration", "avant_apres", "comparatif", "coulisses", "temoignage", "conseil", "histoire"] as const;
export type FormatCreatif = (typeof FORMATS_CREATIFS)[number];

export const ETAGES_KPI = ["business", "systeme", "canal", "crea"] as const;
export const FREQUENCES_KPI = ["quotidien", "hebdo", "mensuel"] as const;

export const MATURITES = ["demarrage", "croissance", "scale"] as const;
export const STATUTS_BRIQUE = ["maintenant", "plus_tard", "sans_objet"] as const;

export type Moteur = "creation" | "captation" | "socle";
/** Les briques du système 360. `page` : la page de Naya qui sert la brique, quand il y en a une. */
export const BRIQUES: ReadonlyArray<{ cle: string; moteur: Moteur; libelle: string; page?: string }> = [
  { cle: "organique_social", moteur: "creation", libelle: "Organique social (labo d'angles, preuve de vie)", page: "/content" },
  { cle: "createurs_ugc", moteur: "creation", libelle: "Créateurs et UGC" },
  { cle: "paid_social", moteur: "creation", libelle: "Publicité sociale (Meta, TikTok, Pinterest, LinkedIn)" },
  { cle: "pr_partenariats", moteur: "creation", libelle: "PR digitale et partenariats" },
  { cle: "communaute", moteur: "creation", libelle: "Communauté (événements, ambassadeurs, groupe)" },
  { cle: "seo", moteur: "captation", libelle: "SEO", page: "/veille" },
  { cle: "sea", moteur: "captation", libelle: "SEA (Google Ads)" },
  { cle: "geo", moteur: "captation", libelle: "GEO (être cité par les IA)", page: "/veille" },
  { cle: "marketplaces", moteur: "captation", libelle: "Marketplaces et retail media" },
  { cle: "affiliation", moteur: "captation", libelle: "Affiliation et comparateurs" },
  { cle: "veille", moteur: "socle", libelle: "Veille et intelligence marché", page: "/veille" },
  { cle: "prospection_directe", moteur: "socle", libelle: "Prospection directe (B2B)", page: "/prospection" },
  { cle: "conversion", moteur: "socle", libelle: "Conversion (site, landing, offre d'entrée, preuve sociale)" },
  { cle: "data_tracking", moteur: "socle", libelle: "Tracking et consentement" },
  { cle: "crm_retention", moteur: "socle", libelle: "CRM, rétention, avis et parrainage" },
  { cle: "mesure", moteur: "socle", libelle: "Mesure (MER, CAC nouveaux clients, cohortes)" },
];
export const CLES_BRIQUES = BRIQUES.map((b) => b.cle);

export const LIBELLES_FORMATS: Record<FormatCreatif, string> = {
  face_camera: "face caméra", demonstration: "démonstration", avant_apres: "avant/après", comparatif: "comparatif",
  coulisses: "coulisses", temoignage: "témoignage", conseil: "conseil", histoire: "histoire",
};

export const PLAFONDS = { motivations: 5, liste: 5, formats: 4, kpis: 12, relevesParKpi: 24 } as const;

/** Valeur d'étiquette « examiné, hors motivations » : réservée, jamais une clé de motivation. */
export const ANGLE_AUCUN = "aucun";

export const KIND_ETIQUETAGE = "fondations_etiquetage";
export const HEURE_ETIQUETAGE_UTC = 5;
