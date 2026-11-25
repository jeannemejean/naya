// Interrupteur de la séance de redémarrage (même forme que FIL_CONDUCTEUR_USERS).
/** Vrai si l'utilisatrice figure dans SEANCE_REDEMARRAGE_USERS (ids séparés par des virgules). */
export function seanceActivePour(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SEANCE_REDEMARRAGE_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}
