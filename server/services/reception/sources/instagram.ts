import type { ReceptionSource } from "../types";

/**
 * Adaptateur Instagram — SQUELETTE. Volontairement non fonctionnel.
 *
 * Les insights par média (`saved`, `reach`, `shares`) exigent la permission
 * `instagram_business_manage_insights`, que l'app ne demande pas aujourd'hui
 * (`server/services/social-oauth.ts` ne demande que `instagram_business_basic` et
 * `instagram_business_content_publish`). L'obtenir suppose un tour d'App Review Meta.
 *
 * Ce fichier existe pour prouver que le port se suffit : le jour où la permission est
 * accordée, seul ce fichier change. Il n'est atteint par AUCUN chemin par défaut.
 */
export const instagramSource: ReceptionSource = {
  name: "instagram",
  async fetchSignals() {
    throw new Error(
      "Adaptateur Instagram indisponible : la lecture des insights par média exige la permission " +
        "`instagram_business_manage_insights`, non accordée à cette app. Utilise la saisie manuelle " +
        "ou l'import CSV en attendant l'App Review Meta.",
    );
  },
};
