import { parseCsv, tokenizeCsvRows } from "../../csv";
import type { ReceptionSignal, ReceptionSource } from "../types";

/**
 * Adaptateur manuel — l'unique adaptateur de ce lot.
 *
 * La réception (saves, shares, ...) n'est récupérable sur AUCUN réseau connecté
 * aujourd'hui (voir types.ts). Le Fil 3 doit donc fonctionner dès aujourd'hui avec de la
 * saisie humaine : un import CSV, poussé par la personne qui possède la donnée. Réutilise
 * `parseCsv`/`tokenizeCsvRows` de `server/services/csv.ts` — aucune ré-écriture de parseur
 * ici.
 */

/**
 * Erreur de parsing portant sur une ligne précise du CSV de réception.
 * Spécifique à cet adaptateur : le port (`types.ts`) n'a pas à connaître ce détail.
 */
export interface CsvRowError {
  line: number;
  message: string;
}

const REQUIRED_COLUMNS = ["content_id", "platform"] as const;

/** Même définition de « ligne vide » que `parseCsv` : toutes ses cellules sont vides. */
function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

type FieldResult<T> = { value: T } | { error: string };

/** Entier ≥ 0, ou `null` si la cellule est vide — une cellule vide n'est jamais un zéro. */
function parseNonNegativeIntOrNull(raw: string | undefined, field: string): FieldResult<number | null> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: `${field} invalide : "${raw}" doit être un entier positif ou vide` };
  }
  return { value: n };
}

/**
 * measured_at optionnel, normalisé à minuit UTC ; absent → aujourd'hui à minuit UTC.
 *
 * On extrait la partie calendaire par expression régulière au lieu de passer la valeur à
 * `new Date(string)` : la normalisation au jour rend l'heure sans intérêt, et `new
 * Date(string)` interprète en revanche un format sans décalage explicite (ex. "2026-08-15
 * 13:45:00") comme une heure LOCALE — ce qui peut faire déborder sur la veille ou le
 * lendemain selon le fuseau du serveur. L'extraction lexicale ne consulte jamais de fuseau,
 * donc ne dérive jamais.
 */
function parseMeasuredAt(raw: string | undefined): FieldResult<Date> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    const now = new Date();
    return { value: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) {
    return { error: `measured_at invalide : "${raw}" doit commencer par AAAA-MM-JJ` };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` accepte silencieusement un débordement (ex. jour 30 février → avance en
  // mars) : on le détecte en recomparant les composantes obtenues à celles demandées.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: `measured_at invalide : "${raw}" n'est pas une date calendaire valide` };
  }
  return { value: date };
}

/** sentiment_score optionnel, -1..1 ; absent → null (jamais un zéro fabriqué). */
function parseSentiment(raw: string | undefined): FieldResult<number | null> {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    return { error: `sentiment_score invalide : "${raw}" doit être compris entre -1 et 1` };
  }
  return { value: n };
}

/**
 * Parse un CSV de réception saisi/exporté à la main.
 *
 * - `content_id` et `platform` obligatoires : leur absence rejette tout le fichier.
 * - une ligne malformée ne fait échouer QU'ELLE-MÊME : une erreur portant son numéro de
 *   ligne est reportée, le reste du fichier continue d'être traité.
 * - la numérotation compte l'en-tête comme ligne 1, donc la première ligne de données est 2.
 */
export function parseReceptionCsv(text: string): {
  rows: Omit<ReceptionSignal, "source">[];
  errors: CsvRowError[];
} {
  // On tokenise nous-mêmes UNE FOIS avec le même tokeniseur que `parseCsv` (`tokenizeCsvRows`)
  // pour lire l'en-tête et repérer les lignes vides — jamais avec un `split(",")` maison, qui
  // ne comprendrait pas les guillemets et désynchroniserait la numérotation ou rejetterait à
  // tort un en-tête entre guillemets (export tableur courant).
  const allRows = tokenizeCsvRows(text);

  if (allRows.length === 0) {
    return {
      rows: [],
      errors: [{
        line: 1,
        message: `colonne(s) obligatoire(s) manquante(s) : ${REQUIRED_COLUMNS.join(", ")}`,
      }],
    };
  }

  if (isBlankRow(allRows[0])) {
    return {
      rows: [],
      errors: [{
        line: 1,
        message:
          "la première ligne du fichier est vide : elle doit être l'en-tête et contenir " +
          `au moins les colonnes ${REQUIRED_COLUMNS.join(", ")}`,
      }],
    };
  }

  const headers = allRows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `colonne(s) obligatoire(s) manquante(s) : ${missing.join(", ")}` }],
    };
  }

  // Numéros de ligne RÉELS des lignes de données non vides, dans l'ordre du fichier (l'en-tête
  // est la ligne 1, donc la ligne physique d'indice i dans `allRows` est la ligne i + 1). Comme
  // `isBlankRow` applique exactement la même règle que `parseCsv` sur les mêmes lignes
  // tokenisées, ce tableau correspond position par position au tableau que `parseCsv(text)`
  // produit lui-même ci-dessous — aucune resynchronisation à faire, aucune duplication de la
  // décision « cette ligne est-elle vide ? ».
  const lineNumbers: number[] = [];
  for (let i = 1; i < allRows.length; i++) {
    if (!isBlankRow(allRows[i])) lineNumbers.push(i + 1);
  }

  const rawRows = parseCsv(text);
  const rows: Omit<ReceptionSignal, "source">[] = [];
  const errors: CsvRowError[] = [];

  rawRows.forEach((row, index) => {
    const line = lineNumbers[index] ?? index + 2; // filet de sécurité, ne devrait pas arriver

    const contentIdRaw = (row["content_id"] ?? "").trim();
    const contentId = Number(contentIdRaw);
    if (contentIdRaw === "" || !Number.isInteger(contentId)) {
      errors.push({ line, message: `content_id invalide : "${row["content_id"] ?? ""}" doit être un entier` });
      return;
    }

    const platform = (row["platform"] ?? "").trim();
    if (platform === "") {
      errors.push({ line, message: "platform manquant" });
      return;
    }

    const saves = parseNonNegativeIntOrNull(row["saves"], "saves");
    if ("error" in saves) { errors.push({ line, message: saves.error }); return; }

    const shares = parseNonNegativeIntOrNull(row["shares"], "shares");
    if ("error" in shares) { errors.push({ line, message: shares.error }); return; }

    const comments = parseNonNegativeIntOrNull(row["comments"], "comments");
    if ("error" in comments) { errors.push({ line, message: comments.error }); return; }

    const reach = parseNonNegativeIntOrNull(row["reach"], "reach");
    if ("error" in reach) { errors.push({ line, message: reach.error }); return; }

    const measuredAt = parseMeasuredAt(row["measured_at"]);
    if ("error" in measuredAt) { errors.push({ line, message: measuredAt.error }); return; }

    const sentimentScore = parseSentiment(row["sentiment_score"]);
    if ("error" in sentimentScore) { errors.push({ line, message: sentimentScore.error }); return; }

    rows.push({
      contentId,
      platform,
      saves: saves.value,
      shares: shares.value,
      comments: comments.value,
      reach: reach.value,
      sentimentScore: sentimentScore.value,
      measuredAt: measuredAt.value,
    });
  });

  return { rows, errors };
}

/**
 * L'adaptateur manuel n'expose pas de lecture : la saisie manuelle est POUSSÉE dans le
 * système (formulaire ou import CSV via `parseReceptionCsv`), jamais TIRÉE depuis une
 * source externe. `fetchSignals` n'a donc rien à interroger.
 */
export const manualSource: ReceptionSource = {
  name: "manual",
  async fetchSignals() {
    throw new Error(
      "L'adaptateur manuel ne peut pas être « tiré » : la réception saisie à la main est " +
        "poussée dans le système via `parseReceptionCsv` (import CSV) ou un formulaire, jamais " +
        "récupérée par un appel sortant. Utilise l'import CSV pour ingérer ces données.",
    );
  },
};
