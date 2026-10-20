// Logique pure de l'accueil « Aujourd'hui » : aucune dépendance React, aucune requête.
import { lienInterneDeTache } from "@/lib/lien-tache";

export type TacheAccueil = {
  id: number; title: string; completed: boolean; scheduledTime: string | null;
  scheduledEndTime?: string | null; priority: number | null; estimatedDuration: number | null;
  actionData?: unknown; projectId?: number | null;
};

const PRIORITE_PAR_DEFAUT = 5;
const DUREE_PAR_DEFAUT = 30;

// Avec heure d'abord (heure croissante, « HH:MM » se compare en texte), puis sans heure par priorité.
function comparer(a: TacheAccueil, b: TacheAccueil): number {
  if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
  if (a.scheduledTime) return -1;
  if (b.scheduledTime) return 1;
  return (a.priority ?? PRIORITE_PAR_DEFAUT) - (b.priority ?? PRIORITE_PAR_DEFAUT);
}

/** « HH:MM » → minutes depuis minuit ; null si l'heure est absente ou mal formée. */
export function enMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Fin d'une tâche à heure : son heure de fin, sinon début + durée (30 min par défaut). */
function finEnMinutes(t: TacheAccueil): number | null {
  const debut = enMinutes(t.scheduledTime);
  if (debut === null) return null;
  return enMinutes(t.scheduledEndTime) ?? debut + (t.estimatedDuration || DUREE_PAR_DEFAUT);
}

/** Heure locale « HH:MM » d'un instant. */
export function heureLocale(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type MomentEtape = "maintenant" | "ensuite" | "sansHeure";

/**
 * La prochaine étape à `maintenant` (« HH:MM ») : jamais une tâche dont le créneau est déjà
 * passé. D'abord celle qui occupe le créneau en cours, puis la prochaine à venir, puis les
 * tâches sans heure par priorité. Une tâche passée non cochée reste dans le fil, mais n'est
 * plus proposée comme « prochaine » : à 18 h 48, Naya ne renvoie pas à la tâche de 10 h 50.
 */
export function prochaineEtape<T extends TacheAccueil>(taches: T[], maintenant: string): { tache: T; moment: MomentEtape } | null {
  const m = enMinutes(maintenant) ?? 0;
  const ouvertes = [...taches.filter((x) => !x.completed)].sort(comparer);
  const enCours = ouvertes.find((x) => {
    const d = enMinutes(x.scheduledTime);
    const f = finEnMinutes(x);
    return d !== null && f !== null && d <= m && m < f;
  });
  if (enCours) return { tache: enCours, moment: "maintenant" };
  const aVenir = ouvertes.find((x) => (enMinutes(x.scheduledTime) ?? -1) > m);
  if (aVenir) return { tache: aVenir, moment: "ensuite" };
  const sansHeure = ouvertes.find((x) => !x.scheduledTime);
  return sansHeure ? { tache: sansHeure, moment: "sansHeure" } : null;
}

/** Tâches à heure dont le créneau est fini sans avoir été cochées. */
export function nonCocheesPassees<T extends TacheAccueil>(taches: T[], maintenant: string): T[] {
  const m = enMinutes(maintenant) ?? 0;
  return taches.filter((x) => !x.completed && (finEnMinutes(x) ?? Infinity) <= m);
}

/** Position de la ligne « maintenant » dans le fil trié : avant la première tâche qui commence après. */
export function indexMaintenant(fil: TacheAccueil[], maintenant: string): number {
  const m = enMinutes(maintenant) ?? 0;
  const i = fil.findIndex((x) => { const d = enMinutes(x.scheduledTime); return d === null || d > m; });
  return i === -1 ? fil.length : i;
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
  locale = "fr-FR",
): { nom: string; fin: string } | null {
  const candidates = campagnes
    .filter((c): c is typeof c & { endDate: string } => c.status === "active" && !!c.endDate && c.endDate >= aujourdhui)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const c = candidates[0];
  if (!c) return null;
  // Midi UTC : le jour affiché ne bascule pas selon le fuseau.
  const fin = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
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

/**
 * Reprise de la garde de l'ancien dashboard : un compte sans ADN de marque part à l'onboarding.
 * Seulement sur une réponse reçue (le serveur renvoie `null` quand il n'y en a pas) : pendant le
 * chargement l'accueil s'affiche normalement, et une erreur de requête ne redirige jamais.
 */
export function doitAllerALOnboarding(q: { isSuccess: boolean; data: unknown }): boolean {
  return q.isSuccess && !q.data;
}
