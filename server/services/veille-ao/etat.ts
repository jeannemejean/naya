// Veille AO : l'état léger partagé (inscription, passages en cours). Aucune dépendance lourde,
// pour que les routes puissent l'importer sans charger le client IA.

/**
 * Inscription sans migration : VEILLE_AO_USERS liste les ids (séparés par des virgules).
 * Aucun champ de user_preferences ne convenait, et les consignes (profil de l'Agence JMD,
 * offres IN SITU / IN LINEA / IN SCENA) sont propres à l'agence : la veille ne tourne que
 * pour qui l'a demandée.
 */
/**
 * Seules ces utilisatrices peuvent être inscrites tant que le profil de qualification est celui
 * de l'Agence JMD (codé en dur dans qualification.ts). À retirer quand profil et critères seront
 * dérivés du contexte de chacune.
 */
export const VEILLE_AO_AUTORISEES: readonly string[] = ["qNCa68cbCCGcMAcLWmehk"];

const refusesSignales = new Set<string>();

export function utilisatricesVeilleAO(env: NodeJS.ProcessEnv = process.env): string[] {
  const ids = Array.from(new Set((env.VEILLE_AO_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)));
  for (const id of ids) {
    if (!VEILLE_AO_AUTORISEES.includes(id) && !refusesSignales.has(id)) {
      refusesSignales.add(id);
      console.warn(`[veille-ao] VEILLE_AO_USERS : ${id} ignorée (profil de qualification propre à l'Agence JMD, pas encore dérivé par utilisatrice)`);
    }
  }
  return ids.filter((id) => VEILLE_AO_AUTORISEES.includes(id));
}

export const veilleActivePour = (userId: string, env: NodeJS.ProcessEnv = process.env) =>
  !!userId && utilisatricesVeilleAO(env).includes(userId);

/** Utilisatrices dont un passage tourne en ce moment (un seul à la fois chacune). */
export const passagesEnCours = new Set<string>();

export const veilleEnCours = (userId: string) => passagesEnCours.has(userId);
