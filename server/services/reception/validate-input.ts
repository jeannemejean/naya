/**
 * Validation du corps JSON des routes de réception (`POST /api/content/:id/reception`).
 *
 * PURE — aucune base, aucun réseau — donc testable isolément (voir validate-input.test.ts),
 * séparément du branchement Express qui l'entoure.
 *
 * Miroir volontaire de `parseNonNegativeIntOrNull`/`parseMeasuredAt` de
 * `sources/manual.ts` (le CSV), adapté à un corps JSON plutôt qu'à du texte : un client
 * peut envoyer un vrai `number`, une chaîne numérique (formulaire non transformé), ou une
 * chaîne vide — jamais un CSV.
 */

import { parseMeasuredAtToUtcMidnight } from "./measured-at";

export type FieldResult<T> = { value: T } | { error: string };

/**
 * Entier ≥ 0, ou `null` si la valeur est absente/`null`/chaîne vide (après trim).
 *
 * La chaîne vide est la représentation navigateur de « non renseigné » (un
 * `<input type="number">` vidé par l'utilisatrice envoie `""`, pas `null`) : elle vaut donc
 * `null`, jamais un zéro fabriqué — cette distinction pilote la CONFIANCE du score en aval,
 * pas le score lui-même (voir score.ts). Une chaîne non vide et non numérique reste une
 * erreur : on n'accepte pas n'importe quoi, seulement « pas renseigné ».
 */
export function parseReceptionIntOrNull(raw: unknown, field: string): FieldResult<number | null> {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === "string" && raw.trim() === "") return { value: null };

  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: `${field} invalide : doit être un entier positif ou vide` };
  }
  return { value: n };
}

/**
 * sentiment_score optionnel, -1..1 ; absent/`null`/chaîne vide → `null` (jamais un zéro
 * fabriqué). Même règle « chaîne vide = non renseigné » que `parseReceptionIntOrNull`.
 */
export function parseReceptionSentiment(raw: unknown): FieldResult<number | null> {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === "string" && raw.trim() === "") return { value: null };

  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    return { error: "sentimentScore invalide : doit être compris entre -1 et 1" };
  }
  return { value: n };
}

/**
 * measuredAt optionnel, normalisé à minuit UTC ; absent/vide → aujourd'hui à minuit UTC.
 *
 * La normalisation est celle de `./measured-at.ts` — la MÊME que celle du chemin CSV, pas
 * une copie : `measured_at` normalisé au jour est un tiers de la clé d'idempotence
 * `(content_id, platform, measured_at)`, et deux copies qui divergeraient produiraient
 * silencieusement deux lignes là où il n'en fallait qu'une.
 *
 * Le seul ajout ici est propre au JSON : un corps de requête peut porter n'importe quel
 * type, là où une cellule CSV est toujours du texte.
 */
export function parseReceptionMeasuredAt(raw: unknown): FieldResult<Date> {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { error: "measuredAt invalide : doit être une chaîne de date AAAA-MM-JJ" };
  }
  return parseMeasuredAtToUtcMidnight(raw, "measuredAt");
}
