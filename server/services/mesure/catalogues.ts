/** Catalogues de la mesure (dossier Acquisition 360, p. 4 et p. 15). */
export const CANAUX: ReadonlyArray<{ cle: string; acquisition: boolean; alias: string[] }> = [
  { cle: "paid_social", acquisition: true, alias: ["pub_meta", "meta", "meta_ads", "facebook_ads", "instagram_ads", "tiktok_ads", "pinterest_ads", "linkedin_ads", "publicite_sociale", "paid_social"] },
  { cle: "google_ads", acquisition: true, alias: ["google_ads", "google", "sea", "adwords", "microsoft_ads", "bing_ads"] },
  { cle: "influence", acquisition: true, alias: ["influence", "createurs", "createur", "ugc", "influenceurs"] },
  { cle: "affiliation", acquisition: true, alias: ["affiliation", "affiliate", "affilies"] },
  { cle: "pr_partenariats", acquisition: true, alias: ["pr", "presse", "partenariats", "pr_partenariats", "relations_presse"] },
  { cle: "evenements", acquisition: true, alias: ["evenements", "evenement", "events", "salon", "salons"] },
  { cle: "email_fidelisation", acquisition: false, alias: ["email", "emailing", "fidelisation", "crm", "email_fidelisation", "newsletter"] },
  { cle: "production_contenu", acquisition: false, alias: ["production", "contenu", "production_contenu", "shooting", "creation"] },
  { cle: "outils", acquisition: false, alias: ["outils", "tools", "logiciels", "abonnements"] },
  { cle: "autre", acquisition: false, alias: ["autre", "other", "divers"] },
];
export const CLES_CANAUX = CANAUX.map((c) => c.cle);
export const CANAUX_ACQUISITION = new Set(CANAUX.filter((c) => c.acquisition).map((c) => c.cle));

export const INDICATEURS = ["ca", "nouveaux_clients", "depense_totale", "mer", "cac", "panier_moyen", "part_ca_nouveaux", "marge_contributive"] as const;
export type Indicateur = (typeof INDICATEURS)[number];

export const KIND_BILAN = "mesure_bilan";
export const HEURE_BILAN_UTC = 5;
