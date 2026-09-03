/**
 * LA normalisation de `measured_at` — une seule, pour tous les chemins d'entrée.
 *
 * `measured_at` normalisé au jour est le troisième terme de la clé d'idempotence
 * `(content_id, platform, measured_at)` de `content_reception`. Deux implémentations
 * indépendantes de cette normalisation, c'est deux occasions de diverger — et une
 * divergence ne casserait rien de visible : elle produirait juste, un jour, deux lignes là
 * où il devait n'y en avoir qu'une. D'où ce module unique, importé par le chemin CSV
 * (`sources/manual.ts`) COMME par le chemin JSON (`validate-input.ts`).
 *
 * PURE, à une exception près et volontaire : l'absence de date vaut « aujourd'hui », ce qui
 * consulte l'horloge. `now` est injectable pour que ce soit testable.
 */

export type MeasuredAtResult = { value: Date } | { error: string };

/** Aujourd'hui, ramené à minuit UTC. */
export function todayAtUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Normalise une date de mesure à minuit UTC. Absente / vide → aujourd'hui à minuit UTC.
 *
 * On extrait la partie calendaire par expression régulière au lieu de passer la valeur à
 * `new Date(string)` : la normalisation au jour rend l'heure sans intérêt, et
 * `new Date(string)` interprète en revanche un format sans décalage explicite (ex.
 * "2026-08-15 13:45:00") comme une heure LOCALE — ce qui peut faire déborder sur la veille
 * ou le lendemain selon le fuseau du serveur. L'extraction lexicale ne consulte jamais de
 * fuseau, donc ne dérive jamais.
 *
 * `fieldLabel` n'entre QUE dans les messages d'erreur : le CSV parle de `measured_at`
 * (nom de colonne), le JSON de `measuredAt` (nom de champ). C'est le seul écart entre les
 * deux chemins, et il ne porte sur aucun comportement.
 */
export function parseMeasuredAtToUtcMidnight(
  raw: string | null | undefined,
  fieldLabel: string,
  now: Date = new Date(),
): MeasuredAtResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: todayAtUtcMidnight(now) };

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) {
    return { error: `${fieldLabel} invalide : "${raw}" doit commencer par AAAA-MM-JJ` };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` accepte silencieusement un débordement (ex. jour 30 février → avance en
  // mars) : on le détecte en recomparant les composantes obtenues à celles demandées.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: `${fieldLabel} invalide : "${raw}" n'est pas une date calendaire valide` };
  }
  return { value: date };
}
