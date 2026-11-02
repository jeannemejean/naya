/**
 * Public d'une campagne de prospection (chantier 2) :
 *  - « froid » (défaut) : ne contacte JAMAIS quelqu'un qui est déjà dans les relations
 *    LinkedIn de l'utilisatrice ;
 *  - « relations » : ne s'adresse qu'à des relations existantes.
 */
export type PublicCampagne = "froid" | "relations";

export function decisionPublic(audience: PublicCampagne, enRelation: boolean): "continuer" | "exclure" {
  if (audience === "relations") return enRelation ? "continuer" : "exclure";
  return enRelation ? "exclure" : "continuer";
}

export const RAISON_EXCLUSION = { froid: "deja_en_relation", relations: "pas_en_relation" } as const;

/** Valeur inconnue ou absente → « froid » (le défaut protecteur). */
export function normaliserPublic(v: unknown): PublicCampagne {
  return v === "relations" ? "relations" : "froid";
}
