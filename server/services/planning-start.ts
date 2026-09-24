/**
 * À partir de quelle date le planificateur doit-il générer ? PURE.
 *
 * Demande de Jeanne (24 septembre 2026) : « si on définit un jour particulier de démarrage,
 * Naya doit pouvoir planifier directement pour ce jour-là et donner une petite vision de
 * structure de la semaine et du mois à venir ».
 *
 * Le comportement d'avant faisait SAUTER le planificateur :
 *
 *     if (prefs?.planningStartDate && prefs.planningStartDate > startDate) continue;
 *
 * « La planification démarre vendredi » voulait donc dire « ne rien faire jusqu'à vendredi ».
 * Jeanne ouvrait son planning du vendredi et n'y voyait rien — elle ne pouvait le découvrir
 * que le vendredi matin, après le cron de 6 h. Impossible de préparer sa semaine.
 *
 * Ça veut dire « planifier À PARTIR de vendredi ». Le planificateur génère déjà sept jours
 * ouvrés depuis son point de départ : déplacer ce point suffit à donner la vision de la
 * semaine, sans rien changer d'autre.
 */

/** `YYYY-MM-DD` réellement valide — pas seulement de la bonne forme. */
function dateValide(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // `new Date("2026-13-45")` ne lève pas : il rend une date invalide, ou pire il déborde
  // sur le mois suivant. On vérifie donc que la date relue est bien celle écrite.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * `aujourdhui` et `dateDeDepart` sont au format `YYYY-MM-DD`.
 *
 * Rend TOUJOURS une date exploitable, jamais « ne rien faire » : une journée sans plan n'est
 * jamais le bon défaut. Une date de départ passée ne fait pas remonter le temps — elle veut
 * dire « la planification a commencé », pas « replanifie le mois dernier ». Une date mal
 * formée est ignorée : la colonne est du texte libre, et une valeur aberrante ne doit pas
 * décaler la génération de plusieurs mois ni la faire sauter.
 */
export function debutEffectifDePlanification(
  aujourdhui: string,
  dateDeDepart: string | null | undefined,
): string {
  if (!dateValide(dateDeDepart)) return aujourdhui;
  return dateDeDepart > aujourdhui ? dateDeDepart : aujourdhui;
}
