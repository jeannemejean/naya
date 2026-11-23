// Un seul travail d'IA à la fois par utilisatrice sur ses repas (préparer la semaine, changer un
// repas), qu'il vienne de la page ou de l'agent : sinon le dernier à finir écrase l'autre.
export type EtatTravail = { semaine: string; travail: "preparation" | "repas"; statut: "en_cours" | "fini" | "erreur"; erreur?: string };

const etats = new Map<string, EtatTravail>();

export const etatRepas = (userId: string) => etats.get(userId) ?? null;
export const repasOccupe = (userId: string) => etats.get(userId)?.statut === "en_cours";

/** Prend le verrou ; faux si un travail est déjà en cours. */
export function prendre(userId: string, semaine: string, travail: EtatTravail["travail"]): boolean {
  if (repasOccupe(userId)) return false;
  etats.set(userId, { semaine, travail, statut: "en_cours" });
  return true;
}
export function rendre(userId: string, fin: Omit<EtatTravail, "semaine" | "travail">) {
  const e = etats.get(userId);
  if (e) etats.set(userId, { ...e, ...fin });
}
