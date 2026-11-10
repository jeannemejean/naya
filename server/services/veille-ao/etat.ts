// Veille AO : l'état léger partagé (inscription, passages en cours). Aucune dépendance lourde,
// pour que les routes puissent l'importer sans charger le client IA.

/**
 * Inscription sans migration : VEILLE_AO_USERS liste les ids (séparés par des virgules).
 * Aucun champ de user_preferences ne convenait, et les consignes (profil de l'Agence JMD,
 * offres IN SITU / IN LINEA / IN SCENA) sont propres à l'agence : la veille ne tourne que
 * pour qui l'a demandée.
 */
export function utilisatricesVeilleAO(env: NodeJS.ProcessEnv = process.env): string[] {
  return Array.from(new Set((env.VEILLE_AO_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)));
}

export const veilleActivePour = (userId: string, env: NodeJS.ProcessEnv = process.env) =>
  !!userId && utilisatricesVeilleAO(env).includes(userId);

/** Utilisatrices dont un passage tourne en ce moment (un seul à la fois chacune). */
export const passagesEnCours = new Set<string>();

export const veilleEnCours = (userId: string) => passagesEnCours.has(userId);
