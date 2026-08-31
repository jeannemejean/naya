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
 * Extraction lexicale de la partie calendaire par expression régulière, jamais
 * `new Date(string)` telle quelle : même précaution anti-fuseau que `parseMeasuredAt` côté
 * CSV (`sources/manual.ts`) — un format sans décalage explicite serait sinon interprété
 * comme une heure LOCALE par le moteur JS, ce qui peut faire déborder sur la veille ou le
 * lendemain selon le fuseau du serveur.
 */
export function parseReceptionMeasuredAt(raw: unknown): FieldResult<Date> {
  if (raw === undefined || raw === null) {
    const now = new Date();
    return { value: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) };
  }
  if (typeof raw !== "string") {
    return { error: "measuredAt invalide : doit être une chaîne de date AAAA-MM-JJ" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    const now = new Date();
    return { value: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) {
    return { error: `measuredAt invalide : "${raw}" doit commencer par AAAA-MM-JJ` };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` accepte silencieusement un débordement (ex. jour 30 février → avance en
  // mars) : on le détecte en recomparant les composantes obtenues à celles demandées.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: `measuredAt invalide : "${raw}" n'est pas une date calendaire valide` };
  }
  return { value: date };
}
