// Logique pure de l'accueil « Aujourd'hui » : aucune dépendance React, aucune requête.
import { lienInterneDeTache } from "@/lib/lien-tache";

export type TacheAccueil = {
  id: number; title: string; completed: boolean; scheduledTime: string | null;
  priority: number | null; estimatedDuration: number | null; actionData?: unknown;
};

const PRIORITE_PAR_DEFAUT = 5;

// Avec heure d'abord (heure croissante, « HH:MM » se compare en texte), puis sans heure par priorité.
function comparer(a: TacheAccueil, b: TacheAccueil): number {
  if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
  if (a.scheduledTime) return -1;
  if (b.scheduledTime) return 1;
  return (a.priority ?? PRIORITE_PAR_DEFAUT) - (b.priority ?? PRIORITE_PAR_DEFAUT);
}

/** La prochaine tâche non faite ; une heure déjà passée reste devant tant qu'elle n'est pas faite. */
export function prochaineEtape<T extends TacheAccueil>(taches: T[]): T | null {
  return [...taches.filter((x) => !x.completed)].sort(comparer)[0] ?? null;
}

/** Toutes les tâches du jour, dans l'ordre du fil (l'entrée n'est pas modifiée). */
export function trierFil<T extends TacheAccueil>(taches: T[]): T[] {
  return [...taches].sort(comparer);
}

export function estTacheProspection(t: { actionData?: unknown }): boolean {
  return lienInterneDeTache(t)?.startsWith("/outreach") ?? false;
}

/** La campagne active qui finit le plus tôt, sans jamais remonter une campagne terminée. */
export function capsuleCampagne(
  campagnes: Array<{ name: string; status: string | null; endDate: string | null }>,
  aujourdhui: string,
): { nom: string; fin: string } | null {
  const candidates = campagnes
    .filter((c): c is typeof c & { endDate: string } => c.status === "active" && !!c.endDate && c.endDate >= aujourdhui)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const c = candidates[0];
  if (!c) return null;
  // Midi UTC : le jour affiché ne bascule pas selon le fuseau.
  const fin = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${c.endDate.slice(0, 10)}T12:00:00Z`));
  return { nom: c.name, fin };
}

/**
 * Chiffre clé de `GET /api/mesure/:projectId` : l'évolution (écart relatif au mois précédent,
 * `evolutions[ind].precedent`) du premier indicateur du catalogue qui en a une, au dernier mois.
 * `libelle` est la clé de l'indicateur : le nom lisible vient de `mesure.indicateurs.<clé>.nom`
 * (i18n), que ce module pur ne lit pas.
 */
export function chiffreCle(reponse: unknown): { libelle: string; variation: string } | null {
  const r = reponse as any;
  const mois = r?.mois;
  const catalogue = r?.catalogues?.indicateurs;
  if (!Array.isArray(mois) || mois.length === 0 || !Array.isArray(catalogue)) return null;
  const dernier = [...mois].filter((m) => typeof m?.mois === "string").sort((a, b) => a.mois.localeCompare(b.mois)).pop();
  const evolutions = dernier?.evolutions;
  if (!evolutions || typeof evolutions !== "object") return null;
  for (const ind of catalogue) {
    const v = evolutions[ind]?.precedent;
    if (typeof v === "number" && Number.isFinite(v)) {
      const pct = Math.round(v * 100) || 0; // évite « -0 »
      return { libelle: String(ind), variation: `${pct >= 0 ? "+" : ""}${pct} %` };
    }
  }
  return null;
}

/** Veille et chiffres sont ceux d'un projet : rien à montrer en mode « tous les projets ». */
export function capsulesAffichables(activeProjectId: number | null): { veille: boolean; chiffres: boolean } {
  const unProjet = activeProjectId !== null;
  return { veille: unProjet, chiffres: unProjet };
}

export function ligneEnAttente(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 tâche d'avant attend sa place. Naya la replace en fin de journée."
    : `${n} tâches d'avant attendent leur place. Naya les replace en fin de journée.`;
}
