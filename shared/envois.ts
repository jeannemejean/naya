// Envois aux marques (séance de redémarrage) : les statuts possibles, dans l'ordre de la vie d'un envoi.
export const STATUTS_ENVOI = ["envoye", "relance", "reponse", "accepte", "refuse", "sans_suite"] as const;
export type StatutEnvoi = (typeof STATUTS_ENVOI)[number];
/** Statuts pour lesquels une relance reste à faire. */
export const STATUTS_A_RELANCER: ReadonlySet<string> = new Set(["envoye", "relance"]);
